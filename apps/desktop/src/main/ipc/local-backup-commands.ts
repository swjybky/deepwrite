import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import {
  CommandEnvelopeSchema,
  LOCAL_BACKUP_FILE_EXTENSION,
  LocalBackupCancelExportResultSchema,
  LocalBackupCorePreviewResultSchema,
  LocalBackupDiscardPreviewResultSchema,
  LocalBackupExportResultSchema,
  LocalBackupImportPreviewSchema,
  LocalBackupImportResultSchema,
  LocalBackupInventorySnapshotSchema,
  LocalBackupOpenExportFolderResultSchema,
  LocalBackupPlatformSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ExternalControlResourceChange,
  type LocalBackupErrorCode,
  type LocalBackupPlatform
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  ImportPreviewRegistry,
  type ImportPreviewSource
} from "../import-preview-registry";
import { nativeText } from "../native-i18n";
import type { UtilitySupervisor } from "../supervisor";
import { rejectedResult, safeErrorDetails } from "./errors";

const PREVIEW_TTL_MS = 10 * 60 * 1_000;
const MAX_RECENT_EXPORT_PATHS = 32;

const PUBLIC_TYPES = new Set<string>([
  "localBackup.getInventory",
  "localBackup.exportPackage",
  "localBackup.cancelExport",
  "localBackup.openExportFolder",
  "localBackup.chooseImportPackage",
  "localBackup.applyImport",
  "localBackup.discardImportPreview",
  "localBackup.setTestDialogPaths"
]);

export interface LocalBackupPreviewSource extends ImportPreviewSource {
  workspaceDirectory: string;
  localHashes: Record<string, string>;
  conflictKeys: ReadonlySet<string>;
}

export interface LocalBackupCommandContext {
  supervisor: Pick<UtilitySupervisor, "requestCommand">;
  window: BrowserWindow;
  dialog: Pick<Dialog, "showSaveDialog" | "showOpenDialog">;
  documentsPath: string;
  appVersion: string;
  platform?: string;
  isTestEnvironment: boolean;
  webContentsId: number;
  isMainFrame: boolean;
  isAppBusy: () => boolean;
  flushRenderer: () => Promise<void>;
  requireSelectedWorkspaceDirectory: () => Promise<string | null>;
  showItemInFolder: (fullPath: string) => void;
  broadcastResourceChanged: (change: ExternalControlResourceChange) => void;
}

class CoreRejection extends Error {
  constructor(readonly result: Extract<CommandResult, { status: "rejected" }>) {
    super(result.error.message);
  }
}

class LocalBackupRouteError extends Error {
  constructor(
    readonly code: LocalBackupErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LocalBackupRouteError";
  }
}

function normalizePlatform(raw: string): LocalBackupPlatform {
  const parsed = LocalBackupPlatformSchema.safeParse(raw);
  return parsed.success ? parsed.data : "linux";
}

function normalizeExportSavePath(rawPath: string): string {
  const resolved = resolve(rawPath);
  if (
    resolved.endsWith(LOCAL_BACKUP_FILE_EXTENSION) ||
    resolved.toLowerCase().endsWith(".zip")
  ) {
    return resolved;
  }
  return `${resolved}${LOCAL_BACKUP_FILE_EXTENSION}`;
}

async function fileFingerprint(filePath: string): Promise<string> {
  const info = await stat(filePath);
  return `${info.size}:${Math.trunc(info.mtimeMs)}`;
}

export interface LocalBackupController {
  isBusy(): boolean;
  clearForWebContents(webContentsId: number): void;
  handleCommand(
    ctx: LocalBackupCommandContext,
    command: CommandEnvelope
  ): Promise<CommandResult | undefined>;
}

export function createLocalBackupController(options?: {
  now?: () => number;
}): LocalBackupController {
  const now = options?.now ?? Date.now;
  const previews = new ImportPreviewRegistry<LocalBackupPreviewSource>({
    idPrefix: "local-backup-preview",
    expiredMessage: "备份导入预览已过期，请重新选择备份包。",
    ttlMs: PREVIEW_TTL_MS,
    now
  });
  const exportedPaths = new Set<string>();
  const testDialogPaths = {
    savePath: null as string | null,
    openPath: null as string | null
  };
  let busyOperationCount = 0;
  let activeExportId: string | null = null;

  const rememberExportPath = (filePath: string): void => {
    const resolved = resolve(filePath);
    exportedPaths.delete(resolved);
    exportedPaths.add(resolved);
    while (exportedPaths.size > MAX_RECENT_EXPORT_PATHS) {
      const oldest = exportedPaths.values().next().value;
      if (oldest === undefined) break;
      exportedPaths.delete(oldest);
    }
  };

  async function runExclusiveBusy<T>(
    ctx: LocalBackupCommandContext,
    task: () => Promise<T>
  ): Promise<T> {
    if (busyOperationCount > 0 || ctx.isAppBusy()) {
      throw new LocalBackupRouteError(
        "local_backup.busy",
        "当前有对话运行或存储操作正在进行，请稍候再试。"
      );
    }
    busyOperationCount += 1;
    try {
      return await task();
    } finally {
      busyOperationCount -= 1;
    }
  }

  async function forwardCore(
    ctx: LocalBackupCommandContext,
    command: CommandEnvelope,
    type: CommandEnvelope["type"],
    payload: unknown
  ): Promise<unknown> {
    const result = await ctx.supervisor.requestCommand(
      "core",
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, {
          id: `${command.id}-core`,
          context: command.context
        })
      ),
      0
    );
    if (result.status === "rejected") {
      throw new CoreRejection(result);
    }
    return result.payload;
  }

  async function runCommand(
    ctx: LocalBackupCommandContext,
    command: CommandEnvelope
  ): Promise<unknown> {
    switch (command.type) {
      case "localBackup.getInventory":
        return LocalBackupInventorySnapshotSchema.parse(
          await forwardCore(ctx, command, "localBackup.coreInventory", {})
        );

      case "localBackup.cancelExport": {
        if (!activeExportId) {
          return LocalBackupCancelExportResultSchema.parse({ canceled: false });
        }
        return LocalBackupCancelExportResultSchema.parse(
          await forwardCore(ctx, command, "localBackup.coreCancelExport", {
            exportId: activeExportId
          })
        );
      }

      case "localBackup.openExportFolder": {
        const resolved = resolve(command.payload.filePath);
        if (!exportedPaths.has(resolved)) {
          throw new LocalBackupRouteError(
            "local_backup.operation_failed",
            "仅支持打开本次会话已导出的备份文件所在目录。"
          );
        }
        ctx.showItemInFolder(resolved);
        return LocalBackupOpenExportFolderResultSchema.parse({ opened: true });
      }

      case "localBackup.discardImportPreview": {
        let discarded = false;
        try {
          previews.resolve(command.payload.previewId, ctx.webContentsId);
          discarded = previews.consume(command.payload.previewId);
        } catch {
          // Expired or owned by another window.
        }
        return LocalBackupDiscardPreviewResultSchema.parse({ discarded });
      }

      case "localBackup.setTestDialogPaths": {
        if (!ctx.isTestEnvironment) {
          throw new LocalBackupRouteError(
            "local_backup.test_only",
            "仅测试环境支持预设文件对话框路径。"
          );
        }
        if (command.payload.savePath !== undefined) {
          testDialogPaths.savePath = command.payload.savePath;
        }
        if (command.payload.openPath !== undefined) {
          testDialogPaths.openPath = command.payload.openPath;
        }
        return undefined;
      }

      case "localBackup.exportPackage":
        return await runExclusiveBusy(ctx, async () => {
          await ctx.flushRenderer();
          let targetPath: string;
          if (ctx.isTestEnvironment && testDialogPaths.savePath) {
            targetPath = normalizeExportSavePath(testDialogPaths.savePath);
            testDialogPaths.savePath = null;
          } else {
            const defaultFileName = `DeepWrite-backup-${new Date(now()).toISOString().slice(0, 10)}${LOCAL_BACKUP_FILE_EXTENSION}`;
            const save = await ctx.dialog.showSaveDialog(ctx.window, {
              title: nativeText("exportLocalBackup"),
              defaultPath: join(ctx.documentsPath, defaultFileName),
              buttonLabel: nativeText("export"),
              filters: [
                { name: nativeText("localBackupArchive"), extensions: ["zip"] }
              ]
            });
            if (save.canceled || !save.filePath) {
              return null;
            }
            targetPath = normalizeExportSavePath(save.filePath);
          }

          const exportId = createId("local_backup_export");
          activeExportId = exportId;
          try {
            const result = LocalBackupExportResultSchema.parse(
              await forwardCore(ctx, command, "localBackup.coreExportAtPath", {
                exportId,
                targetPath,
                selectedKeys: command.payload.selectedKeys,
                appVersion: ctx.appVersion,
                platform: normalizePlatform(ctx.platform ?? process.platform)
              })
            );
            rememberExportPath(result.filePath);
            return result;
          } finally {
            if (activeExportId === exportId) {
              activeExportId = null;
            }
          }
        });

      case "localBackup.chooseImportPackage":
        return await runExclusiveBusy(ctx, async () => {
          const workspaceDirectory =
            await ctx.requireSelectedWorkspaceDirectory();
          if (!workspaceDirectory) {
            throw new LocalBackupRouteError(
              "local_backup.workspace_required",
              "请先选择 DeepWrite 工作目录后再导入备份。"
            );
          }
          let archivePath: string;
          if (ctx.isTestEnvironment && testDialogPaths.openPath) {
            archivePath = resolve(testDialogPaths.openPath);
            testDialogPaths.openPath = null;
          } else {
            const pick = await ctx.dialog.showOpenDialog(ctx.window, {
              title: nativeText("chooseLocalBackup"),
              defaultPath: ctx.documentsPath,
              buttonLabel: nativeText("recognize"),
              properties: ["openFile"],
              filters: [
                { name: nativeText("localBackupArchive"), extensions: ["zip"] }
              ]
            });
            const selected = pick.filePaths[0];
            if (pick.canceled || !selected) {
              return null;
            }
            archivePath = resolve(selected);
          }

          let sourceFingerprint: string;
          try {
            sourceFingerprint = await fileFingerprint(archivePath);
          } catch {
            throw new LocalBackupRouteError(
              "local_backup.invalid_archive",
              "所选备份文件不存在或无法读取。"
            );
          }

          const scanned = LocalBackupCorePreviewResultSchema.parse(
            await forwardCore(
              ctx,
              command,
              "localBackup.corePreviewImportAtPath",
              { archivePath, workspaceDirectory }
            )
          );
          const conflictKeys = new Set(
            scanned.preview.items
              .filter((item) => item.status === "conflict_same_id")
              .map((item) => item.key)
          );
          const { previewId, expiresAt } = previews.register({
            webContentsId: ctx.webContentsId,
            sourcePath: archivePath,
            sourceFingerprint,
            workspaceDirectory,
            localHashes: scanned.localHashes,
            conflictKeys
          });
          return LocalBackupImportPreviewSchema.parse({
            ...scanned.preview,
            previewId,
            expiresAt: new Date(expiresAt).toISOString()
          });
        });

      case "localBackup.applyImport":
        return await runExclusiveBusy(ctx, async () => {
          let registration: LocalBackupPreviewSource;
          try {
            registration = previews.resolve(
              command.payload.previewId,
              ctx.webContentsId
            );
          } catch (error: unknown) {
            throw new LocalBackupRouteError(
              "local_backup.preview_expired",
              error instanceof Error
                ? error.message
                : "备份导入预览已过期，请重新选择备份包。"
            );
          }

          let currentFingerprint: string;
          try {
            currentFingerprint = await fileFingerprint(registration.sourcePath);
          } catch {
            previews.consume(command.payload.previewId);
            throw new LocalBackupRouteError(
              "local_backup.invalid_archive",
              "备份文件在预览后被移除或不可读取，请重新选择。"
            );
          }
          if (currentFingerprint !== registration.sourceFingerprint) {
            previews.consume(command.payload.previewId);
            throw new LocalBackupRouteError(
              "local_backup.preview_expired",
              "备份文件在预览后发生了变化，请重新选择备份包以刷新预览。"
            );
          }

          const hasSelectedConflict = command.payload.selectedKeys.some((key) =>
            registration.conflictKeys.has(key)
          );
          if (
            command.payload.conflictPolicy === "replace" &&
            hasSelectedConflict &&
            command.payload.confirmReplace !== true
          ) {
            throw new LocalBackupRouteError(
              "local_backup.operation_failed",
              "覆盖本机已有项目必须先经用户明确确认。"
            );
          }

          await ctx.flushRenderer();
          let rawResult: unknown;
          try {
            rawResult = await forwardCore(
              ctx,
              command,
              "localBackup.coreApplyImportAtPath",
              {
                archivePath: registration.sourcePath,
                workspaceDirectory: registration.workspaceDirectory,
                selectedKeys: command.payload.selectedKeys,
                conflictPolicy: command.payload.conflictPolicy,
                expectedLocalHashes: registration.localHashes
              }
            );
          } catch (error: unknown) {
            if (
              error instanceof CoreRejection &&
              (error.result.error.code === "local_backup.target_changed" ||
                error.result.error.code === "local_backup.preview_expired")
            ) {
              previews.consume(command.payload.previewId);
            }
            throw error;
          }
          const result = LocalBackupImportResultSchema.parse(rawResult);
          previews.consume(command.payload.previewId);
          ctx.broadcastResourceChanged({
            domain: "work",
            resourceId: "local-backup"
          });
          ctx.broadcastResourceChanged({
            domain: "library",
            resourceId: "local-backup"
          });
          return result;
        });

      default:
        return undefined;
    }
  }

  return {
    isBusy: () => busyOperationCount > 0,
    clearForWebContents: (webContentsId) => {
      previews.clearForWebContents(webContentsId);
    },
    async handleCommand(
      ctx: LocalBackupCommandContext,
      command: CommandEnvelope
    ): Promise<CommandResult | undefined> {
      if (!PUBLIC_TYPES.has(command.type)) {
        return undefined;
      }
      if (!ctx.isMainFrame) {
        return rejectedResult(
          command.id,
          "local_backup.untrusted_frame",
          "备份与迁移操作仅允许从应用主界面发起。"
        );
      }
      try {
        const payload = await runCommand(ctx, command);
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      } catch (error: unknown) {
        if (error instanceof CoreRejection) {
          return { ...error.result, requestId: command.id };
        }
        if (error instanceof LocalBackupRouteError) {
          return rejectedResult(
            command.id,
            error.code,
            error.message,
            safeErrorDetails(error)
          );
        }
        return rejectedResult(
          command.id,
          "local_backup.operation_failed",
          error instanceof Error ? error.message : "本地备份操作失败。",
          safeErrorDetails(error)
        );
      }
    }
  };
}
