import {
  CLOUD_BACKUP_MANIFEST_VERSION,
  CLOUD_BACKUP_QUOTA_BYTES,
  CloudBackupItemSchema,
  type CloudBackupChange,
  type CloudBackupItem,
  type CloudBackupItemKind
} from "@deepwrite/contracts";
import { createZip, readZip, type ZipEntryInput } from "./zip";
import type { LocalBackupProject } from "./catalog-reader";
import { hashProjectFiles, toManifestItems } from "./catalog-reader";
import { backupItemKey } from "./diff";
import { formatBytes } from "@deepwrite/shared";

export interface CloudBackupSnapshotManifest {
  version: typeof CLOUD_BACKUP_MANIFEST_VERSION;
  machineKey: string;
  updatedAt: string;
  sizeBytes: number;
  items: CloudBackupItem[];
}

export function snapshotObjectPrefix(machineKey: string): string {
  return `backups/${machineKey}`;
}

export function snapshotObjectKeys(machineKey: string): {
  manifest: string;
  archive: string;
} {
  const prefix = snapshotObjectPrefix(machineKey);
  return {
    manifest: `${prefix}/manifest.json`,
    archive: `${prefix}/snapshot.zip`
  };
}

export function itemArchivePrefix(
  kind: CloudBackupItemKind,
  id: string
): string {
  return `items/${kind}/${id}/`;
}

export function packBackupSnapshot(
  machineKey: string,
  updatedAt: string,
  projects: readonly LocalBackupProject[]
): { manifest: CloudBackupSnapshotManifest; zip: Buffer } {
  const entries: ZipEntryInput[] = [];
  for (const project of projects) {
    const prefix = itemArchivePrefix(project.kind, project.id);
    for (const file of project.files) {
      entries.push({
        name: `${prefix}${file.relativePath}`,
        data: file.data
      });
    }
  }
  const zip = createZip(entries);
  if (zip.length > CLOUD_BACKUP_QUOTA_BYTES) {
    throw new Error(
      `备份体积 ${formatBytes(zip.length)} 已超过当前 ${formatBytes(CLOUD_BACKUP_QUOTA_BYTES)} 上限。`
    );
  }
  return {
    manifest: {
      version: CLOUD_BACKUP_MANIFEST_VERSION,
      machineKey,
      updatedAt,
      sizeBytes: zip.length,
      items: toManifestItems(projects)
    },
    zip
  };
}

export function parseSnapshotManifest(
  raw: unknown
): CloudBackupSnapshotManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("云端备份清单无效。");
  }
  const value = raw as Partial<CloudBackupSnapshotManifest>;
  if (value.version !== CLOUD_BACKUP_MANIFEST_VERSION) {
    throw new Error("云端备份版本不受支持。");
  }
  if (
    typeof value.machineKey !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("云端备份清单无效。");
  }
  if (!Array.isArray(value.items) || typeof value.sizeBytes !== "number") {
    throw new Error("云端备份清单无效。");
  }
  return {
    version: CLOUD_BACKUP_MANIFEST_VERSION,
    machineKey: value.machineKey,
    updatedAt: value.updatedAt,
    sizeBytes: value.sizeBytes,
    items: CloudBackupItemSchema.array().parse(value.items)
  };
}

function extractProjectFiles(
  entries: ReadonlyMap<string, Buffer>,
  kind: CloudBackupItemKind,
  id: string
): Array<{ relativePath: string; data: Buffer }> {
  const prefix = itemArchivePrefix(kind, id);
  const files: Array<{ relativePath: string; data: Buffer }> = [];
  for (const [name, data] of entries) {
    if (!name.startsWith(prefix) || name.endsWith("/")) continue;
    const relativePath = name.slice(prefix.length);
    if (!relativePath || relativePath.includes("..")) {
      throw new Error("备份压缩包包含非法路径。");
    }
    files.push({ relativePath, data });
  }
  // Legacy hashes include the source host's file order, which the ZIP keeps.
  // Re-sorting by this host's locale would reject valid cross-device backups.
  return files;
}

/** Decode once and validate every selected project before the first local write. */
export function readBackupSnapshot(
  zip: Buffer,
  manifest: CloudBackupSnapshotManifest | null,
  changes: readonly CloudBackupChange[]
): Map<string, Array<{ relativePath: string; data: Buffer }>> {
  if (!manifest || zip.length !== manifest.sizeBytes) {
    throw new Error("云端备份文件与预览不一致，请重新预览后再同步。");
  }
  const entries = readZip(zip);
  const items = new Map(
    manifest.items.map((item) => [backupItemKey(item), item])
  );
  const projects = new Map<
    string,
    Array<{ relativePath: string; data: Buffer }>
  >();
  for (const change of changes) {
    if (change.change !== "add" && change.change !== "overwrite") continue;
    const key = backupItemKey(change);
    const item = items.get(key);
    const files = extractProjectFiles(entries, change.kind, change.id);
    const actual = hashProjectFiles(files);
    if (
      !item ||
      !files.length ||
      actual.hash !== item.hash ||
      actual.sizeBytes !== item.sizeBytes
    ) {
      throw new Error(
        `云端备份文件与预览不一致：${change.title}，请重新预览后再同步。`
      );
    }
    projects.set(key, files);
  }
  return projects;
}
