import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  MysteryProjectRegistrySchema,
  type MysteryProjectRegistry
} from "@deepwrite/contracts";
import { toJsonFileText } from "@deepwrite/shared";
import {
  isNodeError,
  readJsonIfExists,
  sha256Hex,
  writeTextFileDurable
} from "@deepwrite/shared/node";
import type { FolderCatalogRegistry } from "../folder-catalog-store/registry-types";
import type { LongProjectRegistry } from "../long-project-registration";
import { syncDirectory, unlinkOptional } from "../project-transaction/io";
import { LocalBackupError } from "./errors";
import type { RegistrySnapshotBundle } from "./inventory";
import { assertPathContained, ensureRealBackupDirectory } from "./paths";

const IMPORT_JOURNAL_FILENAME = "local-backup-import-journal.json";

export class LocalBackupSimulatedCrashError extends Error {
  constructor(message = "Simulated hard crash during local backup commit.") {
    super(message);
    this.name = "LocalBackupSimulatedCrashError";
  }
}

export interface StagedProjectDirectoryOp {
  key: string;
  mode: "create" | "replace";
  stagedDir: string;
  targetDir: string;
  backupDir?: string;
}

export interface LocalBackupImportJournal {
  version: 1;
  batchId: string;
  phase: "switching" | "cleaning" | "committed";
  workspaceDirectory: string;
  stagingRoot: string;
  backupPrevRoot: string;
  operations: StagedProjectDirectoryOp[];
}

export interface ImportCommitHooks {
  beforeSwitchOp?: (
    index: number,
    op: StagedProjectDirectoryOp
  ) => void | Promise<void>;
  afterBackupMoveBeforeTargetMove?: (
    index: number,
    op: StagedProjectDirectoryOp
  ) => void | Promise<void>;
  beforeRegistryCommit?: () => void | Promise<void>;
  beforeRegistryWrite?: (
    index: number,
    registryName: string
  ) => void | Promise<void>;
}

function journalFilePath(userDataPath: string): string {
  return join(resolve(userDataPath), IMPORT_JOURNAL_FILENAME);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const { lstat } = await import("node:fs/promises");
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function readOptionalBytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function readOptionalUtf8(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function writeRegistrySnapshot(
  path: string,
  value: unknown,
  withBackup: boolean
): Promise<void> {
  const serialized = toJsonFileText(value);
  await writeTextFileDurable(path, serialized);
  await syncDirectory(dirname(path));
  if (withBackup) {
    await writeTextFileDurable(`${path}.bak`, serialized).catch(
      () => undefined
    );
    await syncDirectory(dirname(path)).catch(() => undefined);
  }
}

async function rollbackSwitchedDirectories(
  operations: ReadonlyArray<{
    op: StagedProjectDirectoryOp;
    movedToBackup: boolean;
    movedToTarget: boolean;
  }>
): Promise<void> {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const item = operations[index]!;
    if (item.movedToTarget && (await pathExists(item.op.targetDir))) {
      await rm(item.op.targetDir, { recursive: true, force: true });
      await syncDirectory(dirname(item.op.targetDir));
    }
    if (
      item.movedToBackup &&
      item.op.backupDir &&
      (await pathExists(item.op.backupDir)) &&
      !(await pathExists(item.op.targetDir))
    ) {
      await mkdir(dirname(item.op.targetDir), { recursive: true, mode: 0o700 });
      await rename(item.op.backupDir, item.op.targetDir);
      await syncDirectory(dirname(item.op.targetDir));
    }
  }
}

async function restoreRegistryFilesFromBackups(
  userDataPath: string,
  backupPrevRoot: string
): Promise<void> {
  const resolvedUserData = resolve(userDataPath);
  const registryBackupDir = join(backupPrevRoot, ".registries");
  const files: Array<{ name: string; withBak: boolean }> = [
    { name: "catalog-registry.json", withBak: true },
    { name: "long-project-registry.json", withBak: true },
    { name: "mystery-projects.json", withBak: false }
  ];
  for (const { name, withBak } of files) {
    const markerPath = join(registryBackupDir, `${name}.state.json`);
    const marker = await readJsonIfExists(markerPath);
    if (!marker || typeof marker !== "object" || !("existed" in marker)) {
      continue;
    }
    const targetPath = join(resolvedUserData, name);
    const snapshotPath = join(registryBackupDir, name);
    if ((marker as { existed: boolean }).existed) {
      const content = await readOptionalUtf8(snapshotPath);
      if (content !== undefined) {
        await writeTextFileDurable(targetPath, content);
        if (withBak) {
          await writeTextFileDurable(`${targetPath}.bak`, content).catch(
            () => undefined
          );
        }
      }
    } else {
      await unlinkOptional(targetPath);
      if (withBak) {
        await unlinkOptional(`${targetPath}.bak`);
      }
    }
  }
  await syncDirectory(resolvedUserData).catch(() => undefined);
}

/**
 * Recovers any interrupted local backup import found in `userDataPath` on
 * startup or prior to another backup operation.
 */
export async function recoverInterruptedLocalBackupImport(
  userDataPath: string
): Promise<{ recovered: boolean; action?: "rolled_back" | "cleaned" }> {
  const resolvedUserData = resolve(userDataPath);
  const jPath = journalFilePath(resolvedUserData);
  const raw = await readJsonIfExists(jPath);
  if (!raw || typeof raw !== "object") {
    return { recovered: false };
  }
  const journal = raw as LocalBackupImportJournal;
  if (
    journal.version !== 1 ||
    !Array.isArray(journal.operations) ||
    typeof journal.stagingRoot !== "string" ||
    typeof journal.backupPrevRoot !== "string"
  ) {
    return { recovered: false };
  }

  if (journal.phase === "switching") {
    await restoreRegistryFilesFromBackups(
      resolvedUserData,
      journal.backupPrevRoot
    );
    const reversed = [...journal.operations].reverse();
    for (const op of reversed) {
      if (op.mode === "create") {
        if (await pathExists(op.targetDir)) {
          await rm(op.targetDir, { recursive: true, force: true });
          await syncDirectory(dirname(op.targetDir));
        }
        continue;
      }
      // For replace ops, only discard targetDir while backupDir still holds the original.
      if (op.backupDir && (await pathExists(op.backupDir))) {
        if (await pathExists(op.targetDir)) {
          await rm(op.targetDir, { recursive: true, force: true });
        }
        await mkdir(dirname(op.targetDir), { recursive: true, mode: 0o700 });
        await rename(op.backupDir, op.targetDir);
        await syncDirectory(dirname(op.targetDir));
      }
    }
    await writeTextFileDurable(
      jPath,
      toJsonFileText({ ...journal, phase: "cleaning" })
    );
    await syncDirectory(resolvedUserData).catch(() => undefined);
    await rm(journal.stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    await rm(journal.backupPrevRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    await unlinkOptional(jPath);
    await syncDirectory(resolvedUserData).catch(() => undefined);
    return { recovered: true, action: "rolled_back" };
  }

  await rm(journal.stagingRoot, { recursive: true, force: true }).catch(
    () => undefined
  );
  await rm(journal.backupPrevRoot, { recursive: true, force: true }).catch(
    () => undefined
  );
  await unlinkOptional(jPath);
  await syncDirectory(resolvedUserData).catch(() => undefined);
  return { recovered: true, action: "cleaned" };
}

/**
 * Executes Stage 2 (controlled directory switching) and Stage 3 (atomic
 * registry commits) with deterministic reverse rollback on any failure.
 */
export async function commitStagedBackupImport(options: {
  userDataPath: string;
  workspaceDirectory: string;
  batchId: string;
  stagingRoot: string;
  backupPrevRoot: string;
  operations: StagedProjectDirectoryOp[];
  nextRegistries: RegistrySnapshotBundle;
  expectedRegistryFingerprints?: Readonly<Record<string, string>>;
  hooks?: ImportCommitHooks;
}): Promise<void> {
  const {
    userDataPath,
    workspaceDirectory,
    batchId,
    stagingRoot,
    backupPrevRoot,
    operations,
    nextRegistries,
    expectedRegistryFingerprints,
    hooks
  } = options;

  const resolvedUserData = resolve(userDataPath);
  const realWorkspace = await ensureRealBackupDirectory(workspaceDirectory);
  const jPath = journalFilePath(resolvedUserData);

  if (operations.length === 0) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    return;
  }

  MysteryProjectRegistrySchema.parse(nextRegistries.mystery);

  const registryEntries: Array<{
    shortKey: "catalog" | "long" | "mystery";
    name: string;
    nextValue:
      FolderCatalogRegistry | LongProjectRegistry | MysteryProjectRegistry;
    withBak: boolean;
  }> = [
    {
      shortKey: "catalog",
      name: "catalog-registry.json",
      nextValue: nextRegistries.catalog,
      withBak: true
    },
    {
      shortKey: "long",
      name: "long-project-registry.json",
      nextValue: nextRegistries.long,
      withBak: true
    },
    {
      shortKey: "mystery",
      name: "mystery-projects.json",
      nextValue: nextRegistries.mystery,
      withBak: false
    }
  ];

  const rawOriginals = new Map<string, Buffer | undefined>();
  for (const entry of registryEntries) {
    const targetPath = join(resolvedUserData, entry.name);
    const originalBytes = await readOptionalBytes(targetPath);
    if (expectedRegistryFingerprints) {
      const actualFp =
        originalBytes === undefined ? "__absent__" : sha256Hex(originalBytes);
      if (
        expectedRegistryFingerprints[`__registry__:${entry.shortKey}`] !==
        actualFp
      ) {
        await rm(stagingRoot, { recursive: true, force: true }).catch(
          () => undefined
        );
        throw new LocalBackupError(
          "local_backup.target_changed",
          "本机注册表在导入准备期间发生变化，请重新选择备份包以刷新对比结果。"
        );
      }
    }
    rawOriginals.set(entry.name, originalBytes);
  }

  const registryBackupDir = join(backupPrevRoot, ".registries");
  await mkdir(registryBackupDir, { recursive: true, mode: 0o700 });

  for (const entry of registryEntries) {
    const originalBytes = rawOriginals.get(entry.name);
    const existed = originalBytes !== undefined;
    await writeTextFileDurable(
      join(registryBackupDir, `${entry.name}.state.json`),
      toJsonFileText({ existed })
    );
    if (existed) {
      await writeTextFileDurable(
        join(registryBackupDir, entry.name),
        originalBytes.toString("utf8")
      );
    }
  }
  await syncDirectory(registryBackupDir).catch(() => undefined);

  const journal: LocalBackupImportJournal = {
    version: 1,
    batchId,
    phase: "switching",
    workspaceDirectory: realWorkspace,
    stagingRoot,
    backupPrevRoot,
    operations
  };
  await writeTextFileDurable(jPath, toJsonFileText(journal));
  await syncDirectory(resolvedUserData).catch(() => undefined);

  const progress: Array<{
    op: StagedProjectDirectoryOp;
    movedToBackup: boolean;
    movedToTarget: boolean;
  }> = [];

  try {
    for (let index = 0; index < operations.length; index += 1) {
      const op = operations[index]!;
      assertPathContained(realWorkspace, op.targetDir);
      await hooks?.beforeSwitchOp?.(index, op);

      const itemProgress = { op, movedToBackup: false, movedToTarget: false };
      progress.push(itemProgress);

      if (op.mode === "replace" && op.backupDir) {
        await mkdir(dirname(op.backupDir), { recursive: true, mode: 0o700 });
        await rename(op.targetDir, op.backupDir);
        itemProgress.movedToBackup = true;
        await syncDirectory(dirname(op.targetDir));
        await hooks?.afterBackupMoveBeforeTargetMove?.(index, op);
      }
      await mkdir(dirname(op.targetDir), { recursive: true, mode: 0o700 });
      await rename(op.stagedDir, op.targetDir);
      itemProgress.movedToTarget = true;
      await syncDirectory(dirname(op.targetDir));
    }

    await hooks?.beforeRegistryCommit?.();

    for (let index = 0; index < registryEntries.length; index += 1) {
      const entry = registryEntries[index]!;
      await hooks?.beforeRegistryWrite?.(index, entry.name);
      const targetPath = join(resolvedUserData, entry.name);
      await writeRegistrySnapshot(targetPath, entry.nextValue, entry.withBak);
    }
  } catch (error: unknown) {
    if (error instanceof LocalBackupSimulatedCrashError) {
      throw error;
    }
    try {
      await restoreRegistryFilesFromBackups(resolvedUserData, backupPrevRoot);
      await rollbackSwitchedDirectories(progress);
    } catch (rollbackError: unknown) {
      throw new LocalBackupError(
        "local_backup.switch_failed",
        `导入写入失败，且自动回滚遇到异常：${rollbackError instanceof Error ? rollbackError.message : "未知错误"}。恢复记录已保留。`
      );
    }
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    await rm(backupPrevRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    await unlinkOptional(jPath).catch(() => undefined);

    if (error instanceof LocalBackupError) throw error;
    const message = error instanceof Error ? error.message : "文件切换失败";
    throw new LocalBackupError(
      "local_backup.switch_failed",
      `导入切换失败（已有数据已完整回滚，未做修改）：${message}`
    );
  }

  await writeTextFileDurable(
    jPath,
    toJsonFileText({ ...journal, phase: "committed" })
  );
  await rm(stagingRoot, { recursive: true, force: true }).catch(
    () => undefined
  );
  await rm(backupPrevRoot, { recursive: true, force: true }).catch(
    () => undefined
  );
  await unlinkOptional(jPath).catch(() => undefined);
  await syncDirectory(resolvedUserData).catch(() => undefined);
}
