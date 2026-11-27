import {
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  booleanValue,
  list,
  record,
  splitTextByUtf8Bytes,
  stringValue,
  type WarningCollector
} from "./normalize";
import type { ImportDocumentBuilder } from "./plan-documents";
import { sha256Hex } from "@deepwrite/shared/node";

export { splitTextByUtf8Bytes };

const MIGRATION_EVIDENCE_CHUNK_CHARACTERS = 4 * 1024 * 1024;
const MAX_MIGRATION_EVIDENCE_DOCUMENT_BYTES = 28 * 1024 * 1024;

export function splitEvidenceContent(content: string): string[] {
  if (content.length <= MIGRATION_EVIDENCE_CHUNK_CHARACTERS) return [content];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(
      content.length,
      offset + MIGRATION_EVIDENCE_CHUNK_CHARACTERS
    );
    if (
      end < content.length &&
      end > offset &&
      /[\uD800-\uDBFF]/u.test(content[end - 1]!)
    ) {
      end -= 1;
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function appendMigrationEvidenceCategories(
  worldbuilding: LongWorkspaceIndexSnapshot["worldbuilding"],
  documents: ImportDocumentBuilder,
  warnings: WarningCollector
): void {
  const blocks: Array<{
    title: string;
    source: string;
    chunk: string;
    chunkIndex: number;
    chunkCount: number;
    evidenceIndex: number;
  }> = [];
  warnings.preserved().forEach((entry, evidenceIndex) => {
    const chunks = splitEvidenceContent(entry.content);
    chunks.forEach((chunk, chunkIndex) => {
      const partLabel =
        chunks.length > 1 ? `（${chunkIndex + 1}/${chunks.length}）` : "";
      blocks.push({
        title: `${entry.title}${partLabel}`,
        source: entry.source,
        chunk,
        chunkIndex,
        chunkCount: chunks.length,
        evidenceIndex
      });
    });
  });
  const availableCategories = 10_000 - worldbuilding.length;
  const payloadBudget = MAX_MIGRATION_EVIDENCE_DOCUMENT_BYTES - 16 * 1024;
  const renderStandalone = (block: (typeof blocks)[number]): string =>
    [
      `# ${block.title}`,
      "",
      "> 这是迁移时生成的只读证据副本。其内容可被长篇搜索与 Agent 按需读取；请勿将其误认为当前结构字段。",
      "",
      `- 来源：${block.source}`,
      `- 分片：${block.chunkIndex + 1}/${block.chunkCount}`,
      "",
      "## 旧版完整原文",
      "",
      block.chunk
    ].join("\n");
  const pushCategory = (
    categoryTitle: string,
    content: string,
    seed: string
  ): void => {
    const categoryId = `world_migration-evidence-${sha256Hex(seed).slice(
      0,
      24
    )}`;
    worldbuilding.push({
      id: categoryId,
      title: categoryTitle.slice(0, 256),
      order: worldbuilding.length + 1,
      format: "text",
      contentAuthority: "markdown",
      file: documents.add(
        longWorldbuildingFileId(categoryId),
        longWorldbuildingContentPath(categoryId),
        content
      )
    });
  };
  const keepStandalone =
    blocks.length <= Math.min(availableCategories, 1_000) &&
    blocks.every(
      (block) =>
        Buffer.byteLength(renderStandalone(block), "utf8") <=
        MAX_MIGRATION_EVIDENCE_DOCUMENT_BYTES
    );
  if (keepStandalone) {
    blocks.forEach((block) => {
      pushCategory(
        block.title,
        renderStandalone(block),
        `${block.source}\0${block.evidenceIndex + 1}\0${block.chunkIndex + 1}`
      );
    });
    return;
  }

  const renderedBlocks = blocks.map((block) =>
    [
      `## 证据 ${block.evidenceIndex + 1} · ${block.title}`,
      "",
      `- 来源：${block.source}`,
      `- 原证据分片：${block.chunkIndex + 1}/${block.chunkCount}`,
      "",
      "### 旧版完整原文",
      "",
      block.chunk
    ].join("\n")
  );
  const bundles: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const block of renderedBlocks) {
    const pieces =
      Buffer.byteLength(block, "utf8") <= payloadBudget
        ? [block]
        : splitTextByUtf8Bytes(block, payloadBudget);
    for (const piece of pieces) {
      const pieceBytes = Buffer.byteLength(piece, "utf8");
      const separatorBytes = current.length ? 2 : 0;
      if (
        current.length &&
        currentBytes + separatorBytes + pieceBytes > payloadBudget
      ) {
        bundles.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(piece);
      currentBytes += (current.length > 1 ? 2 : 0) + pieceBytes;
    }
  }
  if (current.length) bundles.push(current);

  if (bundles.length > availableCategories) {
    throw new Error(
      "Write Claw 迁移证据超过当前长篇索引的安全容量；原文件未被修改。"
    );
  }
  bundles.forEach((parts, bundleIndex) => {
    const categoryTitle =
      `迁移证据包 ${bundleIndex + 1}/${bundles.length}`.slice(0, 256);
    const payload = parts.join("\n\n");
    const content = [
      `# ${categoryTitle}`,
      "",
      "> 这是迁移时生成的只读证据副本。其内容可被长篇搜索与 Agent 按需读取；请勿将其误认为当前结构字段。",
      "",
      `- 证据包：${bundleIndex + 1}/${bundles.length}`,
      "",
      payload
    ].join("\n");
    pushCategory(
      categoryTitle,
      content,
      `bundle\0${bundleIndex + 1}\0${payload}`
    );
  });
}

export function memoryArchiveMarkdown(book: Record<string, unknown>): string {
  const memories = list(book.memories);
  const hasCaptureSetting = "memory_auto_capture_enabled" in book;
  if (memories.length === 0 && !hasCaptureSetting) return "";
  const captureSetting = hasCaptureSetting
    ? booleanValue(book.memory_auto_capture_enabled)
      ? "旧版为开启；当前仅存档，没有在 DeepWrite 长篇中启用自动捕获。"
      : "旧版为关闭；当前仅存档，没有在 DeepWrite 长篇中启用自动捕获。"
    : "旧版未提供；当前未启用自动捕获。";
  const sections = memories.map((rawMemory, index) => {
    const memory = record(rawMemory);
    const preserved = {
      id: stringValue(memory.id),
      tag: stringValue(memory.tag),
      content: stringValue(memory.content),
      created_at: stringValue(memory.created_at),
      updated_at: stringValue(memory.updated_at)
    };
    return [
      `## 记忆 ${index + 1}${preserved.tag ? ` · ${preserved.tag}` : ""}`,
      "",
      `- id：${JSON.stringify(preserved.id)}`,
      `- tag：${JSON.stringify(preserved.tag)}`,
      `- created_at：${JSON.stringify(preserved.created_at)}`,
      `- updated_at：${JSON.stringify(preserved.updated_at)}`,
      "",
      "### 内容",
      "",
      preserved.content,
      "",
      "<details><summary>旧版字段精确副本</summary>",
      "",
      "```json",
      JSON.stringify(preserved, null, 2),
      "```",
      "",
      "原始记录（包含当前模型未识别的扩展字段）：",
      "",
      "```json",
      JSON.stringify(rawMemory, null, 2),
      "```",
      "",
      "</details>"
    ].join("\n");
  });
  return [
    "# 书籍记忆（旧版）",
    "",
    `> 自动捕获设置：${captureSetting}`,
    "",
    ...sections
  ].join("\n");
}
