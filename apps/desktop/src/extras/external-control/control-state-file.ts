import {
  ExternalControlStateFileSchema,
  type ExternalControlStateFile
} from "@deepwrite/contracts/external-control";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const RENAME_ATTEMPTS = 4;

function isNodeError(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // `mode` is ignored when the directory already exists.
  if (process.platform !== "win32") await chmod(directory, 0o700);
}

/** Windows refuses the rename while a bridge briefly holds the file open. */
async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error: unknown) {
      if (attempt >= RENAME_ATTEMPTS || !isNodeError(error, "EPERM", "EACCES"))
        throw error;
      await delay(50 * attempt);
    }
  }
}

export async function writePrivateJson(
  path: string,
  value: unknown
): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await renameWithRetry(temporary, path);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** A missing or damaged file reads as absent. */
export async function readPrivateJson<T>(
  path: string,
  schema: { parse(value: unknown): T }
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error: unknown) {
    if (
      isNodeError(error, "ENOENT") ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return undefined;
    throw error;
  }
}

export function writeExternalControlState(
  path: string,
  state: ExternalControlStateFile
): Promise<void> {
  return writePrivateJson(path, state);
}

export function readExternalControlState(
  path: string
): Promise<ExternalControlStateFile | undefined> {
  return readPrivateJson(path, ExternalControlStateFileSchema);
}

export async function removeExternalControlState(path: string): Promise<void> {
  await rm(path, { force: true });
}
