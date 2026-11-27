import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import {
  createLocalBackupController,
  type LocalBackupCommandContext
} from "./local-backup-commands";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
});

function baseContext(
  overrides: Partial<LocalBackupCommandContext> = {}
): LocalBackupCommandContext {
  return {
    supervisor: {
      requestCommand: vi.fn(async () => ({
        status: "accepted" as const,
        requestId: "req-core",
        payload: {}
      }))
    },
    window: {} as BrowserWindow,
    dialog: {
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    } as unknown as Pick<Dialog, "showSaveDialog" | "showOpenDialog">,
    documentsPath: "/tmp/docs",
    appVersion: "1.9.0",
    platform: "darwin",
    isTestEnvironment: true,
    webContentsId: 101,
    isMainFrame: true,
    isAppBusy: () => false,
    flushRenderer: vi.fn(async () => undefined),
    requireSelectedWorkspaceDirectory: vi.fn(async () => "/tmp/workspace"),
    showItemInFolder: vi.fn(),
    broadcastResourceChanged: vi.fn(),
    ...overrides
  };
}

describe("Main LocalBackup IPC 路由控制", () => {
  it("拒绝非主 frame 调用与非测试环境预设对话框路径", async () => {
    const controller = createLocalBackupController();
    const untrusted = await controller.handleCommand(
      baseContext({ isMainFrame: false }),
      createEnvelope(
        "localBackup.getInventory",
        {},
        { id: "c1", correlationId: "c1" }
      )
    );
    expect(untrusted).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.untrusted_frame" }
    });

    const prodTestPath = await controller.handleCommand(
      baseContext({ isTestEnvironment: false }),
      createEnvelope(
        "localBackup.setTestDialogPaths",
        { savePath: "/tmp/out.dwbackup.zip" },
        { id: "c2", correlationId: "c2" }
      )
    );
    expect(prodTestPath).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.test_only" }
    });
  });

  it("在全局忙碌态时拒绝导出并拦截未授权打开任意路径", async () => {
    const controller = createLocalBackupController();
    const busyRes = await controller.handleCommand(
      baseContext({ isAppBusy: () => true }),
      createEnvelope(
        "localBackup.exportPackage",
        { selectedKeys: ["book:b1"] },
        { id: "c3", correlationId: "c3" }
      )
    );
    expect(busyRes).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.busy" }
    });

    const openArbitrary = await controller.handleCommand(
      baseContext(),
      createEnvelope(
        "localBackup.openExportFolder",
        { filePath: "/etc/passwd" },
        { id: "c4", correlationId: "c4" }
      )
    );
    expect(openArbitrary).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.operation_failed" }
    });
  });

  it("校验导入预览 TTL 过期、源文件变更、replace 确认及成功导入广播刷新", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dw-ipc-backup-"));
    tempDirs.push(dir);
    const archivePath = join(dir, "sample.dwbackup.zip");
    await writeFile(archivePath, "zip-v1");

    let clock = 1_000;
    const controller = createLocalBackupController({ now: () => clock });
    const broadcast = vi.fn();
    const flush = vi.fn(async () => undefined);
    const requestCommand = vi.fn(async (_worker, cmd) => {
      if (cmd.type === "localBackup.corePreviewImportAtPath") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: {
            preview: {
              fileName: "sample.dwbackup.zip",
              sourcePlatform: "darwin",
              exportedAt: new Date().toISOString(),
              appVersion: "1.9.0",
              totalItems: 1,
              totalBytes: 120,
              availableDiskBytes: 1024 * 1024 * 1024,
              requiredDiskBytes: 64 * 1024 * 1024,
              diskSpaceSufficient: true,
              items: [
                {
                  key: "book:b1",
                  kind: "book",
                  id: "b1",
                  title: "冲突之书",
                  workSubtype: "short",
                  sizeBytes: 120,
                  status: "conflict_same_id"
                }
              ]
            },
            localHashes: { "book:b1": "a".repeat(64) }
          }
        };
      }
      if (cmd.type === "localBackup.coreApplyImportAtPath") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: {
            added: 0,
            duplicated: 0,
            replaced: 1,
            skipped: 0,
            danglingBindingsRemoved: 0,
            warnings: []
          }
        };
      }
      return {
        status: "accepted" as const,
        requestId: cmd.id,
        payload: {
          filePath: join(dir, "exported.dwbackup.zip"),
          itemCount: 1,
          archiveBytes: 256
        }
      };
    });

    const ctx = baseContext({
      supervisor: { requestCommand },
      flushRenderer: flush,
      broadcastResourceChanged: broadcast,
      dialog: {
        showSaveDialog: vi.fn(async () => ({
          canceled: false,
          filePath: join(dir, "exported")
        })),
        showOpenDialog: vi.fn(async () => ({
          canceled: false,
          filePaths: [archivePath]
        }))
      } as unknown as Pick<Dialog, "showSaveDialog" | "showOpenDialog">
    });

    // 导出自动补全 .dwbackup.zip 且加入 openExportFolder 白名单
    const exportRes = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.exportPackage",
        { selectedKeys: ["book:b1"] },
        { id: "exp-1", correlationId: "exp-1" }
      )
    );
    expect(exportRes).toMatchObject({ status: "accepted" });
    expect(flush).toHaveBeenCalledTimes(1);
    const coreExportCall = requestCommand.mock.calls[0]![1];
    expect(coreExportCall.payload.targetPath).toMatch(/\.dwbackup\.zip$/u);

    const openAllowed = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.openExportFolder",
        { filePath: join(dir, "exported.dwbackup.zip") },
        { id: "open-1", correlationId: "open-1" }
      )
    );
    expect(openAllowed).toMatchObject({ status: "accepted" });
    expect(ctx.showItemInFolder).toHaveBeenCalledTimes(1);

    // 选择导入预览
    const previewRes = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.chooseImportPackage",
        {},
        { id: "prev-1", correlationId: "prev-1" }
      )
    );
    expect(previewRes).toMatchObject({ status: "accepted" });
    const previewId = (
      previewRes as Extract<typeof previewRes, { status: "accepted" }>
    ).payload as { previewId: string };

    // 未明确 confirmReplace=true 且选了 conflict_same_id 的 replace 请求必须被拒
    const blockedReplace = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: previewId.previewId,
          selectedKeys: ["book:b1"],
          conflictPolicy: "replace" as const
        },
        { id: "imp-blocked", correlationId: "imp-blocked" }
      )
    );
    expect(blockedReplace).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.operation_failed" }
    });

    // 带 confirmReplace=true 成功导入并广播刷新工作区和资料库
    const applied = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: previewId.previewId,
          selectedKeys: ["book:b1"],
          conflictPolicy: "replace" as const,
          confirmReplace: true
        },
        { id: "imp-ok", correlationId: "imp-ok" }
      )
    );
    expect(applied).toMatchObject({ status: "accepted" });
    expect(broadcast).toHaveBeenCalledWith({
      domain: "work",
      resourceId: "local-backup"
    });
    expect(broadcast).toHaveBeenCalledWith({
      domain: "library",
      resourceId: "local-backup"
    });

    // 测试预览过期（超过 10 分钟 TTL）
    const p2Res = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.chooseImportPackage",
        {},
        { id: "prev-2", correlationId: "prev-2" }
      )
    );
    const p2Id = (
      (p2Res as Extract<typeof p2Res, { status: "accepted" }>).payload as {
        previewId: string;
      }
    ).previewId;
    clock += 11 * 60 * 1_000;
    const expired = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: p2Id,
          selectedKeys: ["book:b1"],
          conflictPolicy: "keep_both" as const
        },
        { id: "imp-exp", correlationId: "imp-exp" }
      )
    );
    expect(expired).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.preview_expired" }
    });

    // 测试源文件在预览后变化
    const p3Res = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.chooseImportPackage",
        {},
        { id: "prev-3", correlationId: "prev-3" }
      )
    );
    const p3Id = (
      (p3Res as Extract<typeof p3Res, { status: "accepted" }>).payload as {
        previewId: string;
      }
    ).previewId;
    await writeFile(archivePath, "zip-v2-mutated-size");
    await utimes(archivePath, new Date(), new Date(Date.now() + 2000));
    const mutated = await controller.handleCommand(
      ctx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: p3Id,
          selectedKeys: ["book:b1"],
          conflictPolicy: "keep_both" as const
        },
        { id: "imp-mut", correlationId: "imp-mut" }
      )
    );
    expect(mutated).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.preview_expired" }
    });

    // Core 拒绝 target_changed 后，旧 previewId 必须立即作废，再次提交直接报 preview_expired
    const staleController = createLocalBackupController({ now: () => clock });
    const staleRequestCommand = vi.fn(async (_worker, cmd) => {
      if (cmd.type === "localBackup.corePreviewImportAtPath") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: {
            preview: {
              fileName: "sample.dwbackup.zip",
              sourcePlatform: "darwin",
              exportedAt: new Date().toISOString(),
              appVersion: "1.9.0",
              totalItems: 1,
              totalBytes: 120,
              availableDiskBytes: 1024 * 1024 * 1024,
              requiredDiskBytes: 64 * 1024 * 1024,
              diskSpaceSufficient: true,
              items: [
                {
                  key: "book:b1",
                  kind: "book",
                  id: "b1",
                  title: "目标变动测试书",
                  workSubtype: "short",
                  sizeBytes: 120,
                  status: "conflict_same_id"
                }
              ]
            },
            localHashes: {
              "__registry__:catalog": "1".repeat(64),
              "__registry__:long": "2".repeat(64),
              "__registry__:mystery": "__absent__",
              "book:b1": "a".repeat(64)
            }
          }
        };
      }
      return {
        status: "rejected" as const,
        requestId: cmd.id,
        error: {
          code: "local_backup.target_changed",
          message: "目标在预览后发生了变化。"
        }
      };
    });
    const staleCtx = baseContext({
      supervisor: { requestCommand: staleRequestCommand },
      dialog: {
        showSaveDialog: ctx.dialog.showSaveDialog,
        showOpenDialog: vi.fn(async () => ({
          canceled: false,
          filePaths: [archivePath]
        }))
      } as unknown as Pick<Dialog, "showSaveDialog" | "showOpenDialog">
    });
    const p4Res = await staleController.handleCommand(
      staleCtx,
      createEnvelope(
        "localBackup.chooseImportPackage",
        {},
        { id: "prev-4", correlationId: "prev-4" }
      )
    );
    const p4Id = (
      (p4Res as Extract<typeof p4Res, { status: "accepted" }>).payload as {
        previewId: string;
      }
    ).previewId;
    const firstReject = await staleController.handleCommand(
      staleCtx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: p4Id,
          selectedKeys: ["book:b1"],
          conflictPolicy: "replace" as const,
          confirmReplace: true
        },
        { id: "imp-stale-1", correlationId: "imp-stale-1" }
      )
    );
    expect(firstReject).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.target_changed" }
    });
    const secondReject = await staleController.handleCommand(
      staleCtx,
      createEnvelope(
        "localBackup.applyImport",
        {
          previewId: p4Id,
          selectedKeys: ["book:b1"],
          conflictPolicy: "replace" as const,
          confirmReplace: true
        },
        { id: "imp-stale-2", correlationId: "imp-stale-2" }
      )
    );
    expect(secondReject).toMatchObject({
      status: "rejected",
      error: { code: "local_backup.preview_expired" }
    });
  });
});
