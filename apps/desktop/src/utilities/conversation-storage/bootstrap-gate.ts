import {
  constants,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  symlinkSync,
  unlinkSync
} from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  rm,
  rmdir,
  symlink,
  unlink,
  type FileHandle
} from "node:fs/promises";
import net from "node:net";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isRecord } from "@deepwrite/shared";
import {
  isNodeError,
  readJsonIfExists,
  resolveStorageBootstrapLockRoot,
  STORAGE_BOOTSTRAP_OWNER_FILE
} from "@deepwrite/shared/node";
import { isProcessAlive } from "../project-transaction/lock";

/**
 * libuv UV_FS_O_EXLOCK clears dwShareMode on Win32 CreateFileW, while Chromium's
 * ProcessSingleton (process_singleton_win.cc) opens `lockfile` with GENERIC_WRITE,
 * FILE_SHARE_READ, and FILE_FLAG_DELETE_ON_CLOSE; both are mutually exclusive with
 * any non-readonly open (O_WRONLY / O_RDWR / UV_FS_O_EXLOCK).
 */
const WINDOWS_EXLOCK_FLAG = 0x10000000;

export type BootstrapGateMode = "auto" | "unavailable";

export interface BootstrapGateOptions {
  bootstrapLockRoot?: string;
  bootstrapOwnerPid?: number;
  mainInstanceId?: string;
  bootstrapGateMode?: BootstrapGateMode;
  platform?: NodeJS.Platform;
  fsOps?: {
    open?: typeof open;
  };
}

export class StorageBootstrapGateError extends Error {
  constructor(
    readonly code: "old_process_active" | "bootstrap_gate_unavailable",
    message: string,
    readonly ownerPid?: number
  ) {
    super(message);
    this.name = "StorageBootstrapGateError";
  }
}

interface ActiveLockAcquisition {
  assertHeld(): void;
  release(): Promise<void>;
}

const inProcessLockChains = new Map<string, Promise<void>>();

export function parseSingletonLockTarget(
  target: string
): { host: string; pid: number } | undefined {
  const sepIndex = target.lastIndexOf("-");
  if (sepIndex <= 0) return undefined;
  const host = target.slice(0, sepIndex);
  const pid = Number(target.slice(sepIndex + 1));
  if (!host || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  return { host, pid };
}

export function inferBootstrapLockRoots(
  databasePath: string,
  explicitLockRoot?: string
): string[] {
  const resolvedDb = resolve(databasePath);
  const parentDir = dirname(resolvedDb);
  const profileRoot =
    basename(parentDir) === "renderer-state" ? dirname(parentDir) : parentDir;
  const localRoot = resolveStorageBootstrapLockRoot(profileRoot);
  const ordered = new Set<string>();
  if (explicitLockRoot?.trim()) {
    ordered.add(resolve(explicitLockRoot));
  }
  ordered.add(localRoot);
  return [...ordered].sort();
}

async function runExclusiveInProcess<T>(
  lockRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = inProcessLockChains.get(lockRoot) ?? Promise.resolve();
  let releaseNext!: () => void;
  const next = new Promise<void>((resolveNext) => {
    releaseNext = resolveNext;
  });
  const chained = previous.then(() => next);
  inProcessLockChains.set(lockRoot, chained);
  await previous;
  try {
    return await operation();
  } finally {
    releaseNext();
    if (inProcessLockChains.get(lockRoot) === chained) {
      inProcessLockChains.delete(lockRoot);
    }
  }
}

async function probeUnixSocketConnect(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolveProbe) => {
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolveProbe(result);
    };
    const client = net.createConnection(socketPath, () => {
      clearTimeout(timer);
      client.destroy();
      done(true);
    });
    const timer = setTimeout(() => {
      client.destroy();
      done(false);
    }, 150);
    client.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

async function isLockRootHeldByVerifiedMain(
  lockRoot: string,
  options: BootstrapGateOptions,
  platform: NodeJS.Platform
): Promise<boolean> {
  const expectedPid =
    options.bootstrapOwnerPid ??
    (process.env.DEEPWRITE_MAIN_PID
      ? Number(process.env.DEEPWRITE_MAIN_PID)
      : undefined);
  if (
    expectedPid === undefined ||
    !Number.isSafeInteger(expectedPid) ||
    expectedPid <= 0 ||
    !isProcessAlive(expectedPid)
  ) {
    return false;
  }

  if (platform === "win32") {
    const owner = await readJsonIfExists(
      join(lockRoot, STORAGE_BOOTSTRAP_OWNER_FILE)
    ).catch(() => undefined);
    if (!isRecord(owner) || owner.pid !== expectedPid) return false;
    const expectedInstance =
      options.mainInstanceId ?? process.env.DEEPWRITE_MAIN_INSTANCE_ID;
    if (
      expectedInstance &&
      typeof owner.instanceId === "string" &&
      owner.instanceId !== expectedInstance
    ) {
      return false;
    }
    const fsOpen = options.fsOps?.open ?? open;
    try {
      // Chromium ProcessSingleton opens Windows `lockfile` with FILE_SHARE_READ,
      // so O_RDONLY succeeds; O_WRONLY (GENERIC_WRITE) conflicts while live.
      const handle = await fsOpen(
        join(lockRoot, "lockfile"),
        constants.O_WRONLY
      );
      await handle.close();
      return false;
    } catch (error) {
      return isNodeError(error, "EBUSY", "EPERM", "EACCES");
    }
  }

  try {
    const target = await readlink(join(lockRoot, "SingletonLock"));
    const parsed = parseSingletonLockTarget(target);
    if (!parsed || parsed.pid !== expectedPid) return false;
    await lstat(join(lockRoot, "SingletonSocket"));
    return true;
  } catch {
    return false;
  }
}

async function acquireSingleLockRoot(
  lockRoot: string,
  options: BootstrapGateOptions
): Promise<ActiveLockAcquisition> {
  const platform = options.platform ?? process.platform;
  if (options.bootstrapGateMode === "unavailable") {
    throw new StorageBootstrapGateError(
      "bootstrap_gate_unavailable",
      "无法建立跨版本单实例门闩互斥，已主动推迟自动文件替换。"
    );
  }

  if (await isLockRootHeldByVerifiedMain(lockRoot, options, platform)) {
    return {
      assertHeld: () => {
        const expectedPid =
          options.bootstrapOwnerPid ??
          (process.env.DEEPWRITE_MAIN_PID
            ? Number(process.env.DEEPWRITE_MAIN_PID)
            : undefined);
        if (
          expectedPid === undefined ||
          !Number.isSafeInteger(expectedPid) ||
          !isProcessAlive(expectedPid)
        ) {
          throw new StorageBootstrapGateError(
            "bootstrap_gate_unavailable",
            "主进程跨版本单实例门闩已失效，中止文件替换。"
          );
        }
        if (platform !== "win32") {
          try {
            const parsed = parseSingletonLockTarget(
              readlinkSync(join(lockRoot, "SingletonLock"))
            );
            if (!parsed || parsed.pid !== expectedPid) {
              throw new Error("SingletonLock owner changed.");
            }
          } catch {
            throw new StorageBootstrapGateError(
              "bootstrap_gate_unavailable",
              "主进程 SingletonLock 在切换期间发生变化，中止文件替换。"
            );
          }
        } else if (!existsSync(join(lockRoot, "lockfile"))) {
          throw new StorageBootstrapGateError(
            "bootstrap_gate_unavailable",
            "主进程 Windows lockfile 在切换期间消失，中止文件替换。"
          );
        }
      },
      release: async () => undefined
    };
  }

  if (platform === "win32") {
    try {
      await mkdir(lockRoot, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new StorageBootstrapGateError(
        "bootstrap_gate_unavailable",
        `无法创建 Windows 单实例门闩目录：${error instanceof Error ? error.message : String(error)}`
      );
    }
    const lockFilePath = join(lockRoot, "lockfile");
    const fsOpen = options.fsOps?.open ?? open;
    let handle: FileHandle;
    try {
      handle = await fsOpen(
        lockFilePath,
        constants.O_RDWR | constants.O_CREAT | WINDOWS_EXLOCK_FLAG,
        0o600
      );
    } catch (error) {
      if (isNodeError(error, "EBUSY", "EPERM", "EACCES")) {
        throw new StorageBootstrapGateError(
          "old_process_active",
          "检测到另一个 DeepWrite 实例正在持有单实例门闩（Windows lockfile），已安全推迟操作。"
        );
      }
      throw new StorageBootstrapGateError(
        "bootstrap_gate_unavailable",
        `无法建立 Windows 单实例门闩：${error instanceof Error ? error.message : String(error)}`
      );
    }

    let released = false;
    return {
      assertHeld: () => {
        if (released || !existsSync(lockFilePath)) {
          throw new StorageBootstrapGateError(
            "bootstrap_gate_unavailable",
            "Windows 单实例门闩在执行期间失效，已中止文件替换。"
          );
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => undefined);
        await unlink(lockFilePath).catch(() => undefined);
        await rmdir(lockRoot).catch(() => undefined);
      }
    };
  }

  // POSIX Chromium ProcessSingleton layout inside `<defaultUserData>/../.<name>.storage-bootstrap`
  try {
    await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new StorageBootstrapGateError(
      "bootstrap_gate_unavailable",
      `无法创建跨版本单实例门闩目录：${error instanceof Error ? error.message : String(error)}`
    );
  }
  const sockBase = existsSync("/tmp") ? "/tmp" : tmpdir();
  const sockDir = await mkdtemp(join(sockBase, "dw-bs-"));
  const socketPath = join(sockDir, "s");
  const server = net.createServer((connection) => {
    connection.end();
  });
  server.unref();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const cleanupSocket = async () => {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    }).catch(() => undefined);
    await rm(sockDir, { recursive: true, force: true }).catch(() => undefined);
  };

  const lockFile = join(lockRoot, "SingletonLock");
  const socketLink = join(lockRoot, "SingletonSocket");
  const cookieLink = join(lockRoot, "SingletonCookie");
  const myTarget = `${hostname()}-${process.pid}`;

  const tryCreateSymlink = async (): Promise<boolean> => {
    try {
      await symlink(myTarget, lockFile);
      return true;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) return false;
      throw error;
    }
  };

  try {
    let acquired = await tryCreateSymlink();
    if (!acquired) {
      const existingTarget = await readlink(lockFile).catch(() => undefined);
      const parsed = existingTarget
        ? parseSingletonLockTarget(existingTarget)
        : undefined;
      if (parsed && parsed.pid !== process.pid && isProcessAlive(parsed.pid)) {
        throw new StorageBootstrapGateError(
          "old_process_active",
          `检测到另一个 DeepWrite 实例（PID ${parsed.pid}）正在运行，已安全推迟操作。`,
          parsed.pid
        );
      }
      if (await probeUnixSocketConnect(socketLink)) {
        throw new StorageBootstrapGateError(
          "old_process_active",
          "检测到另一个 DeepWrite 实例的通讯套接字仍处于活跃状态，已安全推迟操作。"
        );
      }
      const confirmedTarget = await readlink(lockFile).catch(() => undefined);
      if (confirmedTarget !== existingTarget) {
        throw new StorageBootstrapGateError(
          "old_process_active",
          "检测到另一个 DeepWrite 实例正在竞争启动门闩，已安全推迟操作。"
        );
      }
      await unlink(lockFile).catch(() => undefined);
      await unlink(socketLink).catch(() => undefined);
      await unlink(cookieLink).catch(() => undefined);
      acquired = await tryCreateSymlink();
      if (!acquired) {
        const retryTarget = await readlink(lockFile).catch(() => undefined);
        const retryParsed = retryTarget
          ? parseSingletonLockTarget(retryTarget)
          : undefined;
        throw new StorageBootstrapGateError(
          "old_process_active",
          "检测到另一个 DeepWrite 实例已抢占单实例门闩，已安全推迟操作。",
          retryParsed?.pid
        );
      }
    }

    await unlink(socketLink).catch(() => undefined);
    await symlink(socketPath, socketLink);
    await unlink(cookieLink).catch(() => undefined);
    await symlink(randomUUID(), cookieLink);

    let released = false;
    return {
      assertHeld: () => {
        if (released) {
          throw new StorageBootstrapGateError(
            "bootstrap_gate_unavailable",
            "跨版本单实例门闩已释放，已中止文件替换。"
          );
        }
        try {
          if (readlinkSync(lockFile) !== myTarget) {
            throw new Error("SingletonLock target mismatch.");
          }
        } catch {
          throw new StorageBootstrapGateError(
            "bootstrap_gate_unavailable",
            "SingletonLock 在执行期间被修改或移除，已中止文件替换。"
          );
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        try {
          const currentTarget = await readlink(lockFile).catch(() => undefined);
          if (currentTarget === myTarget) {
            await unlink(socketLink).catch(() => undefined);
            await unlink(cookieLink).catch(() => undefined);
            await unlink(lockFile).catch(() => undefined);
          }
        } finally {
          await cleanupSocket();
          await rmdir(lockRoot).catch(() => undefined);
        }
      }
    };
  } catch (error) {
    await cleanupSocket();
    if (error instanceof StorageBootstrapGateError) throw error;
    throw new StorageBootstrapGateError(
      "bootstrap_gate_unavailable",
      `无法建立跨版本单实例门闩：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function withStorageBootstrapGate<T>(
  databasePath: string,
  options: BootstrapGateOptions,
  task: (gate: { assertStillHeld(): void }) => Promise<T>
): Promise<T> {
  const roots = inferBootstrapLockRoots(
    databasePath,
    options.bootstrapLockRoot
  );
  const explicitResolved = options.bootstrapLockRoot?.trim()
    ? resolve(options.bootstrapLockRoot)
    : undefined;
  const acquired: ActiveLockAcquisition[] = [];

  const acquireAllAndRun = async (index: number): Promise<T> => {
    if (index >= roots.length) {
      try {
        return await task({
          assertStillHeld: () => {
            for (const lock of acquired) lock.assertHeld();
          }
        });
      } finally {
        for (let i = acquired.length - 1; i >= 0; i -= 1) {
          await acquired[i]!.release().catch(() => undefined);
        }
      }
    }
    const lockRoot = roots[index]!;
    return runExclusiveInProcess(lockRoot, async () => {
      const isSecondaryRelocated =
        explicitResolved !== undefined && lockRoot !== explicitResolved;
      const existedBefore = isSecondaryRelocated ? existsSync(lockRoot) : true;
      try {
        const handle = await acquireSingleLockRoot(lockRoot, options);
        acquired.push(handle);
      } catch (error) {
        if (!(
          isSecondaryRelocated &&
          options.bootstrapGateMode !== "unavailable" &&
          !existedBefore &&
          error instanceof StorageBootstrapGateError &&
          error.code === "bootstrap_gate_unavailable"
        )) {
          throw error;
        }
      }
      return acquireAllAndRun(index + 1);
    });
  };

  return acquireAllAndRun(0);
}

/**
 * Synchronous Chromium `ProcessSingleton` lock protocol used by v1.9.0 child
 * harnesses implementing `app.requestSingleInstanceLock()` inside `acquireStorageInstanceLock`.
 */
export function tryAcquireChromiumSingletonLockSync(
  lockRoot: string,
  platform: NodeJS.Platform = process.platform
): { acquired: boolean; release(): void } {
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  if (platform === "win32") {
    const lockFilePath = join(lockRoot, "lockfile");
    try {
      const fd = openSync(
        lockFilePath,
        constants.O_RDWR | constants.O_CREAT | WINDOWS_EXLOCK_FLAG,
        0o600
      );
      return {
        acquired: true,
        release: () => {
          try {
            closeSync(fd);
          } catch {
            /* Ignore close failure on cleanup. */
          }
          try {
            unlinkSync(lockFilePath);
          } catch {
            /* Ignore unlink failure on cleanup. */
          }
        }
      };
    } catch {
      return { acquired: false, release: () => undefined };
    }
  }

  const lockFile = join(lockRoot, "SingletonLock");
  const myTarget = `${hostname()}-${process.pid}`;
  try {
    symlinkSync(myTarget, lockFile);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      return { acquired: false, release: () => undefined };
    }
    let existingTarget: string | undefined;
    try {
      existingTarget = readlinkSync(lockFile);
    } catch {
      existingTarget = undefined;
    }
    const parsed = existingTarget
      ? parseSingletonLockTarget(existingTarget)
      : undefined;
    if (parsed && parsed.pid !== process.pid && isProcessAlive(parsed.pid)) {
      return { acquired: false, release: () => undefined };
    }
    try {
      const sockStat = lstatSync(join(lockRoot, "SingletonSocket"));
      if (sockStat.isSymbolicLink() && existingTarget && parsed) {
        if (isProcessAlive(parsed.pid)) {
          return { acquired: false, release: () => undefined };
        }
      }
    } catch {
      /* No live socket link present. */
    }
    try {
      unlinkSync(lockFile);
      symlinkSync(myTarget, lockFile);
    } catch {
      return { acquired: false, release: () => undefined };
    }
  }

  return {
    acquired: true,
    release: () => {
      try {
        if (readlinkSync(lockFile) === myTarget) {
          unlinkSync(lockFile);
        }
      } catch {
        /* Ignore cleanup errors. */
      }
    }
  };
}
