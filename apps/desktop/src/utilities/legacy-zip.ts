import { readFile, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface LegacyZipArchive {
  readonly entryNames: readonly string[];
  read(name: string): Buffer | undefined;
  readJsonObject(name: string): Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkedRange(
  buffer: Buffer,
  offset: number,
  length: number,
  label: string,
  archiveLabel: string
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new Error(`${archiveLabel}中的${label}已损坏。`);
  }
}

function normalizeArchivePath(rawName: string, archiveLabel: string): string {
  const name = rawName.replaceAll("\\", "/");
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(name) ||
    name.split("/").some((part) => part === "..")
  ) {
    throw new Error(`${archiveLabel}包含不安全的文件路径。`);
  }
  return name.replace(/^\.\//u, "");
}

function readZipEntries(archive: Buffer, archiveLabel: string): ZipEntry[] {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  let directoryOffset = -1;
  let entryCount = 0;
  let directorySize = 0;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    checkedRange(archive, offset, 22, "目录结尾", archiveLabel);
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== archive.length) {
      continue;
    }
    if (archive.readUInt16LE(offset + 4) !== 0 || archive.readUInt16LE(offset + 6) !== 0) {
      throw new Error(`暂不支持分卷${archiveLabel}。`);
    }
    entryCount = archive.readUInt16LE(offset + 10);
    directorySize = archive.readUInt32LE(offset + 12);
    directoryOffset = archive.readUInt32LE(offset + 16);
    if (
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new Error(`${archiveLabel}过大，暂不支持 ZIP64 格式。`);
    }
    break;
  }
  if (directoryOffset < 0) {
    throw new Error(`无效的 zip 文件：${archiveLabel}中找不到压缩包目录。`);
  }
  checkedRange(archive, directoryOffset, directorySize, "文件目录", archiveLabel);
  const entries: ZipEntry[] = [];
  const entryNames = new Set<string>();
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    checkedRange(archive, cursor, 46, "文件目录项", archiveLabel);
    if (archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`${archiveLabel}的文件目录已损坏。`);
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    checkedRange(archive, cursor, recordLength, "文件目录项", archiveLabel);
    const name = normalizeArchivePath(
      archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      archiveLabel
    );
    if (!name.endsWith("/")) {
      if (entryNames.has(name)) {
        throw new Error(`${archiveLabel}包含重复文件：${name}。`);
      }
      if ((flags & 0x1) !== 0) {
        throw new Error(`${archiveLabel}已加密，无法导入。`);
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`${archiveLabel}使用了不支持的压缩方式：${method}。`);
      }
      entries.push({
        name,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      entryNames.add(name);
    }
    cursor += recordLength;
  }
  return entries;
}

function readZipEntry(
  archive: Buffer,
  entry: ZipEntry,
  archiveLabel: string
): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`${archiveLabel}中的文件“${entry.name}”超过 32 MB 安全上限。`);
  }
  checkedRange(
    archive,
    entry.localHeaderOffset,
    30,
    `文件“${entry.name}”`,
    archiveLabel
  );
  if (archive.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`${archiveLabel}中文件“${entry.name}”的本地头已损坏。`);
  }
  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  checkedRange(
    archive,
    entry.localHeaderOffset + 30,
    nameLength + extraLength,
    `文件“${entry.name}”`,
    archiveLabel
  );
  const localName = normalizeArchivePath(
    archive
      .subarray(
        entry.localHeaderOffset + 30,
        entry.localHeaderOffset + 30 + nameLength
      )
      .toString("utf8"),
    archiveLabel
  );
  if (localName !== entry.name) {
    throw new Error(`${archiveLabel}中文件“${entry.name}”的目录名称不一致。`);
  }
  const contentOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  checkedRange(
    archive,
    contentOffset,
    entry.compressedSize,
    `文件“${entry.name}”`,
    archiveLabel
  );
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  const content = entry.method === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  if (content.length !== entry.uncompressedSize) {
    throw new Error(`${archiveLabel}中文件“${entry.name}”的长度校验失败。`);
  }
  return content;
}

export async function openLegacyZipArchive(
  path: string,
  archiveLabel: string
): Promise<LegacyZipArchive> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`选择的${archiveLabel}不是普通文件。`);
  }
  if (info.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`${archiveLabel}超过 256 MB 安全上限。`);
  }
  const archive = await readFile(path);
  const entries = readZipEntries(archive, archiveLabel);
  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const read = (name: string): Buffer | undefined => {
    const entry = byName.get(name);
    return entry ? readZipEntry(archive, entry, archiveLabel) : undefined;
  };
  return {
    entryNames: entries.map(({ name }) => name),
    read,
    readJsonObject(name) {
      const content = read(name);
      if (!content) {
        return undefined;
      }
      try {
        const value = JSON.parse(
          content.toString("utf8").replace(/^\uFEFF/u, "")
        ) as unknown;
        return isRecord(value) ? value : undefined;
      } catch {
        throw new Error(`${archiveLabel}中的 ${name} 不是有效 JSON。`);
      }
    }
  };
}
