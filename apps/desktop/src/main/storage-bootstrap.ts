import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  STORAGE_BOOTSTRAP_OWNER_FILE,
  resolveStorageBootstrapLockRoot
} from "@deepwrite/shared/node";
import {
  StorageLocationStore,
  type StorageMigrationPlan
} from "./storage-location-store";

export { resolveStorageBootstrapLockRoot };

interface StorageApplication {
  getPath(name: "userData"): string;
  setPath(name: "userData" | "sessionData", path: string): void;
}

export function acquireStorageInstanceLock(
  application: StorageApplication & { requestSingleInstanceLock(): boolean }
): boolean {
  const defaultPath = application.getPath("userData");
  const lockRoot = resolveStorageBootstrapLockRoot(defaultPath);
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  application.setPath("userData", lockRoot);
  try {
    return application.requestSingleInstanceLock();
  } finally {
    application.setPath("userData", defaultPath);
  }
}

export function recordStorageBootstrapOwner(
  defaultUserDataPath: string,
  instanceId: string
): string {
  const lockRoot = resolveStorageBootstrapLockRoot(defaultUserDataPath);
  if (existsSync(lockRoot)) {
    try {
      writeFileSync(
        join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE),
        `${JSON.stringify({
          pid: process.pid,
          instanceId,
          acquiredAt: new Date().toISOString()
        })}\n`,
        { mode: 0o600 }
      );
    } catch {
      /* Best-effort owner marker inside an existing bootstrap lock folder. */
    }
  }
  return lockRoot;
}

export function runStorageMigration(plan: StorageMigrationPlan): void {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./utilities/storage-migration-entry.js", import.meta.url)
      ),
      plan.sourcePath,
      plan.targetPath,
      String(plan.allowExistingTarget),
      plan.migrationId
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "用户数据迁移未完成，已保留原目录。请检查目标目录权限和磁盘空间后重试。"
    );
  }
}

/** Call synchronously, under the default-profile instance lock, before Electron readiness. */
export function initializeStorageLocation(
  application: StorageApplication,
  migrate: (plan: StorageMigrationPlan) => void = runStorageMigration
): { locations: StorageLocationStore; migrationError?: string } {
  const locations = new StorageLocationStore(application.getPath("userData"));
  let migrationError: string | undefined;
  if (locations.pending) {
    try {
      migrate(locations.pending);
      locations.complete();
    } catch {
      locations.cancel();
      migrationError =
        "用户数据迁移未完成，已继续使用原目录，原有数据未删除。请检查目标目录权限和磁盘空间后重试。";
    }
  }
  locations.assertAvailable();
  application.setPath("userData", locations.currentPath);
  application.setPath("sessionData", locations.currentPath);
  return { locations, ...(migrationError ? { migrationError } : {}) };
}
