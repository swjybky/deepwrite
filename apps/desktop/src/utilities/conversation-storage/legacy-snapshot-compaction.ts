import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, openSync, readSync, statSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ConversationCompactionFailureCode,
  ConversationCompactionPhase,
  ConversationCompactionStatus,
  ConversationHistoryJson
} from "@deepwrite/contracts";
import { isNodeError } from "@deepwrite/shared/node";
import { ConversationDatabase, ConversationStorageError } from "./database";
import { JsonNodes, type ValueRef } from "./json-nodes";
import {
  openConversationDatabase,
  sealDatabaseAsReadonlyBackup,
  Statements,
  unsealReadonlyBackupTriggers
} from "./schema";
import {
  isProcessAlive,
  parseLockOwnerOptional,
  withProjectTransactionLock
} from "../project-transaction/lock";
import { INTERNAL_DIRECTORY, LOCK_FILE } from "../project-transaction/types";
import {
  StorageBootstrapGateError,
  withStorageBootstrapGate,
  type BootstrapGateOptions
} from "./bootstrap-gate";

export const COMPACTION_META_KEY = "legacy_model_call_compaction_v1";
const DEFAULT_DISK_HEADROOM_BYTES = 64 * 1024 * 1024;
const STREAM_BATCH_SIZE = 50;
const WINDOWS_TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

type SwapStrategy = "posix-hardlink" | "windows-rename";

export interface CompactionFsOps {
  rename?: typeof rename;
  link?: typeof link;
  rm?: typeof rm;
  open?: typeof open;
}

interface SqliteHeaderFingerprint {
  writeVersion: number;
  readVersion: number;
  changeCounter: number;
  pageCount: number;
  versionValidFor: number;
  size: number;
}

interface SessionWatermarkEntry {
  scopeKey: string;
  sessionId: string;
  revision: number;
  generation: number;
  sequence: number;
  messageCount: number;
  turnCount: number;
  deleted?: number;
  updatedAt?: string;
}

interface PreSwapWatermark {
  scopeCount: number;
  sessionCount: number;
  messageCount: number;
  messageBytesTotal?: number;
  receiptCount: number;
  stageReceiptCount?: number;
  legacyCount: number;
  legacyBackupCount: number;
  stageCount: number;
  purgedSessionCount?: number;
  migrationCount?: number;
  migrationRecordCount?: number;
  maxNodeId: number;
  auxDigest?: string;
  sessions: SessionWatermarkEntry[];
}

interface FidelityTotals {
  subagentRuns: number;
  toolCalls: number;
  editProposals: number;
  editProposalsWithHunks: number;
  editProposalsWithDiscardSnapshot: number;
}

interface PersistedCompactionMeta {
  phase: ConversationCompactionPhase;
  bytesBefore?: number;
  bytesAfter?: number;
  backupBytes?: number;
  netFreedBytes?: number;
  processedSessions?: number;
  totalSessions?: number;
  legacyCallsFound?: number;
  estimatedReclaimableBytes?: number;
  requiredDiskBytes?: number;
  availableDiskBytes?: number;
  failureCode?: ConversationCompactionFailureCode;
  failureDetail?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  backupPath?: string;
  preSwapWatermark?: PreSwapWatermark;
}

export interface CompactionDatabaseHandle {
  getDatabase(): ConversationDatabase;
  closeDatabase(): void;
  reopenDatabase(): ConversationDatabase;
  setWriteBlocked(reason: string | undefined): void;
  onProgress?: (status: ConversationCompactionStatus) => void;
}

export interface RunCompactionOptions extends BootstrapGateOptions {
  force?: boolean;
  lockTimeoutMs?: number;
  minDiskHeadroomBytes?: number;
  getAvailableDiskBytes?: (directory: string) => Promise<number>;
  swapStrategy?: "auto" | SwapStrategy;
  fsOps?: CompactionFsOps;
  shouldAbort?: () => boolean;
  testHooks?: {
    duringCandidateBuild?: (paths: {
      candidatePath: string;
      databasePath: string;
    }) => Promise<void> | void;
    beforeBackupAndSwap?: (paths: {
      candidatePath: string;
      databasePath: string;
    }) => Promise<void> | void;
    afterSourceCloseBeforeBackupRename?: (paths: {
      candidatePath: string;
      databasePath: string;
    }) => Promise<void> | void;
    afterBackupBeforeSwap?: (paths: {
      candidatePath: string;
      databasePath: string;
    }) => Promise<void> | void;
    afterCandidateSwapBeforeReopen?: (paths: {
      candidatePath: string;
      databasePath: string;
    }) => Promise<void> | void;
  };
}

export interface RecoverCompactionOptions extends BootstrapGateOptions {
  testHooks?: {
    beforeRestoreBackup?: (paths: {
      databasePath: string;
      recoveryBase: string;
    }) => Promise<void> | void;
  };
}

function resolveGateOptions(
  options: BootstrapGateOptions = {}
): BootstrapGateOptions {
  const bootstrapLockRoot =
    options.bootstrapLockRoot ??
    process.env.DEEPWRITE_STORAGE_BOOTSTRAP_LOCK_ROOT;
  const bootstrapOwnerPid =
    options.bootstrapOwnerPid ??
    (process.env.DEEPWRITE_MAIN_PID
      ? Number(process.env.DEEPWRITE_MAIN_PID)
      : undefined);
  const mainInstanceId =
    options.mainInstanceId ?? process.env.DEEPWRITE_MAIN_INSTANCE_ID;
  return {
    ...(bootstrapLockRoot ? { bootstrapLockRoot } : {}),
    ...(bootstrapOwnerPid !== undefined ? { bootstrapOwnerPid } : {}),
    ...(mainInstanceId ? { mainInstanceId } : {}),
    ...(options.bootstrapGateMode
      ? { bootstrapGateMode: options.bootstrapGateMode }
      : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.fsOps ? { fsOps: options.fsOps } : {})
  };
}

function backupPaths(databasePath: string): string[] {
  const base = `${databasePath}.bak-v190`;
  return [base, `${base}-wal`, `${base}-shm`];
}

function sqliteSidecarPaths(databasePath: string): string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

async function fileSizeIfExists(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return 0;
    throw error;
  }
}

async function existsAsync(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return false;
    throw error;
  }
}

async function measureFootprint(paths: readonly string[]): Promise<number> {
  let total = 0;
  for (const path of paths) total += await fileSizeIfExists(path);
  return total;
}

function isTransientWindowsLockError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && WINDOWS_TRANSIENT_CODES.has(code);
}

async function retryFsOp<T>(
  operation: () => Promise<T>,
  maxAttempts = 6
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !isTransientWindowsLockError(error)) {
        throw error;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(200, 25 * attempt))
      );
    }
  }
}

async function defaultAvailableDiskBytes(directory: string): Promise<number> {
  const stats = await statfs(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function yieldEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function readMeta(sql: Statements): PersistedCompactionMeta | undefined {
  const row = sql
    .get("SELECT value FROM runtime_meta WHERE key = ?")
    .get(COMPACTION_META_KEY) as { value?: string } | undefined;
  if (!row?.value) return undefined;
  try {
    return JSON.parse(String(row.value)) as PersistedCompactionMeta;
  } catch {
    return undefined;
  }
}

function writeMeta(sql: Statements, meta: PersistedCompactionMeta): void {
  sql
    .get(
      "INSERT INTO runtime_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(COMPACTION_META_KEY, JSON.stringify(meta));
}

function countTotalSessions(sql: Statements): number {
  const row = sql.get("SELECT COUNT(*) AS count FROM sessions").get() as
    { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function quickCheckPath(databasePath: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath);
    const row = db.prepare("PRAGMA quick_check").get() as
      Record<string, unknown> | undefined;
    const value = row ? Object.values(row)[0] : undefined;
    return value === "ok";
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* Ignore close failure on broken probe DB. */
    }
  }
}

async function fsyncFileBestEffort(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Windows FlushFileBuffers requires write access on the file handle.
    handle = await open(filePath, "r+");
    await handle.sync();
  } catch {
    /* Best-effort durability flush. */
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function syncDirBestEffort(dirPath: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(dirPath, constants.O_RDONLY);
    await handle.sync();
  } catch {
    /* Directory fsync may not be supported on some filesystems. */
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function setWritableBestEffort(filePath: string): Promise<void> {
  await chmod(filePath, 0o600).catch(() => undefined);
}

async function installSingleFileNonOverwriting(
  src: string,
  dst: string,
  ops: { link: typeof link; rm: typeof rm }
): Promise<void> {
  try {
    await retryFsOp(() => ops.link(src, dst));
  } catch (error) {
    if (ops.link === link && isNodeError(error, "EXDEV", "ENOTSUP", "EPERM")) {
      // Fall back strictly to O_EXCL exclusive copy; never overwrite an existing file.
      await retryFsOp(() => copyFile(src, dst, constants.COPYFILE_EXCL));
    } else {
      throw error;
    }
  }
  await fsyncFileBestEffort(dst);
  await syncDirBestEffort(dirname(dst));
  await retryFsOp(() => ops.rm(src, { force: true })).catch(() => undefined);
  await syncDirBestEffort(dirname(dst));
}

async function installFileSetNonOverwriting(
  fromPaths: readonly string[],
  toPaths: readonly string[],
  ops: { link: typeof link; rm: typeof rm }
): Promise<void> {
  const pairs: { src: string; dst: string }[] = [];
  for (let i = 0; i < fromPaths.length; i += 1) {
    const src = fromPaths[i]!;
    const dst = toPaths[i]!;
    if (!(await existsAsync(src))) continue;
    if (await existsAsync(dst)) {
      throw Object.assign(new Error(`目标路径已存在文件，拒绝覆盖：${dst}`), {
        code: "EEXIST"
      });
    }
    pairs.push({ src, dst });
  }
  for (const pair of pairs) {
    await installSingleFileNonOverwriting(pair.src, pair.dst, ops);
  }
}

async function moveFileSet(
  fromPaths: readonly string[],
  toPaths: readonly string[],
  fsRename: typeof rename = rename
): Promise<void> {
  for (let i = 0; i < fromPaths.length; i += 1) {
    const src = fromPaths[i]!;
    const dst = toPaths[i]!;
    if (!(await existsAsync(src))) continue;
    await retryFsOp(() => fsRename(src, dst));
  }
}

async function removeFileSet(
  paths: readonly string[],
  fsRm: typeof rm = rm
): Promise<void> {
  for (const path of paths) {
    if (!(await existsAsync(path))) continue;
    await retryFsOp(() => fsRm(path, { force: true }));
  }
}

function readSqliteFileHeader(
  databasePath: string
): SqliteHeaderFingerprint | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(databasePath, "r");
    const buffer = Buffer.alloc(100);
    const bytesRead = readSync(fd, buffer, 0, 100, 0);
    if (bytesRead < 100) return undefined;
    return {
      writeVersion: buffer[18] ?? 0,
      readVersion: buffer[19] ?? 0,
      changeCounter: buffer.readUInt32BE(24),
      pageCount: buffer.readUInt32BE(28),
      versionValidFor: buffer.readUInt32BE(92),
      size: statSync(databasePath).size
    };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* Ignore close error on header probe. */
      }
    }
  }
}

function headersEqual(
  a: SqliteHeaderFingerprint | undefined,
  b: SqliteHeaderFingerprint | undefined
): boolean {
  if (!a || !b) return false;
  return (
    a.writeVersion === b.writeVersion &&
    a.readVersion === b.readVersion &&
    a.changeCounter === b.changeCounter &&
    a.pageCount === b.pageCount &&
    a.versionValidFor === b.versionValidFor &&
    a.size === b.size
  );
}

function captureWatermark(sql: Statements): PreSwapWatermark {
  const count = (table: string): number =>
    Number(
      (
        sql.get(`SELECT COUNT(*) AS c FROM ${table}`).get() as
          { c?: number } | undefined
      )?.c ?? 0
    );
  const sessions = (
    sql
      .get(
        "SELECT scope_key, session_id, revision, generation, sequence, deleted, updated_at, message_count, turn_count FROM sessions ORDER BY scope_key, session_id"
      )
      .all() as {
      scope_key: string;
      session_id: string;
      revision: number;
      generation: number;
      sequence: number;
      deleted: number;
      updated_at: string;
      message_count: number;
      turn_count: number;
    }[]
  ).map((row) => ({
    scopeKey: row.scope_key,
    sessionId: row.session_id,
    revision: Number(row.revision),
    generation: Number(row.generation),
    sequence: Number(row.sequence),
    deleted: Number(row.deleted),
    updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count),
    turnCount: Number(row.turn_count)
  }));
  const digest = createHash("sha256");
  for (const row of sql
    .get("SELECT key, value_ref FROM legacy_values ORDER BY key")
    .all() as { key: string; value_ref: string }[]) {
    digest.update(`lv:${row.key}=${row.value_ref}\0`);
  }
  for (const row of sql
    .get(
      "SELECT scope_key, session_id, stage_id, sequence, value_ref, consumed FROM stages ORDER BY scope_key, session_id, stage_id"
    )
    .all() as {
    scope_key: string;
    session_id: string;
    stage_id: string;
    sequence: number;
    value_ref: string | null;
    consumed: number;
  }[]) {
    digest.update(
      `st:${row.scope_key}/${row.session_id}/${row.stage_id}=${row.sequence}:${row.consumed}:${row.value_ref ?? ""}\0`
    );
  }
  for (const row of sql
    .get(
      "SELECT key, value FROM runtime_meta WHERE key != ? AND key NOT LIKE 'mainInstance%' ORDER BY key"
    )
    .all(COMPACTION_META_KEY) as { key: string; value: string }[]) {
    digest.update(`rm:${row.key}=${row.value}\0`);
  }
  return {
    scopeCount: count("scopes"),
    sessionCount: sessions.length,
    messageCount: count("messages"),
    messageBytesTotal: Number(
      (
        sql
          .get("SELECT COALESCE(SUM(byte_length), 0) AS s FROM messages")
          .get() as { s?: number } | undefined
      )?.s ?? 0
    ),
    receiptCount: count("receipts"),
    stageReceiptCount: count("stage_receipts"),
    legacyCount: count("legacy_values"),
    legacyBackupCount: count("legacy_backups"),
    stageCount: count("stages"),
    purgedSessionCount: count("purged_sessions"),
    migrationCount: count("migrations"),
    migrationRecordCount: count("migration_records"),
    maxNodeId: Number(
      (
        sql.get("SELECT COALESCE(MAX(id), 0) AS c FROM nodes").get() as
          { c?: number } | undefined
      )?.c ?? 0
    ),
    auxDigest: digest.digest("hex"),
    sessions
  };
}

function watermarksEqual(
  a: PreSwapWatermark,
  b: PreSwapWatermark,
  strictSameStore = true
): boolean {
  if (
    a.scopeCount !== b.scopeCount ||
    a.sessionCount !== b.sessionCount ||
    a.messageCount !== b.messageCount ||
    a.receiptCount !== b.receiptCount ||
    a.legacyCount !== b.legacyCount ||
    a.legacyBackupCount !== b.legacyBackupCount ||
    a.stageCount !== b.stageCount ||
    (a.stageReceiptCount !== undefined &&
      b.stageReceiptCount !== undefined &&
      a.stageReceiptCount !== b.stageReceiptCount) ||
    (a.purgedSessionCount !== undefined &&
      b.purgedSessionCount !== undefined &&
      a.purgedSessionCount !== b.purgedSessionCount) ||
    (a.migrationCount !== undefined &&
      b.migrationCount !== undefined &&
      a.migrationCount !== b.migrationCount) ||
    (a.migrationRecordCount !== undefined &&
      b.migrationRecordCount !== undefined &&
      a.migrationRecordCount !== b.migrationRecordCount) ||
    (strictSameStore && a.maxNodeId !== b.maxNodeId) ||
    (strictSameStore &&
      a.messageBytesTotal !== undefined &&
      b.messageBytesTotal !== undefined &&
      a.messageBytesTotal !== b.messageBytesTotal) ||
    (strictSameStore &&
      a.auxDigest !== undefined &&
      b.auxDigest !== undefined &&
      a.auxDigest !== b.auxDigest) ||
    a.sessions.length !== b.sessions.length
  ) {
    return false;
  }
  for (let i = 0; i < a.sessions.length; i += 1) {
    const s1 = a.sessions[i]!;
    const s2 = b.sessions[i]!;
    if (
      s1.scopeKey !== s2.scopeKey ||
      s1.sessionId !== s2.sessionId ||
      s1.revision !== s2.revision ||
      s1.generation !== s2.generation ||
      s1.sequence !== s2.sequence ||
      s1.messageCount !== s2.messageCount ||
      s1.turnCount !== s2.turnCount ||
      (s1.deleted !== undefined &&
        s2.deleted !== undefined &&
        s1.deleted !== s2.deleted) ||
      (s1.updatedAt !== undefined &&
        s2.updatedAt !== undefined &&
        s1.updatedAt !== s2.updatedAt)
    ) {
      return false;
    }
  }
  return true;
}

function buildStatus(
  meta: PersistedCompactionMeta,
  overrides: Partial<ConversationCompactionStatus> = {}
): ConversationCompactionStatus {
  const phase = overrides.phase ?? meta.phase;
  const backupBytes = overrides.backupBytes ?? meta.backupBytes;
  const status: ConversationCompactionStatus = {
    phase,
    legacyCallsFound: overrides.legacyCallsFound ?? meta.legacyCallsFound ?? 0,
    estimatedReclaimableBytes:
      overrides.estimatedReclaimableBytes ??
      meta.estimatedReclaimableBytes ??
      0,
    processedSessions:
      overrides.processedSessions ?? meta.processedSessions ?? 0,
    totalSessions: overrides.totalSessions ?? meta.totalSessions ?? 0,
    bytesBefore: overrides.bytesBefore ?? meta.bytesBefore ?? 0,
    canRetry: overrides.canRetry ?? (phase === "needed" || phase === "failed"),
    canReleaseBackup:
      overrides.canReleaseBackup ??
      (Boolean(backupBytes && backupBytes > 0) &&
        phase === "completed_with_backup"),
    canRollback:
      overrides.canRollback ?? Boolean(backupBytes && backupBytes > 0)
  };
  const bytesAfter = overrides.bytesAfter ?? meta.bytesAfter;
  if (bytesAfter !== undefined) status.bytesAfter = bytesAfter;
  if (backupBytes !== undefined) status.backupBytes = backupBytes;
  const netFreedBytes = overrides.netFreedBytes ?? meta.netFreedBytes;
  if (netFreedBytes !== undefined) status.netFreedBytes = netFreedBytes;
  const requiredDiskBytes =
    overrides.requiredDiskBytes ?? meta.requiredDiskBytes;
  if (requiredDiskBytes !== undefined)
    status.requiredDiskBytes = requiredDiskBytes;
  const availableDiskBytes =
    overrides.availableDiskBytes ?? meta.availableDiskBytes;
  if (availableDiskBytes !== undefined) {
    status.availableDiskBytes = availableDiskBytes;
  }
  const failureCode = overrides.failureCode ?? meta.failureCode;
  if (failureCode !== undefined) status.failureCode = failureCode;
  const failureDetail = overrides.failureDetail ?? meta.failureDetail;
  if (failureDetail !== undefined) status.failureDetail = failureDetail;
  const startedAt = overrides.startedAt ?? meta.startedAt;
  if (startedAt !== undefined) status.startedAt = startedAt;
  const updatedAt = overrides.updatedAt ?? meta.updatedAt;
  if (updatedAt !== undefined) status.updatedAt = updatedAt;
  const completedAt = overrides.completedAt ?? meta.completedAt;
  if (completedAt !== undefined) status.completedAt = completedAt;
  const backupPath = overrides.backupPath ?? meta.backupPath;
  if (backupPath !== undefined) status.backupPath = backupPath;
  return status;
}

/**
 * Cleans interrupted temporary candidate files on startup under the cross-version
 * `.storage-bootstrap` gate and restores `.bak-v190` without overwriting a
 * newly committed database at `databasePath`. Never deletes `.bak-v190` silently.
 */
export async function recoverCompactionOnStartup(
  databasePath: string,
  options: RecoverCompactionOptions = {}
): Promise<void> {
  if (!databasePath || databasePath === ":memory:") return;
  const dir = dirname(databasePath);
  const name = basename(databasePath);
  if (!(await existsAsync(dir))) return;

  const initialEntries = await readdir(dir);
  const hasCompactionArtifacts = initialEntries.some(
    (entry) =>
      entry === `${name}.bak-v190` ||
      entry.startsWith(`${name}.bak-v190-`) ||
      entry.startsWith(`${name}.bak-prev-`) ||
      entry.startsWith(`${name}.candidate-`)
  );
  if (!hasCompactionArtifacts) return;

  try {
    await withStorageBootstrapGate(
      databasePath,
      resolveGateOptions(options),
      async (gate) => {
        const entries = await readdir(dir);
        const backupMain = `${databasePath}.bak-v190`;
        const hasBackup = await existsAsync(backupMain);
        const prevBases = entries
          .filter((entry) => entry.startsWith(`${name}.bak-prev-`))
          .filter((entry) => !entry.endsWith("-wal") && !entry.endsWith("-shm"))
          .map((entry) => join(dir, entry));

        // Always check and restore the main database BEFORE purging temporary files,
        // and skip expensive full-DB quick_check when no recovery backup exists.
        if (hasBackup || prevBases.length > 0) {
          const hasMain = await existsAsync(databasePath);
          const initialMainStat = hasMain
            ? await lstat(databasePath, { bigint: true }).catch(() => undefined)
            : undefined;
          const mainHealthy =
            hasMain &&
            (await fileSizeIfExists(databasePath)) > 0 &&
            quickCheckPath(databasePath);

          if (!mainHealthy) {
            const recoveryBase =
              hasBackup && quickCheckPath(backupMain)
                ? backupMain
                : prevBases.find((base) => quickCheckPath(base));
            if (recoveryBase) {
              await options.testHooks?.beforeRestoreBackup?.({
                databasePath,
                recoveryBase
              });
              gate.assertStillHeld();

              const mainNowExists = await existsAsync(databasePath);
              if (hasMain && mainNowExists && initialMainStat) {
                const latestStat = await lstat(databasePath, {
                  bigint: true
                }).catch(() => undefined);
                if (
                  !latestStat ||
                  latestStat.dev !== initialMainStat.dev ||
                  latestStat.ino !== initialMainStat.ino ||
                  latestStat.size !== initialMainStat.size
                ) {
                  throw new ConversationStorageError(
                    "database_locked",
                    "启动恢复期间检测到主库文件发生变化，已中止覆盖并保留现有文件与备份。"
                  );
                }
                const corruptSuffix = `.corrupt-${Date.now()}`;
                await installFileSetNonOverwriting(
                  sqliteSidecarPaths(databasePath),
                  sqliteSidecarPaths(`${databasePath}${corruptSuffix}`),
                  { link, rm }
                );
              } else if (!hasMain && mainNowExists) {
                throw new ConversationStorageError(
                  "database_locked",
                  "启动恢复期间检测到原路径已存在新数据库文件，已中止覆盖并保留现有文件与备份。"
                );
              } else if (!hasMain) {
                await removeFileSet([
                  `${databasePath}-wal`,
                  `${databasePath}-shm`
                ]);
              }

              for (const path of [
                recoveryBase,
                `${recoveryBase}-wal`,
                `${recoveryBase}-shm`
              ]) {
                await setWritableBestEffort(path);
              }
              try {
                await installFileSetNonOverwriting(
                  [recoveryBase, `${recoveryBase}-wal`, `${recoveryBase}-shm`],
                  sqliteSidecarPaths(databasePath),
                  { link, rm }
                );
              } catch (error) {
                if (isNodeError(error, "EEXIST")) {
                  throw new ConversationStorageError(
                    "database_locked",
                    "启动恢复期间目标路径被外部进程抢占，已中止覆盖并保留现有文件与备份。"
                  );
                }
                throw error;
              }
            }
          }
        }

        const refreshedEntries = await readdir(dir);
        for (const entry of refreshedEntries) {
          if (
            entry.startsWith(`${name}.candidate-`) ||
            entry.startsWith(`${name}.bak-prev-`)
          ) {
            const fullPath = join(dir, entry);
            await setWritableBestEffort(fullPath);
            await retryFsOp(() => rm(fullPath, { force: true }));
          }
        }
      }
    );
  } catch (error) {
    if (error instanceof StorageBootstrapGateError) {
      throw new ConversationStorageError("database_locked", error.message);
    }
    throw error;
  }
}

export async function inspectCompactionStatus(
  database: ConversationDatabase
): Promise<ConversationCompactionStatus> {
  const totalSessions = countTotalSessions(database.statements);
  const meta = readMeta(database.statements);
  const snapshotStats =
    meta?.phase === "skipped_new" ||
    meta?.phase === "completed_with_backup" ||
    meta?.phase === "backup_released"
      ? { legacyCallsFound: 0, estimatedReclaimableBytes: 0 }
      : database.jsonNodes.inspectModelCallSnapshots();
  const currentBytes =
    database.databasePath === ":memory:"
      ? 0
      : await measureFootprint(sqliteSidecarPaths(database.databasePath));
  const backupBytes =
    database.databasePath === ":memory:"
      ? 0
      : await measureFootprint(backupPaths(database.databasePath));
  const backupMain = `${database.databasePath}.bak-v190`;

  if (snapshotStats.legacyCallsFound > 0) {
    if (meta?.phase === "failed") {
      return buildStatus(meta, {
        phase: "failed",
        legacyCallsFound: snapshotStats.legacyCallsFound,
        estimatedReclaimableBytes: snapshotStats.estimatedReclaimableBytes,
        totalSessions,
        bytesBefore: meta.bytesBefore ?? currentBytes,
        backupBytes,
        canRetry: true,
        canReleaseBackup: false,
        canRollback: backupBytes > 0
      });
    }
    return buildStatus(meta ?? { phase: "needed" }, {
      phase: "needed",
      legacyCallsFound: snapshotStats.legacyCallsFound,
      estimatedReclaimableBytes: snapshotStats.estimatedReclaimableBytes,
      totalSessions,
      bytesBefore: currentBytes,
      backupBytes,
      canRetry: true,
      canReleaseBackup: false,
      canRollback: backupBytes > 0
    });
  }

  if (backupBytes > 0 || meta?.phase === "completed_with_backup") {
    const bytesBefore = meta?.bytesBefore ?? currentBytes;
    const netFreedBytes = bytesBefore - currentBytes - backupBytes;
    return buildStatus(meta ?? { phase: "completed_with_backup" }, {
      phase: backupBytes > 0 ? "completed_with_backup" : "backup_released",
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      processedSessions: meta?.processedSessions ?? totalSessions,
      totalSessions,
      bytesBefore,
      bytesAfter: currentBytes,
      backupBytes,
      netFreedBytes:
        backupBytes > 0 ? netFreedBytes : bytesBefore - currentBytes,
      canRetry: false,
      canReleaseBackup: backupBytes > 0,
      canRollback: backupBytes > 0,
      ...(backupBytes > 0 ? { backupPath: backupMain } : {})
    });
  }

  if (meta?.phase === "backup_released") {
    const bytesBefore = meta.bytesBefore ?? currentBytes;
    return buildStatus(meta, {
      phase: "backup_released",
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      totalSessions,
      bytesBefore,
      bytesAfter: currentBytes,
      backupBytes: 0,
      netFreedBytes: bytesBefore - currentBytes,
      canRetry: false,
      canReleaseBackup: false,
      canRollback: false
    });
  }

  if (meta?.phase === "rolled_back") {
    return buildStatus(meta, {
      phase: "rolled_back",
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      totalSessions,
      bytesBefore: currentBytes,
      backupBytes: 0,
      canRetry: false,
      canReleaseBackup: false,
      canRollback: false
    });
  }

  if (meta?.phase === "skipped_new") {
    return buildStatus(meta, {
      phase: "skipped_new",
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      totalSessions: 0,
      bytesBefore: currentBytes,
      canRetry: false,
      canReleaseBackup: false,
      canRollback: false
    });
  }

  return buildStatus(
    { phase: "idle" },
    {
      phase: "idle",
      legacyCallsFound: 0,
      estimatedReclaimableBytes: 0,
      totalSessions,
      bytesBefore: currentBytes,
      canRetry: false,
      canReleaseBackup: false,
      canRollback: false
    }
  );
}

async function detectLockFailure(
  lockRoot: string,
  error: unknown
): Promise<{ code: ConversationCompactionFailureCode; detail: string }> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const content = await readFile(
      join(lockRoot, INTERNAL_DIRECTORY, LOCK_FILE),
      "utf8"
    );
    const owner = parseLockOwnerOptional(content);
    if (owner && owner.pid !== process.pid && isProcessAlive(owner.pid)) {
      return {
        code: "old_process_active",
        detail: `检测到另一个 DeepWrite 进程（PID ${owner.pid}）正在占用历史库锁，请关闭该进程后重试。`
      };
    }
  } catch {
    // Fallback to generic lock conflict if lock disappeared cleanly.
  }
  return {
    code: "database_locked",
    detail: message
  };
}

function addFidelity(target: FidelityTotals, source: FidelityTotals): void {
  target.subagentRuns += source.subagentRuns;
  target.toolCalls += source.toolCalls;
  target.editProposals += source.editProposals;
  target.editProposalsWithHunks += source.editProposalsWithHunks;
  target.editProposalsWithDiscardSnapshot +=
    source.editProposalsWithDiscardSnapshot;
}

function fidelityEqual(a: FidelityTotals, b: FidelityTotals): boolean {
  return (
    a.subagentRuns === b.subagentRuns &&
    a.toolCalls === b.toolCalls &&
    a.editProposals === b.editProposals &&
    a.editProposalsWithHunks === b.editProposalsWithHunks &&
    a.editProposalsWithDiscardSnapshot === b.editProposalsWithDiscardSnapshot
  );
}

function emptyFidelity(): FidelityTotals {
  return {
    subagentRuns: 0,
    toolCalls: 0,
    editProposals: 0,
    editProposalsWithHunks: 0,
    editProposalsWithDiscardSnapshot: 0
  };
}

function copySimpleTable(
  sourceSql: Statements,
  destSql: Statements,
  table: string,
  columns: readonly string[]
): void {
  const cols = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const select = sourceSql.get(`SELECT ${cols} FROM ${table}`);
  const insert = destSql.get(
    `INSERT INTO ${table}(${cols}) VALUES (${placeholders})`
  );
  const rows = select.all() as Record<string, unknown>[];
  for (const row of rows) {
    insert.run(
      ...(columns.map((column) => row[column]) as (
        string | number | bigint | Uint8Array | null
      )[])
    );
  }
}

function rewriteRef(
  sourceNodes: JsonNodes,
  destNodes: JsonNodes,
  rawRef: string | null,
  totals?: FidelityTotals
): { refJson: string | null; refBytes: number; strippedCalls: number } {
  if (!rawRef) return { refJson: null, refBytes: 0, strippedCalls: 0 };
  const parsedRef = JSON.parse(rawRef) as ValueRef;
  const read = sourceNodes.readWithoutModelCallSnapshots(parsedRef);
  if (totals) addFidelity(totals, read);
  const newRef = destNodes.create(read.value as ConversationHistoryJson);
  return {
    refJson: JSON.stringify(newRef),
    refBytes: newRef.bytes,
    strippedCalls: read.strippedCalls
  };
}

function verifyCandidateFidelity(
  candidatePath: string,
  expectedWatermark: PreSwapWatermark,
  expectedFidelity: FidelityTotals,
  shouldAbort?: () => boolean
):
  | { ok: true }
  | { ok: false; aborted: true }
  | { ok: false; code: ConversationCompactionFailureCode; detail: string } {
  const verifyDb = new DatabaseSync(candidatePath);
  try {
    if (shouldAbort?.()) {
      return { ok: false, aborted: true };
    }
    const qcRow = verifyDb.prepare("PRAGMA quick_check").get() as
      Record<string, unknown> | undefined;
    if ((qcRow ? Object.values(qcRow)[0] : undefined) !== "ok") {
      return {
        ok: false,
        code: "integrity_check_failed",
        detail: "Candidate database failed SQLite quick_check."
      };
    }
    const fkRows = verifyDb.prepare("PRAGMA foreign_key_check").all();
    if (fkRows.length > 0) {
      return {
        ok: false,
        code: "integrity_check_failed",
        detail: `Candidate database reported ${fkRows.length} foreign key violation(s).`
      };
    }
    const verifySql = new Statements(verifyDb);
    const verifyNodes = new JsonNodes(verifySql);
    const actualWatermark = captureWatermark(verifySql);
    if (!watermarksEqual(expectedWatermark, actualWatermark, false)) {
      return {
        ok: false,
        code: "logic_check_failed",
        detail:
          "Candidate session metadata, revisions, or row counts diverged from source."
      };
    }
    if (shouldAbort?.()) {
      return { ok: false, aborted: true };
    }
    const remainingSnapshots = verifyNodes.inspectModelCallSnapshots();
    if (remainingSnapshots.legacyCallsFound > 0) {
      return {
        ok: false,
        code: "logic_check_failed",
        detail: `Candidate database still contains ${remainingSnapshots.legacyCallsFound} unstripped snapshots.`
      };
    }
    const actualFidelity = emptyFidelity();
    let lastRowId = 0;
    const msgStmt = verifySql.get(
      "SELECT rowid, value_ref FROM messages WHERE rowid > ? ORDER BY rowid LIMIT ?"
    );
    while (true) {
      if (shouldAbort?.()) {
        return { ok: false, aborted: true };
      }
      const batch = msgStmt.all(lastRowId, STREAM_BATCH_SIZE) as {
        rowid: number;
        value_ref: string;
      }[];
      if (batch.length === 0) break;
      for (const row of batch) {
        lastRowId = Number(row.rowid);
        const read = verifyNodes.readWithoutModelCallSnapshots(
          JSON.parse(row.value_ref) as ValueRef
        );
        addFidelity(actualFidelity, read);
      }
    }
    if (!fidelityEqual(expectedFidelity, actualFidelity)) {
      return {
        ok: false,
        code: "logic_check_failed",
        detail:
          "Candidate subagent, tool call, or edit proposal fidelity counters did not match source."
      };
    }
    const candidateMeta = readMeta(verifySql);
    if (
      candidateMeta?.phase !== "completed_with_backup" ||
      !candidateMeta.preSwapWatermark
    ) {
      return {
        ok: false,
        code: "logic_check_failed",
        detail:
          "Candidate database is missing pre-swap completion metadata or rollback watermark."
      };
    }
    return { ok: true };
  } finally {
    try {
      verifyDb.close();
    } catch {
      /* Ignore close cleanup error. */
    }
  }
}

export async function runConversationCompaction(
  handle: CompactionDatabaseHandle,
  options: RunCompactionOptions = {}
): Promise<ConversationCompactionStatus> {
  const initialDb = handle.getDatabase();
  if (!initialDb.databasePath || initialDb.databasePath === ":memory:") {
    return inspectCompactionStatus(initialDb);
  }

  const dbPath = initialDb.databasePath;
  await mkdir(dirname(dbPath), { recursive: true });
  const lockRoot = await realpath(dirname(dbPath));

  try {
    return await withStorageBootstrapGate(
      dbPath,
      resolveGateOptions(options),
      async (gate) =>
        await withProjectTransactionLock(
          lockRoot,
          async () => {
            const currentDb = handle.getDatabase();
            const preStatus = await inspectCompactionStatus(currentDb);
            if (
              preStatus.phase === "skipped_new" ||
              (preStatus.legacyCallsFound === 0 && !options.force)
            ) {
              return preStatus;
            }

            const currentBytes = await measureFootprint(
              sqliteSidecarPaths(dbPath)
            );
            const estimatedCompactBytes = Math.max(
              512 * 1024,
              currentBytes -
                Math.min(currentBytes, preStatus.estimatedReclaimableBytes)
            );
            const headroomBytes =
              options.minDiskHeadroomBytes ?? DEFAULT_DISK_HEADROOM_BYTES;
            const requiredDiskBytes = Math.max(
              estimatedCompactBytes * 2 + headroomBytes,
              Math.ceil(currentBytes * 0.15) + headroomBytes
            );
            const availableDiskBytes = await (
              options.getAvailableDiskBytes ?? defaultAvailableDiskBytes
            )(lockRoot);

            if (availableDiskBytes < requiredDiskBytes) {
              const startedAt = new Date().toISOString();
              const failedMeta: PersistedCompactionMeta = {
                phase: "failed",
                legacyCallsFound: preStatus.legacyCallsFound,
                estimatedReclaimableBytes: preStatus.estimatedReclaimableBytes,
                totalSessions: preStatus.totalSessions,
                processedSessions: 0,
                bytesBefore: currentBytes,
                requiredDiskBytes,
                availableDiskBytes,
                failureCode: "disk_full",
                failureDetail: `可用磁盘空间不足：需要约 ${Math.ceil(requiredDiskBytes / (1024 * 1024))} MiB，当前可用 ${Math.floor(availableDiskBytes / (1024 * 1024))} MiB。清理空间后可在设置中重试。`,
                startedAt,
                updatedAt: startedAt
              };
              writeMeta(currentDb.statements, failedMeta);
              const status = buildStatus(failedMeta, { canRetry: true });
              handle.onProgress?.(status);
              return status;
            }

            const fsRename = options.fsOps?.rename ?? rename;
            const fsLink = options.fsOps?.link ?? link;
            const fsRm = options.fsOps?.rm ?? rm;
            const swapStrategy: SwapStrategy =
              options.swapStrategy && options.swapStrategy !== "auto"
                ? options.swapStrategy
                : process.platform === "win32"
                  ? "windows-rename"
                  : "posix-hardlink";

            const startedAt = new Date().toISOString();
            let candidatePath: string | undefined;
            let candidateDb: DatabaseSync | undefined;
            let sourceLockedExclusive = false;
            const restoreSourceNormalWal = (targetDb: ConversationDatabase) => {
              try {
                targetDb.database.exec("ROLLBACK;");
              } catch {
                /* No active transaction to roll back. */
              }
              try {
                unsealReadonlyBackupTriggers(targetDb.database);
              } catch {
                /* Best-effort unseal if source DB had read-only backup triggers applied. */
              }
              try {
                targetDb.database.exec("PRAGMA locking_mode = NORMAL;");
                targetDb.database.prepare("SELECT 1 FROM schema_version").get();
                targetDb.database.exec(
                  "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"
                );
              } catch {
                /* Best-effort return to normal WAL mode. */
              }
            };

            const abortToCurrentStatus =
              async (): Promise<ConversationCompactionStatus> => {
                if (sourceLockedExclusive) {
                  restoreSourceNormalWal(currentDb);
                  sourceLockedExclusive = false;
                }
                if (candidateDb) {
                  try {
                    candidateDb.close();
                  } catch {
                    /* Ignore close cleanup error during preemptive abort. */
                  }
                  candidateDb = undefined;
                }
                if (candidatePath) {
                  await removeFileSet(
                    sqliteSidecarPaths(candidatePath),
                    fsRm
                  ).catch(() => undefined);
                  candidatePath = undefined;
                }
                handle.setWriteBlocked(undefined);
                const status = await inspectCompactionStatus(currentDb);
                handle.onProgress?.(status);
                return status;
              };

            if (options.shouldAbort?.()) {
              return await abortToCurrentStatus();
            }

            handle.setWriteBlocked(
              "正在压缩历史对话数据库，请稍后自动重试写入。"
            );

            try {
              const preLockBytes = await measureFootprint(
                sqliteSidecarPaths(dbPath)
              );
              try {
                currentDb.assertMainInstance();
                // Switch to DELETE journal + EXCLUSIVE OS lock with zero wait so ANY open
                // independent SQLite connection (including v1.9.0 without directory locks) is
                // excluded immediately before candidate build or file replacement begins.
                currentDb.database.exec("PRAGMA busy_timeout = 0;");
                const ckpt = currentDb.database
                  .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
                  .get() as { busy?: number } | undefined;
                if (Number(ckpt?.busy ?? 0) !== 0) {
                  throw Object.assign(
                    new Error(
                      "Database is held open by another active connection."
                    ),
                    { code: "database_locked", sqliteCode: 5 }
                  );
                }
                const jmRow = currentDb.database
                  .prepare("PRAGMA journal_mode = DELETE")
                  .get() as { journal_mode?: string } | undefined;
                if (
                  String(jmRow?.journal_mode ?? "").toLowerCase() !== "delete"
                ) {
                  throw Object.assign(
                    new Error(
                      "Database is held open in WAL mode by another independent process."
                    ),
                    { code: "database_locked", sqliteCode: 5 }
                  );
                }
                currentDb.database.exec(
                  "PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;"
                );
                currentDb.assertMainInstance();
                sourceLockedExclusive = true;
              } catch (lockError) {
                restoreSourceNormalWal(currentDb);
                sourceLockedExclusive = false;
                const errCode =
                  (lockError as { code?: unknown })?.code ===
                  "main_instance_changed"
                    ? ("old_process_active" as const)
                    : ("database_locked" as const);
                const failedMeta: PersistedCompactionMeta = {
                  phase: "failed",
                  legacyCallsFound: preStatus.legacyCallsFound,
                  estimatedReclaimableBytes:
                    preStatus.estimatedReclaimableBytes,
                  totalSessions: preStatus.totalSessions,
                  processedSessions: 0,
                  bytesBefore: preLockBytes,
                  failureCode: errCode,
                  failureDetail:
                    errCode === "old_process_active"
                      ? "检测到另一个较新 DeepWrite 实例正在使用会话库，已推迟本次整理。"
                      : "数据库正被其他独立进程占用，已安全推迟整理，稍后可重试。",
                  startedAt,
                  updatedAt: new Date().toISOString()
                };
                try {
                  writeMeta(currentDb.statements, failedMeta);
                } catch {
                  /* External process may hold write lock; status still surfaced. */
                }
                const status = buildStatus(failedMeta, { canRetry: true });
                handle.onProgress?.(status);
                return status;
              }

              const bytesBefore = Math.max(
                preLockBytes,
                await measureFootprint(sqliteSidecarPaths(dbPath))
              );
              const preCloseSourceBytes = await fileSizeIfExists(dbPath);
              const watermark = captureWatermark(currentDb.statements);
              const totalSessions = watermark.sessionCount;

              handle.onProgress?.(
                buildStatus(
                  {
                    phase: "running",
                    legacyCallsFound: preStatus.legacyCallsFound,
                    estimatedReclaimableBytes:
                      preStatus.estimatedReclaimableBytes,
                    processedSessions: 0,
                    totalSessions,
                    bytesBefore,
                    startedAt,
                    updatedAt: startedAt
                  },
                  {
                    canRetry: false,
                    canReleaseBackup: false,
                    canRollback: false
                  }
                )
              );

              candidatePath = `${dbPath}.candidate-${randomUUID()}.tmp`;
              candidateDb = openConversationDatabase(candidatePath);
              candidateDb.exec(`
            PRAGMA foreign_keys = OFF;
            PRAGMA journal_mode = MEMORY;
            PRAGMA synchronous = NORMAL;
          `);
              const candidateSql = new Statements(candidateDb);
              const candidateNodes = new JsonNodes(candidateSql);
              const sourceSql = currentDb.statements;
              const sourceNodes = currentDb.jsonNodes;

              candidateDb.exec("BEGIN IMMEDIATE");
              copySimpleTable(sourceSql, candidateSql, "runtime_meta", [
                "key",
                "value"
              ]);
              copySimpleTable(sourceSql, candidateSql, "migrations", [
                "source",
                "fingerprint",
                "state",
                "cursor",
                "checked_records"
              ]);
              copySimpleTable(sourceSql, candidateSql, "migration_records", [
                "source",
                "scope_key",
                "session_id",
                "message_id",
                "checksum"
              ]);
              copySimpleTable(sourceSql, candidateSql, "purged_sessions", [
                "scope_key",
                "session_id"
              ]);
              copySimpleTable(sourceSql, candidateSql, "receipts", [
                "scope_key",
                "session_id",
                "batch_id",
                "revision",
                "generation",
                "sequence",
                "fingerprint"
              ]);
              copySimpleTable(sourceSql, candidateSql, "stage_receipts", [
                "scope_key",
                "session_id",
                "stage_id",
                "chunk_id",
                "fingerprint",
                "sequence"
              ]);

              const scopeInsert = candidateSql.get(
                "INSERT INTO scopes(key, active_session_id, metadata_ref, removed, epoch, incremental) VALUES (?, ?, ?, ?, ?, ?)"
              );
              for (const row of sourceSql
                .get(
                  "SELECT key, active_session_id, metadata_ref, removed, epoch, incremental FROM scopes"
                )
                .all() as {
                key: string;
                active_session_id: string | null;
                metadata_ref: string | null;
                removed: number;
                epoch: number;
                incremental: number;
              }[]) {
                const meta = rewriteRef(
                  sourceNodes,
                  candidateNodes,
                  row.metadata_ref
                );
                scopeInsert.run(
                  row.key,
                  row.active_session_id,
                  meta.refJson,
                  row.removed,
                  row.epoch,
                  row.incremental
                );
              }

              const sessionInsert = candidateSql.get(
                "INSERT INTO sessions(scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position, message_count, message_bytes, turn_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)"
              );
              for (const row of sourceSql
                .get(
                  "SELECT scope_key, session_id, revision, generation, sequence, deleted, metadata_ref, updated_at, legacy_position FROM sessions"
                )
                .all() as {
                scope_key: string;
                session_id: string;
                revision: number;
                generation: number;
                sequence: number;
                deleted: number;
                metadata_ref: string | null;
                updated_at: string;
                legacy_position: number;
              }[]) {
                const meta = rewriteRef(
                  sourceNodes,
                  candidateNodes,
                  row.metadata_ref
                );
                sessionInsert.run(
                  row.scope_key,
                  row.session_id,
                  row.revision,
                  row.generation,
                  row.sequence,
                  row.deleted,
                  meta.refJson,
                  row.updated_at,
                  row.legacy_position
                );
              }

              const legacyValueInsert = candidateSql.get(
                "INSERT INTO legacy_values(key, value_ref) VALUES (?, ?)"
              );
              for (const row of sourceSql
                .get("SELECT key, value_ref FROM legacy_values")
                .all() as { key: string; value_ref: string }[]) {
                const converted = rewriteRef(
                  sourceNodes,
                  candidateNodes,
                  row.value_ref
                );
                legacyValueInsert.run(row.key, converted.refJson);
              }

              const legacyBackupInsert = candidateSql.get(
                "INSERT INTO legacy_backups(id, key, value_ref) VALUES (?, ?, ?)"
              );
              for (const row of sourceSql
                .get("SELECT id, key, value_ref FROM legacy_backups")
                .all() as { id: number; key: string; value_ref: string }[]) {
                const converted = rewriteRef(
                  sourceNodes,
                  candidateNodes,
                  row.value_ref
                );
                legacyBackupInsert.run(row.id, row.key, converted.refJson);
              }

              const stageInsert = candidateSql.get(
                "INSERT INTO stages(scope_key, session_id, stage_id, message_id, target, expected_revision, generation, sequence, value_ref, consumed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              );
              for (const row of sourceSql
                .get(
                  "SELECT scope_key, session_id, stage_id, message_id, target, expected_revision, generation, sequence, value_ref, consumed FROM stages"
                )
                .all() as {
                scope_key: string;
                session_id: string;
                stage_id: string;
                message_id: string;
                target: string;
                expected_revision: number;
                generation: number;
                sequence: number;
                value_ref: string | null;
                consumed: number;
              }[]) {
                const converted = rewriteRef(
                  sourceNodes,
                  candidateNodes,
                  row.value_ref
                );
                stageInsert.run(
                  row.scope_key,
                  row.session_id,
                  row.stage_id,
                  row.message_id,
                  row.target,
                  row.expected_revision,
                  row.generation,
                  row.sequence,
                  converted.refJson,
                  row.consumed
                );
              }
              candidateDb.exec("COMMIT");

              const sourceFidelity = emptyFidelity();
              const msgSelect = sourceSql.get(
                "SELECT rowid, scope_key, session_id, message_id, position, value_ref, role, preview, running, pending, reviewing FROM messages WHERE rowid > ? ORDER BY rowid LIMIT ?"
              );
              const msgInsert = candidateSql.get(
                "INSERT INTO messages(scope_key, session_id, message_id, position, value_ref, byte_length, role, preview, running, pending, reviewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              );
              const seenSessions = new Set<string>();
              let lastRowId = 0;
              let lastProgressAt = Date.now();
              let candidateBuildHookInvoked = false;

              while (true) {
                const batch = msgSelect.all(lastRowId, STREAM_BATCH_SIZE) as {
                  rowid: number;
                  scope_key: string;
                  session_id: string;
                  message_id: string;
                  position: number;
                  value_ref: string;
                  role: string;
                  preview: string;
                  running: number;
                  pending: number;
                  reviewing: number;
                }[];
                if (batch.length === 0) break;

                candidateDb.exec("BEGIN IMMEDIATE");
                for (const row of batch) {
                  lastRowId = Number(row.rowid);
                  seenSessions.add(`${row.scope_key}\0${row.session_id}`);
                  const rewritten = rewriteRef(
                    sourceNodes,
                    candidateNodes,
                    row.value_ref,
                    sourceFidelity
                  );
                  msgInsert.run(
                    row.scope_key,
                    row.session_id,
                    row.message_id,
                    row.position,
                    rewritten.refJson,
                    rewritten.refBytes,
                    row.role,
                    row.preview,
                    row.running,
                    row.pending,
                    row.reviewing
                  );
                }
                candidateDb.exec("COMMIT");

                if (!candidateBuildHookInvoked) {
                  candidateBuildHookInvoked = true;
                  await options.testHooks?.duringCandidateBuild?.({
                    candidatePath,
                    databasePath: dbPath
                  });
                  if (options.shouldAbort?.()) {
                    return await abortToCurrentStatus();
                  }
                }

                const now = Date.now();
                if (
                  now - lastProgressAt >= 100 ||
                  seenSessions.size === totalSessions
                ) {
                  lastProgressAt = now;
                  handle.onProgress?.(
                    buildStatus(
                      {
                        phase: "running",
                        legacyCallsFound: preStatus.legacyCallsFound,
                        estimatedReclaimableBytes:
                          preStatus.estimatedReclaimableBytes,
                        processedSessions: seenSessions.size,
                        totalSessions,
                        bytesBefore,
                        startedAt,
                        updatedAt: new Date(now).toISOString()
                      },
                      {
                        canRetry: false,
                        canReleaseBackup: false,
                        canRollback: false
                      }
                    )
                  );
                }
                await yieldEventLoop();
                if (options.shouldAbort?.()) {
                  return await abortToCurrentStatus();
                }
              }

              if (!candidateBuildHookInvoked) {
                await options.testHooks?.duringCandidateBuild?.({
                  candidatePath,
                  databasePath: dbPath
                });
                if (options.shouldAbort?.()) {
                  return await abortToCurrentStatus();
                }
              }

              const backupPath = `${dbPath}.bak-v190`;
              const candidateWatermark = captureWatermark(candidateSql);
              const preSwapCompletedAt = new Date().toISOString();
              // Persist completion state and post-upgrade watermark INSIDE candidateDb BEFORE
              // swapping onto dbPath so crashing right after rename never leaves missing rollback guard.
              const candidateMeta: PersistedCompactionMeta = {
                phase: "completed_with_backup",
                legacyCallsFound: 0,
                estimatedReclaimableBytes: 0,
                processedSessions: totalSessions,
                totalSessions,
                bytesBefore,
                backupBytes: preCloseSourceBytes,
                startedAt,
                updatedAt: preSwapCompletedAt,
                completedAt: preSwapCompletedAt,
                backupPath,
                preSwapWatermark: candidateWatermark
              };
              writeMeta(candidateSql, candidateMeta);

              candidateDb.exec(`
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA wal_checkpoint(TRUNCATE);
            ANALYZE;
          `);
              candidateDb.close();
              candidateDb = undefined;
              await fsyncFileBestEffort(candidatePath);
              await syncDirBestEffort(dirname(candidatePath));

              if (options.shouldAbort?.()) {
                return await abortToCurrentStatus();
              }

              handle.onProgress?.(
                buildStatus(
                  {
                    phase: "verifying",
                    legacyCallsFound: preStatus.legacyCallsFound,
                    estimatedReclaimableBytes:
                      preStatus.estimatedReclaimableBytes,
                    processedSessions: totalSessions,
                    totalSessions,
                    bytesBefore,
                    startedAt,
                    updatedAt: new Date().toISOString()
                  },
                  {
                    canRetry: false,
                    canReleaseBackup: false,
                    canRollback: false
                  }
                )
              );

              const postSourceWatermark = captureWatermark(sourceSql);
              if (!watermarksEqual(watermark, postSourceWatermark)) {
                restoreSourceNormalWal(currentDb);
                sourceLockedExclusive = false;
                await removeFileSet(sqliteSidecarPaths(candidatePath), fsRm);
                const failedMeta: PersistedCompactionMeta = {
                  phase: "failed",
                  legacyCallsFound: preStatus.legacyCallsFound,
                  estimatedReclaimableBytes:
                    preStatus.estimatedReclaimableBytes,
                  totalSessions,
                  processedSessions: totalSessions,
                  bytesBefore,
                  failureCode: "database_locked",
                  failureDetail:
                    "整理期间检测到并发修改，已保留原库未做切换，请重试。",
                  startedAt,
                  updatedAt: new Date().toISOString()
                };
                writeMeta(sourceSql, failedMeta);
                const status = buildStatus(failedMeta, { canRetry: true });
                handle.onProgress?.(status);
                return status;
              }

              if (options.shouldAbort?.()) {
                return await abortToCurrentStatus();
              }

              const verified = verifyCandidateFidelity(
                candidatePath,
                watermark,
                sourceFidelity,
                options.shouldAbort
              );
              if (!verified.ok) {
                if ("aborted" in verified) {
                  return await abortToCurrentStatus();
                }
                restoreSourceNormalWal(currentDb);
                sourceLockedExclusive = false;
                await removeFileSet(sqliteSidecarPaths(candidatePath), fsRm);
                const failedMeta: PersistedCompactionMeta = {
                  phase: "failed",
                  legacyCallsFound: preStatus.legacyCallsFound,
                  estimatedReclaimableBytes:
                    preStatus.estimatedReclaimableBytes,
                  totalSessions,
                  processedSessions: totalSessions,
                  bytesBefore,
                  failureCode: verified.code,
                  failureDetail: verified.detail,
                  startedAt,
                  updatedAt: new Date().toISOString()
                };
                writeMeta(sourceSql, failedMeta);
                const status = buildStatus(failedMeta, { canRetry: true });
                handle.onProgress?.(status);
                return status;
              }

              // Last preemption check: once `swapping` starts, file replacement completes atomically.
              if (options.shouldAbort?.()) {
                return await abortToCurrentStatus();
              }

              handle.onProgress?.(
                buildStatus(
                  {
                    phase: "swapping",
                    legacyCallsFound: preStatus.legacyCallsFound,
                    estimatedReclaimableBytes:
                      preStatus.estimatedReclaimableBytes,
                    processedSessions: totalSessions,
                    totalSessions,
                    bytesBefore,
                    startedAt,
                    updatedAt: new Date().toISOString()
                  },
                  {
                    canRetry: false,
                    canReleaseBackup: false,
                    canRollback: false
                  }
                )
              );

              await options.testHooks?.beforeBackupAndSwap?.({
                candidatePath,
                databasePath: dbPath
              });
              gate.assertStillHeld();
              const bytesAfter = await measureFootprint(
                sqliteSidecarPaths(candidatePath)
              );
              const prevBase = `${dbPath}.bak-prev-${randomUUID()}`;
              const prevBackupPaths = [
                prevBase,
                `${prevBase}-wal`,
                `${prevBase}-shm`
              ];

              // Seal the old database inode read-only via SQLite triggers BEFORE closing or
              // relinking so any stale pre-swap file descriptor fails writes to `.bak-v190`.
              sealDatabaseAsReadonlyBackup(currentDb.database);
              currentDb.database.exec("COMMIT; BEGIN EXCLUSIVE;");

              const sourceStat = await lstat(dbPath, { bigint: true }).catch(
                () => undefined
              );
              const preCloseHeader = readSqliteFileHeader(dbPath);
              const finalCandidatePath = candidatePath;
              let movedToBackup = false;
              let movedPrevBackup = false;
              let closedSourceForSwap = false;

              try {
                if (swapStrategy === "posix-hardlink") {
                  if (!sourceStat) {
                    throw Object.assign(
                      new Error("源数据库文件在切换前消失，已中止切换。"),
                      { code: "database_locked" }
                    );
                  }
                  if (await existsAsync(backupPath)) {
                    for (const path of backupPaths(dbPath)) {
                      await setWritableBestEffort(path);
                    }
                    await moveFileSet(
                      backupPaths(dbPath),
                      prevBackupPaths,
                      fsRename
                    );
                    movedPrevBackup = true;
                  }
                  await retryFsOp(() => fsLink(dbPath, backupPath));
                  movedToBackup = true;
                  await options.testHooks?.afterBackupBeforeSwap?.({
                    candidatePath: finalCandidatePath,
                    databasePath: dbPath
                  });
                  gate.assertStillHeld();
                  const statBeforeRename = await lstat(dbPath, {
                    bigint: true
                  }).catch(() => undefined);
                  if (
                    !statBeforeRename ||
                    statBeforeRename.dev !== sourceStat.dev ||
                    statBeforeRename.ino !== sourceStat.ino
                  ) {
                    throw Object.assign(
                      new Error(
                        "检测到切换期间原路径文件被外部替换，已保留原路径文件与备份。"
                      ),
                      { code: "database_locked", targetReplaced: true }
                    );
                  }
                  await chmod(backupPath, 0o444).catch(() => undefined);
                  await retryFsOp(() => fsRename(finalCandidatePath, dbPath));
                  await syncDirBestEffort(dirname(dbPath));
                  await removeFileSet(
                    [`${finalCandidatePath}-wal`, `${finalCandidatePath}-shm`],
                    fsRm
                  );
                  if (movedPrevBackup) {
                    await removeFileSet(prevBackupPaths, fsRm);
                  }
                  try {
                    currentDb.database.exec(
                      "ROLLBACK; PRAGMA locking_mode = NORMAL;"
                    );
                    currentDb.database
                      .prepare("SELECT 1 FROM schema_version")
                      .get();
                  } catch {
                    /* Release exclusive lock on old inode cleanly without writing WAL. */
                  }
                  sourceLockedExclusive = false;
                  handle.closeDatabase();
                  closedSourceForSwap = true;
                } else {
                  try {
                    currentDb.database.exec(
                      "ROLLBACK; PRAGMA locking_mode = NORMAL;"
                    );
                    currentDb.database
                      .prepare("SELECT 1 FROM schema_version")
                      .get();
                  } catch {
                    /* Keep source in DELETE mode across close for clean backup rename. */
                  }
                  sourceLockedExclusive = false;
                  handle.closeDatabase();
                  closedSourceForSwap = true;

                  await options.testHooks?.afterSourceCloseBeforeBackupRename?.(
                    {
                      candidatePath,
                      databasePath: dbPath
                    }
                  );
                  gate.assertStillHeld();

                  if (
                    (await existsAsync(`${dbPath}-wal`)) ||
                    !headersEqual(preCloseHeader, readSqliteFileHeader(dbPath))
                  ) {
                    throw Object.assign(
                      new Error(
                        "检测到关闭切换窗口内产生新的并发操作，已回滚原库保留全部数据。"
                      ),
                      { code: "database_locked" }
                    );
                  }

                  if (await existsAsync(backupPath)) {
                    for (const path of backupPaths(dbPath)) {
                      await setWritableBestEffort(path);
                    }
                    await moveFileSet(
                      backupPaths(dbPath),
                      prevBackupPaths,
                      fsRename
                    );
                    movedPrevBackup = true;
                  }
                  await moveFileSet(
                    sqliteSidecarPaths(dbPath),
                    backupPaths(dbPath),
                    fsRename
                  );
                  movedToBackup = true;
                  await chmod(backupPath, 0o444).catch(() => undefined);

                  if (
                    (await existsAsync(dbPath)) ||
                    (await existsAsync(`${dbPath}-wal`)) ||
                    (await existsAsync(`${backupPath}-wal`)) ||
                    !headersEqual(
                      preCloseHeader,
                      readSqliteFileHeader(backupPath)
                    )
                  ) {
                    throw Object.assign(
                      new Error(
                        "检测到另一个进程在关闭后重命名前接触了对话库，已中止切换保留数据。"
                      ),
                      { code: "database_locked" }
                    );
                  }

                  await options.testHooks?.afterBackupBeforeSwap?.({
                    candidatePath: finalCandidatePath,
                    databasePath: dbPath
                  });
                  gate.assertStillHeld();

                  await installSingleFileNonOverwriting(
                    finalCandidatePath,
                    dbPath,
                    { link: fsLink, rm: fsRm }
                  );
                  await removeFileSet(
                    [`${finalCandidatePath}-wal`, `${finalCandidatePath}-shm`],
                    fsRm
                  );
                  if (movedPrevBackup) {
                    await removeFileSet(prevBackupPaths, fsRm);
                  }
                }
              } catch (swapError) {
                const failureCode: ConversationCompactionFailureCode =
                  swapError instanceof StorageBootstrapGateError
                    ? swapError.code === "old_process_active"
                      ? "old_process_active"
                      : "database_locked"
                    : (swapError as { code?: unknown })?.code ===
                          "database_locked" || isNodeError(swapError, "EEXIST")
                      ? "database_locked"
                      : "swap_failed";

                const targetReplacedOnPosix = Boolean(
                  (swapError as { targetReplaced?: unknown })?.targetReplaced
                );
                const targetOccupiedOnWindows =
                  swapStrategy === "windows-rename" &&
                  movedToBackup &&
                  (isNodeError(swapError, "EEXIST") ||
                    (await existsAsync(dbPath)));
                const preserveOccupiedTarget =
                  targetReplacedOnPosix || targetOccupiedOnWindows;

                if (movedToBackup && !preserveOccupiedTarget) {
                  for (const path of backupPaths(dbPath)) {
                    await setWritableBestEffort(path);
                  }
                  if (swapStrategy === "posix-hardlink") {
                    const hasMain = await existsAsync(dbPath);
                    if (!hasMain) {
                      await installFileSetNonOverwriting(
                        backupPaths(dbPath),
                        sqliteSidecarPaths(dbPath),
                        { link: fsLink, rm: fsRm }
                      ).catch(() => undefined);
                    } else {
                      await removeFileSet(backupPaths(dbPath), fsRm).catch(
                        () => undefined
                      );
                    }
                  } else {
                    await installFileSetNonOverwriting(
                      backupPaths(dbPath),
                      sqliteSidecarPaths(dbPath),
                      { link: fsLink, rm: fsRm }
                    ).catch(() => undefined);
                  }
                }
                if (movedPrevBackup && !movedToBackup) {
                  for (const path of prevBackupPaths) {
                    await setWritableBestEffort(path);
                  }
                  await moveFileSet(
                    prevBackupPaths,
                    backupPaths(dbPath),
                    fsRename
                  ).catch(() => undefined);
                }
                await removeFileSet(
                  sqliteSidecarPaths(candidatePath),
                  fsRm
                ).catch(() => undefined);
                const dbForError = closedSourceForSwap
                  ? handle.reopenDatabase()
                  : (() => {
                      restoreSourceNormalWal(currentDb);
                      sourceLockedExclusive = false;
                      return currentDb;
                    })();
                const retainedBackupBytes = preserveOccupiedTarget
                  ? await measureFootprint(backupPaths(dbPath))
                  : 0;
                const failedMeta: PersistedCompactionMeta = {
                  phase: "failed",
                  legacyCallsFound: preStatus.legacyCallsFound,
                  estimatedReclaimableBytes:
                    preStatus.estimatedReclaimableBytes,
                  totalSessions,
                  processedSessions: totalSessions,
                  bytesBefore,
                  ...(retainedBackupBytes > 0
                    ? { backupBytes: retainedBackupBytes, backupPath }
                    : {}),
                  failureCode,
                  failureDetail: preserveOccupiedTarget
                    ? "切换期间检测到原路径已存在外部进程新建数据库，已中止覆盖并同时保留当前库与 .bak-v190 备份。"
                    : swapError instanceof Error
                      ? swapError.message
                      : String(swapError),
                  startedAt,
                  updatedAt: new Date().toISOString()
                };
                try {
                  writeMeta(dbForError.statements, failedMeta);
                } catch {
                  /* Another external process may hold dbPath; surface failure status directly. */
                }
                const status = buildStatus(failedMeta, {
                  canRetry: !preserveOccupiedTarget,
                  canRollback: retainedBackupBytes > 0
                });
                handle.onProgress?.(status);
                return status;
              }

              await options.testHooks?.afterCandidateSwapBeforeReopen?.({
                candidatePath,
                databasePath: dbPath
              });

              const reopened = handle.reopenDatabase();
              const backupBytes = await measureFootprint(backupPaths(dbPath));
              try {
                reopened.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
              } catch {
                /* Best-effort initial WAL flush on reopened database. */
              }
              const finalBytesAfter = await measureFootprint(
                sqliteSidecarPaths(dbPath)
              );
              const effectiveAfter = finalBytesAfter || bytesAfter;
              const postCompactionWatermark = captureWatermark(
                reopened.statements
              );
              const completedAt = new Date().toISOString();
              const completedMeta: PersistedCompactionMeta = {
                phase: "completed_with_backup",
                legacyCallsFound: 0,
                estimatedReclaimableBytes: 0,
                processedSessions: totalSessions,
                totalSessions,
                bytesBefore,
                bytesAfter: effectiveAfter,
                backupBytes,
                netFreedBytes: bytesBefore - effectiveAfter - backupBytes,
                startedAt,
                updatedAt: completedAt,
                completedAt,
                backupPath,
                preSwapWatermark: postCompactionWatermark
              };
              writeMeta(reopened.statements, completedMeta);
              try {
                reopened.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
              } catch {
                /* Best-effort WAL flush after recording completion metadata. */
              }
              const postFlushBytesAfter = await measureFootprint(
                sqliteSidecarPaths(dbPath)
              );
              const flushedAfter = postFlushBytesAfter || effectiveAfter;
              const completedStatus = buildStatus(completedMeta, {
                bytesAfter: flushedAfter,
                netFreedBytes: bytesBefore - flushedAfter - backupBytes,
                canRetry: false,
                canReleaseBackup: backupBytes > 0,
                canRollback: backupBytes > 0
              });
              handle.onProgress?.(completedStatus);
              return completedStatus;
            } finally {
              if (sourceLockedExclusive) {
                restoreSourceNormalWal(currentDb);
              }
              if (candidateDb) {
                try {
                  candidateDb.close();
                } catch {
                  /* Ignore close cleanup error. */
                }
              }
              if (candidatePath) {
                await removeFileSet(
                  sqliteSidecarPaths(candidatePath),
                  options.fsOps?.rm ?? rm
                ).catch(() => undefined);
              }
              handle.setWriteBlocked(undefined);
            }
          },
          { timeoutMs: options.lockTimeoutMs ?? 500 }
        )
    );
  } catch (error) {
    const { code, detail } =
      error instanceof StorageBootstrapGateError
        ? {
            code:
              error.code === "old_process_active"
                ? ("old_process_active" as const)
                : ("database_locked" as const),
            detail: error.message
          }
        : await detectLockFailure(lockRoot, error);
    const currentDb = handle.getDatabase();
    const statusBefore = await inspectCompactionStatus(currentDb);
    const failedMeta: PersistedCompactionMeta = {
      phase: "failed",
      legacyCallsFound: statusBefore.legacyCallsFound,
      estimatedReclaimableBytes: statusBefore.estimatedReclaimableBytes,
      totalSessions: statusBefore.totalSessions,
      processedSessions: statusBefore.processedSessions,
      bytesBefore: statusBefore.bytesBefore,
      failureCode: code,
      failureDetail: detail,
      updatedAt: new Date().toISOString()
    };
    try {
      writeMeta(currentDb.statements, failedMeta);
    } catch {
      /* Database may also be locked externally; surface status directly. */
    }
    const status = buildStatus(failedMeta, { canRetry: true });
    handle.onProgress?.(status);
    return status;
  }
}

export async function releaseCompactionBackup(
  handle: CompactionDatabaseHandle,
  options: { lockTimeoutMs?: number } & BootstrapGateOptions = {}
): Promise<ConversationCompactionStatus> {
  const db = handle.getDatabase();
  if (!db.databasePath || db.databasePath === ":memory:") {
    return inspectCompactionStatus(db);
  }
  const dbPath = db.databasePath;
  await mkdir(dirname(dbPath), { recursive: true });
  const lockRoot = await realpath(dirname(dbPath));

  try {
    return await withStorageBootstrapGate(
      dbPath,
      resolveGateOptions(options),
      async () =>
        await withProjectTransactionLock(
          lockRoot,
          async () => {
            const liveDb = handle.getDatabase();
            if (!quickCheckPath(dbPath)) {
              const current = await inspectCompactionStatus(liveDb);
              return {
                ...current,
                failureCode: "integrity_check_failed",
                failureDetail: "主库未通过完整性校验，已保留旧库备份禁止删除。",
                canReleaseBackup: false
              };
            }
            const remaining = liveDb.jsonNodes.inspectModelCallSnapshots();
            if (remaining.legacyCallsFound > 0) {
              const current = await inspectCompactionStatus(liveDb);
              return {
                ...current,
                failureCode: "logic_check_failed",
                failureDetail: "当前主库仍含待清理旧快照，禁止删除备份。",
                canReleaseBackup: false
              };
            }

            for (const path of backupPaths(dbPath)) {
              await setWritableBestEffort(path);
            }
            await removeFileSet(backupPaths(dbPath));
            const meta = readMeta(liveDb.statements);
            const bytesAfter = await measureFootprint(
              sqliteSidecarPaths(dbPath)
            );
            const bytesBefore = meta?.bytesBefore ?? bytesAfter;
            const totalSessions = countTotalSessions(liveDb.statements);
            const updatedAt = new Date().toISOString();
            const nextMeta: PersistedCompactionMeta = {
              ...(meta ?? {}),
              phase: "backup_released",
              legacyCallsFound: 0,
              estimatedReclaimableBytes: 0,
              processedSessions: meta?.processedSessions ?? totalSessions,
              totalSessions,
              bytesBefore,
              bytesAfter,
              backupBytes: 0,
              netFreedBytes: bytesBefore - bytesAfter,
              updatedAt,
              completedAt: meta?.completedAt ?? updatedAt
            };
            delete nextMeta.backupPath;
            delete nextMeta.failureCode;
            delete nextMeta.failureDetail;
            writeMeta(liveDb.statements, nextMeta);
            try {
              liveDb.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
            } catch {
              /* Best-effort WAL flush after releasing backup metadata. */
            }
            const finalReleasedBytes = await measureFootprint(
              sqliteSidecarPaths(dbPath)
            );
            const nextStatus = buildStatus(nextMeta, {
              bytesAfter: finalReleasedBytes,
              netFreedBytes: bytesBefore - finalReleasedBytes,
              canRetry: false,
              canReleaseBackup: false,
              canRollback: false
            });
            handle.onProgress?.(nextStatus);
            return nextStatus;
          },
          { timeoutMs: options.lockTimeoutMs ?? 500 }
        )
    );
  } catch (error) {
    const { code, detail } =
      error instanceof StorageBootstrapGateError
        ? {
            code:
              error.code === "old_process_active"
                ? ("old_process_active" as const)
                : ("database_locked" as const),
            detail: error.message
          }
        : await detectLockFailure(lockRoot, error);
    const current = await inspectCompactionStatus(handle.getDatabase());
    return {
      ...current,
      failureCode: code,
      failureDetail: detail
    };
  }
}

export async function rollbackToCompactionBackup(
  handle: CompactionDatabaseHandle,
  options: { lockTimeoutMs?: number } & BootstrapGateOptions = {}
): Promise<ConversationCompactionStatus> {
  const db = handle.getDatabase();
  if (!db.databasePath || db.databasePath === ":memory:") {
    return inspectCompactionStatus(db);
  }
  const dbPath = db.databasePath;
  await mkdir(dirname(dbPath), { recursive: true });
  const lockRoot = await realpath(dirname(dbPath));

  try {
    return await withStorageBootstrapGate(
      dbPath,
      resolveGateOptions(options),
      async () =>
        await withProjectTransactionLock(
          lockRoot,
          async () => {
            const liveDb = handle.getDatabase();
            const meta = readMeta(liveDb.statements);
            const backupMain = `${dbPath}.bak-v190`;
            if (!(await existsAsync(backupMain))) {
              const status = await inspectCompactionStatus(liveDb);
              return {
                ...status,
                failureCode: "backup_missing",
                failureDetail: "未找到可回滚的旧库备份文件。",
                canRollback: false
              };
            }
            if (!quickCheckPath(backupMain)) {
              const status = await inspectCompactionStatus(liveDb);
              return {
                ...status,
                failureCode: "integrity_check_failed",
                failureDetail: "旧库备份未通过完整性校验，无法回滚。",
                canRollback: false
              };
            }

            // Refuse silent rollback if new conversations or edits were saved after backup.
            if (meta?.preSwapWatermark) {
              const liveWatermark = captureWatermark(liveDb.statements);
              if (!watermarksEqual(meta.preSwapWatermark, liveWatermark)) {
                const status = await inspectCompactionStatus(liveDb);
                return {
                  ...status,
                  failureCode: "post_backup_changes_present",
                  failureDetail:
                    "检测到备份创建后产生了新的对话或编辑修改，已禁止静默回滚以保护后续数据。",
                  canRollback: false
                };
              }
            }

            handle.setWriteBlocked("正在恢复旧版对话数据库，请稍候。");
            const tempCurrent = `${dbPath}.bak-prev-${randomUUID()}`;
            let movedLive = false;
            try {
              handle.closeDatabase();
              await moveFileSet(
                sqliteSidecarPaths(dbPath),
                sqliteSidecarPaths(tempCurrent)
              );
              movedLive = true;
              for (const path of backupPaths(dbPath)) {
                await setWritableBestEffort(path);
              }
              await installFileSetNonOverwriting(
                backupPaths(dbPath),
                sqliteSidecarPaths(dbPath),
                { link, rm }
              );
              await removeFileSet(sqliteSidecarPaths(tempCurrent));
            } catch (error) {
              if (movedLive && !(await existsAsync(dbPath))) {
                await installFileSetNonOverwriting(
                  sqliteSidecarPaths(tempCurrent),
                  sqliteSidecarPaths(dbPath),
                  { link, rm }
                ).catch(() => undefined);
              }
              handle.reopenDatabase();
              const current = await inspectCompactionStatus(
                handle.getDatabase()
              );
              return {
                ...current,
                failureCode: isNodeError(error, "EEXIST")
                  ? "database_locked"
                  : "swap_failed",
                failureDetail:
                  error instanceof Error ? error.message : String(error)
              };
            } finally {
              handle.setWriteBlocked(undefined);
            }

            const restored = handle.reopenDatabase();
            const bytesAfter = await measureFootprint(
              sqliteSidecarPaths(dbPath)
            );
            const restoredMeta: PersistedCompactionMeta = {
              phase: "rolled_back",
              bytesBefore: meta?.bytesBefore ?? bytesAfter,
              bytesAfter,
              backupBytes: 0,
              updatedAt: new Date().toISOString()
            };
            writeMeta(restored.statements, restoredMeta);
            const status = buildStatus(restoredMeta, {
              canRetry: true,
              canReleaseBackup: false,
              canRollback: false
            });
            handle.onProgress?.(status);
            return status;
          },
          { timeoutMs: options.lockTimeoutMs ?? 500 }
        )
    );
  } catch (error) {
    const { code, detail } =
      error instanceof StorageBootstrapGateError
        ? {
            code:
              error.code === "old_process_active"
                ? ("old_process_active" as const)
                : ("database_locked" as const),
            detail: error.message
          }
        : await detectLockFailure(lockRoot, error);
    const current = await inspectCompactionStatus(handle.getDatabase());
    return {
      ...current,
      failureCode: code,
      failureDetail: detail
    };
  }
}
