import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  ExternalLibrarySelectionResultSchema,
  type ExternalLibrarySelectionResult,
  type ExternalLibrarySourceKind
} from "@deepwrite/contracts";

const TEXT_OR_WORD_MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAX_BYTES = 20 * 1024 * 1024;
const EXTRACTED_TEXT_MAX_BYTES = 32 * 1024 * 1024;
const WORD_XML_MAX_BYTES = 32 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".doc",
  ".docx",
  ".pdf"
]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

class ExternalDocumentTooLargeError extends Error {}

interface ZipEntry {
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function cleanFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function skillName(content: string): string | undefined {
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return undefined;
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  );
  if (closingIndex < 0) return undefined;
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^name\s*:(.*)$/iu.exec(line);
    if (!match) continue;
    const name = cleanFrontmatterValue(match[1] ?? "");
    return name || undefined;
  }
  return undefined;
}

function candidateTitle(path: string, content: string): string {
  const fileName = basename(path);
  const rawTitle =
    fileName.toLowerCase() === "skill.md"
      ? (skillName(content) ?? basename(dirname(path)))
      : basename(fileName, extname(fileName));
  const normalized = rawTitle.replace(/\s+/gu, " ").trim();
  return (normalized || "未命名条目").slice(0, 256);
}

function isReadableLegacyWordCodePoint(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

function readableRuns(value: string, minimumLength: number): string[] {
  const runs: string[] = [];
  let current = "";
  for (const character of value) {
    if (isReadableLegacyWordCodePoint(character.codePointAt(0) ?? 0)) {
      current += character;
    } else {
      if (current.trim().length >= minimumLength) runs.push(current);
      current = "";
    }
  }
  if (current.trim().length >= minimumLength) runs.push(current);
  return runs;
}

function extractLegacyWordText(bytes: Uint8Array): string {
  const runs: string[] = [];
  for (const offset of [0, 1]) {
    let value = "";
    for (let index = offset; index + 1 < bytes.length; index += 2) {
      value += String.fromCharCode(bytes[index]! | (bytes[index + 1]! << 8));
    }
    runs.push(...readableRuns(value, 4));
  }
  try {
    runs.push(...readableRuns(new TextDecoder("gb18030").decode(bytes), 6));
  } catch {
    runs.push(...readableRuns(new TextDecoder().decode(bytes), 6));
  }
  const seen = new Set<string>();
  return runs
    .flatMap((run) =>
      run
        .split("\u0000")
        .join("")
        .split(/\r?\n+/u)
    )
    .map((line) =>
      line
        .replace(/\u00a0/gu, " ")
        .replace(/[ \t]+/gu, " ")
        .trim()
    )
    .filter((line) => {
      if (line.length < 2 || seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join("\n");
}

function findZipEntry(bytes: Uint8Array, expectedName: string): ZipEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Word 文档 ZIP 目录损坏。");
  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER
    ) {
      throw new Error("Word 文档 ZIP 目录损坏。");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameEnd));
    if (name === expectedName) {
      return {
        encrypted: Boolean(view.getUint16(offset + 8, true) & 0x1),
        compressionMethod: view.getUint16(offset + 10, true),
        compressedSize: view.getUint32(offset + 20, true),
        uncompressedSize: view.getUint32(offset + 24, true),
        localHeaderOffset: view.getUint32(offset + 42, true)
      };
    }
    offset = nameEnd + extraLength + commentLength;
  }
  throw new Error("Word 文档中缺少 word/document.xml。");
}

function extractDocxText(bytes: Uint8Array): string {
  const entry = findZipEntry(bytes, "word/document.xml");
  if (entry.encrypted) throw new Error("受密码保护的 Word 文档暂时无法读取。");
  if (entry.uncompressedSize > WORD_XML_MAX_BYTES) {
    throw new ExternalDocumentTooLargeError("Word 文档正文过大。");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (
    offset + 30 > bytes.length ||
    view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER
  ) {
    throw new Error("Word 文档 ZIP 内容损坏。");
  }
  const dataStart =
    offset +
    30 +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true);
  const compressed = bytes.subarray(
    dataStart,
    dataStart + entry.compressedSize
  );
  const xmlBytes =
    entry.compressionMethod === 0
      ? compressed
      : entry.compressionMethod === 8
        ? inflateRawSync(compressed, { maxOutputLength: WORD_XML_MAX_BYTES })
        : (() => {
            throw new Error("Word 文档使用了暂不支持的压缩方式。");
          })();
  return new TextDecoder()
    .decode(xmlBytes)
    .replace(/<(?:\w+:)?tab\b[^>]*\/?\s*>/giu, "\t")
    .replace(/<(?:\w+:)?(?:br|cr)\b[^>]*\/?\s*>/giu, "\n")
    .replace(/<\/(?:\w+:)?tc\s*>/giu, "\t")
    .replace(/<\/(?:\w+:)?(?:p|tr)\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    let extractedBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const pageText = text.items
        .filter(
          (item): item is typeof item & { str: string; hasEOL: boolean } =>
            "str" in item
        )
        .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
        .join("")
        .trim();
      page.cleanup();
      if (!pageText) continue;
      extractedBytes += Buffer.byteLength(pageText, "utf8");
      if (extractedBytes > EXTRACTED_TEXT_MAX_BYTES) {
        throw new ExternalDocumentTooLargeError("PDF 可提取正文过大。");
      }
      pages.push(pageText);
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

async function readDocument(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  const metadata = await stat(path);
  const maximumBytes =
    extension === ".pdf" ? PDF_MAX_BYTES : TEXT_OR_WORD_MAX_BYTES;
  if (metadata.size > maximumBytes) {
    throw new ExternalDocumentTooLargeError("源文件过大。");
  }
  const bytes = await readFile(path);
  let content: string;
  if (extension === ".doc") content = extractLegacyWordText(bytes);
  else if (extension === ".docx") content = extractDocxText(bytes);
  else if (extension === ".pdf") content = await extractPdfText(bytes);
  else content = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  const normalized =
    extension === ".md" || extension === ".markdown" || extension === ".txt"
      ? content
      : normalizeExtractedText(content);
  if (Buffer.byteLength(normalized, "utf8") > EXTRACTED_TEXT_MAX_BYTES) {
    throw new ExternalDocumentTooLargeError("提取正文过大。");
  }
  return normalized;
}

async function collectDirectoryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(path);
      } else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        files.push(path);
      }
    }
  }
  await visit(root);
  return files;
}

export async function readExternalLibraryEntries(
  sourceKind: ExternalLibrarySourceKind,
  selectedPaths: readonly string[]
): Promise<ExternalLibrarySelectionResult> {
  const skipped = {
    unsupported: 0,
    unreadable: 0,
    empty: 0,
    tooLarge: 0,
    limitExceeded: 0
  };
  const discovered =
    sourceKind === "directory"
      ? (await Promise.all(selectedPaths.map(collectDirectoryFiles))).flat()
      : selectedPaths.filter((path) => {
          const supported = SUPPORTED_EXTENSIONS.has(
            extname(path).toLowerCase()
          );
          if (!supported) skipped.unsupported += 1;
          return supported;
        });
  const paths = [...new Set(discovered)].sort((left, right) =>
    left.localeCompare(right)
  );
  const candidates: ExternalLibrarySelectionResult["candidates"] = [];
  for (const path of paths) {
    if (candidates.length >= CATALOG_PROJECT_MAX_CONTENT_ITEMS) {
      skipped.limitExceeded += 1;
      continue;
    }
    try {
      const content = await readDocument(path);
      if (!content.trim()) {
        skipped.empty += 1;
        continue;
      }
      candidates.push({
        id: `external-library-entry-${candidates.length + 1}`,
        title: candidateTitle(path, content),
        sourceName: basename(path),
        content
      });
    } catch (error: unknown) {
      if (error instanceof ExternalDocumentTooLargeError) skipped.tooLarge += 1;
      else skipped.unreadable += 1;
    }
  }
  return ExternalLibrarySelectionResultSchema.parse({
    candidates,
    scanned: paths.length,
    skipped
  });
}
