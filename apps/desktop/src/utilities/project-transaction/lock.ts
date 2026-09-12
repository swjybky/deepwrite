import { constants as fsConstants, type BigIntStats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomHex8 } from "@deepwrite/shared";
import {
  INTERNAL_DIRECTORY,
  LOCK_FILE,
  LOCK_WAIT_TIMEOUT_MS,
  LOCK_RETRY_MS,
  LOCK_INITIALIZATION_GRACE_MS,
  projectTransactionFileIdentity
} from "./types";
import { isRecord } from "./validation";
import {
  syncDirectory,
  resolveInternalWritableFile,
  readRegularFileOptionalWithIdentity,
  isNodeError
} from "./io";

export interface ProjectTransactionLockOwner {
  pid: number;
  token: string;
  acquiredAt: string;
}

export async function withProjectTransactionLock<T>(
  projectRoot: string,
  task: () => Promise<T>
): Promise<T> {
  const release = await acquireProjectTransactionLock(projectRoot);
  try {
    return await task();
  } finally {
    await release();
  }
}

export async function acquireProjectTransactionLock(
  projectRoot: string
): Promise<() => Promise<void>> {
  const lockPath = await resolveInternalWritableFile(
    projectRoot,
    `${INTERNAL_DIRECTORY}/${LOCK_FILE}`
  );
  const token = randomHex8();
  const owner: ProjectTransactionLockOwner = {
    pid: process.pid,
    token,
    acquiredAt: new Date().toISOString()
  };
  const serialized = `${JSON.stringify(owner)}\n`;
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  for (;;) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let acquiredIdentity: string | undefined;
    try {
      handle = await open(
        lockPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_NOFOLLOW,
        0o600
      );
      const acquiredInfo = await handle.stat({ bigint: true });
      if (!acquiredInfo.isFile() || acquiredInfo.nlink !== 1n) {
        throw new Error("新建项目事务锁不是安全的普通文件。");
      }
      acquiredIdentity = projectTransactionFileIdentity(acquiredInfo);
      await handle.writeFile(serialized);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await syncDirectory(dirname(lockPath));
      const published = await lstat(lockPath, { bigint: true });
      if (
        published.isSymbolicLink() ||
        !published.isFile() ||
        published.nlink !== 1n ||
        projectTransactionFileIdentity(published) !== acquiredIdentity
      ) {
        throw new Error("项目事务锁在获取期间发生路径替换。");
      }
      const ownedIdentity = acquiredIdentity;
      return async () => {
        const current = await readRegularFileOptionalWithIdentity(
          projectRoot,
          lockPath,
          4 * 1024
        );
        if (!current) {
          throw new Error("项目事务锁在持有期间消失，拒绝无条件释放。");
        }
        const parsed = parseLockOwnerOptional(current.bytes.toString("utf8"));
        if (
          parsed?.token !== token ||
          parsed.pid !== process.pid ||
          current.identity !== ownedIdentity
        ) {
          throw new Error("项目事务锁所有者发生变化，拒绝释放其他进程的锁。");
        }
        if (
          !(await unlinkProjectTransactionLockIfIdentity(
            lockPath,
            ownedIdentity
          ))
        ) {
          throw new Error("项目事务锁在释放前发生路径替换，拒绝删除替代锁。");
        }
      };
    } catch (error: unknown) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      if (!isNodeError(error, "EEXIST")) {
        if (acquiredIdentity) {
          await unlinkProjectTransactionLockIfIdentity(
            lockPath,
            acquiredIdentity
          ).catch(() => false);
        }
        throw error;
      }
    }

    await removeStaleProjectTransactionLock(projectRoot, lockPath);
    if (Date.now() >= deadline) {
      throw new Error("等待项目事务锁超时，请确认没有其他实例仍在写入该项目。");
    }
    await delay(LOCK_RETRY_MS);
  }
}

export async function removeStaleProjectTransactionLock(
  projectRoot: string,
  lockPath: string
): Promise<void> {
  let details: BigIntStats;
  try {
    details = await lstat(lockPath, { bigint: true });
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (details.isSymbolicLink() || !details.isFile() || details.nlink > 1n) {
    throw new Error("项目事务锁不是安全的普通文件。");
  }
  if (
    details.size === 0n &&
    Date.now() - Number(details.mtimeMs) < LOCK_INITIALIZATION_GRACE_MS
  ) {
    return;
  }
  const current = await readRegularFileOptionalWithIdentity(
    projectRoot,
    lockPath,
    4 * 1024,
    {
      pathRaceAsMissing: true
    }
  );
  if (!current) return;
  const owner = parseLockOwnerOptional(current.bytes.toString("utf8"));
  if (owner && isProcessAlive(owner.pid)) return;
  if (
    !owner &&
    Date.now() - Number(details.mtimeMs) < LOCK_INITIALIZATION_GRACE_MS
  ) {
    return;
  }

  await unlinkProjectTransactionLockIfIdentity(lockPath, current.identity);
}

export async function unlinkProjectTransactionLockIfIdentity(
  lockPath: string,
  expectedIdentity: string
): Promise<boolean> {
  const latest = await lstat(lockPath, { bigint: true }).catch(
    (error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    }
  );
  if (
    !latest ||
    latest.isSymbolicLink() ||
    !latest.isFile() ||
    latest.nlink !== 1n ||
    projectTransactionFileIdentity(latest) !== expectedIdentity
  ) {
    return false;
  }
  await unlink(lockPath);
  await syncDirectory(dirname(lockPath));
  return true;
}

export function parseLockOwnerOptional(
  text: string
): ProjectTransactionLockOwner | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.token !== "string" ||
    !/^[0-9a-f]{8}$/u.test(value.token) ||
    typeof value.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  ) {
    return undefined;
  }
  return {
    pid: value.pid as number,
    token: value.token,
    acquiredAt: value.acquiredAt
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !isNodeError(error, "ESRCH");
  }
}

export async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}
