import {
  ProjectTransactionConflictError,
  commitProjectTransaction
} from "../project-transaction";
import { normalizeLongLedgerCommitRecord } from "../long-version-metadata";
import { createCachedPagedTextFile, loadPagedIndexedFile } from "./cache";
import { parseJson } from "./io";
import type { LongProjectStoreContext } from "./store-context";
import {
  MAX_LEDGER_RECORD_BYTES,
  type LoadedLongProject,
  type LoadedPagedIndexedFile,
  type SecureTextFile
} from "./types";
import { toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";

function publicLedgerFile(
  file: LoadedPagedIndexedFile,
  content: string
): LoadedPagedIndexedFile {
  const bytes = Buffer.from(content, "utf8");
  const disk: SecureTextFile = {
    ...file.disk,
    content,
    bytes,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength
  };
  return {
    ...file,
    disk,
    paging: createCachedPagedTextFile(disk)
  };
}

async function persistRetiredLedgerMetadataRemovalBestEffort(
  loaded: LoadedLongProject,
  file: LoadedPagedIndexedFile,
  content: string
): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_LEDGER_RECORD_BYTES) return;
  try {
    // This is a schema-compatibility cleanup rather than a content edit. Keep
    // the technical SHA precondition so a concurrent process always wins and
    // never surface that internal race as a user-facing version conflict.
    await commitProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        {
          path: file.reference.path,
          content,
          expectedSha256: file.disk.sha256
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
  } catch (error: unknown) {
    if (error instanceof ProjectTransactionConflictError) return;
    // Read/search must still return the sanitized record when a read-only
    // volume or another transient filesystem failure prevents the hygiene
    // rewrite. A later access can retry without blocking the manuscript.
  }
}

/**
 * Loads an indexed file for a public read/search boundary. Ledger JSON is
 * always strict-parsed and re-serialized so retired version and rollback
 * fields can never leak through pagination, search snippets, or Agent reads.
 */
export async function loadPublicPagedIndexedFile(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  fileId: string
): Promise<LoadedPagedIndexedFile> {
  const file = await loadPagedIndexedFile(ctx, loaded, fileId);
  if (file.kind !== "json") return file;

  const normalized = normalizeLongLedgerCommitRecord(
    parseJson(file.disk.content, `长篇账本 ${file.reference.id}`)
  );
  const content = toJsonFileText(normalized.record);
  if (normalized.changed) {
    await persistRetiredLedgerMetadataRemovalBestEffort(loaded, file, content);
  }
  return publicLedgerFile(file, content);
}
