import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { inflateRawSync } from "node:zlib";
import { isRecord } from "@deepwrite/shared";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
// A Write Claw long-book export contains one stage projection plus three
// readable chapter projections per chapter. 4,096 therefore rejects valid
// books at only about one thousand chapters. Keep a bounded classic-ZIP scan,
// but allow the scale that the archive byte limits can safely carry.
const MAX_ARCHIVE_ENTRIES = 65_534;
const MAX_ARCHIVE_PATH_BYTES = 4_096;
const MAX_TOTAL_ARCHIVE_PATH_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_AUTHORITY_JSON_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_EVIDENCE_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 500;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface WriteClawLongArchiveSource {
  sourceKind: "write-claw-zip" | "long-workspace-json" | "book-json";
  book: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
  /**
   * Extra UTF-8 artifacts exported by Write Claw that do not have a direct
   * structural equivalent in the current long-form model. The importer keeps
   * them as indexed migration-evidence Markdown instead of silently dropping
   * them.
   */
  evidenceFiles: Array<{
    archivePath: string;
    content: string;
  }>;
  warnings: string[];
}

function checkedRange(
  buffer: Buffer,
  offset: number,
  length: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new Error(`旧版本长篇压缩包中的${label}已损坏。`);
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label}不是有效的 UTF-8 文本。`);
  }
}

function normalizeArchivePath(rawName: string): string {
  if (rawName.includes("\\")) {
    throw new Error("旧版本长篇压缩包包含反斜杠文件路径。");
  }
  const name = rawName.normalize("NFC");
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(name)
  ) {
    throw new Error("旧版本长篇压缩包包含不安全的文件路径。");
  }
  const directory = name.endsWith("/");
  const path = directory ? name.slice(0, -1) : name;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error("旧版本长篇压缩包包含不安全的文件路径。");
  }
  return directory ? `${path}/` : path;
}

function archivePathKey(path: string): string {
  // The archive is never extracted by its original names. Write Claw can
  // legitimately emit case-distinct redundant projections on a
  // case-sensitive source filesystem, so only exact NFC aliases are
  // duplicates here.
  return path.normalize("NFC");
}

function readZipEntries(archive: Buffer): ZipEntry[] {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  let endOffset = -1;
  let directoryOffset = -1;
  let directorySize = 0;
  let entryCount = 0;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    checkedRange(archive, offset, 22, "目录结尾");
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== archive.length) {
      continue;
    }
    if (
      archive.readUInt16LE(offset + 4) !== 0 ||
      archive.readUInt16LE(offset + 6) !== 0
    ) {
      throw new Error("暂不支持旧版本长篇分卷压缩包。");
    }
    const entriesOnDisk = archive.readUInt16LE(offset + 8);
    entryCount = archive.readUInt16LE(offset + 10);
    if (entriesOnDisk !== entryCount) {
      throw new Error("旧版本长篇压缩包的分卷目录信息无效。");
    }
    directorySize = archive.readUInt32LE(offset + 12);
    directoryOffset = archive.readUInt32LE(offset + 16);
    if (
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new Error("暂不支持旧版本长篇 ZIP64 压缩包。");
    }
    endOffset = offset;
    break;
  }
  if (endOffset < 0 || directoryOffset < 0) {
    throw new Error("无效的旧版本长篇 ZIP：找不到压缩包目录。");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error("旧版本长篇压缩包文件数量超过安全上限。");
  }
  checkedRange(archive, directoryOffset, directorySize, "文件目录");
  if (directoryOffset + directorySize > endOffset) {
    throw new Error("旧版本长篇压缩包的文件目录范围无效。");
  }

  const entries: ZipEntry[] = [];
  const pathKeys = new Set<string>();
  let totalUncompressedBytes = 0;
  let totalPathBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    checkedRange(archive, cursor, 46, "文件目录项");
    if (archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("旧版本长篇压缩包的文件目录已损坏。");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const crc32 = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    checkedRange(archive, cursor, recordLength, "文件目录项");
    if (nameLength > MAX_ARCHIVE_PATH_BYTES) {
      throw new Error("旧版本长篇压缩包包含过长的文件路径。");
    }
    totalPathBytes += nameLength;
    if (totalPathBytes > MAX_TOTAL_ARCHIVE_PATH_BYTES) {
      throw new Error("旧版本长篇压缩包的文件路径总量超过安全上限。");
    }
    const name = normalizeArchivePath(
      decodeUtf8(
        archive.subarray(cursor + 46, cursor + 46 + nameLength),
        "旧版本长篇压缩包文件名"
      )
    );
    const pathKey = archivePathKey(name);
    if (pathKeys.has(pathKey)) {
      throw new Error(`旧版本长篇压缩包包含重复文件：${name}。`);
    }
    pathKeys.add(pathKey);

    if (!name.endsWith("/")) {
      if ((flags & 0x41) !== 0) {
        throw new Error("旧版本长篇压缩包已加密，无法导入。");
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`旧版本长篇压缩包使用了不支持的压缩方式：${method}。`);
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error("旧版本长篇压缩包解压后总大小超过安全上限。");
      }
      if (
        uncompressedSize > 1024 * 1024 &&
        compressedSize * MAX_COMPRESSION_RATIO < uncompressedSize
      ) {
        throw new Error(
          `旧版本长篇压缩包中的“${name}”压缩率异常，已拒绝导入。`
        );
      }
      entries.push({
        name,
        flags,
        method,
        crc32,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
    }
    cursor += recordLength;
  }
  if (cursor !== directoryOffset + directorySize) {
    throw new Error("旧版本长篇压缩包的文件目录长度不一致。");
  }
  return entries;
}

let crcTable: Uint32Array | undefined;

function crc32(content: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let result = 0xffffffff;
  for (const byte of content) {
    result = crcTable[(result ^ byte) & 0xff]! ^ (result >>> 8);
  }
  return (result ^ 0xffffffff) >>> 0;
}

function readZipEntry(
  archive: Buffer,
  entry: ZipEntry,
  maxEntryBytes = MAX_EVIDENCE_ENTRY_BYTES
): Buffer {
  if (entry.uncompressedSize > maxEntryBytes) {
    throw new Error(
      `旧版本长篇压缩包中的“${entry.name}”超过 ${Math.floor(
        maxEntryBytes / 1024 / 1024
      )} MB 安全上限。`
    );
  }
  checkedRange(archive, entry.localHeaderOffset, 30, `文件“${entry.name}”`);
  if (archive.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`旧版本长篇压缩包中文件“${entry.name}”的本地头已损坏。`);
  }
  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  if (nameLength > MAX_ARCHIVE_PATH_BYTES) {
    throw new Error(`旧版本长篇压缩包中文件“${entry.name}”的本地路径过长。`);
  }
  checkedRange(
    archive,
    entry.localHeaderOffset + 30,
    nameLength + extraLength,
    `文件“${entry.name}”`
  );
  const localName = normalizeArchivePath(
    decodeUtf8(
      archive.subarray(
        entry.localHeaderOffset + 30,
        entry.localHeaderOffset + 30 + nameLength
      ),
      "旧版本长篇压缩包文件名"
    )
  );
  if (
    localName !== entry.name ||
    localMethod !== entry.method ||
    (localFlags & 0x41) !== (entry.flags & 0x41)
  ) {
    throw new Error(`旧版本长篇压缩包中文件“${entry.name}”的目录信息不一致。`);
  }
  const contentOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  checkedRange(
    archive,
    contentOffset,
    entry.compressedSize,
    `文件“${entry.name}”`
  );
  const compressed = archive.subarray(
    contentOffset,
    contentOffset + entry.compressedSize
  );
  let content: Buffer;
  try {
    content =
      entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, {
            maxOutputLength: maxEntryBytes
          });
  } catch {
    throw new Error(`旧版本长篇压缩包中文件“${entry.name}”无法安全解压。`);
  }
  if (
    content.length !== entry.uncompressedSize ||
    crc32(content) !== entry.crc32
  ) {
    throw new Error(`旧版本长篇压缩包中文件“${entry.name}”的完整性校验失败。`);
  }
  return content;
}

function parseJsonObject(
  content: Uint8Array,
  label: string
): Record<string, unknown> {
  const text = decodeUtf8(content, label).replace(/^\uFEFF/u, "");
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(`${label}不是有效的 JSON 对象。`);
  }
}

interface AuthorityEntrySelection {
  entry: ZipEntry | undefined;
  warnings: string[];
}

function summarizedEntryPaths(entries: readonly ZipEntry[]): string {
  const visible = entries
    .slice(0, 8)
    .map(
      ({ name }) => `“${name.length > 240 ? `${name.slice(0, 237)}...` : name}”`
    );
  const remaining = entries.length - visible.length;
  return `${visible.join("、")}${remaining > 0 ? `等 ${entries.length} 个路径` : ""}`;
}

function authorityEntryDigest(archive: Buffer, entry: ZipEntry): string {
  return createHash("sha256")
    .update(readZipEntry(archive, entry, MAX_AUTHORITY_JSON_ENTRY_BYTES))
    .digest("hex");
}

function compareEntryPaths(left: ZipEntry, right: ZipEntry): number {
  if (left.name.length !== right.name.length) {
    return left.name.length - right.name.length;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function selectAuthorityEntry(
  archive: Buffer,
  entries: readonly ZipEntry[],
  basename: string
): AuthorityEntrySelection {
  const matches = entries.filter(
    ({ name }) => name === basename || name.endsWith(`/${basename}`)
  );
  if (matches.length <= 1) {
    return { entry: matches[0], warnings: [] };
  }

  const rootEntry = matches.find(({ name }) => name === basename);
  if (rootEntry) {
    const ignored = matches.filter((entry) => entry !== rootEntry);
    return {
      entry: rootEntry,
      warnings: [
        `压缩包包含多份 ${basename}，已优先采用根目录“${basename}”，并忽略 ${summarizedEntryPaths(ignored)}。`
      ]
    };
  }

  const ordered = [...matches].sort(compareEntryPaths);
  const selected = ordered[0]!;
  const selectedDigest = authorityEntryDigest(archive, selected);
  const identical = ordered
    .slice(1)
    .every((entry) => authorityEntryDigest(archive, entry) === selectedDigest);
  if (identical) {
    return {
      entry: selected,
      warnings: [
        `压缩包包含多份内容相同的 ${basename}，已自动去重并采用“${selected.name}”；候选路径：${summarizedEntryPaths(ordered)}。`
      ]
    };
  }

  throw new Error(
    `旧版本长篇压缩包包含多份内容不一致的 ${basename}：${summarizedEntryPaths(ordered)}。请只保留需要导入的一份后重新压缩。`
  );
}

function workspaceFromBook(
  book: Record<string, unknown>
): Record<string, unknown> | null {
  return isRecord(book.long_workspace) ? book.long_workspace : null;
}

function assertLongBook(book: Record<string, unknown> | null): void {
  if (
    book &&
    typeof book.book_type === "string" &&
    book.book_type.trim() !== "" &&
    book.book_type !== "long"
  ) {
    throw new Error("选择的旧版本书籍不是长篇创作空间。");
  }
}

function readZipSource(archive: Buffer): WriteClawLongArchiveSource {
  const entries = readZipEntries(archive);
  const bookSelection = selectAuthorityEntry(archive, entries, "book.json");
  const workspaceSelection = selectAuthorityEntry(
    archive,
    entries,
    "long_workspace.json"
  );
  const metadataSelection = selectAuthorityEntry(
    archive,
    entries,
    "metadata.json"
  );
  const bookEntry = bookSelection.entry;
  const workspaceEntry = workspaceSelection.entry;
  const metadataEntry = metadataSelection.entry;
  const warnings: string[] = [
    ...bookSelection.warnings,
    ...workspaceSelection.warnings,
    ...metadataSelection.warnings
  ];
  const standaloneWorkspace = workspaceEntry
    ? parseJsonObject(
        readZipEntry(archive, workspaceEntry, MAX_AUTHORITY_JSON_ENTRY_BYTES),
        workspaceEntry.name
      )
    : null;
  let book: Record<string, unknown> | null = null;
  if (bookEntry) {
    try {
      book = parseJsonObject(
        readZipEntry(archive, bookEntry, MAX_AUTHORITY_JSON_ENTRY_BYTES),
        bookEntry.name
      );
    } catch (error: unknown) {
      if (!standaloneWorkspace) throw error;
      warnings.push(
        `压缩包中的 ${bookEntry.name} 未能作为元数据读取，已继续采用独立 long_workspace.json：${
          error instanceof Error ? error.message : "无法安全读取。"
        }`
      );
    }
  }
  if (!book && metadataEntry) {
    try {
      const metadata = parseJsonObject(
        readZipEntry(archive, metadataEntry, MAX_AUTHORITY_JSON_ENTRY_BYTES),
        metadataEntry.name
      );
      if (
        (metadata.library_type === "book" ||
          metadata.library_type === "workspace") &&
        isRecord(metadata.data)
      ) {
        book = metadata.data;
      }
    } catch (error: unknown) {
      if (!standaloneWorkspace) throw error;
      warnings.push(
        `压缩包中的 ${metadataEntry.name} 未能作为元数据读取，已继续采用独立 long_workspace.json：${
          error instanceof Error ? error.message : "无法安全读取。"
        }`
      );
    }
  }
  assertLongBook(book);
  const embeddedWorkspace = book ? workspaceFromBook(book) : null;
  const workspace = standaloneWorkspace ?? embeddedWorkspace;
  if (!workspace) {
    throw new Error(
      "无效的 旧版本长篇压缩包：缺少 long_workspace.json 或 book.json.long_workspace。"
    );
  }
  if (standaloneWorkspace && embeddedWorkspace) {
    warnings.push("压缩包同时包含两份长篇工作区，已采用 long_workspace.json。");
  }
  const evidenceFiles: WriteClawLongArchiveSource["evidenceFiles"] = [];
  for (const entry of entries) {
    const isExpertDraft =
      entry.name === "expert_draft.json" ||
      entry.name.endsWith("/expert_draft.json");
    const isExportedFile =
      entry.name.startsWith("files/") || entry.name.includes("/files/");
    if (!isExpertDraft && !isExportedFile) continue;
    try {
      evidenceFiles.push({
        archivePath: entry.name,
        content: decodeUtf8(
          readZipEntry(archive, entry),
          `旧版本长篇压缩包文件“${entry.name}”`
        )
      });
    } catch (error: unknown) {
      warnings.push(
        `旧版附件“${entry.name}”未能迁移：${
          error instanceof Error ? error.message : "无法安全读取。"
        }`
      );
    }
  }
  return {
    sourceKind: "write-claw-zip",
    book,
    workspace,
    evidenceFiles,
    warnings
  };
}

function looksLikeZip(content: Buffer, sourceName: string): boolean {
  return (
    sourceName.toLocaleLowerCase("en-US").endsWith(".zip") ||
    (content.length >= 4 &&
      (content.readUInt32LE(0) === LOCAL_FILE_SIGNATURE ||
        content.readUInt32LE(0) === END_OF_CENTRAL_DIRECTORY_SIGNATURE))
  );
}

export function parseWriteClawLongSourceBytes(
  rawContent: Uint8Array,
  sourceName: string
): WriteClawLongArchiveSource {
  const content = Buffer.from(rawContent);
  if (content.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("旧版本长篇导入文件超过 256 MB 安全上限。");
  }
  if (looksLikeZip(content, sourceName)) {
    return readZipSource(content);
  }
  if (content.byteLength > MAX_AUTHORITY_JSON_ENTRY_BYTES) {
    throw new Error("旧版本长篇 JSON 超过 128 MB 安全上限。");
  }
  const value = parseJsonObject(content, sourceName || "长篇 JSON");
  const lowerName = sourceName.toLocaleLowerCase("en-US");
  const isBook =
    lowerName.endsWith("book.json") ||
    "long_workspace" in value ||
    "book_type" in value;
  if (isBook) {
    assertLongBook(value);
    const workspace = workspaceFromBook(value);
    if (!workspace) {
      throw new Error("旧版本 book.json 缺少 long_workspace。");
    }
    return {
      sourceKind: "book-json",
      book: value,
      workspace,
      evidenceFiles: [],
      warnings: []
    };
  }
  return {
    sourceKind: "long-workspace-json",
    book: null,
    workspace: value,
    evidenceFiles: [],
    warnings: []
  };
}

export async function readWriteClawLongSource(
  path: string
): Promise<WriteClawLongArchiveSource> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ELOOP"
    ) {
      throw new Error("选择的 旧版本长篇导入来源不能是符号链接。");
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1) {
      throw new Error("选择的 旧版本长篇导入来源必须是无硬链接的普通文件。");
    }
    if (info.size > MAX_ARCHIVE_BYTES) {
      throw new Error("旧版本长篇导入文件超过 256 MB 安全上限。");
    }
    const canonicalPath = await realpath(path);
    const pathInfo = await lstat(path);
    if (
      pathInfo.isSymbolicLink() ||
      pathInfo.dev !== info.dev ||
      pathInfo.ino !== info.ino
    ) {
      throw new Error("旧版本长篇导入来源在读取期间发生替换。");
    }
    const content = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== info.dev ||
      after.ino !== info.ino ||
      after.size !== content.byteLength ||
      content.byteLength > MAX_ARCHIVE_BYTES
    ) {
      throw new Error("旧版本长篇导入来源在读取期间发生变化。");
    }
    return parseWriteClawLongSourceBytes(content, canonicalPath);
  } finally {
    await handle.close();
  }
}
