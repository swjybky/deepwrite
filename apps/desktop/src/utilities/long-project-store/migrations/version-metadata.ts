import type { ProjectTransactionFileOperation } from "../../project-transaction";
import {
  commitLongProjectTransaction,
  readSecureTextFile,
  unknownRecord
} from "../io";
import { MANIFEST_PATH, MAX_LEDGER_RECORD_BYTES } from "../types";
import { stripLegacyLongVersionMetadata } from "../../long-version-metadata";
import { toJsonFileText } from "@deepwrite/shared";

interface VersionMetadataMigrationInput {
  projectDirectory: string;
  rawManifest: unknown;
  rawIndex: unknown;
}

/**
 * Converts version-managed long projects to the direct-edit format. This is
 * deliberately data-only: schemaVersion remains available for structural
 * migrations, while revisions and rollback snapshots are removed forever.
 */
export async function migrateLegacyLongVersionMetadata(
  input: VersionMetadataMigrationInput
): Promise<boolean> {
  const manifest = stripLegacyLongVersionMetadata(input.rawManifest);
  const index = stripLegacyLongVersionMetadata(input.rawIndex);
  const operations: ProjectTransactionFileOperation[] = [];

  if (manifest.changed) {
    operations.push({
      path: MANIFEST_PATH,
      content: toJsonFileText(manifest.value)
    });
  }
  if (index.changed) {
    operations.push({
      path: indexPath(input.rawManifest),
      content: toJsonFileText(index.value)
    });
  }

  // Every legacy project carried version metadata in its manifest and index,
  // including every indexed ledger file reference. Once those containers are
  // clean, the ledger was already migrated and can remain lazily loaded.
  const legacyLedgerPaths =
    manifest.changed || index.changed ? ledgerRecordPaths(input.rawIndex) : [];
  for (const path of legacyLedgerPaths) {
    const disk = await readSecureTextFile(
      input.projectDirectory,
      path,
      MAX_LEDGER_RECORD_BYTES
    );
    let raw: unknown;
    try {
      raw = JSON.parse(disk.content) as unknown;
    } catch {
      throw new Error(`长篇账本不是有效 JSON：${path}`);
    }
    const record = stripLegacyLongVersionMetadata(raw, {
      stripRollbackState: true
    });
    if (record.changed) {
      operations.push({ path, content: toJsonFileText(record.value) });
    }
  }

  if (operations.length === 0) return false;
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations,
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

function indexPath(rawManifest: unknown): string {
  const manifest = unknownRecord(rawManifest);
  const reference = unknownRecord(manifest?.workspaceIndexFile);
  return typeof reference?.path === "string"
    ? reference.path
    : "long/index.json";
}

function ledgerRecordPaths(rawIndex: unknown): string[] {
  const index = unknownRecord(rawIndex);
  const ledger = unknownRecord(index?.ledger);
  if (!Array.isArray(ledger?.commits)) return [];
  const paths = ledger.commits.flatMap((value) => {
    const commit = unknownRecord(value);
    const reference = unknownRecord(commit?.recordFile);
    return typeof reference?.path === "string" ? [reference.path] : [];
  });
  return [...new Set(paths)];
}
