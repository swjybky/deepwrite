import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomHex8 } from "@deepwrite/shared";
import {
  INTERNAL_DIRECTORY,
  TRANSACTION_DIRECTORY,
  type ProjectTransactionFileOperation,
  type CommitProjectTransactionInput,
  type ProjectTransactionResult,
  type JournalOperation,
  type TransactionJournal,
  ProjectTransactionConflictError,
  projectTransactionContentSha256
} from "./types";
import { validateOperations } from "./validation";
import {
  writeDurableNewFile,
  syncDirectory,
  secureProjectRoot,
  resolveProjectFileTarget,
  resolveInternalWritableFile,
  ensureSafeDirectory,
  readRegularFileOptionalWithIdentity,
  positiveByteLimit
} from "./io";
import { writeJournal } from "./journal";
import { withProjectTransactionLock } from "./lock";
import { recoverProjectTransactionLocked } from "./recovery";

export async function commitProjectTransaction(
  rawInput: CommitProjectTransactionInput
): Promise<ProjectTransactionResult> {
  const projectRoot = await secureProjectRoot(rawInput.projectRoot);
  const maxFileBytes = positiveByteLimit(rawInput.maxFileBytes);
  const operations = validateOperations(rawInput.operations, maxFileBytes);
  return await withProjectTransactionLock(projectRoot, async () => {
    await recoverProjectTransactionLocked(projectRoot, maxFileBytes, false);
    return await commitProjectTransactionLocked(
      projectRoot,
      operations,
      maxFileBytes
    );
  });
}

export async function commitProjectTransactionLocked(
  projectRoot: string,
  operations: readonly ProjectTransactionFileOperation[],
  maxFileBytes: number
): Promise<ProjectTransactionResult> {
  const transactionId = `txn-${Date.now()}-${randomHex8()}`;
  const transactionRoot = join(
    projectRoot,
    INTERNAL_DIRECTORY,
    TRANSACTION_DIRECTORY,
    transactionId
  );
  await ensureSafeDirectory(projectRoot, transactionRoot);

  const journalOperations: JournalOperation[] = [];
  const firstPathByIdentity = new Map<string, string>();
  const stagedDirectories = new Set<string>();
  let journalWritten = false;
  try {
    for (const [index, operation] of operations.entries()) {
      const target = await resolveProjectFileTarget(
        projectRoot,
        operation.path
      );
      const existing = await readRegularFileOptionalWithIdentity(
        projectRoot,
        target,
        maxFileBytes
      );
      if (existing?.identity) {
        const firstPath = firstPathByIdentity.get(existing.identity);
        if (firstPath) {
          throw new Error(
            `同一事务中的文件身份重复：${firstPath} 与 ${operation.path}。` +
              "可能存在硬链接别名，或当前文件系统返回了重复的文件身份。"
          );
        }
        firstPathByIdentity.set(existing.identity, operation.path);
      }
      const beforeSha256 = existing
        ? projectTransactionContentSha256(existing.bytes)
        : null;
      if (
        operation.expectedSha256 !== undefined &&
        operation.expectedSha256 !== beforeSha256
      ) {
        throw new ProjectTransactionConflictError(
          operation.path,
          operation.expectedSha256,
          beforeSha256
        );
      }

      const action = operation.action ?? "write";
      const stagePath =
        action === "write"
          ? `${INTERNAL_DIRECTORY}/${TRANSACTION_DIRECTORY}/${transactionId}/stage/${index}.next`
          : null;
      const backupPath =
        action === "check"
          ? null
          : `${INTERNAL_DIRECTORY}/${TRANSACTION_DIRECTORY}/${transactionId}/backup/${index}.previous`;
      let afterSha256: string | null = null;
      if (operation.action === undefined || operation.action === "write") {
        const staged = await resolveInternalWritableFile(
          projectRoot,
          stagePath!
        );
        await writeDurableNewFile(staged, operation.content);
        stagedDirectories.add(dirname(staged));
        afterSha256 = projectTransactionContentSha256(operation.content);
      } else if (operation.action === "check") {
        afterSha256 = beforeSha256;
      }
      if (existing && backupPath) {
        const backup = await resolveInternalWritableFile(
          projectRoot,
          backupPath
        );
        await writeDurableNewFile(backup, existing.bytes);
        stagedDirectories.add(dirname(backup));
      }
      journalOperations.push({
        action,
        path: operation.path,
        stagePath,
        backupPath,
        beforeSha256,
        afterSha256
      });
    }

    const journal: TransactionJournal = {
      schemaVersion: 1,
      transactionId,
      phase: "prepared",
      appliedCount: 0,
      operations: journalOperations
    };
    for (const directory of stagedDirectories) {
      await syncDirectory(directory);
    }
    await writeJournal(projectRoot, journal, maxFileBytes);
    journalWritten = true;
    const recovered = await recoverProjectTransactionLocked(
      projectRoot,
      maxFileBytes,
      true
    );
    if (!recovered) {
      throw new Error("项目事务提交后未返回恢复结果。");
    }
    if (recovered.transactionId !== transactionId) {
      throw new Error(
        `项目事务身份不一致：期望 ${transactionId}，实际 ${recovered.transactionId}。`
      );
    }
    return recovered;
  } catch (error: unknown) {
    if (!journalWritten) {
      await rm(transactionRoot, { recursive: true, force: true });
    }
    throw error;
  }
}
