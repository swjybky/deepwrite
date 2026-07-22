import {
  LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS,
  type LearningImitationDocument
} from "@deepwrite/contracts";
import { readPromptAttachment } from "./promptAttachments";

export const LEARNING_DOCUMENT_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".doc",
  ".docx",
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
].join(",");

export const LEARNING_DOCUMENT_SUPPORTED_LABEL =
  "TXT、Markdown、PDF、Word（.doc/.docx）";

const LEARNING_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const WORD_DOCUMENT_XML_MAX_BYTES = 32 * 1024 * 1024;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export interface LearningDocumentReadResult {
  document: LearningImitationDocument;
  warning?: string;
}

interface ZipEntry {
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

function learningDocumentId(): string {
  return `learning_document_${globalThis.crypto.randomUUID()}`;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function toLearningDocument(
  file: File,
  mediaType: string,
  extractedText: string
): LearningDocumentReadResult {
  const normalized = normalizeExtractedText(extractedText);
  if (!normalized) {
    throw new Error(`无法从“${file.name}”中提取可读正文。`);
  }
  const text = normalized.slice(0, LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS);
  const truncated = text.length < normalized.length;
  return {
    document: {
      id: learningDocumentId(),
      name: file.name,
      extension: extensionOf(file.name),
      mediaType,
      size: file.size,
      text,
      charCount: normalized.replace(/\p{White_Space}/gu, "").length,
      ...(truncated
        ? { truncated: true, originalLength: normalized.length }
        : {})
    },
    ...(truncated
      ? {
          warning: `“${file.name}”正文较长，仅保留前 ${LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS.toLocaleString("zh-CN")} 个字符用于学习。`
        }
      : {})
  };
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

function collectReadableRuns(text: string, minimumLength: number): string[] {
  const runs: string[] = [];
  let current = "";
  for (const character of text) {
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

function collectUtf16ReadableRuns(bytes: Uint8Array, offset: number): string[] {
  let text = "";
  for (let index = offset; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode(bytes[index]! | (bytes[index + 1]! << 8));
  }
  return collectReadableRuns(text, 4);
}

function normalizeLegacyWordRuns(runs: readonly string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const run of runs) {
    for (const line of run
      .split("\u0000").join("")
      .replace(/\u00a0/gu, " ")
      .replace(/[ \t]+/gu, " ")
      .split(/\r?\n+/gu)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)) {
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function extractLegacyWordText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const runs = [
    ...collectUtf16ReadableRuns(bytes, 0),
    ...collectUtf16ReadableRuns(bytes, 1)
  ];
  try {
    runs.push(...collectReadableRuns(new TextDecoder("gb18030").decode(bytes), 6));
  } catch {
    runs.push(...collectReadableRuns(new TextDecoder().decode(bytes), 6));
  }
  return normalizeLegacyWordRuns(runs);
}

function findZipEntry(bytes: Uint8Array, expectedName: string): ZipEntry | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return undefined;

  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Word 文档 ZIP 目录损坏。");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) throw new Error("Word 文档 ZIP 文件名损坏。");
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    if (name === expectedName) {
      return {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        encrypted: Boolean(flags & 0x1)
      };
    }
    offset = nameEnd + extraLength + commentLength;
  }
  return undefined;
}

async function inflateRawWithLimit(
  compressed: Uint8Array,
  maximumBytes: number
): Promise<Uint8Array> {
  const payload = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength
  ) as ArrayBuffer;
  const stream = new Blob([payload])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Word 文档正文 XML 过大，无法安全读取。");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error("受密码保护的 Word 文档暂时无法读取。");
  if (entry.uncompressedSize > WORD_DOCUMENT_XML_MAX_BYTES) {
    throw new Error("Word 文档正文 XML 过大，无法安全读取。");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("Word 文档 ZIP 内容损坏。");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error("Word 文档 ZIP 数据不完整。");
  const compressed = bytes.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) return compressed.slice();
  if (entry.compressionMethod === 8) {
    return inflateRawWithLimit(compressed, WORD_DOCUMENT_XML_MAX_BYTES);
  }
  throw new Error(`暂不支持 Word 文档使用的 ZIP 压缩方式 ${entry.compressionMethod}。`);
}

function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(?:#(x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/giu,
    (entity, numeric: string | undefined) => {
      if (numeric) {
        const hexadecimal = numeric[0]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(
          hexadecimal ? numeric.slice(1) : numeric,
          hexadecimal ? 16 : 10
        );
        if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
          return String.fromCodePoint(codePoint);
        }
        return "";
      }
      return ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'"
      } as Record<string, string>)[entity.toLowerCase()] ?? entity;
    }
  );
}

function extractDocxXmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<(?:\w+:)?tab\b[^>]*\/?\s*>/giu, "\t")
      .replace(/<(?:\w+:)?(?:br|cr)\b[^>]*\/?\s*>/giu, "\n")
      .replace(/<\/(?:\w+:)?tc\s*>/giu, "\t")
      .replace(/<\/(?:\w+:)?(?:p|tr)\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, "")
  );
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const entry = findZipEntry(bytes, "word/document.xml");
  if (!entry) throw new Error("Word 文档中缺少 word/document.xml。");
  const xmlBytes = await readZipEntry(bytes, entry);
  return extractDocxXmlText(new TextDecoder().decode(xmlBytes));
}

export async function readLearningDocumentFile(
  file: File
): Promise<LearningDocumentReadResult> {
  if (file.size > LEARNING_DOCUMENT_MAX_BYTES) {
    throw new Error(`“${file.name}”超过 25 MB，请拆分或压缩后再上传。`);
  }
  const extension = extensionOf(file.name);
  if (extension === "doc" || file.type === "application/msword") {
    const text = extractLegacyWordText(await file.arrayBuffer());
    if (!text.trim()) {
      throw new Error(`无法从“${file.name}”中提取可读文字，请另存为 .docx 后再上传。`);
    }
    return toLearningDocument(file, "application/msword", text);
  }
  if (
    extension === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return toLearningDocument(
      file,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      await extractDocxText(await file.arrayBuffer())
    );
  }
  if (["txt", "md", "markdown"].includes(extension) || file.type.startsWith("text/")) {
    return toLearningDocument(
      file,
      file.type || (extension === "txt" ? "text/plain" : "text/markdown"),
      await file.text()
    );
  }
  try {
    const result = await readPromptAttachment(file);
    if (result.attachment.kind !== "text") {
      throw new Error("学习仿写只接受可提取正文的文档。");
    }
    const document = toLearningDocument(
      file,
      result.attachment.mediaType,
      result.attachment.content
    );
    if (result.attachment.truncated && result.attachment.originalLength) {
      document.document.truncated = true;
      document.document.originalLength = result.attachment.originalLength;
      document.document.charCount = result.attachment.originalLength;
    }
    return {
      ...document,
      ...(result.warning ? { warning: result.warning } : {})
    };
  } catch (error: unknown) {
    if (
      !["txt", "md", "markdown", "pdf"].includes(extension) &&
      !file.type.startsWith("text/") &&
      file.type !== "application/pdf"
    ) {
      throw new Error(
        `不支持“${file.name}”的文件类型；请选择${LEARNING_DOCUMENT_SUPPORTED_LABEL}。`
      );
    }
    throw error;
  }
}
