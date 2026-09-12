import { rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomHex8 } from "@deepwrite/shared";
import {
  INTERNAL_DIRECTORY,
  TRANSACTION_DIRECTORY,
  JOURNAL_FILE,
  type ProjectTransactionResult,
  type TransactionJournal,
  ProjectTransactionConflictError,
  projectTransactionContentSha256
} from "./types";
import {
  writeDurableNewFile,
  syncDirectory,
  resolveProjectFileTarget,
  resolveInternalWritableFile,
  readRegularFileOptional,
  assertContained,
  unlinkOptional
} from "./io";

export async function assertJournalPreconditions(
  projectRoot: string,
  journal: TransactionJournal,
  maxFileBytes: number,
  allowAppliedState: boolean
): Promise<void> {
  for (const operation of journal.operations) {
    const target = await resolveProjectFileTarget(projectRoot, operation.path);
    const current = await readRegularFileOptional(
      projectRoot,
      target,
      maxFileBytes
    );
    const currentSha256 = current
      ? projectTransactionContentSha256(current)
      : null;
    const appliedStateAllowed =
      allowAppliedState &&
      operation.action !== "check" &&
      currentSha256 === operation.afterSha256;
    if (currentSha256 !== operation.beforeSha256 && !appliedStateAllowed) {
      throw new ProjectTransactionConflictError(
        operation.path,
        operation.beforeSha256,
        currentSha256
      );
    }
  }
}

export async function writeJournal(
  projectRoot: string,
  journal: TransactionJournal,
  maxFileBytes: number
): Promise<void> {
  const serialized = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > maxFileBytes) {
    throw new Error("项目事务日志超过大小限制。");
  }
  const journalPath = await resolveInternalWritableFile(
    projectRoot,
    `${INTERNAL_DIRECTORY}/${JOURNAL_FILE}`
  );
  const temporary = `${journalPath}.${randomHex8()}.tmp`;
  try {
    await writeDurableNewFile(temporary, serialized);
    await rename(temporary, journalPath);
    await syncDirectory(dirname(journalPath));
  } catch (error: unknown) {
    await unlinkOptional(temporary);
    throw error;
  }
}

export async function cleanupTransaction(
  projectRoot: string,
  journal: TransactionJournal
): Promise<void> {
  const journalPath = join(projectRoot, INTERNAL_DIRECTORY, JOURNAL_FILE);
  await unlinkOptional(journalPath);
  await syncDirectory(dirname(journalPath));
  const transactionRoot = resolve(
    projectRoot,
    INTERNAL_DIRECTORY,
    TRANSACTION_DIRECTORY,
    journal.transactionId
  );
  assertContained(projectRoot, transactionRoot);
  await rm(transactionRoot, { recursive: true, force: true });
  await syncDirectory(dirname(transactionRoot));
}

export function transactionResult(
  journal: TransactionJournal
): ProjectTransactionResult {
  return {
    transactionId: journal.transactionId,
    files: journal.operations.map(({ path, afterSha256 }) => ({
      path,
      sha256: afterSha256
    }))
  };
}
