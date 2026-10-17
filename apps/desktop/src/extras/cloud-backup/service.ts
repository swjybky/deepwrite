import { randomBytes } from "node:crypto";
import {
  CLOUD_BACKUP_QUOTA_BYTES,
  CloudBackupApplyResultSchema,
  CloudBackupPreviewSchema,
  CloudBackupStatusSchema,
  type CloudBackupApplyResult,
  type CloudBackupItemKind,
  type CloudBackupPreview,
  type CloudBackupStatus
} from "@deepwrite/contracts";
import {
  allocateProjectDirectory,
  catalogOpenDomain,
  writeProjectFiles
} from "./apply";
import { listLocalBackupProjects } from "./catalog-reader";
import { loadCloudBackupOssConfig } from "./config";
import { countChanges, diffBackupItems } from "./diff";
import { registerGroupInCatalogRegistry } from "./group-registry";
import { CloudBackupIdentityStore, formatMachineKey } from "./identity";
import {
  AliyunOssObjectStore,
  type CloudBackupObjectStore
} from "./oss-client";
import {
  extractProjectFiles,
  packBackupSnapshot,
  parseSnapshotManifest,
  snapshotObjectKeys,
  type CloudBackupSnapshotManifest
} from "./packager";

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface CloudBackupServiceHooks {
  getWorkspaceDirectory(): Promise<string | null>;
  registerCatalogProject(input: {
    projectDirectory: string;
    domain: "book" | "material" | "skill";
  }): Promise<void>;
  registerLongBook(projectDirectory: string): Promise<void>;
}

interface StoredPreview {
  id: string;
  createdAt: number;
  direction: "upload" | "download";
  machineKey: string;
  remoteUpdatedAt: string | null;
  totalBytes: number;
  changes: CloudBackupPreview["changes"];
  packed?: { manifest: CloudBackupSnapshotManifest; zip: Buffer };
}

function previewId(): string {
  return `preview_${randomBytes(8).toString("hex")}`;
}

export class CloudBackupService {
  private readonly identity: CloudBackupIdentityStore;
  private readonly previews = new Map<string, StoredPreview>();

  constructor(
    private readonly userDataPath: string,
    private readonly hooks: CloudBackupServiceHooks,
    private readonly store: CloudBackupObjectStore | null = createDefaultStore(),
    private readonly now: () => Date = () => new Date()
  ) {
    this.identity = new CloudBackupIdentityStore(userDataPath);
  }

  async status(): Promise<CloudBackupStatus> {
    const machineKey = await this.identity.getOrCreate(() => this.isoNow());
    const local = await listLocalBackupProjects(this.userDataPath);
    const remote = this.store
      ? await this.readRemoteManifest(machineKey)
      : null;
    return CloudBackupStatusSchema.parse({
      configured: this.store !== null,
      machineKey,
      quotaBytes: CLOUD_BACKUP_QUOTA_BYTES,
      usedBytes: remote?.sizeBytes ?? 0,
      localItemCount: local.length,
      remoteItemCount: remote?.items.length ?? 0,
      lastBackupAt: remote?.updatedAt ?? null
    });
  }

  async previewBackup(): Promise<CloudBackupPreview> {
    const store = this.requireStore();
    const machineKey = await this.identity.getOrCreate(() => this.isoNow());
    const local = await listLocalBackupProjects(this.userDataPath);
    const packed = packBackupSnapshot(machineKey, this.isoNow(), local);
    const remote = await this.readRemoteManifest(machineKey);
    const changes = diffBackupItems(
      "upload",
      packed.manifest.items,
      remote?.items ?? []
    );
    const preview = this.remember({
      id: previewId(),
      createdAt: Date.now(),
      direction: "upload",
      machineKey,
      remoteUpdatedAt: remote?.updatedAt ?? null,
      totalBytes: packed.zip.length,
      changes,
      packed
    });
    void store;
    return this.toPreview(preview);
  }

  async applyBackup(rawPreviewId: string): Promise<CloudBackupApplyResult> {
    const store = this.requireStore();
    const preview = this.takePreview(rawPreviewId, "upload");
    await this.assertRemotePreviewCurrent(preview);
    const packed = preview.packed;
    if (!packed) {
      throw new Error("备份预览已失效，请重新预览后再同步。");
    }
    const keys = snapshotObjectKeys(preview.machineKey);
    await store.putObject(keys.archive, packed.zip, "application/zip");
    await store.putObject(
      keys.manifest,
      Buffer.from(`${JSON.stringify(packed.manifest, null, 2)}\n`, "utf8"),
      "application/json"
    );
    return CloudBackupApplyResultSchema.parse({
      direction: "upload",
      ...countChanges(preview.changes),
      sizeBytes: packed.zip.length,
      updatedAt: packed.manifest.updatedAt
    });
  }

  async previewRestore(rawMachineKey: string): Promise<CloudBackupPreview> {
    this.requireStore();
    const machineKey = formatMachineKey(rawMachineKey);
    const remote = await this.readRemoteManifest(machineKey);
    if (!remote) {
      throw new Error("未找到该密钥的云端备份。");
    }
    const local = await listLocalBackupProjects(this.userDataPath);
    const localItems = local.map(({ kind, id, title, hash, sizeBytes }) => ({
      kind,
      id,
      title,
      hash,
      sizeBytes
    }));
    const changes = diffBackupItems("download", localItems, remote.items);
    const preview = this.remember({
      id: previewId(),
      createdAt: Date.now(),
      direction: "download",
      machineKey,
      remoteUpdatedAt: remote.updatedAt,
      totalBytes: remote.sizeBytes,
      changes
    });
    return this.toPreview(preview);
  }

  async applyRestore(rawPreviewId: string): Promise<CloudBackupApplyResult> {
    const store = this.requireStore();
    const preview = this.takePreview(rawPreviewId, "download");
    await this.assertRemotePreviewCurrent(preview);
    const workspaceDirectory = await this.hooks.getWorkspaceDirectory();
    if (!workspaceDirectory) {
      throw new Error("请先选择工作目录后再同步云端备份。");
    }
    const keys = snapshotObjectKeys(preview.machineKey);
    const zip = await store.getObject(keys.archive);
    if (!zip) {
      throw new Error("云端备份文件不存在或已被删除。");
    }
    const local = await listLocalBackupProjects(this.userDataPath);
    const localByKey = new Map(
      local.map((project) => [`${project.kind}:${project.id}`, project])
    );
    const now = this.isoNow();
    for (const change of preview.changes) {
      if (change.change !== "add" && change.change !== "overwrite") continue;
      const files = extractProjectFiles(zip, change.kind, change.id);
      if (files.length === 0) {
        throw new Error(`云端备份缺少“${change.title}”的文件。`);
      }
      const existing = localByKey.get(`${change.kind}:${change.id}`);
      if (existing) {
        await writeProjectFiles(existing.projectDirectory, files, {
          replaceExisting: true
        });
        continue;
      }
      const projectDirectory = await allocateProjectDirectory(
        workspaceDirectory,
        change.kind,
        change.title
      );
      await writeProjectFiles(projectDirectory, files);
      await this.registerRestoredProject(
        change.kind,
        change.id,
        projectDirectory,
        now
      );
    }
    return CloudBackupApplyResultSchema.parse({
      direction: "download",
      ...countChanges(preview.changes),
      sizeBytes: preview.totalBytes,
      updatedAt: preview.remoteUpdatedAt ?? now
    });
  }

  private async registerRestoredProject(
    kind: CloudBackupItemKind,
    id: string,
    projectDirectory: string,
    now: string
  ): Promise<void> {
    const catalogDomain = catalogOpenDomain(kind);
    if (catalogDomain) {
      await this.hooks.registerCatalogProject({
        projectDirectory,
        domain: catalogDomain
      });
      return;
    }
    if (kind === "long-book") {
      await this.hooks.registerLongBook(projectDirectory);
      return;
    }
    await registerGroupInCatalogRegistry(this.userDataPath, {
      id,
      kind,
      projectDirectory,
      now
    });
  }

  private async readRemoteManifest(
    machineKey: string
  ): Promise<CloudBackupSnapshotManifest | null> {
    if (!this.store) return null;
    const body = await this.store.getObject(
      snapshotObjectKeys(machineKey).manifest
    );
    if (!body) return null;
    return parseSnapshotManifest(JSON.parse(body.toString("utf8")) as unknown);
  }

  private remember(preview: StoredPreview): StoredPreview {
    this.expirePreviews();
    this.previews.set(preview.id, preview);
    return preview;
  }

  private takePreview(
    id: string,
    direction: StoredPreview["direction"]
  ): StoredPreview {
    this.expirePreviews();
    const preview = this.previews.get(id);
    if (!preview || preview.direction !== direction) {
      throw new Error("同步预览已过期，请重新确认后再继续。");
    }
    this.previews.delete(id);
    return preview;
  }

  private expirePreviews(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of this.previews) {
      if (preview.createdAt < cutoff) {
        this.previews.delete(id);
      }
    }
  }

  private toPreview(preview: StoredPreview): CloudBackupPreview {
    return CloudBackupPreviewSchema.parse({
      previewId: preview.id,
      direction: preview.direction,
      machineKey: preview.machineKey,
      remoteUpdatedAt: preview.remoteUpdatedAt,
      totalBytes: preview.totalBytes,
      quotaBytes: CLOUD_BACKUP_QUOTA_BYTES,
      changes: preview.changes
    });
  }

  private requireStore(): CloudBackupObjectStore {
    if (!this.store) {
      throw new Error("当前环境未配置云端备份。");
    }
    return this.store;
  }

  private async assertRemotePreviewCurrent(
    preview: StoredPreview
  ): Promise<void> {
    const current = await this.readRemoteManifest(preview.machineKey);
    const currentUpdatedAt = current?.updatedAt ?? null;
    if (currentUpdatedAt !== preview.remoteUpdatedAt) {
      throw new Error("云端备份在预览后发生变化，请重新预览后再同步。");
    }
  }

  private isoNow(): string {
    return this.now().toISOString();
  }
}

function createDefaultStore(): CloudBackupObjectStore | null {
  const config = loadCloudBackupOssConfig();
  return config ? new AliyunOssObjectStore(config) : null;
}
