import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle
} from "node:fs/promises";
import { dirname, extname } from "node:path";
import { TextDecoder } from "node:util";
import { crc32 as zlibCrc32, deflateRawSync, inflateRawSync } from "node:zlib";
import {
  LOCAL_BACKUP_MAX_ARCHIVE_BYTES,
  LOCAL_BACKUP_MAX_ENTRIES,
  LOCAL_BACKUP_MAX_ENTRY_BYTES
} from "@deepwrite/contracts";
import { isRecord, randomHex8, zipDateTime } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";
import { LocalBackupError } from "./errors";
import {
  NOFOLLOW_READ_FLAGS,
  caseFoldPathKey,
  normalizeBackupArchivePath
} from "./paths";

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FILENAME_FLAG = 0x0800;
const MAX_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024;
const PREFER_STORE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".gz",
  ".zip"
]);

export interface BackupArchiveWriteEntry {
  archivePath: string;
  readBytes: () => Promise<Buffer>;
}

interface CentralRecord {
  nameBytes: Buffer;
  method: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface VerifiedZipEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface VerifiedBackupZipArchive {
  readonly entryNames: readonly string[];
  readonly totalUncompressedBytes: number;
  sizeOf(name: string): number | undefined;
  has(name: string): boolean;
  readEntry(name: string): Promise<Buffer>;
  readJsonObject(name: string): Promise<Record<string, unknown> | undefined>;
  close(): Promise<void>;
}

function decodeZipEntryName(bytes: Buffer, flags: number): string {
  if ((flags & UTF8_FILENAME_FLAG) !== 0) {
    return bytes.toString("utf8");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

async function writeFull(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset
    );
    if (bytesWritten <= 0) {
      throw new LocalBackupError(
        "local_backup.operation_failed",
        "写入备份文件失败。"
      );
    }
    offset += bytesWritten;
  }
}

async function readExact(
  handle: FileHandle,
  position: number,
  length: number,
  label: string
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(length) ||
    position < 0 ||
    length < 0
  ) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `备份包中的${label}偏移或长度无效。`
    );
  }
  const buffer = Buffer.allocUnsafe(length);
  let totalRead = 0;
  while (totalRead < length) {
    const { bytesRead } = await handle.read(
      buffer,
      totalRead,
      length - totalRead,
      position + totalRead
    );
    if (bytesRead <= 0) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        `备份包意外截断：读取${label}失败。`
      );
    }
    totalRead += bytesRead;
  }
  return buffer;
}

/**
 * Streams backup entries into a `.part` archive using standard ZIP32 format,
 * computes per-file SHA-256 and CRC32, appends the manifest, fsyncs, and
 * atomically renames to `targetPath`. Cleans up `.part` on error or cancel.
 */
export async function writeBackupZipArchive(options: {
  targetPath: string;
  entries: readonly BackupArchiveWriteEntry[];
  manifestEntryName: string;
  buildManifest: (sha256ByPath: Record<string, string>) => Buffer;
  modifiedAt?: Date;
  signal?: AbortSignal;
}): Promise<{ archiveBytes: number; sha256ByPath: Record<string, string> }> {
  const { targetPath, entries, manifestEntryName, buildManifest } = options;
  if (entries.length + 1 > LOCAL_BACKUP_MAX_ENTRIES) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      `备份包含文件数量超过 ZIP32 上限（${LOCAL_BACKUP_MAX_ENTRIES}）。`
    );
  }
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const partPath = `${targetPath}.${process.pid}.${randomHex8()}.part`;
  const { date, time } = zipDateTime(options.modifiedAt ?? new Date());
  const records: CentralRecord[] = [];
  const sha256ByPath: Record<string, string> = {};
  let localOffset = 0;
  let centralBytes = 0;

  const handle = await open(
    partPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600
  );
  let closed = false;

  const appendEntry = async (
    archivePath: string,
    rawData: Buffer,
    recordHash: boolean
  ): Promise<void> => {
    if (options.signal?.aborted) {
      throw new LocalBackupError("local_backup.canceled", "已取消导出备份包。");
    }
    const cleanPath = normalizeBackupArchivePath(archivePath);
    if (rawData.byteLength > LOCAL_BACKUP_MAX_ENTRY_BYTES) {
      throw new LocalBackupError(
        "local_backup.operation_failed",
        `文件「${cleanPath}」超过单文件 64 MB 打包上限。`
      );
    }
    const nameBytes = Buffer.from(cleanPath, "utf8");
    const checksum = zlibCrc32(rawData) >>> 0;
    if (recordHash) {
      sha256ByPath[cleanPath] = sha256Hex(rawData);
    }
    const preferStore =
      rawData.byteLength === 0 ||
      PREFER_STORE_EXTENSIONS.has(extname(cleanPath).toLowerCase());
    let method = 0;
    let payload = rawData;
    if (!preferStore) {
      const deflated = deflateRawSync(rawData);
      if (deflated.byteLength < rawData.byteLength) {
        method = 8;
        payload = deflated;
      }
    }
    const nextCentralBytes = centralBytes + 46 + nameBytes.length;
    const nextLocalEnd = localOffset + 30 + nameBytes.length + payload.length;
    if (
      nextLocalEnd + nextCentralBytes + 22 > LOCAL_BACKUP_MAX_ARCHIVE_BYTES ||
      nextLocalEnd > 0xfffffffe
    ) {
      throw new LocalBackupError(
        "local_backup.operation_failed",
        "备份包总体积超过 2 GB 安全上限，请分批勾选导出。"
      );
    }
    const localHeader = Buffer.allocUnsafe(30);
    localHeader.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FILENAME_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    await writeFull(handle, localHeader);
    await writeFull(handle, nameBytes);
    if (payload.length > 0) {
      await writeFull(handle, payload);
    }

    records.push({
      nameBytes,
      method,
      checksum,
      compressedSize: payload.length,
      uncompressedSize: rawData.length,
      localOffset
    });
    localOffset = nextLocalEnd;
    centralBytes = nextCentralBytes;
  };

  try {
    for (const entry of entries) {
      if (options.signal?.aborted) {
        throw new LocalBackupError(
          "local_backup.canceled",
          "已取消导出备份包。"
        );
      }
      const data = await entry.readBytes();
      await appendEntry(entry.archivePath, data, true);
    }
    const manifestBuffer = buildManifest(sha256ByPath);
    await appendEntry(manifestEntryName, manifestBuffer, false);

    for (const record of records) {
      const central = Buffer.allocUnsafe(46);
      central.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(UTF8_FILENAME_FLAG, 8);
      central.writeUInt16LE(record.method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(record.checksum, 16);
      central.writeUInt32LE(record.compressedSize, 20);
      central.writeUInt32LE(record.uncompressedSize, 24);
      central.writeUInt16LE(record.nameBytes.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(record.localOffset, 42);
      await writeFull(handle, central);
      await writeFull(handle, record.nameBytes);
    }

    const eocd = Buffer.allocUnsafe(22);
    eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(records.length, 8);
    eocd.writeUInt16LE(records.length, 10);
    eocd.writeUInt32LE(centralBytes, 12);
    eocd.writeUInt32LE(localOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await writeFull(handle, eocd);

    if (options.signal?.aborted) {
      throw new LocalBackupError("local_backup.canceled", "已取消导出备份包。");
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(partPath, targetPath);
    return {
      archiveBytes: localOffset + centralBytes + 22,
      sha256ByPath
    };
  } catch (error: unknown) {
    if (!closed) {
      await handle.close().catch(() => undefined);
    }
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Opens a `.dwbackup.zip` via random-access FileHandle and verifies EOCD,
 * Central Directory, Local Headers, CRC32, path safety, and decompression limits.
 */
export async function openVerifiedBackupZipArchive(
  archivePath: string
): Promise<VerifiedBackupZipArchive> {
  let info;
  try {
    info = await lstat(archivePath);
  } catch {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      "所选备份文件不存在或无法读取。"
    );
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      "备份文件必须是普通本地文件，不能使用符号链接或目录。"
    );
  }
  if (info.size < 22 || info.size > LOCAL_BACKUP_MAX_ARCHIVE_BYTES) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      "备份文件体积异常或超过 2 GB 安全上限。"
    );
  }

  const handle = await open(archivePath, NOFOLLOW_READ_FLAGS);
  try {
    const tailLength = Math.min(info.size, 65_557);
    const tailStart = info.size - tailLength;
    const tail = await readExact(handle, tailStart, tailLength, "目录结尾");

    let eocdOffset = -1;
    let entryCount = 0;
    let cdSize = 0;
    let cdOffset = 0;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        continue;
      }
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength !== tail.length) {
        continue;
      }
      if (
        tail.readUInt16LE(offset + 4) !== 0 ||
        tail.readUInt16LE(offset + 6) !== 0 ||
        tail.readUInt16LE(offset + 8) !== tail.readUInt16LE(offset + 10)
      ) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "暂不支持分卷 ZIP 备份包。"
        );
      }
      entryCount = tail.readUInt16LE(offset + 10);
      cdSize = tail.readUInt32LE(offset + 12);
      cdOffset = tail.readUInt32LE(offset + 16);
      if (
        entryCount === 0xffff ||
        cdSize === 0xffffffff ||
        cdOffset === 0xffffffff
      ) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "暂不支持 ZIP64 格式备份包。"
        );
      }
      eocdOffset = tailStart + offset;
      break;
    }

    if (eocdOffset < 0) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        "文件不是有效的 ZIP 备份包（找不到压缩目录结尾）。"
      );
    }
    if (entryCount > LOCAL_BACKUP_MAX_ENTRIES) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        `备份包文件数超过上限（${LOCAL_BACKUP_MAX_ENTRIES}）。`
      );
    }
    if (
      cdSize > MAX_CENTRAL_DIRECTORY_BYTES ||
      cdOffset + cdSize > eocdOffset
    ) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        "备份包的中央目录区已损坏或越界。"
      );
    }

    const cdBuffer = await readExact(handle, cdOffset, cdSize, "中央目录");
    const entries: VerifiedZipEntry[] = [];
    const byName = new Map<string, VerifiedZipEntry>();
    const seenFoldedNames = new Set<string>();
    let totalUncompressedBytes = 0;
    let cursor = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > cdBuffer.length) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "备份包中央目录条目已截断。"
        );
      }
      if (cdBuffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "备份包中央目录签名无效。"
        );
      }
      const flags = cdBuffer.readUInt16LE(cursor + 8);
      const method = cdBuffer.readUInt16LE(cursor + 10);
      const crc = cdBuffer.readUInt32LE(cursor + 16);
      const compressedSize = cdBuffer.readUInt32LE(cursor + 20);
      const uncompressedSize = cdBuffer.readUInt32LE(cursor + 24);
      const nameLength = cdBuffer.readUInt16LE(cursor + 28);
      const extraLength = cdBuffer.readUInt16LE(cursor + 30);
      const commentLength = cdBuffer.readUInt16LE(cursor + 32);
      const localHeaderOffset = cdBuffer.readUInt32LE(cursor + 42);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (cursor + recordLength > cdBuffer.length) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "备份包中央目录条目长度越界。"
        );
      }
      const rawName = decodeZipEntryName(
        cdBuffer.subarray(cursor + 46, cursor + 46 + nameLength),
        flags
      );
      cursor += recordLength;

      if (rawName.replaceAll("\\", "/").endsWith("/")) {
        continue;
      }
      const name = normalizeBackupArchivePath(rawName);
      const folded = caseFoldPathKey(name);
      if (byName.has(name) || seenFoldedNames.has(folded)) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包包含重复或大小写冲突的文件路径：${name}`
        );
      }
      if ((flags & 0x1) !== 0) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          "暂不支持导入加密的备份包。"
        );
      }
      if (method !== 0 && method !== 8) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包使用了不支持的压缩方式（${method}）。`
        );
      }
      if (uncompressedSize > LOCAL_BACKUP_MAX_ENTRY_BYTES) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包内文件「${name}」超过单文件 64 MB 安全上限。`
        );
      }
      if (localHeaderOffset + 30 + compressedSize > cdOffset) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包内文件「${name}」的本地记录越界。`
        );
      }

      totalUncompressedBytes += uncompressedSize;
      const entry: VerifiedZipEntry = {
        name,
        flags,
        method,
        crc32: crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      };
      entries.push(entry);
      byName.set(name, entry);
      seenFoldedNames.add(folded);
    }

    if (cursor !== cdBuffer.length) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        "备份包中央目录总长度与条目数不匹配。"
      );
    }

    const readEntry = async (name: string): Promise<Buffer> => {
      const entry = byName.get(name);
      if (!entry) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包缺少预期文件：${name}`
        );
      }
      const localHeader = await readExact(
        handle,
        entry.localHeaderOffset,
        30,
        `文件「${entry.name}」本地头`
      );
      if (localHeader.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `文件「${entry.name}」本地头签名已损坏。`
        );
      }
      const localFlags = localHeader.readUInt16LE(6);
      const localMethod = localHeader.readUInt16LE(8);
      const localCrc = localHeader.readUInt32LE(14);
      const localCompressedSize = localHeader.readUInt32LE(18);
      const localUncompressedSize = localHeader.readUInt32LE(22);
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      if (localMethod !== entry.method) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `文件「${entry.name}」的本地头压缩方式与目录不一致。`
        );
      }
      if ((localFlags & 0x08) === 0) {
        if (
          localCrc !== entry.crc32 ||
          localCompressedSize !== entry.compressedSize ||
          localUncompressedSize !== entry.uncompressedSize
        ) {
          throw new LocalBackupError(
            "local_backup.checksum_mismatch",
            `文件「${entry.name}」的头校验信息与中央目录不一致。`
          );
        }
      }
      const localNameBytes = await readExact(
        handle,
        entry.localHeaderOffset + 30,
        localNameLength,
        `文件「${entry.name}」路径`
      );
      const localName = normalizeBackupArchivePath(
        decodeZipEntryName(localNameBytes, localFlags)
      );
      if (localName !== entry.name) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `文件「${entry.name}」的本地文件名与目录不一致。`
        );
      }
      const contentOffset =
        entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
      if (contentOffset + entry.compressedSize > cdOffset) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `文件「${entry.name}」的数据区越界。`
        );
      }
      const compressed =
        entry.compressedSize === 0
          ? Buffer.alloc(0)
          : await readExact(
              handle,
              contentOffset,
              entry.compressedSize,
              `文件「${entry.name}」数据`
            );
      let content: Buffer;
      if (entry.method === 0) {
        content = compressed;
      } else {
        try {
          content = inflateRawSync(compressed, {
            maxOutputLength: LOCAL_BACKUP_MAX_ENTRY_BYTES
          });
        } catch {
          throw new LocalBackupError(
            "local_backup.invalid_archive",
            `文件「${entry.name}」解压失败或超过安全大小限制。`
          );
        }
      }
      if (content.byteLength !== entry.uncompressedSize) {
        throw new LocalBackupError(
          "local_backup.checksum_mismatch",
          `文件「${entry.name}」解压长度校验失败。`
        );
      }
      if (zlibCrc32(content) >>> 0 !== entry.crc32) {
        throw new LocalBackupError(
          "local_backup.checksum_mismatch",
          `文件「${entry.name}」CRC32 校验和不匹配，请重新导出后再试。`
        );
      }
      return content;
    };

    return {
      entryNames: entries.map(({ name }) => name),
      totalUncompressedBytes,
      sizeOf: (name) => byName.get(name)?.uncompressedSize,
      has: (name) => byName.has(name),
      readEntry,
      async readJsonObject(name) {
        if (!byName.has(name)) return undefined;
        const content = await readEntry(name);
        try {
          const parsed: unknown = JSON.parse(
            content.toString("utf8").replace(/^\uFEFF/u, "")
          );
          return isRecord(parsed) ? parsed : undefined;
        } catch {
          throw new LocalBackupError(
            "local_backup.invalid_archive",
            `备份包中的「${name}」不是有效的 JSON 文件。`
          );
        }
      },
      close: () => handle.close()
    };
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}
