import { join } from "node:path";
import { TextDecoder } from "node:util";
import { randomHex8 } from "@deepwrite/shared";
import { commitProjectTransactionLocked } from "./commit";
import {
  readRegularFileOptional,
  readRegularFileRequired,
  resolveInternalWritableFile,
  resolveProjectFileTarget,
  secureProjectRoot,
  syncDirectory,
  writeDurableNewFile
} from "./io";
import { cleanupTransaction } from "./journal";
import { withProjectTransactionLock } from "./lock";
import { recoverProjectTransactionLocked } from "./recovery";
import {
  INTERNAL_DIRECTORY,
  JOURNAL_FILE,
  projectTransactionContentSha256,
  type ProjectTransactionFileOperation,
  type TransactionJournal
} from "./types";
import { parseJournal, validateOperations } from "./validation";

export interface ResolveProjectConflictsInput {
  projectRoot: string;
  maxFileBytes: number;
  /** Validate the projected recovery and return any required metadata writes. */
  prepare(
    read: (path: string) => Promise<Buffer | null>,
    recovery: {
      paths: ReadonlySet<string>;
      deletions: ReadonlySet<string>;
      readBeforeDeletion(path: string): Promise<Buffer | null>;
    }
  ): Promise<ReadonlyMap<string, string>>;
}

/** Explicit recovery only: keep external edits, finish the remaining writes. */
export async function resolveProjectTransactionConflicts(
  input: ResolveProjectConflictsInput
): Promise<{ resolvedPaths: string[]; backupPath: string | null }> {
  const root = await secureProjectRoot(input.projectRoot);
  return await withProjectTransactionLock(root, async () => {
    const journalBytes = await readRegularFileOptional(
      root,
      await resolveInternalWritableFile(
        root,
        `${INTERNAL_DIRECTORY}/${JOURNAL_FILE}`
      ),
      input.maxFileBytes
    );
    if (!journalBytes) return { resolvedPaths: [], backupPath: null };
    const journal = parseJournal(journalBytes.toString("utf8"));
    if (journal.phase === "committed") {
      await recoverProjectTransactionLocked(root, input.maxFileBytes, false);
      return { resolvedPaths: [], backupPath: null };
    }

    const currentFiles = new Map<string, Buffer | null>();
    const projected = new Map<string, Buffer | null>();
    const resolvedPaths: string[] = [];
    const currentFile = async (path: string): Promise<Buffer | null> => {
      if (!currentFiles.has(path)) {
        currentFiles.set(
          path,
          (await readRegularFileOptional(
            root,
            await resolveProjectFileTarget(root, path),
            input.maxFileBytes
          )) ?? null
        );
      }
      return currentFiles.get(path)!;
    };
    for (const operation of journal.operations) {
      const current = await currentFile(operation.path);
      const hash = contentHash(current);
      const applied =
        operation.action !== "check" && hash === operation.afterSha256;
      const conflict = hash !== operation.beforeSha256 && !applied;
      if (conflict) resolvedPaths.push(operation.path);
      if (conflict || applied || operation.action === "check") {
        projected.set(operation.path, current);
      } else if (operation.action === "delete") {
        projected.set(operation.path, null);
      } else {
        const staged = await readRegularFileRequired(
          root,
          await resolveInternalWritableFile(root, operation.stagePath!),
          input.maxFileBytes
        );
        if (contentHash(staged) !== operation.afterSha256) {
          throw new Error(`事务暂存文件校验失败：${operation.path}`);
        }
        projected.set(operation.path, staged);
      }
    }
    if (!resolvedPaths.length) {
      await recoverProjectTransactionLocked(root, input.maxFileBytes, false);
      return { resolvedPaths, backupPath: null };
    }

    const adjustments = await input.prepare(
      async (path) => {
        if (!projected.has(path)) projected.set(path, await currentFile(path));
        return projected.get(path)!;
      },
      {
        paths: new Set(projected.keys()),
        deletions: new Set(
          journal.operations
            .filter((operation) => operation.action === "delete")
            .map((operation) => operation.path)
        ),
        readBeforeDeletion: async (path) => {
          const current = await currentFile(path);
          if (current !== null) return current;
          const operation = journal.operations.find(
            (candidate) =>
              candidate.path === path && candidate.action === "delete"
          );
          if (!operation?.backupPath || operation.beforeSha256 === null)
            return null;
          const before = await readRegularFileRequired(
            root,
            await resolveInternalWritableFile(root, operation.backupPath),
            input.maxFileBytes
          );
          if (contentHash(before) !== operation.beforeSha256)
            throw new Error(`事务备份文件校验失败：${path}`);
          return before;
        }
      }
    );
    for (const [path, content] of adjustments) {
      await currentFile(path);
      projected.set(path, Buffer.from(content, "utf8"));
    }
    const operations: ProjectTransactionFileOperation[] = [];
    for (const [path, next] of projected) {
      const expectedSha256 = contentHash(currentFiles.get(path)!);
      if (contentHash(next) === expectedSha256) {
        operations.push({ action: "check", path, expectedSha256 });
      } else if (next === null) {
        operations.push({ action: "delete", path, expectedSha256 });
      } else {
        operations.push({
          path,
          expectedSha256,
          content: new TextDecoder("utf-8", { fatal: true }).decode(next)
        });
      }
    }

    // Keep the journal, original before/after versions, and every observed disk
    // file outside the transient transaction directory. Publishing the new
    // journal happens only after the backup and all new stages are durable.
    const backupPath = `${INTERNAL_DIRECTORY}/conflict-backups/${journal.transactionId}-${randomHex8()}`;
    await backupRecovery(
      root,
      backupPath,
      journalBytes,
      journal,
      currentFiles,
      input.maxFileBytes
    );
    await commitProjectTransactionLocked(
      root,
      validateOperations(operations, input.maxFileBytes),
      input.maxFileBytes
    );
    await cleanupTransaction(root, journal);
    return { resolvedPaths, backupPath };
  });
}

function contentHash(bytes: Buffer | null): string | null {
  return bytes === null ? null : projectTransactionContentSha256(bytes);
}

async function backupRecovery(
  root: string,
  backupPath: string,
  journalBytes: Buffer,
  journal: TransactionJournal,
  currentFiles: ReadonlyMap<string, Buffer | null>,
  maxFileBytes: number
): Promise<void> {
  const directories = new Set<string>();
  const write = async (path: string, bytes: Buffer): Promise<void> => {
    const target = await resolveInternalWritableFile(
      root,
      `${backupPath}/${path}`
    );
    await writeDurableNewFile(target, bytes);
    // Also sync newly created parent entries, up to the project root.
    const segments = `${backupPath}/${path}`.split("/");
    for (let count = 1; count < segments.length; count++) {
      directories.add(join(root, ...segments.slice(0, count)));
    }
  };
  await write("transaction.json", journalBytes);
  for (const [path, bytes] of currentFiles) {
    if (bytes !== null) await write(`current/${path}`, bytes);
  }
  for (const [index, operation] of journal.operations.entries()) {
    for (const [kind, path] of [
      ["stage", operation.stagePath],
      ["backup", operation.backupPath]
    ] as const) {
      if (!path) continue;
      const bytes = await readRegularFileOptional(
        root,
        await resolveInternalWritableFile(root, path),
        maxFileBytes
      );
      if (bytes) await write(`${kind}/${index}`, bytes);
    }
  }
  for (const directory of [...directories].reverse())
    await syncDirectory(directory);
  await syncDirectory(root);
}
