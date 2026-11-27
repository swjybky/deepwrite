import { constants } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalBackupItemKind } from "@deepwrite/contracts";
import { isNodeError } from "@deepwrite/shared/node";
import { LocalBackupError } from "./errors";

const WINDOWS_RESERVED_DEVICE_RE =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export const BACKUP_PARENT_DIR_BY_KIND: Readonly<
  Record<LocalBackupItemKind, string>
> = {
  book: "books",
  "long-book": "books",
  "mystery-book": "mystery-books",
  "material-library": "materials",
  "material-group": "material-groups",
  "skill-library": "skills",
  "skill-group": "skill-groups"
};

export function caseFoldPathKey(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

/** Sanitizes titles into safe cross-platform folder names (Windows + macOS). */
export function sanitizeBackupFolderName(
  value: string,
  fallback = "未命名项目"
): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  const base = [...cleaned].slice(0, 80).join("") || fallback;
  if (!WINDOWS_RESERVED_DEVICE_RE.test(base)) {
    return base;
  }
  const dotIndex = base.indexOf(".");
  if (dotIndex > 0) {
    const stem = base.slice(0, dotIndex);
    const ext = base.slice(dotIndex);
    return [...`${stem}_dw${ext}`].slice(0, 80).join("");
  }
  return [...`${base}_dw`].slice(0, 80).join("");
}

/** Validates and normalizes an archive-internal relative POSIX path. */
export function normalizeBackupArchivePath(rawPath: string): string {
  if (!rawPath || rawPath.includes("\0")) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      "备份包包含无效空路径或空字节。"
    );
  }
  const normalized = rawPath.replaceAll("\\", "/").normalize("NFC");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/u.test(normalized) ||
    normalized.endsWith("/")
  ) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `备份包包含不安全路径：${rawPath}`
    );
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `备份包包含越界或非法路径段：${rawPath}`
    );
  }
  return segments.join("/");
}

export function assertPathContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  ) {
    return;
  }
  throw new LocalBackupError(
    "local_backup.invalid_archive",
    "备份目标路径超出允许目录边界。"
  );
}

export async function ensureRealBackupDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      `存储目录不能是符号链接或非目录节点：${resolved}`
    );
  }
  return await realpath(resolved);
}

/**
 * Allocates a collision-free project folder inside the target workspace,
 * folding case and NFC across both disk entries and reserved batch paths.
 */
export async function allocateWorkspaceProjectDirectory(
  workspaceDirectory: string,
  kind: LocalBackupItemKind,
  title: string,
  reservedKeys: Set<string>
): Promise<string> {
  const root = await ensureRealBackupDirectory(workspaceDirectory);
  const parentFolder = BACKUP_PARENT_DIR_BY_KIND[kind];
  const parentPath = join(root, parentFolder);
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  const parentInfo = await lstat(parentPath);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      `工作目录子文件夹异常（不能为符号链接）：${parentPath}`
    );
  }
  const realParent = await realpath(parentPath);
  assertPathContained(root, realParent);

  const existingFolded = new Set<string>();
  for (const name of await readdir(realParent)) {
    existingFolded.add(caseFoldPathKey(name));
  }

  const folderBase = sanitizeBackupFolderName(title);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const maxBaseLen = Math.max(1, 80 - [...suffix].length);
    const trimmedBase = [...folderBase].slice(0, maxBaseLen).join("");
    const folderName = `${trimmedBase}${suffix}`;
    const key = `${parentFolder}/${caseFoldPathKey(folderName)}`;
    if (
      existingFolded.has(caseFoldPathKey(folderName)) ||
      reservedKeys.has(key)
    ) {
      continue;
    }
    const candidate = join(realParent, folderName);
    try {
      await lstat(candidate);
      existingFolded.add(caseFoldPathKey(folderName));
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
      reservedKeys.add(key);
      return candidate;
    }
  }
  throw new LocalBackupError(
    "local_backup.operation_failed",
    "无法为导入项目分配不重复的文件夹名称。"
  );
}

export function nextBackupCopyTitle(
  sourceTitle: string,
  occupiedComparableTitles: Set<string>,
  maxLength = 256
): string {
  const normalized = sourceTitle.normalize("NFC").trim() || "未命名项目";
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? " (备份)" : ` (备份 ${index})`;
    const maxBase = Math.max(1, maxLength - [...suffix].length);
    const base = [...normalized].slice(0, maxBase).join("").trimEnd();
    const candidate = `${base || "项目"}${suffix}`;
    const key = caseFoldPathKey(candidate);
    if (!occupiedComparableTitles.has(key)) {
      occupiedComparableTitles.add(key);
      return candidate;
    }
  }
  throw new LocalBackupError(
    "local_backup.operation_failed",
    "无法为冲突副本生成不重复标题。"
  );
}

export const NOFOLLOW_READ_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
