import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CatalogProjectManifestSchema,
  CurrentBookProjectManifestSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  assertLongProjectIndexMetadata,
  assertProjectSyncItem,
  checkedSyncItem,
  safeSyncFile,
  type ProjectSyncItem,
  SyncItemValidationError,
  type SyncItem
} from "@deepwrite/contracts";
import { recoverProjectTransaction } from "./project-transaction";
import { MAX_LEDGER_RECORD_BYTES } from "./long-project-store/types";
import { assertDeviceSyncFileCount } from "./device-sync-transaction";

/** Workspace subfolder that holds each kind of synced project. */
export function syncProjectParentFolder(kind: ProjectSyncItem["kind"]): string {
  return kind === "book" || kind === "long-book"
    ? "books"
    : kind === "material-library"
      ? "materials"
      : kind === "skill-library"
        ? "skills"
        : kind === "material-group"
          ? "material-groups"
          : "skill-groups";
}

export async function readDeviceSyncFiles(
  root: string
): Promise<Record<string, string>> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("同步项目目录无效。");
  // An interrupted decomposition may have installed its index before its manifest.
  // Export only the coherent revision recovered by the ordinary project writer.
  await recoverProjectTransaction(root, MAX_LEDGER_RECORD_BYTES);
  const files: Record<string, string> = {};
  let count = 0;
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
        assertDeviceSyncFileCount(++count);
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
export function validateDesktopSyncItem(
  raw: SyncItem
): asserts raw is ProjectSyncItem {
  assertProjectSyncItem(raw);
  assertDeviceSyncFileCount(Object.keys(raw.files).length);
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
    try {
      assertLongProjectIndexMetadata(
        LongProjectManifestSchema.parse(decoded),
        index
      );
    } catch (error) {
      throw new SyncItemValidationError(
        ["deepwrite.json", "long/index.json"],
        error instanceof Error ? error.message : "长篇索引结构不兼容。"
      );
    }
    paths = [...paths, ...requiredPaths(index)];
  }
  const missing = paths.filter((path) => item.files[path] === undefined);
  if (missing.length) throw new SyncItemValidationError(missing);
}
