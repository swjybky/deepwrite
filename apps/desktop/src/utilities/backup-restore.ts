import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  CloudBackupItemKind,
  RestoreBackupFilesInput,
  RestoreBackupFilesResult
} from "@deepwrite/contracts";
import { isNodeError, writeFileAtomic } from "@deepwrite/shared/node";
import {
  ensureSafeDirectory,
  resolveProjectFileTarget,
  secureProjectRoot
} from "./project-transaction/io";

const PARENT_BY_KIND: Record<CloudBackupItemKind, string> = {
  book: "books",
  "long-book": "books",
  "material-library": "materials",
  "material-group": "material-groups",
  "skill-library": "skills",
  "skill-group": "skill-groups"
};

function sanitizeProjectFolderName(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  return [...normalized].slice(0, 80).join("") || "未命名项目";
}

async function allocateProjectDirectory(
  workspaceDirectory: string,
  kind: CloudBackupItemKind,
  title: string
): Promise<string> {
  await mkdir(workspaceDirectory, { recursive: true });
  const root = await secureProjectRoot(workspaceDirectory);
  const parent = join(root, PARENT_BY_KIND[kind]);
  await ensureSafeDirectory(root, parent);
  const name = sanitizeProjectFolderName(title);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = join(parent, `${name}${suffix}`);
    try {
      await mkdir(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
  }
  throw new Error("无法为同步项目分配文件夹。");
}

function backupRelativePath(raw: string): string {
  const path = raw.replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    path.includes(":") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("备份文件路径无效。");
  }
  return path;
}

export async function restoreBackupFiles(
  input: RestoreBackupFilesInput
): Promise<RestoreBackupFilesResult> {
  const { target } = input;
  const projectDirectory =
    target.mode === "create"
      ? await allocateProjectDirectory(
          target.workspaceDirectory,
          target.kind,
          target.title
        )
      : target.projectDirectory;
  try {
    const root = await secureProjectRoot(projectDirectory);
    return await writeBackupFiles(root, input.files, target.mode === "replace");
  } catch (error) {
    if (target.mode === "create")
      await rm(projectDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function writeBackupFiles(
  root: string,
  entries: RestoreBackupFilesInput["files"],
  replaceExisting: boolean
): Promise<RestoreBackupFilesResult> {
  const files = new Map<string, { target: string; content: string }>();
  for (const file of entries) {
    const path = backupRelativePath(file.relativePath);
    if (files.has(path)) throw new Error("备份包含重复文件路径。");
    files.set(path, {
      target: await resolveProjectFileTarget(root, path),
      content: file.contentBase64
    });
  }
  for (const { target, content } of files.values()) {
    await writeFileAtomic(target, Buffer.from(content, "base64"));
  }
  let removed = 0;
  async function removeStale(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeStale(fullPath, relativePath);
      } else if (!files.has(relativePath) && entry.name !== ".DS_Store") {
        await rm(fullPath, { force: true });
        removed += 1;
      }
    }
  }
  if (replaceExisting) await removeStale(root, "");
  return { projectDirectory: root, written: files.size, removed };
}
