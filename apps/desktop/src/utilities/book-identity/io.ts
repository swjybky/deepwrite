import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function assertContained(root: string, path: string): void {
  const offset = relative(root, path);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset))
    throw new Error("封面路径超出作品目录。");
}

export async function secureDirectory(path: string): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("书名设计目录必须是真实文件夹。");
  return realpath(path);
}

/** Every component is checked individually; never follow a user-created link. */
export async function identityDirectory(
  projectDirectory: string,
  create: boolean
): Promise<string> {
  const root = await secureDirectory(resolve(projectDirectory));
  const path = join(root, "book-identity");
  if (create) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
  }
  try {
    const actual = await secureDirectory(path);
    assertContained(root, actual);
    return actual;
  } catch (error) {
    if (!create && isMissing(error)) return path;
    throw error;
  }
}

export async function identityFile(
  directory: string,
  file: string,
  createParents = false
): Promise<string> {
  if (
    !file ||
    isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("封面路径必须是规范的相对路径。");
  let parent = directory;
  for (const segment of file.split("/").slice(0, -1)) {
    const next = join(parent, segment);
    if (createParents) {
      try {
        await mkdir(next, { mode: 0o700 });
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
      }
    }
    parent = await secureDirectory(next);
    assertContained(directory, parent);
  }
  const target = join(directory, file);
  assertContained(directory, target);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("封面文件必须是普通文件。");
    assertContained(directory, await realpath(target));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return target;
}

export async function readBytes(
  path: string,
  maxBytes: number
): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("书名设计文件必须是普通文件。");
    if (info.size > maxBytes) throw new Error("书名设计文件超过大小限制。");
    const value = await handle.readFile();
    if (value.length > maxBytes) throw new Error("书名设计文件超过大小限制。");
    return value;
  } finally {
    await handle.close();
  }
}

export async function optionalBytes(
  path: string,
  maxBytes: number
): Promise<Buffer | undefined> {
  try {
    return await readBytes(path, maxBytes);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function removeOptional(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function writeIdentityFile(
  path: string,
  bytes: string | Buffer
): Promise<void> {
  const temp = join(dirname(path), `.identity-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await removeOptional(temp);
  }
}

export function decodeBase64(value: string, maxBytes: number): Buffer {
  if (
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  )
    throw new Error("封面数据不是有效的 Base64 或超过大小限制。");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maxBytes)
    throw new Error("封面图片超过大小限制。");
  return bytes;
}

export function imageMime(
  bytes: Buffer
): "image/png" | "image/jpeg" | "image/webp" {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new Error("封面图片格式不受支持。");
}
