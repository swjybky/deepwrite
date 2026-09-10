import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  syncItemSchema,
  syncKey,
  DeviceSyncTitleSchema,
  DeviceSyncCatalogRegistrySchema,
  DeviceSyncLongRegistrySchema,
  SyncItemValidationError,
  type SyncKind
} from "@deepwrite/contracts";
import {
  readDeviceSyncFiles,
  validateDesktopSyncItem
} from "./device-sync-files";

async function json(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
export async function syncRegistrations(userDataPath: string) {
  const result: { id: string; kind: SyncKind; root: string }[] = [];
  const catalog = await json(join(userDataPath, "catalog-registry.json"));
  if (catalog)
    for (const entry of DeviceSyncCatalogRegistrySchema.parse(catalog)
      .projects) {
      result.push({
        id: entry.id,
        kind: entry.domain,
        root: entry.projectDirectory
      });
    }
  const long = await json(join(userDataPath, "long-project-registry.json"));
  if (long)
    for (const entry of DeviceSyncLongRegistrySchema.parse(long).projects) {
      if (!entry.deletion)
        result.push({
          id: entry.bookId,
          kind: "long-book",
          root: entry.projectDirectory
        });
    }
  if (
    new Set(result.map((entry) => `${entry.kind}:${entry.id}`)).size !==
    result.length
  )
    throw new Error("本机存在重复的作品身份。");
  return result;
}
export async function desktopSyncInventory(userDataPath: string) {
  const items = [];
  const issues = [];
  for (const entry of await syncRegistrations(userDataPath)) {
    const key = `${entry.kind}:${entry.id}`;
    let title = entry.id;
    try {
      const files = await readDeviceSyncFiles(entry.root);
      const manifest = DeviceSyncTitleSchema.parse(
        JSON.parse(files["deepwrite.json"] ?? "null")
      );
      title = manifest.title;
      const item = syncItemSchema.parse({
        id: entry.id,
        kind: entry.kind,
        title: manifest.title,
        files
      });
      if (syncKey(item) !== key) throw new Error("身份不一致");
      validateDesktopSyncItem(item);
      items.push(item);
    } catch (error) {
      issues.push({
        key,
        title,
        message:
          error instanceof SyncItemValidationError
            ? error.message
            : "此作品目录不可读或结构不兼容，本次不参与同步。"
      });
    }
  }
  return { items, issues };
}
