import type { Dirent } from "node:fs";
import { lstat, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { availableProjectDirectory } from "../folder-catalog-store/paths-io";
import { isNodeError, readSecureTextFile, unknownRecord } from "./io";
import { MANIFEST_PATH, MAX_MANIFEST_BYTES } from "./types";

/**
 * Finds a long book folder in its parent. Older versions named the folder by
 * book id; newer ones use the title like short books and scripts.
 */
export async function findLongProjectDirectory(
  parentDirectory: string,
  bookId: string
): Promise<string | undefined> {
  const legacy = join(parentDirectory, bookId);
  try {
    // Any occupant of the legacy name still blocks reuse of that id.
    await lstat(legacy);
    return legacy;
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  let entries: Dirent[];
  try {
    entries = await readdir(parentDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
  for (const entry of entries) {
    // Hidden names are staging, deletion or other temporary folders.
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = join(parentDirectory, entry.name);
    try {
      const { content } = await readSecureTextFile(
        directory,
        MANIFEST_PATH,
        MAX_MANIFEST_BYTES
      );
      const manifest = unknownRecord(JSON.parse(content));
      if (manifest?.kind === "deepwrite.long-book" && manifest.id === bookId) {
        return directory;
      }
    } catch {
      // Short books, libraries and unreadable folders are not candidates.
    }
  }
  return undefined;
}

export async function assertLongProjectIdAvailable(
  parentDirectory: string,
  bookId: string
): Promise<void> {
  if (await findLongProjectDirectory(parentDirectory, bookId)) {
    throw new Error("长篇项目目录已存在。");
  }
}

/** Moves a validated staging folder to a title-named project folder. */
export async function promoteLongProjectStaging(
  parentDirectory: string,
  stagingDirectory: string,
  title: string
): Promise<string> {
  const projectDirectory = await availableProjectDirectory(
    parentDirectory,
    title
  );
  await rename(stagingDirectory, projectDirectory);
  return projectDirectory;
}
