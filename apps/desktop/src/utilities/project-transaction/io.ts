import { constants as fsConstants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  INTERNAL_DIRECTORY,
  DEFAULT_MAX_FILE_BYTES,
  projectTransactionFileIdentity
} from "./types";
import { validateRelativeProjectPath } from "./validation";

export async function writeDurableNewFile(
  path: string,
  content: string | Uint8Array
): Promise<void> {
  const handle = await open(
    path,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, fsConstants.O_RDONLY);
  } catch (error: unknown) {
    if (
      isNodeError(error, "EPERM") ||
      isNodeError(error, "EISDIR") ||
      isNodeError(error, "ENOTSUP")
    ) {
      return;
    }
    throw error;
  }
  try {
    await handle.sync();
  } catch (error: unknown) {
    if (
      !isNodeError(error, "EINVAL") &&
      !isNodeError(error, "ENOTSUP") &&
      !isNodeError(error, "EPERM")
    ) {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

export async function secureProjectRoot(path: string): Promise<string> {
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("项目事务根目录必须是真实目录。");
  }
  return await realpath(resolved);
}

export async function resolveProjectFileTarget(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  const normalized = validateRelativeProjectPath(relativePath);
  const target = resolve(projectRoot, normalized);
  assertContained(projectRoot, target);
  await ensureSafeParent(projectRoot, target);
  return target;
}

export async function resolveInternalWritableFile(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  const normalized = validateRelativeProjectPath(relativePath);
  if (!normalized.startsWith(`${INTERNAL_DIRECTORY}/`)) {
    throw new Error("内部事务文件必须位于 DeepWrite 内部目录。");
  }
  const target = resolve(projectRoot, normalized);
  assertContained(projectRoot, target);
  await ensureSafeParent(projectRoot, target);
  return target;
}

export async function resolveInternalFile(
  projectRoot: string,
  relativePath: string,
  maxFileBytes: number
): Promise<string> {
  const target = await resolveInternalWritableFile(projectRoot, relativePath);
  await readRegularFileRequired(projectRoot, target, maxFileBytes);
  return target;
}

export async function ensureSafeDirectory(
  projectRoot: string,
  directory: string
): Promise<void> {
  assertContained(projectRoot, directory);
  await ensureSafeParent(projectRoot, join(directory, ".placeholder"));
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error: unknown) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("项目事务目录不是安全的真实目录。");
  }
}

export async function ensureSafeParent(
  projectRoot: string,
  target: string
): Promise<void> {
  const parent = dirname(target);
  assertContained(projectRoot, parent);
  const offset = relative(projectRoot, parent);
  let current = projectRoot;
  for (const segment of offset ? offset.split(sep) : []) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error: unknown) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("项目事务父目录包含符号链接或非目录节点。");
    }
    assertContained(projectRoot, await realpath(current));
  }
}

export async function readRegularFileOptional(
  projectRoot: string,
  path: string,
  maxFileBytes: number
): Promise<Buffer | undefined> {
  return (
    await readRegularFileOptionalWithIdentity(projectRoot, path, maxFileBytes)
  )?.bytes;
}

export async function readRegularFileOptionalWithIdentity(
  projectRoot: string,
  path: string,
  maxFileBytes: number,
  options: { pathRaceAsMissing?: boolean } = {}
): Promise<{ bytes: Buffer; identity: string } | undefined> {
  assertContained(projectRoot, path);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    if (isNodeError(error, "ELOOP")) {
      throw new Error("项目事务目标不能是符号链接。");
    }
    throw error;
  }
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink > 1n) {
      throw new Error("项目事务目标必须是普通文件。");
    }
    if (info.nlink === 0n) {
      if (options.pathRaceAsMissing) return undefined;
      throw new Error("项目事务目标在读取前已从目录中移除。");
    }
    if (info.size > BigInt(maxFileBytes)) {
      throw new Error("项目事务目标超过大小限制。");
    }
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch (error: unknown) {
      if (options.pathRaceAsMissing && isNodeError(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
    assertContained(projectRoot, canonical);
    let pathInfo: BigIntStats;
    try {
      pathInfo = await lstat(path, { bigint: true });
    } catch (error: unknown) {
      if (options.pathRaceAsMissing && isNodeError(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
    if (
      pathInfo.isSymbolicLink() ||
      pathInfo.dev !== info.dev ||
      pathInfo.ino !== info.ino
    ) {
      if (options.pathRaceAsMissing) return undefined;
      throw new Error("项目事务目标在读取期间发生替换。");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const changedDuringRead =
      after.dev !== info.dev ||
      after.ino !== info.ino ||
      after.nlink !== 1n ||
      after.size !== BigInt(bytes.byteLength) ||
      bytes.byteLength > maxFileBytes;
    if (changedDuringRead) {
      if (options.pathRaceAsMissing && after.nlink !== 1n) {
        return undefined;
      }
      throw new Error("项目事务目标在读取期间发生变化。");
    }
    return {
      bytes,
      identity: projectTransactionFileIdentity(after)
    };
  } finally {
    await handle.close();
  }
}

export async function readRegularFileRequired(
  projectRoot: string,
  path: string,
  maxFileBytes: number
): Promise<Buffer> {
  const bytes = await readRegularFileOptional(projectRoot, path, maxFileBytes);
  if (!bytes) throw new Error("项目事务内部文件不存在。");
  return bytes;
}

export function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  ) {
    return;
  }
  throw new Error("项目事务路径越过项目根目录。");
}

export function positiveByteLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("项目事务文件大小限制必须是正整数。");
  }
  return limit;
}

export async function unlinkOptional(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

export function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
