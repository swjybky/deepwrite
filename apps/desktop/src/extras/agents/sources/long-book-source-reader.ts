import { decodeAnalysisText as decodeLongBookAnalysisText } from "./text-decoder";
export { decodeAnalysisText as decodeLongBookAnalysisText } from "./text-decoder";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_DIRECTORY_BYTES,
  LONG_BOOK_ANALYSIS_MAX_FILE_BYTES,
  LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS,
  LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS,
  LongBookAnalysisSourceSchema,
  type LongBookAnalysisChapter,
  type LongBookAnalysisDiagnostic,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const CHINESE_NUMBER = "0-9零一二两三四五六七八九十百千万〇○";
const CHAPTER_HEADING = new RegExp(
  `^\\s*(第[${CHINESE_NUMBER}]+(?:章|回|节|篇))(?:[\\s:：._—-]*(.{1,80}))?\\s*$`,
  "u"
);
const VOLUME_HEADING = new RegExp(
  `^\\s*(第[${CHINESE_NUMBER}]+(?:卷|部))(?:[\\s:：._—-]*(.{1,80}))?\\s*$`,
  "u"
);
const SPECIAL_HEADING =
  /^\s*((?:序章|楔子|引子|前言|后记|尾声|终章|大结局|番外(?:篇|章)?)(?:[\s:：._—-]+.{1,80})?)\s*$/u;
const ENGLISH_HEADING =
  /^\s*(chapter\s+[0-9ivxlcdm]+)(?:[\s:：._—-]+(.{1,80}))?\s*$/iu;
const NUMERIC_HEADING = /^\s*(\d{1,6})(?:[.、\s:：_—-]+(.{1,80}))?\s*$/u;
const PUBLICATION_TIMESTAMP =
  /^\d{4}-\d{1,2}-\d{1,2}\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:发表|发布)?$/u;
const DECORATIVE_PREFIX_LINE = /^(?:正文|目录|contents?|[-=_*—·]{3,})$/iu;

interface HeadingCandidate {
  lineIndex: number;
  blockStart: number;
  contentStart: number;
  title: string;
  volume?: string;
  confidence: "strong" | "numeric";
}

interface TextLine {
  text: string;
  start: number;
  end: number;
}

function normalizeText(text: string): string {
  return text
    .replace(/\uFEFF/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .trim();
}

function isDecorativePrefix(text: string): boolean {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 && lines.every((line) => DECORATIVE_PREFIX_LINE.test(line))
  );
}

function textLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue;
    lines.push({ text: text.slice(start, index), start, end: index });
    start = index + 1;
  }
  return lines;
}

function joinedHeading(primary: string, secondary?: string): string {
  return [primary.trim(), secondary?.trim()].filter(Boolean).join(" ");
}

function collectHeadings(lines: readonly TextLine[]): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];
  let currentVolume: string | undefined;
  let pendingVolumeStart: number | undefined;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const cleaned = line.text.trim();
    if (!cleaned || cleaned.length > 100) continue;
    const volumeMatch = VOLUME_HEADING.exec(cleaned);
    if (volumeMatch) {
      currentVolume = joinedHeading(volumeMatch[1]!, volumeMatch[2]);
      pendingVolumeStart = line.start;
      continue;
    }
    const chapterMatch = CHAPTER_HEADING.exec(cleaned);
    const specialMatch = SPECIAL_HEADING.exec(cleaned);
    const englishMatch = ENGLISH_HEADING.exec(cleaned);
    const numericMatch = PUBLICATION_TIMESTAMP.test(cleaned)
      ? null
      : NUMERIC_HEADING.exec(cleaned);
    const title = chapterMatch
      ? joinedHeading(chapterMatch[1]!, chapterMatch[2])
      : specialMatch
        ? specialMatch[1]!.trim()
        : englishMatch
          ? joinedHeading(englishMatch[1]!, englishMatch[2])
          : numericMatch
            ? joinedHeading(numericMatch[1]!, numericMatch[2])
            : undefined;
    if (!title) continue;
    candidates.push({
      lineIndex,
      blockStart: pendingVolumeStart ?? line.start,
      contentStart: line.end + (line.end < lines.at(-1)!.end ? 1 : 0),
      title,
      ...(currentVolume ? { volume: currentVolume } : {}),
      confidence: numericMatch ? "numeric" : "strong"
    });
    pendingVolumeStart = undefined;
  }
  const numericCount = candidates.filter(
    (candidate) => candidate.confidence === "numeric"
  ).length;
  const strongCount = candidates.length - numericCount;
  return candidates.filter(
    (candidate) =>
      candidate.confidence === "strong" || numericCount >= 2 || strongCount >= 1
  );
}

function chapter(
  order: number,
  title: string,
  sourceName: string,
  text: string,
  volume?: string
): LongBookAnalysisChapter | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  if (normalized.length > LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS) {
    throw new Error(`章节“${title}”超过 10,000,000 字符，无法安全导入。`);
  }
  return {
    id: createId("long_book_analysis_chapter"),
    order,
    title,
    ...(volume ? { volume } : {}),
    sourceName,
    text: normalized,
    charCount: normalized.replace(/\p{White_Space}/gu, "").length
  };
}

export function parseLongBookAnalysisTxt(
  text: string,
  sourceName: string
): {
  chapters: LongBookAnalysisChapter[];
  diagnostics: LongBookAnalysisDiagnostic[];
} {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error(`“${sourceName}”没有可读取的正文。`);
  const lines = textLines(normalized);
  const headings = collectHeadings(lines);
  const diagnostics: LongBookAnalysisDiagnostic[] = [];
  if (!headings.length) {
    diagnostics.push({
      code: "chapter_heading_not_found",
      message: "未识别到可靠章节标题，已将全文作为一章；可在页面中手动拆分。",
      sourceName
    });
    return {
      chapters: [
        chapter(
          1,
          basename(sourceName, extname(sourceName)) || "全文",
          sourceName,
          normalized
        )!
      ],
      diagnostics
    };
  }

  const chapters: LongBookAnalysisChapter[] = [];
  const firstHeading = headings[0]!;
  const prefix = normalized.slice(0, firstHeading.blockStart);
  const preface = isDecorativePrefix(prefix)
    ? undefined
    : chapter(1, "正文前内容", sourceName, prefix);
  if (preface) {
    chapters.push(preface);
    diagnostics.push({
      code: "preface_detected",
      message: "首个章节标题前存在正文，已单独保留为“正文前内容”。",
      sourceName
    });
  }
  let emptyHeadingCount = 0;
  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const end = next ? next.blockStart : normalized.length;
    const parsed = chapter(
      chapters.length + 1,
      heading.title,
      sourceName,
      normalized.slice(heading.contentStart, end),
      heading.volume
    );
    if (parsed) chapters.push(parsed);
    else emptyHeadingCount += 1;
  });
  if (emptyHeadingCount > 0) {
    diagnostics.push({
      code: "empty_headings_skipped",
      message: `已跳过 ${emptyHeadingCount.toLocaleString("zh-CN")} 个没有正文的章节标题，其余正文已继续导入。`,
      sourceName
    });
  }
  if (!chapters.length)
    throw new Error(`“${sourceName}”没有可读取的章节正文。`);
  return { chapters, diagnostics };
}

async function readRegularFile(path: string): Promise<Uint8Array> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("长篇拆书来源必须是普通文件，不能使用符号链接。");
  }
  if (stats.size > LONG_BOOK_ANALYSIS_MAX_FILE_BYTES) {
    throw new Error(`“${basename(path)}”超过 25 MiB，无法安全导入。`);
  }
  return readFile(path);
}

async function collectDirectoryFiles(
  root: string,
  current: string,
  files: string[],
  diagnostics: LongBookAnalysisDiagnostic[]
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN", {
      numeric: true,
      sensitivity: "base"
    })
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        code: "symbolic_link_skipped",
        message: "已跳过符号链接。",
        sourceName: relative(root, path)
      });
      continue;
    }
    if (entry.isDirectory()) {
      await collectDirectoryFiles(root, path, files, diagnostics);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) {
      continue;
    }
    files.push(path);
    if (files.length > LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS) {
      throw new Error(
        `章节文件数量超过 ${LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS.toLocaleString("zh-CN")} 个安全上限。`
      );
    }
  }
}

async function readTxtSource(path: string): Promise<LongBookAnalysisSource> {
  const decoded = decodeLongBookAnalysisText(await readRegularFile(path));
  const parsed = parseLongBookAnalysisTxt(decoded, basename(path));
  return LongBookAnalysisSourceSchema.parse({
    id: createId("long_book_analysis_source"),
    kind: "txt",
    name: basename(path),
    chapters: parsed.chapters,
    diagnostics: parsed.diagnostics
  });
}

async function readDirectorySource(
  path: string
): Promise<LongBookAnalysisSource> {
  const rootStats = await lstat(path);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("长篇拆书来源必须是普通文件夹，不能使用符号链接。");
  }
  const diagnostics: LongBookAnalysisDiagnostic[] = [];
  const files: string[] = [];
  await collectDirectoryFiles(path, path, files, diagnostics);
  if (!files.length)
    throw new Error("所选文件夹中没有 TXT 或 Markdown 章节文件。");
  let totalBytes = 0;
  let totalCharacters = 0;
  const chapters: LongBookAnalysisChapter[] = [];
  for (const filePath of files) {
    const stats = await lstat(filePath);
    if (stats.size > LONG_BOOK_ANALYSIS_MAX_FILE_BYTES) {
      throw new Error(
        `“${relative(path, filePath)}”超过 25 MiB，无法安全导入。`
      );
    }
    totalBytes += stats.size;
    if (totalBytes > LONG_BOOK_ANALYSIS_MAX_DIRECTORY_BYTES) {
      throw new Error("章节文件夹总大小超过 100 MiB，无法安全导入。");
    }
    const text = decodeLongBookAnalysisText(await readFile(filePath));
    if (!text) {
      diagnostics.push({
        code: "empty_file_skipped",
        message: "空章节文件已跳过。",
        sourceName: relative(path, filePath)
      });
      continue;
    }
    totalCharacters += text.length;
    if (totalCharacters > LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS) {
      throw new Error("章节文件夹正文超过 50,000,000 字符安全上限。");
    }
    const relativePath = relative(path, filePath);
    const parent = dirname(relativePath);
    const title = basename(filePath, extname(filePath));
    const parsed = chapter(
      chapters.length + 1,
      title,
      relativePath,
      text,
      parent === "." ? undefined : parent.split(sep).join(" / ")
    );
    if (parsed) chapters.push(parsed);
  }
  if (!chapters.length) throw new Error("所选文件夹中没有可读取的章节正文。");
  return LongBookAnalysisSourceSchema.parse({
    id: createId("long_book_analysis_source"),
    kind: "directory",
    name: basename(path),
    chapters,
    diagnostics
  });
}

export async function readLongBookAnalysisSource(
  kind: LongBookAnalysisSourceKind,
  path: string
): Promise<LongBookAnalysisSource> {
  return kind === "txt" ? readTxtSource(path) : readDirectorySource(path);
}
