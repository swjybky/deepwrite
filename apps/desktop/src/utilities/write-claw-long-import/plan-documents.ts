import type { LongWorkspaceFileReference } from "@deepwrite/contracts";
import { safeUnicode, type WarningCollector } from "./normalize";
import type { WriteClawLongImportDocument } from "./types";
import { sha256Hex } from "@deepwrite/shared/node";

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

export function storageKey(id: string): string {
  return sha256Hex(id).slice(0, 32);
}

export function characterPath(characterId: string, filename: string): string {
  return `long/characters/${storageKey(characterId)}/${filename}`;
}

export function chapterPath(chapterId: string, filename: string): string {
  return `long/chapters/${storageKey(chapterId)}/${filename}`;
}

export function ledgerPath(commitId: string): string {
  return `long/ledger/${storageKey(commitId)}.json`;
}

export interface ImportDocumentBuilder {
  documents: WriteClawLongImportDocument[];
  add(
    fileId: string,
    path: string,
    content: string,
    kind?: "markdown" | "json"
  ): LongWorkspaceFileReference;
}

export function createDocumentBuilder(
  updatedAt: string,
  warnings: WarningCollector
): ImportDocumentBuilder {
  const documents: WriteClawLongImportDocument[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  return {
    documents,
    add(fileId, path, rawContent, kind = "markdown") {
      const content = safeUnicode(rawContent, warnings, `文档 ${path}`);
      const size = Buffer.byteLength(content, "utf8");
      if (size > MAX_DOCUMENT_BYTES) {
        throw new Error(`导入文档 ${path} 超过 32 MB 安全上限。`);
      }
      const pathKey = path.normalize("NFC").toLocaleLowerCase("en-US");
      if (ids.has(fileId) || paths.has(pathKey)) {
        throw new Error(`导入计划生成了重复文件：${fileId} / ${path}。`);
      }
      ids.add(fileId);
      paths.add(pathKey);
      documents.push({
        fileId,
        path,
        kind,
        content
      });
      return { id: fileId, path, updatedAt };
    }
  };
}
