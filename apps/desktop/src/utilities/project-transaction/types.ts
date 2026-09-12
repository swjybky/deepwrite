import { createHash } from "node:crypto";

export const INTERNAL_DIRECTORY = ".deepwrite";
export const TRANSACTION_DIRECTORY = "transactions";
export const JOURNAL_FILE = "transaction.json";
export const LOCK_FILE = "transaction.lock";
export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const LOCK_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
export const LOCK_RETRY_MS = 25;
export const LOCK_INITIALIZATION_GRACE_MS = 5 * 1000;
// A long-form import contains at least three files per chapter and four per
// character. Keep one recoverable transaction for book-level atomicity while
// still enforcing a finite journal bound.
export const MAX_TRANSACTION_FILES = 20_000;

export interface ProjectTransactionFileOperationBase {
  /** Normalized, forward-slash-separated path inside the project root. */
  path: string;
  /**
   * `undefined` disables the precondition, `null` requires a missing target,
   * and a SHA-256 string requires the exact current file contents.
   */
  expectedSha256?: string | null;
}

export type ProjectTransactionFileOperation =
  | (ProjectTransactionFileOperationBase & {
      action?: "write";
      content: string;
    })
  | (ProjectTransactionFileOperationBase & {
      action: "delete";
    })
  | (ProjectTransactionFileOperationBase & {
      action: "check";
      expectedSha256: string | null;
    });

export interface CommitProjectTransactionInput {
  projectRoot: string;
  operations: readonly ProjectTransactionFileOperation[];
  maxFileBytes?: number;
}

export interface ProjectTransactionResult {
  transactionId: string;
  files: readonly {
    path: string;
    sha256: string | null;
  }[];
}

export interface JournalOperation {
  action: "write" | "delete" | "check";
  path: string;
  stagePath: string | null;
  backupPath: string | null;
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface TransactionJournal {
  schemaVersion: 1;
  transactionId: string;
  phase: "prepared" | "committing" | "committed";
  appliedCount: number;
  operations: JournalOperation[];
}

export class ProjectTransactionConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expectedSha256: string | null,
    readonly actualSha256: string | null
  ) {
    super(
      `项目文件已在其他位置更新：${path}（期望 ${
        expectedSha256 ?? "不存在"
      }，实际 ${actualSha256 ?? "不存在"}）。`
    );
    this.name = "ProjectTransactionConflictError";
  }
}

export function projectTransactionContentSha256(
  content: string | Uint8Array
): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Node's default numeric fs.Stats can round 64-bit device and inode values on
 * filesystems whose identifiers exceed Number.MAX_SAFE_INTEGER. Keep both
 * components as bigint all the way through identity comparisons so distinct
 * files cannot be mistaken for hard-link aliases on those filesystems.
 */
export function projectTransactionFileIdentity(
  details: Readonly<{ dev: bigint; ino: bigint }>
): string {
  return `${details.dev}:${details.ino}`;
}
