import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  CloudBackupItem,
  CloudBackupItemKind
} from "@deepwrite/contracts";

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

interface RegistryProject {
  id: string;
  domain: string;
  projectDirectory: string;
}

interface LongRegistryProject {
  bookId: string;
  projectDirectory: string;
  deletion?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogKind(domain: string): CloudBackupItemKind | null {
  switch (domain) {
    case "book":
      return "book";
    case "material-library":
      return "material-library";
    case "material-group":
      return "material-group";
    case "skill-library":
      return "skill-library";
    case "skill-group":
      return "skill-group";
    default:
      return null;
  }
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
  userDataPath: string
): Promise<LocalBackupProject[]> {
  const catalog = await readJsonObject(
    join(userDataPath, "catalog-registry.json")
  );
  const longCatalog = await readJsonObject(
    join(userDataPath, "long-project-registry.json")
  );
  const projects: LocalBackupProject[] = [];
  const seen = new Set<string>();

  const catalogProjects = Array.isArray(catalog?.projects)
    ? catalog.projects
    : [];
  for (const raw of catalogProjects) {
    if (!isRecord(raw)) continue;
    const item = raw as unknown as RegistryProject;
    if (
      typeof item.id !== "string" ||
      typeof item.projectDirectory !== "string"
    )
      continue;
    const kind = catalogKind(String(item.domain));
    if (!kind) continue;
    const key = `${kind}:${item.id}`;
    if (seen.has(key)) continue;
    const loaded = await loadProject(kind, item.id, item.projectDirectory);
    if (!loaded) continue;
    seen.add(key);
    projects.push(loaded);
  }

  const longProjects = Array.isArray(longCatalog?.projects)
    ? longCatalog.projects
    : [];
  for (const raw of longProjects) {
    if (!isRecord(raw)) continue;
    const item = raw as unknown as LongRegistryProject;
    if (
      typeof item.bookId !== "string" ||
      typeof item.projectDirectory !== "string"
    )
      continue;
    if (item.deletion) continue;
    const key = `long-book:${item.bookId}`;
    if (seen.has(key)) continue;
    const loaded = await loadProject(
      "long-book",
      item.bookId,
      item.projectDirectory
    );
    if (!loaded) continue;
    seen.add(key);
    projects.push(loaded);
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
