import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CatalogProjectManifestSchema,
  CurrentBookProjectManifestSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  checkedSyncItem,
  safeSyncFile,
  SyncItemValidationError,
  type SyncItem
} from "@deepwrite/contracts";

export async function readDeviceSyncFiles(
  root: string
): Promise<Record<string, string>> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("同步项目目录无效。");
  const files: Record<string, string> = {};
  async function walk(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        ["transactions", "agent", "mobile-legacy"].includes(entry.name)
      )
        continue;
      const relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("同步项目包含符号链接。");
      if (entry.isDirectory())
        await walk(join(path, entry.name), `${relative}/`);
      else if (entry.isFile() && safeSyncFile(relative)) {
        const stat = await lstat(join(path, entry.name));
        if (stat.size > 32 * 1024 * 1024)
          throw new Error("作品文件超过同步大小限制。");
        files[relative] = await readFile(join(path, entry.name), "utf8");
      }
    }
  }
  await walk(root, "");
  return files;
}
function requiredPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(requiredPaths);
  if (!value || typeof value !== "object") return [];
  if (
    "path" in value &&
    typeof value.path === "string" &&
    (value.path.endsWith(".md") || value.path.endsWith(".json"))
  )
    return [value.path];
  return Object.values(value).flatMap(requiredPaths);
}
export function validateDesktopSyncItem(raw: SyncItem): void {
  const item = checkedSyncItem(raw);
  const decoded: unknown = JSON.parse(item.files["deepwrite.json"] ?? "null");
  const manifest =
    item.kind === "book"
      ? CurrentBookProjectManifestSchema.parse(decoded)
      : item.kind === "long-book"
        ? LongProjectManifestSchema.parse(decoded)
        : CatalogProjectManifestSchema.parse(decoded);
  if (
    manifest.id !== item.id ||
    manifest.title !== item.title ||
    manifest.kind !== `deepwrite.${item.kind}`
  )
    throw new Error("同步作品身份不一致。");
  let paths = requiredPaths(manifest);
  if (item.kind === "long-book") {
    const index = LongWorkspaceIndexSnapshotSchema.parse(
      JSON.parse(item.files["long/index.json"] ?? "null")
    );
    if (index.bookId !== item.id) throw new Error("长篇索引身份不一致。");
    paths = [...paths, ...requiredPaths(index)];
  }
  const missing = paths.filter((path) => item.files[path] === undefined);
  if (missing.length) throw new SyncItemValidationError(missing);
}
