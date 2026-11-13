import { constants as fsConstants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import {
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectRelativePathSchema
} from "@deepwrite/contracts";
import { LONG_PORTABLE_BUNDLE_MAX_BYTES } from "../long-portable-bundle";
import {
  commitProjectTransaction,
  projectTransactionContentSha256,
  projectTransactionFileIdentity,
  type CommitProjectTransactionInput
} from "../project-transaction";
import { encodeUtf8Strict } from "./utf8";
import {
  MANIFEST_PATH,
  MAX_AGENTS_MD_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_INDEX_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_MANIFEST_BYTES,
  type SecureTextFile
} from "./types";

export { encodeUtf8Strict } from "./utf8";

export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} 不是有效 JSON。`);
  }
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function commitLongProjectTransaction(
  input: CommitProjectTransactionInput,
  afterCommit?: Parameters<typeof commitProjectTransaction>[1],
  preservePreconditions = false
) {
  for (const operation of input.operations) {
    if (operation.action === "delete" || operation.action === "check") {
      continue;
    }
    const path = operation.path.trim();
    const maxBytes =
      path === MANIFEST_PATH
        ? MAX_MANIFEST_BYTES
        : path === LONG_WORKSPACE_INDEX_PATH
          ? MAX_INDEX_BYTES
          : path === LONG_AGENTS_MD_PATH
            ? MAX_AGENTS_MD_BYTES
            : path.startsWith("long/ledger/") && path.endsWith(".json")
              ? MAX_LEDGER_RECORD_BYTES
              : MAX_DOCUMENT_BYTES;
    const byteLength = encodeUtf8Strict(operation.content).byteLength;
    if (byteLength > maxBytes) {
      throw new Error(
        `长篇项目文件超过 UTF-8 字节限制：${path}（${byteLength} > ${maxBytes}）。`
      );
    }
  }
  // Long-form editing is intentionally last-write-wins. The generic project
  // transaction still gives us atomic multi-file replacement and crash
  // recovery, but long-form callers must not turn hashes captured while
  // reading into a user-visible optimistic-concurrency boundary. A null
  // precondition is retained only for files that are being created.
  // A user-requested version restore explicitly keeps its content CAS instead.
  const operations = input.operations.flatMap((operation) => {
    if (operation.action === "check") return [];
    if (preservePreconditions || operation.expectedSha256 === null)
      return [operation];
    const { expectedSha256: _expectedSha256, ...lastWriteWins } = operation;
    return [lastWriteWins];
  });
  return await commitProjectTransaction(
    {
      ...input,
      operations,
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    },
    afterCommit
  );
}

export async function readPortableBundleSource(
  sourcePath: string
): Promise<string> {
  if (!isAbsolute(sourcePath)) {
    throw new Error("长篇可移植包路径必须是绝对路径。");
  }
  const resolved = resolve(sourcePath);
  const { bytes } = await readNoFollowFile(
    resolved,
    LONG_PORTABLE_BUNDLE_MAX_BYTES,
    "长篇可移植包"
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("长篇可移植包不是有效 UTF-8。");
  }
}

export async function readSecureTextFile(
  projectDirectory: string,
  relativePath: string,
  maxBytes: number
): Promise<SecureTextFile> {
  validateStoreFilePath(relativePath);
  const target = resolve(projectDirectory, relativePath);
  assertContained(projectDirectory, target);
  await validateParentDirectories(projectDirectory, dirname(target));
  const { bytes, info } = await readNoFollowFile(
    target,
    maxBytes,
    `长篇项目文件 ${relativePath}`,
    projectDirectory
  );
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`长篇项目文件不是有效 UTF-8：${relativePath}`);
  }
  return {
    content,
    bytes,
    sha256: projectTransactionContentSha256(bytes),
    updatedAt: info.mtime.toISOString(),
    identity: projectTransactionFileIdentity(info),
    size: Number(info.size),
    mtimeNs: info.mtimeNs,
    ctimeNs: info.ctimeNs
  };
}

export async function secureTextFileMetadataMatches(
  projectDirectory: string,
  relativePath: string,
  maxBytes: number,
  cached: SecureTextFile
): Promise<boolean> {
  validateStoreFilePath(relativePath);
  const target = resolve(projectDirectory, relativePath);
  assertContained(projectDirectory, target);
  await validateParentDirectories(projectDirectory, dirname(target));
  return noFollowFileMetadataMatches(
    target,
    maxBytes,
    cached,
    projectDirectory
  );
}

export type NoFollowFileMetadata = Pick<
  SecureTextFile,
  "identity" | "size" | "mtimeNs" | "ctimeNs"
>;

/** Rechecks file identity and safety without rereading unchanged bytes. */
export async function noFollowFileMetadataMatches(
  target: string,
  maxBytes: number,
  cached: NoFollowFileMetadata,
  containingRoot: string
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT") || isNodeError(error, "ELOOP")) {
      return false;
    }
    throw error;
  }
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(maxBytes)) {
      return false;
    }
    const canonical = await realpath(target);
    assertContained(containingRoot, canonical);
    const pathInfo = await lstat(target, { bigint: true });
    if (
      pathInfo.isSymbolicLink() ||
      pathInfo.dev !== info.dev ||
      pathInfo.ino !== info.ino ||
      pathInfo.nlink !== info.nlink ||
      pathInfo.size !== info.size ||
      pathInfo.mtimeNs !== info.mtimeNs ||
      pathInfo.ctimeNs !== info.ctimeNs
    ) {
      return false;
    }
    return (
      projectTransactionFileIdentity(info) === cached.identity &&
      Number(info.size) === cached.size &&
      info.mtimeNs === cached.mtimeNs &&
      info.ctimeNs === cached.ctimeNs
    );
  } finally {
    await handle.close();
  }
}

export async function readNoFollowFile(
  path: string,
  maxBytes: number,
  label: string,
  containingRoot?: string
): Promise<{
  bytes: Buffer;
  info: BigIntStats;
}> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ELOOP"
    ) {
      throw new Error(`${label}不能是符号链接。`);
    }
    throw error;
  }
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n) {
      throw new Error(`${label}必须是无硬链接的普通文件。`);
    }
    if (info.size > BigInt(maxBytes)) {
      throw new Error(`${label}超过大小限制。`);
    }
    const pathInfo = await lstat(path, { bigint: true });
    if (pathInfo.isSymbolicLink()) {
      throw new Error(`${label}不能是符号链接。`);
    }
    const canonical = await realpath(path);
    if (containingRoot) assertContained(containingRoot, canonical);
    if (pathInfo.dev !== info.dev || pathInfo.ino !== info.ino) {
      throw new Error(`${label}在读取期间发生替换。`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== info.dev ||
      after.ino !== info.ino ||
      after.nlink !== 1n ||
      after.mtimeNs !== info.mtimeNs ||
      after.ctimeNs !== info.ctimeNs ||
      after.size !== BigInt(bytes.byteLength) ||
      bytes.byteLength > maxBytes
    ) {
      throw new Error(`${label}在读取期间发生变化。`);
    }
    return { bytes, info: after };
  } finally {
    await handle.close();
  }
}

export function validateStoreFilePath(path: string): void {
  if (path === MANIFEST_PATH || path === LONG_AGENTS_MD_PATH) return;
  const parsed = LongProjectRelativePathSchema.parse(path);
  if (
    parsed !== path ||
    path.normalize("NFC") !== path ||
    !path.startsWith("long/") ||
    path.startsWith(".deepwrite/")
  ) {
    throw new Error("长篇业务文件必须使用 long/ 下的规范相对路径。");
  }
}

export async function validateParentDirectories(
  projectDirectory: string,
  parent: string
): Promise<void> {
  assertContained(projectDirectory, parent);
  const offset = relative(projectDirectory, parent);
  let current = projectDirectory;
  for (const segment of offset ? offset.split(sep) : []) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("长篇项目文件父目录包含符号链接或非目录节点。");
    }
    assertContained(projectDirectory, await realpath(current));
  }
}

export async function secureDirectory(
  path: string,
  label: string
): Promise<string> {
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label}必须是真实目录。`);
  }
  return await realpath(resolved);
}

export async function ensureSecureDirectory(
  path: string,
  label: string
): Promise<string> {
  const resolved = resolve(path);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  return await secureDirectory(resolved, label);
}

export async function requireMissing(
  path: string,
  message: string
): Promise<void> {
  try {
    await lstat(path);
    throw new Error(message);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
}

export function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  ) {
    return;
  }
  throw new Error("长篇项目路径越过项目根目录。");
}

export function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负整数。`);
  }
  return value;
}

export function boundedPositiveInteger(
  value: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label}必须是 1 到 ${maximum} 的整数。`);
  }
  return value;
}

export function boundedNonnegativeInteger(
  value: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label}必须是 0 到 ${maximum} 的整数。`);
  }
  return value;
}

export function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
