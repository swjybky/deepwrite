import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BackupProjectRegistration,
  CloudBackupItemKind
} from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";

const CATALOG_KINDS: Readonly<Record<string, CloudBackupItemKind>> = {
  book: "book",
  "material-library": "material-library",
  "material-group": "material-group",
  "skill-library": "skill-library",
  "skill-group": "skill-group"
};

async function registryProjects(path: string): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(parsed) && Array.isArray(parsed.projects)
      ? parsed.projects
      : [];
  } catch {
    return [];
  }
}

/** Every registered project folder, for cloud backup packing in Main. */
export async function listBackupProjectRegistrations(
  userDataPath: string
): Promise<BackupProjectRegistration[]> {
  const registrations = new Map<string, BackupProjectRegistration>();
  for (const item of await registryProjects(
    join(userDataPath, "catalog-registry.json")
  )) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.projectDirectory !== "string"
    )
      continue;
    const kind = CATALOG_KINDS[String(item.domain)];
    if (!kind || registrations.has(`${kind}:${item.id}`)) continue;
    registrations.set(`${kind}:${item.id}`, {
      kind,
      id: item.id,
      projectDirectory: item.projectDirectory
    });
  }
  for (const item of await registryProjects(
    join(userDataPath, "long-project-registry.json")
  )) {
    if (
      !isRecord(item) ||
      typeof item.bookId !== "string" ||
      typeof item.projectDirectory !== "string" ||
      item.deletion
    )
      continue;
    if (registrations.has(`long-book:${item.bookId}`)) continue;
    registrations.set(`long-book:${item.bookId}`, {
      kind: "long-book",
      id: item.bookId,
      projectDirectory: item.projectDirectory
    });
  }
  return [...registrations.values()];
}
