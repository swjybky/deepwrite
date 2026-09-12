import { rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  INTERNAL_DIRECTORY,
  JOURNAL_FILE,
  DEFAULT_MAX_FILE_BYTES,
  type ProjectTransactionResult,
  type TransactionJournal,
  ProjectTransactionConflictError,
  projectTransactionContentSha256
} from "./types";
import { parseJournal } from "./validation";
import {
  syncDirectory,
  secureProjectRoot,
  resolveProjectFileTarget,
  resolveInternalFile,
  ensureSafeParent,
  readRegularFileOptional,
  readRegularFileRequired,
  positiveByteLimit
} from "./io";
import {
  assertJournalPreconditions,
  writeJournal,
  cleanupTransaction,
  transactionResult
} from "./journal";
import { withProjectTransactionLock } from "./lock";

/**
 * Finishes an interrupted, already-prepared project transaction. Recovery
 * deliberately rolls forward: all next contents were durably staged before
 * the journal became visible, so completing the transaction preserves one
 * coherent revision without guessing which partial files should win.
 */
export async function recoverProjectTransaction(
  rawProjectRoot: string,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES
): Promise<ProjectTransactionResult | undefined> {
  const projectRoot = await secureProjectRoot(rawProjectRoot);
  const byteLimit = positiveByteLimit(maxFileBytes);
  return await withProjectTransactionLock(
    projectRoot,
    async () =>
      await recoverProjectTransactionLocked(projectRoot, byteLimit, false)
  );
}

export async function recoverProjectTransactionLocked(
  projectRoot: string,
  maxFileBytes: number,
  abortPreparedConflict: boolean
): Promise<ProjectTransactionResult | undefined> {
  const journalPath = join(projectRoot, INTERNAL_DIRECTORY, JOURNAL_FILE);
  const journalBytes = await readRegularFileOptional(
    projectRoot,
    journalPath,
    maxFileBytes
  );
  if (!journalBytes) return undefined;

  const journal = parseJournal(journalBytes.toString("utf8"));
  if (journal.phase === "committed") {
    await cleanupTransaction(projectRoot, journal);
    return transactionResult(journal);
  }

  if (journal.phase === "prepared") {
    try {
      // A project directory can be moved or copied while the source is
      // finishing a commit. The destination may then contain the durable
      // prepared journal together with one or more files that already match
      // their staged contents. Hash equality makes those replacements
      // idempotent, so recover them just like a journal already marked as
      // committing instead of rejecting a valid migrated project as stale.
      await assertJournalPreconditions(
        projectRoot,
        journal,
        maxFileBytes,
        true
      );
    } catch (error: unknown) {
      if (
        abortPreparedConflict &&
        error instanceof ProjectTransactionConflictError
      ) {
        await cleanupTransaction(projectRoot, journal);
      }
      throw error;
    }
  } else {
    await assertJournalPreconditions(projectRoot, journal, maxFileBytes, true);
  }

  const committing: TransactionJournal = {
    ...journal,
    phase: "committing"
  };
  await writeJournal(projectRoot, committing, maxFileBytes);
  const changedDirectories = new Set<string>();

  for (let index = 0; index < committing.operations.length; index += 1) {
    const operation = committing.operations[index]!;
    const target = await resolveProjectFileTarget(projectRoot, operation.path);
    const current = await readRegularFileOptional(
      projectRoot,
      target,
      maxFileBytes
    );
    const currentSha256 = current
      ? projectTransactionContentSha256(current)
      : null;

    if (operation.action === "check") {
      if (currentSha256 !== operation.beforeSha256) {
        throw new ProjectTransactionConflictError(
          operation.path,
          operation.beforeSha256,
          currentSha256
        );
      }
    } else if (operation.action === "delete") {
      if (currentSha256 !== null) {
        if (currentSha256 !== operation.beforeSha256) {
          throw new ProjectTransactionConflictError(
            operation.path,
            operation.beforeSha256,
            currentSha256
          );
        }
        await ensureSafeParent(projectRoot, target);
        await unlink(target);
        changedDirectories.add(dirname(target));
      }
    } else if (currentSha256 !== operation.afterSha256) {
      if (currentSha256 !== operation.beforeSha256) {
        throw new ProjectTransactionConflictError(
          operation.path,
          operation.beforeSha256,
          currentSha256
        );
      }
      const staged = await resolveInternalFile(
        projectRoot,
        operation.stagePath!,
        maxFileBytes
      );
      const stagedBytes = await readRegularFileRequired(
        projectRoot,
        staged,
        maxFileBytes
      );
      const stagedSha256 = projectTransactionContentSha256(stagedBytes);
      if (stagedSha256 !== operation.afterSha256) {
        throw new Error(`事务暂存文件校验失败：${operation.path}`);
      }
      await ensureSafeParent(projectRoot, target);
      await rename(staged, target);
      changedDirectories.add(dirname(target));
    }

    committing.appliedCount = index + 1;
  }
  for (const directory of changedDirectories) {
    await syncDirectory(directory);
  }

  committing.phase = "committed";
  await writeJournal(projectRoot, committing, maxFileBytes);
  await cleanupTransaction(projectRoot, committing);
  return transactionResult(committing);
}
