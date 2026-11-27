import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { toJsonFileText } from "./index";

export const STORAGE_BOOTSTRAP_OWNER_FILE = "deepwrite-bootstrap-owner.json";

export function resolveStorageBootstrapLockRoot(
  defaultUserDataPath: string
): string {
  const normalized = resolve(defaultUserDataPath);
  return join(
    dirname(normalized),
    `.${basename(normalized)}.storage-bootstrap`
  );
}

export function isNodeError(
  error: unknown,
  ...codes: string[]
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Writes through a sibling temporary file and a rename, so readers never see a partial file. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  {
    mode = 0o600,
    directoryMode
  }: { mode?: number; directoryMode?: number } = {}
): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
    ...(directoryMode === undefined ? {} : { mode: directoryMode })
  });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, data, {
      mode,
      ...(typeof data === "string" ? { encoding: "utf8" } : {})
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function writeJsonAtomic(
  path: string,
  value: unknown,
  options?: { mode?: number; directoryMode?: number }
): Promise<void> {
  return writeFileAtomic(path, toJsonFileText(value), options);
}

/** Parsed JSON, or undefined when the file does not exist. */
export async function readJsonIfExists(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** Writes with fsync and reads the bytes back before the rename, for files a crash must never corrupt. */
export async function writeTextFileDurable(
  path: string,
  value: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await readFile(temporary, "utf8")) !== value)
      throw new Error("同步记录读回校验失败。");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
