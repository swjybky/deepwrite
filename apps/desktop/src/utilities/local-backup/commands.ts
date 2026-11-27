import { readFile } from "node:fs/promises";
import {
  LOCAL_BACKUP_FORMAT_VERSION,
  LOCAL_BACKUP_MIN_APP_VERSION,
  LibraryOrganizationSchema,
  LocalBackupApplyImportInputSchema,
  LocalBackupCoreApplyImportAtPathInputSchema,
  LocalBackupCoreCancelExportInputSchema,
  LocalBackupCoreExportAtPathInputSchema,
  LocalBackupCorePreviewImportAtPathInputSchema,
  LocalBackupCancelExportResultSchema,
  LocalBackupCorePreviewResultSchema,
  LocalBackupExportResultSchema,
  LocalBackupImportResultSchema,
  LocalBackupInventorySnapshotSchema,
  LocalBackupManifestSchema,
  type CommandResult,
  type LibraryOrganization,
  type LocalBackupManifestItem
} from "@deepwrite/contracts";
import { nowIso, toJsonFileText } from "@deepwrite/shared";
import type { UtilityRuntimeOptions } from "../runtime";
import { LocalBackupError } from "./errors";
import {
  assertSufficientDiskSpace,
  requiredExportDiskBytes,
  type StatFsFn
} from "./disk-space";
import {
  commitStagedBackupImport,
  recoverInterruptedLocalBackupImport,
  type ImportCommitHooks
} from "./import-transaction";
import {
  collectRegisteredRealRoots,
  computeProjectFilesHash,
  discoverExportableProjects,
  getLocalBackupInventory,
  hashProjectDirectoryOnDisk
} from "./inventory";
import {
  BACKUP_MANIFEST_FILENAME,
  backupItemArchivePrefix,
  computeRegistryFingerprints,
  previewLocalBackupArchive,
  stageLocalBackupImport,
  validateItemPayload
} from "./remap-and-validate";
import {
  writeBackupZipArchive,
  type BackupArchiveWriteEntry
} from "./zip-archive";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import { isNodeError } from "@deepwrite/shared/node";

export interface ExportSnapshotHooks {
  beforeReadProject?: (index: number, key: string) => void | Promise<void>;
  afterSnapshotCaptured?: () => void | Promise<void>;
}

export interface LocalBackupCoreDeps {
  userDataPath: string;
  requireCatalogStore: () => Promise<FolderCatalogStore>;
  longWorkspaceService: Pick<LongWorkspaceService, "store">;
  statfsImpl?: StatFsFn;
  importHooks?: ImportCommitHooks;
  exportHooks?: ExportSnapshotHooks;
}

function sliceLibraryOrganization(
  source: LibraryOrganization | undefined,
  selectedKeys: ReadonlySet<string>,
  unboundIds: ReadonlySet<string>
): LibraryOrganization | undefined {
  if (!source) return undefined;
  const isMatIncluded = (id: string) =>
    selectedKeys.has(`material-library:${id}`) ||
    selectedKeys.has(`material-group:${id}`);
  const isSkillIncluded = (id: string) =>
    selectedKeys.has(`skill-library:${id}`) ||
    selectedKeys.has(`skill-group:${id}`);

  const groups: Record<string, string[]> = {};
  for (const [groupId, memberIds] of Object.entries(source.groups)) {
    if (selectedKeys.has(`material-group:${groupId}`)) {
      groups[groupId] = memberIds.filter((id) =>
        selectedKeys.has(`material-library:${id}`)
      );
    } else if (selectedKeys.has(`skill-group:${groupId}`)) {
      groups[groupId] = memberIds.filter((id) =>
        selectedKeys.has(`skill-library:${id}`)
      );
    }
  }

  return LibraryOrganizationSchema.parse({
    revision: source.revision,
    material: source.material.filter(isMatIncluded),
    skill: source.skill.filter(isSkillIncluded),
    groups,
    unboundLibraryIds: [...unboundIds].filter(
      (id) =>
        selectedKeys.has(`material-library:${id}`) ||
        selectedKeys.has(`skill-library:${id}`)
    )
  });
}

export async function exportLocalBackupAtPath(options: {
  userDataPath: string;
  targetPath: string;
  selectedKeys: readonly string[];
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  signal?: AbortSignal;
  statfsImpl?: StatFsFn;
  exportHooks?: ExportSnapshotHooks;
}): Promise<{
  filePath: string;
  itemCount: number;
  archiveBytes: number;
}> {
  const onlyKeys = new Set(options.selectedKeys);
  if (onlyKeys.size === 0) {
    throw new LocalBackupError(
      "local_backup.operation_failed",
      "请至少选择一个作品、素材库或技能库进行导出。"
    );
  }

  const preRegHashes = await computeRegistryFingerprints(options.userDataPath);
  const { registries, projects } = await discoverExportableProjects(
    options.userDataPath,
    { strict: true, onlyKeys }
  );
  if (projects.length === 0) {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      "未找到可导出的有效项目，请刷新列表后重试。"
    );
  }
  const missingKey = [...onlyKeys].find(
    (key) => !projects.some((project) => project.key === key)
  );
  if (missingKey) {
    throw new LocalBackupError(
      "local_backup.inconsistent_project",
      `选中的项目「${missingKey}」不存在或属于系统内置技能库（不支持导出）。`
    );
  }

  const totalRawBytes = projects.reduce((sum, item) => sum + item.rawBytes, 0);
  await assertSufficientDiskSpace({
    targetPath: options.targetPath,
    requiredBytes: requiredExportDiskBytes(totalRawBytes),
    purpose: "export",
    ...(options.statfsImpl ? { statfsImpl: options.statfsImpl } : {})
  });

  const manifestItems: LocalBackupManifestItem[] = [];
  const archiveEntries: BackupArchiveWriteEntry[] = [];
  const itemFileMeta = new Map<string, string[]>();
  const capturedProjectFiles: Array<{
    project: (typeof projects)[number];
    filesMap: Map<string, Buffer>;
    hash: string;
    meta: LocalBackupManifestItem;
  }> = [];

  for (
    let projectIndex = 0;
    projectIndex < projects.length;
    projectIndex += 1
  ) {
    const project = projects[projectIndex]!;
    if (options.signal?.aborted) {
      throw new LocalBackupError("local_backup.canceled", "已取消导出备份包。");
    }
    await options.exportHooks?.beforeReadProject?.(projectIndex, project.key);
    const prefix = backupItemArchivePrefix(project.kind, project.id);
    const loadedFiles: Array<{ relativePath: string; bytes: Buffer }> = [];
    const filesMap = new Map<string, Buffer>();
    for (const entry of project.files) {
      let bytes: Buffer;
      try {
        bytes = await readFile(entry.fullPath);
      } catch (error: unknown) {
        if (isNodeError(error, "ENOENT")) {
          throw new LocalBackupError(
            "local_backup.target_changed",
            `导出过程中项目「${project.title}」文件发生变化，已中止导出，请重试。`
          );
        }
        throw error;
      }
      loadedFiles.push({ relativePath: entry.relativePath, bytes });
      filesMap.set(entry.relativePath, bytes);
      const archivePath = `${prefix}${entry.relativePath}`;
      itemFileMeta.set(archivePath, [project.key, entry.relativePath]);
      archiveEntries.push({
        archivePath,
        readBytes: async () => bytes
      });
    }
    const computed = computeProjectFilesHash(loadedFiles);
    const meta: LocalBackupManifestItem = {
      kind: project.kind,
      id: project.id,
      title: project.title,
      ...(project.workSubtype ? { workSubtype: project.workSubtype } : {}),
      ...(project.isUnbound ? { isUnbound: true } : {}),
      sizeBytes: computed.sizeBytes,
      hash: computed.hash
    };
    manifestItems.push(meta);
    capturedProjectFiles.push({
      project,
      filesMap,
      hash: computed.hash,
      meta
    });
  }

  await options.exportHooks?.afterSnapshotCaptured?.();

  // Consistency gate: validate captured in-memory structure and verify neither
  // registries nor any selected project directory changed on disk mid-snapshot.
  for (const captured of capturedProjectFiles) {
    try {
      validateItemPayload(captured.meta, captured.filesMap);
    } catch (error: unknown) {
      if (error instanceof LocalBackupError) {
        throw new LocalBackupError(
          "local_backup.inconsistent_project",
          `作品或资料库「${captured.project.title}」导出前校验失败：${error.message}`
        );
      }
      throw error;
    }
  }
  const postRegHashes = await computeRegistryFingerprints(options.userDataPath);
  for (const [key, value] of Object.entries(preRegHashes)) {
    if (postRegHashes[key] !== value) {
      throw new LocalBackupError(
        "local_backup.target_changed",
        "导出过程中注册表发生变化，已中止导出以保证备份快照一致，请重试。"
      );
    }
  }
  const realRoots = await collectRegisteredRealRoots(registries);
  for (const captured of capturedProjectFiles) {
    try {
      const current = await hashProjectDirectoryOnDisk(
        captured.project.projectDirectory,
        realRoots
      );
      if (current.hash !== captured.hash) {
        throw new LocalBackupError(
          "local_backup.target_changed",
          `导出过程中项目「${captured.project.title}」内容发生变化，已中止导出以保证备份快照一致，请重试。`
        );
      }
    } catch (error: unknown) {
      if (error instanceof LocalBackupError) throw error;
      if (isNodeError(error, "ENOENT")) {
        throw new LocalBackupError(
          "local_backup.target_changed",
          `导出过程中项目「${captured.project.title}」目录发生变动，已中止导出，请重试。`
        );
      }
      throw error;
    }
  }

  const selectedUnboundIds = new Set(
    projects.filter((project) => project.isUnbound).map((project) => project.id)
  );
  const slicedOrg = sliceLibraryOrganization(
    registries.catalog.libraryOrganization,
    new Set(projects.map((project) => project.key)),
    selectedUnboundIds
  );

  const { archiveBytes } = await writeBackupZipArchive({
    targetPath: options.targetPath,
    entries: archiveEntries,
    manifestEntryName: BACKUP_MANIFEST_FILENAME,
    ...(options.signal ? { signal: options.signal } : {}),
    buildManifest: (sha256ByPath) => {
      const manifest = LocalBackupManifestSchema.parse({
        formatVersion: LOCAL_BACKUP_FORMAT_VERSION,
        minAppVersion: LOCAL_BACKUP_MIN_APP_VERSION,
        appVersion: options.appVersion,
        exportedAt: nowIso(),
        platform: options.platform,
        creativePlotStages: registries.catalog.creativePlotStages,
        ...(slicedOrg ? { libraryOrganization: slicedOrg } : {}),
        items: manifestItems,
        sha256ByPath
      });
      return Buffer.from(toJsonFileText(manifest), "utf8");
    }
  });

  return {
    filePath: options.targetPath,
    itemCount: manifestItems.length,
    archiveBytes
  };
}

export function withLocalBackupCommands(
  deps: LocalBackupCoreDeps,
  next: NonNullable<UtilityRuntimeOptions["commandHandler"]>
): NonNullable<UtilityRuntimeOptions["commandHandler"]> {
  const activeExportAborts = new Map<string, AbortController>();
  let mutexChain: Promise<void> = Promise.resolve();
  let recoveryComplete = false;
  let recoveryInFlight: Promise<void> | null = null;
  let activeRegularCount = 0;
  let exclusiveActive = false;
  const exclusiveWaiters: Array<() => void> = [];
  const regularWaiters: Array<() => void> = [];

  const ensureRecovered = async (): Promise<void> => {
    if (recoveryComplete) return;
    if (!recoveryInFlight) {
      recoveryInFlight = (async () => {
        const res = await recoverInterruptedLocalBackupImport(
          deps.userDataPath
        );
        if (res.recovered) {
          deps.longWorkspaceService.store.clearReadCaches();
        }
        recoveryComplete = true;
      })().finally(() => {
        recoveryInFlight = null;
      });
    }
    await recoveryInFlight;
  };

  void ensureRecovered().catch(() => undefined);

  const runExclusive = async <T>(task: () => Promise<T>): Promise<T> => {
    const previousTurn = mutexChain.catch(() => undefined);
    let releaseMutex!: () => void;
    mutexChain = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    await previousTurn;
    await ensureRecovered();
    exclusiveActive = true;
    try {
      while (activeRegularCount > 0) {
        await new Promise<void>((resolve) => exclusiveWaiters.push(resolve));
      }
      await deps.requireCatalogStore();
      return await task();
    } finally {
      exclusiveActive = false;
      const wakeRegular = regularWaiters.splice(0, regularWaiters.length);
      for (const wake of wakeRegular) wake();
      releaseMutex();
    }
  };

  return async (command, emitEvent, context): Promise<CommandResult> => {
    if (!command.type.startsWith("localBackup.core")) {
      await ensureRecovered();
      while (exclusiveActive) {
        await new Promise<void>((resolve) => regularWaiters.push(resolve));
      }
      activeRegularCount += 1;
      try {
        return await next(command, emitEvent, context);
      } finally {
        activeRegularCount -= 1;
        if (activeRegularCount === 0) {
          const wakeExclusive = exclusiveWaiters.splice(
            0,
            exclusiveWaiters.length
          );
          for (const wake of wakeExclusive) wake();
        }
      }
    }

    try {
      switch (command.type) {
        case "localBackup.coreInventory": {
          const snapshot = await runExclusive(() =>
            getLocalBackupInventory(deps.userDataPath)
          );
          return {
            status: "accepted",
            requestId: command.id,
            payload: LocalBackupInventorySnapshotSchema.parse(snapshot)
          };
        }

        case "localBackup.coreExportAtPath": {
          const payload = LocalBackupCoreExportAtPathInputSchema.parse(
            command.payload
          );
          const controller = new AbortController();
          activeExportAborts.set(payload.exportId, controller);
          try {
            const exported = await runExclusive(() =>
              exportLocalBackupAtPath({
                userDataPath: deps.userDataPath,
                targetPath: payload.targetPath,
                selectedKeys: payload.selectedKeys,
                appVersion: payload.appVersion,
                platform: payload.platform,
                signal: controller.signal,
                ...(deps.statfsImpl ? { statfsImpl: deps.statfsImpl } : {}),
                ...(deps.exportHooks ? { exportHooks: deps.exportHooks } : {})
              })
            );
            return {
              status: "accepted",
              requestId: command.id,
              payload: LocalBackupExportResultSchema.parse(exported)
            };
          } finally {
            activeExportAborts.delete(payload.exportId);
          }
        }

        case "localBackup.coreCancelExport": {
          const payload = LocalBackupCoreCancelExportInputSchema.parse(
            command.payload
          );
          const controller = activeExportAborts.get(payload.exportId);
          if (controller) {
            controller.abort();
          }
          return {
            status: "accepted",
            requestId: command.id,
            payload: LocalBackupCancelExportResultSchema.parse({
              canceled: Boolean(controller)
            })
          };
        }

        case "localBackup.corePreviewImportAtPath": {
          const payload = LocalBackupCorePreviewImportAtPathInputSchema.parse(
            command.payload
          );
          const preview = await runExclusive(() =>
            previewLocalBackupArchive({
              archivePath: payload.archivePath,
              userDataPath: deps.userDataPath,
              workspaceDirectory: payload.workspaceDirectory,
              ...(deps.statfsImpl ? { statfsImpl: deps.statfsImpl } : {})
            })
          );
          return {
            status: "accepted",
            requestId: command.id,
            payload: LocalBackupCorePreviewResultSchema.parse(preview)
          };
        }

        case "localBackup.coreApplyImportAtPath": {
          const payload = LocalBackupCoreApplyImportAtPathInputSchema.parse(
            command.payload
          );
          const imported = await runExclusive(async () => {
            const plan = await stageLocalBackupImport({
              ...payload,
              userDataPath: deps.userDataPath,
              ...(deps.statfsImpl ? { statfsImpl: deps.statfsImpl } : {})
            });
            await commitStagedBackupImport({
              userDataPath: deps.userDataPath,
              workspaceDirectory: payload.workspaceDirectory,
              batchId: plan.batchId,
              stagingRoot: plan.stagingRoot,
              backupPrevRoot: plan.backupPrevRoot,
              operations: plan.operations,
              nextRegistries: plan.nextRegistries,
              expectedRegistryFingerprints: plan.expectedRegistryFingerprints,
              ...(deps.importHooks ? { hooks: deps.importHooks } : {})
            });
            deps.longWorkspaceService.store.clearReadCaches();
            return plan.summary;
          });
          return {
            status: "accepted",
            requestId: command.id,
            payload: LocalBackupImportResultSchema.parse(imported)
          };
        }
      }
    } catch (error: unknown) {
      if (error instanceof LocalBackupError) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {})
          }
        };
      }
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "local_backup.operation_failed",
          message:
            error instanceof Error ? error.message : "本地备份或导入操作失败。"
        }
      };
    }

    return await next(command, emitEvent, context);
  };
}

export { LocalBackupApplyImportInputSchema };
