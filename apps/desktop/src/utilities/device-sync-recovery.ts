import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  stableSyncJson,
  syncKey,
  type DeviceSyncIntent,
  type ProjectSyncItem
} from "@deepwrite/contracts";
import { isNodeError } from "@deepwrite/shared/node";
import {
  readDeviceSyncFiles,
  validateDesktopSyncItem
} from "./device-sync-files";
import { commitDeviceSyncFiles } from "./device-sync-transaction";

export class DeviceSyncRecoveryPausedError extends Error {
  constructor(cause: unknown) {
    super("同步恢复计划已暂停并保留，请重新同步。", { cause });
  }
}

export function assertDeviceSyncRecoveryPath(
  userDataPath: string,
  removalPath: string
): void {
  const recoveryRelative = relative(
    resolve(userDataPath, "device-sync-recovery"),
    resolve(removalPath)
  );
  if (
    !recoveryRelative ||
    isAbsolute(recoveryRelative) ||
    recoveryRelative.split(sep).includes("..")
  ) {
    throw new Error("恢复区路径无效。");
  }
}

/** Retain the original plan, including its previous snapshot, outside the automatic retry path. */
export async function pauseDeviceSyncRecovery(
  userDataPath: string,
  intentPath: string,
  error: unknown
): Promise<never> {
  const directory = join(userDataPath, "device-sync-paused");
  await mkdir(directory, { recursive: true });
  await rename(intentPath, join(directory, `${randomUUID()}.json`));
  throw new DeviceSyncRecoveryPausedError(error);
}

/**
 * Older versions could install an invalid received snapshot before opening it.
 * Restore its valid predecessor only while every installed byte still matches
 * that received snapshot. User edits and all unrecognized partial states stay intact.
 */
export async function restorePreviousDeviceSyncItem(
  userDataPath: string,
  intent: DeviceSyncIntent | undefined,
  register: (root: string, item: ProjectSyncItem) => Promise<void>
): Promise<void> {
  if (intent && !intent.item && intent.removal && isAbsolute(intent.root)) {
    assertDeviceSyncRecoveryPath(userDataPath, intent.removal);
    try {
      await lstat(intent.removal);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
    try {
      await lstat(intent.root);
      return;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(intent.removal, intent.root);
    return;
  }
  if (!intent?.previous || !intent.item || !isAbsolute(intent.root)) return;
  if (
    syncKey(intent.previous) !== intent.key ||
    syncKey(intent.item) !== intent.key
  )
    return;
  validateDesktopSyncItem(intent.previous);
  const files = await readDeviceSyncFiles(intent.root);
  try {
    const title = JSON.parse(files["deepwrite.json"] ?? "null")?.title;
    validateDesktopSyncItem({ ...intent.item, title, files });
    return;
  } catch {
    // Only an invalid installed snapshot needs a compensating transaction.
  }
  if (stableSyncJson(files) !== stableSyncJson(intent.item.files)) return;
  await commitDeviceSyncFiles(intent.root, files, intent.previous);
  await register(intent.root, intent.previous);
}
