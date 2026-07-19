import { readFile, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  ShortBookGenre
} from "@deepwrite/contracts";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_IMPORTED_CONTENT_BYTES = 128 * 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const CORE_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["outline", "大纲"],
  ["draft", "正文编写"]
] as const;

const LEGACY_STAGE_ALIASES: Readonly<Record<string, string>> = {
  qinggan_character: "character_design",
  qinggan_intro: "intro_design",
  qinggan_plot_refine: "plot_refine",
  qinggan_outline: "outline",
  qinggan_draft: "draft",
  qinggan_draft_review: "draft_review"
};

const LEGACY_STAGE_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(CORE_DOCUMENTS),
  draft_review: "正文审阅（旧版）",
  format_conversion: "格式转换（旧版）",
  expert_draft_coordinator: "专家正文总控（旧版）"
};

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ImportedLegacyBookDocument {
  id: string;
  title: string;
  content: string;
}

export interface ImportedLegacyBook {
  title: string;
  genre: ShortBookGenre;
  status: "editing" | "completed";
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
  documents: ImportedLegacyBookDocument[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeTitle(value: unknown): string {
  const title = asString(value).trim();
  return (title || "导入书籍").slice(0, 256);
}

function normalizeGenre(book: Record<string, unknown>): ShortBookGenre {
  const categories = Array.isArray(book.categories)
    ? book.categories.filter((value): value is string => typeof value === "string")
    : [];
  const raw = asString(book.genre).trim() || categories[0]?.trim() || "";
  if (raw === "世情" || raw === "追妻" || raw === "科幻" || raw === "悬疑") {
    return raw;
  }
  if (raw === "现实情感" || raw === "情感") {
    return "追妻";
  }
  return "其他";
}

function normalizedIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function normalizeMaterialLinks(book: Record<string, unknown>): LinkedMaterialIdsByKind {
  const source = isRecord(book.linked_material_ids_by_kind)
    ? book.linked_material_ids_by_kind
    : {};
  const result: LinkedMaterialIdsByKind = {
    character: normalizedIdList(source.character),
    gimmick: normalizedIdList(source.gimmick),
    plot: normalizedIdList(source.plot),
    draft: normalizedIdList(source.draft),
    other: normalizedIdList(source.other)
  };
  const legacyId = asString(book.linked_material_id).trim();
  if (legacyId && !Object.values(result).some((ids) => ids.includes(legacyId))) {
    result.other.push(legacyId);
  }
  return result;
}

function normalizeSkillLinks(book: Record<string, unknown>): LinkedSkillIdsByKind {
  const source = isRecord(book.linked_skill_ids_by_kind)
    ? book.linked_skill_ids_by_kind
    : {};
  const result: LinkedSkillIdsByKind = {
    general: normalizedIdList(source.general),
    plot: normalizedIdList(source.plot),
    style: normalizedIdList(source.style),
    other: normalizedIdList(source.other)
  };
  const legacyId = asString(book.linked_skill_id).trim();
  if (legacyId && !Object.values(result).some((ids) => ids.includes(legacyId))) {
    result.other.push(legacyId);
  }
  return result;
}

function checkedRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new Error(`旧版书籍压缩包中的${label}已损坏。`);
  }
}

function normalizeArchivePath(rawName: string): string {
  const name = rawName.replaceAll("\\", "/");
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(name) ||
    name.split("/").some((part) => part === "..")
  ) {
    throw new Error("旧版书籍压缩包包含不安全的文件路径。");
  }
  return name.replace(/^\.\//u, "");
}

function readZipEntries(archive: Buffer): ZipEntry[] {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  let directoryOffset = -1;
  let entryCount = 0;
  let directorySize = 0;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    checkedRange(archive, offset, 22, "目录结尾");
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== archive.length) {
      continue;
    }
    if (archive.readUInt16LE(offset + 4) !== 0 || archive.readUInt16LE(offset + 6) !== 0) {
      throw new Error("暂不支持分卷旧版书籍压缩包。");
    }
    entryCount = archive.readUInt16LE(offset + 10);
    directorySize = archive.readUInt32LE(offset + 12);
    directoryOffset = archive.readUInt32LE(offset + 16);
    if (
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new Error("旧版书籍压缩包过大，暂不支持 ZIP64 格式。");
    }
    break;
  }
  if (directoryOffset < 0) {
    throw new Error("无效的 zip 文件：找不到压缩包目录。");
  }
  checkedRange(archive, directoryOffset, directorySize, "文件目录");
  const entries: ZipEntry[] = [];
  const entryNames = new Set<string>();
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    checkedRange(archive, cursor, 46, "文件目录项");
    if (archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("旧版书籍压缩包的文件目录已损坏。");
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
    checkedRange(archive, cursor, recordLength, "文件目录项");
    const name = normalizeArchivePath(
      archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    );
    if (!name.endsWith("/")) {
      if (entryNames.has(name)) {
        throw new Error(`旧版书籍压缩包包含重复文件：${name}。`);
      }
      if ((flags & 0x1) !== 0) {
        throw new Error("旧版书籍压缩包已加密，无法导入。");
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`旧版书籍压缩包使用了不支持的压缩方式：${method}。`);
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

function readZipEntry(archive: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`压缩包文件“${entry.name}”超过 32 MB 安全上限。`);
  }
  checkedRange(archive, entry.localHeaderOffset, 30, `文件“${entry.name}”`);
  if (archive.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`压缩包文件“${entry.name}”的本地头已损坏。`);
  }
  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  checkedRange(
    archive,
    entry.localHeaderOffset + 30,
    nameLength + extraLength,
    `文件“${entry.name}”`
  );
  const localName = normalizeArchivePath(
    archive
      .subarray(
        entry.localHeaderOffset + 30,
        entry.localHeaderOffset + 30 + nameLength
      )
      .toString("utf8")
  );
  if (localName !== entry.name) {
    throw new Error(`压缩包文件“${entry.name}”的目录名称不一致。`);
  }
  const contentOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  checkedRange(archive, contentOffset, entry.compressedSize, `文件“${entry.name}”`);
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  const content = entry.method === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  if (content.length !== entry.uncompressedSize) {
    throw new Error(`压缩包文件“${entry.name}”的长度校验失败。`);
  }
  return content;
}

function parseJsonObject(content: Buffer, label: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/u, "")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    throw new Error(`旧版书籍压缩包中的 ${label} 不是有效 JSON。`);
  }
}

function extraDocumentId(stageId: string, index: number): string {
  const safe = stageId
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `legacy-${index + 1}-${safe || "document"}`;
}

function legacyStageTitle(stageId: string): string {
  return LEGACY_STAGE_TITLES[stageId] ?? `旧版文稿 · ${stageId}`;
}

function expertDraftMarkdown(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.sections)) return "";
  return value.sections
    .flatMap((section, index) => {
      if (!isRecord(section)) return [];
      const title = safeTitle(section.title || `小节 ${index + 1}`);
      const body = asString(section.body);
      return body.trim() ? [`## ${title}\n\n${body}`] : [];
    })
    .join("\n\n");
}

function legacyMemoriesMarkdown(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((memory, index) => {
      if (!isRecord(memory)) return [];
      const content = asString(memory.content).trim();
      if (!content) return [];
      const title = safeTitle(memory.title || `记忆 ${index + 1}`);
      const tag = asString(memory.tag).trim();
      return [`## ${title}${tag ? ` · ${tag}` : ""}\n\n${content}`];
    })
    .join("\n\n");
}

export function normalizeLegacyBook(
  rawBook: Record<string, unknown>,
  archivedStageFiles: ReadonlyMap<string, string> = new Map()
): ImportedLegacyBook {
  const rawStages = isRecord(rawBook.stages) ? rawBook.stages : {};
  const stages = new Map<string, string>();
  for (const [rawId, rawContent] of Object.entries(rawStages)) {
    const stageId = LEGACY_STAGE_ALIASES[rawId] ?? rawId;
    const content = asString(rawContent);
    if (!stages.has(stageId)) {
      stages.set(stageId, content);
    }
  }
  for (const [rawId, content] of archivedStageFiles) {
    const stageId = LEGACY_STAGE_ALIASES[rawId] ?? rawId;
    if (!stages.get(stageId)?.trim()) {
      stages.set(stageId, content);
    }
  }
  if (!stages.get("draft")?.trim() && asString(rawBook.content).trim()) {
    stages.set("draft", asString(rawBook.content));
  }

  const documents: ImportedLegacyBookDocument[] = CORE_DOCUMENTS.map(
    ([id, title]) => ({ id, title, content: stages.get(id) ?? "" })
  );
  const coreIds = new Set(CORE_DOCUMENTS.map(([id]) => id));
  for (const [stageId, content] of stages) {
    if (coreIds.has(stageId as (typeof CORE_DOCUMENTS)[number][0]) || !content.trim()) {
      continue;
    }
    documents.push({
      id: extraDocumentId(stageId, documents.length),
      title: legacyStageTitle(stageId),
      content
    });
  }
  const expertDraft = expertDraftMarkdown(rawBook.expert_draft);
  if (expertDraft) {
    documents.push({
      id: extraDocumentId("expert-draft", documents.length),
      title: "专家正文（旧版）",
      content: expertDraft
    });
  }
  const memories = legacyMemoriesMarkdown(rawBook.memories);
  if (memories) {
    documents.push({
      id: extraDocumentId("memories", documents.length),
      title: "书籍记忆（旧版）",
      content: memories
    });
  }
  const contentBytes = documents.reduce(
    (total, document) => total + Buffer.byteLength(document.content, "utf8"),
    0
  );
  if (contentBytes > MAX_IMPORTED_CONTENT_BYTES) {
    throw new Error("旧版书籍正文合计超过 128 MB 安全上限。");
  }
  if (documents.length > 4_096) {
    throw new Error("旧版书籍包含的文稿数量过多，无法安全导入。");
  }

  return {
    title: safeTitle(rawBook.title),
    genre: normalizeGenre(rawBook),
    status: rawBook.status === "completed" ? "completed" : "editing",
    linkedMaterialIdsByKind: normalizeMaterialLinks(rawBook),
    linkedSkillIdsByKind: normalizeSkillLinks(rawBook),
    documents
  };
}

export async function readLegacyBookArchive(path: string): Promise<ImportedLegacyBook> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error("选择的旧版书籍压缩包不是普通文件。");
  }
  if (info.size > MAX_ARCHIVE_BYTES) {
    throw new Error("旧版书籍压缩包超过 256 MB 安全上限。");
  }
  const archive = await readFile(path);
  const entries = readZipEntries(archive);
  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  let book = byName.get("book.json")
    ? parseJsonObject(readZipEntry(archive, byName.get("book.json")!), "book.json")
    : undefined;
  if (!book) {
    const metadataEntry = byName.get("metadata.json");
    const metadata = metadataEntry
      ? parseJsonObject(readZipEntry(archive, metadataEntry), "metadata.json")
      : undefined;
    if (
      metadata &&
      (metadata.library_type === "book" || metadata.library_type === "workspace") &&
      isRecord(metadata.data)
    ) {
      book = metadata.data;
    }
  }
  if (!book) {
    throw new Error("无效的旧版书籍压缩包：缺少 book.json。");
  }
  const stageFiles = new Map<string, string>();
  for (const entry of entries) {
    const match = /^stages\/([^/]+)\.txt$/u.exec(entry.name);
    if (match?.[1]) {
      stageFiles.set(match[1], readZipEntry(archive, entry).toString("utf8"));
    }
  }
  return normalizeLegacyBook(book, stageFiles);
}
