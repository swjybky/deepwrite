import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  BackupProjectRegistration,
  CloudBackupItem,
  CloudBackupItemKind
} from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";

const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export interface LocalBackupProject {
  kind: CloudBackupItemKind;
  id: string;
  title: string;
  projectDirectory: string;
  hash: string;
  sizeBytes: number;
  files: Array<{ relativePath: string; data: Buffer }>;
}

async function readJsonObject(
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function projectTitleFromManifest(
  manifest: Record<string, unknown> | null,
  fallback: string
): string {
  if (!manifest) return fallback;
  if (typeof manifest.title === "string" && manifest.title.trim()) {
    return manifest.title.trim();
  }
  if (isRecord(manifest.book) && typeof manifest.book.title === "string") {
    const title = manifest.book.title.trim();
    if (title) return title;
  }
  return fallback;
}

export async function collectProjectFiles(
  projectDirectory: string
): Promise<Array<{ relativePath: string; data: Buffer }>> {
  const root = resolve(projectDirectory);
  const files: Array<{ relativePath: string; data: Buffer }> = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        SKIP_NAMES.has(entry.name) ||
        entry.name.startsWith(".deepwrite-project-")
      ) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      if (fullPath === join(root, ".deepwrite", "versions")) continue;
      let info;
      try {
        info = await lstat(fullPath);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!info.isFile()) continue;
      const relativePath = relative(root, fullPath).split(sep).join("/");
      files.push({ relativePath, data: await readFile(fullPath) });
    }
  }

  await walk(root);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  return files;
}

export function hashProjectFiles(
  files: ReadonlyArray<{ relativePath: string; data: Buffer }>
): {
  hash: string;
  sizeBytes: number;
} {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for (const file of files) {
    sizeBytes += file.data.length;
    digest.update(file.relativePath);
    digest.update("\0");
    digest.update(String(file.data.length));
    digest.update("\0");
    digest.update(createHash("sha256").update(file.data).digest("hex"));
    digest.update("\n");
  }
  return { hash: digest.digest("hex"), sizeBytes };
}

async function loadProject(
  kind: CloudBackupItemKind,
  id: string,
  projectDirectory: string
): Promise<LocalBackupProject | null> {
  const files = await collectProjectFiles(projectDirectory);
  if (files.length === 0) return null;
  const manifest = await readJsonObject(
    join(projectDirectory, "deepwrite.json")
  );
  const { hash, sizeBytes } = hashProjectFiles(files);
  return {
    kind,
    id,
    title: projectTitleFromManifest(manifest, basename(projectDirectory)),
    projectDirectory,
    hash,
    sizeBytes,
    files
  };
}

export async function listLocalBackupProjects(
  registrations: readonly BackupProjectRegistration[]
): Promise<LocalBackupProject[]> {
  const projects: LocalBackupProject[] = [];
  for (const { kind, id, projectDirectory } of registrations) {
    const loaded = await loadProject(kind, id, projectDirectory);
    if (loaded) projects.push(loaded);
  }
  projects.sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
  );
  return projects;
}

export function toManifestItems(
  projects: readonly LocalBackupProject[]
): CloudBackupItem[] {
  return projects.map(({ kind, id, title, hash, sizeBytes }) => ({
    kind,
    id,
    title,
    hash,
    sizeBytes
  }));
}
