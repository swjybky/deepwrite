import { describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  LocalBackupImportPreview,
  LocalBackupInventorySnapshot
} from "@deepwrite/contracts";
import { useLocalBackup } from "./useLocalBackup";

type LocalBackupApi = NonNullable<DeepWriteApi["localBackup"]>;

function makePreview(): LocalBackupImportPreview {
  return {
    previewId: "prev-1",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    fileName: "backup.dwbackup.zip",
    sourcePlatform: "win32",
    exportedAt: new Date().toISOString(),
    appVersion: "1.9.0",
    totalItems: 3,
    totalBytes: 4096,
    availableDiskBytes: 1024 * 1024 * 1024,
    requiredDiskBytes: 64 * 1024 * 1024,
    diskSpaceSufficient: true,
    items: [
      {
        key: "book:b1",
        kind: "book",
        id: "b1",
        title: "作品1",
        workSubtype: "short",
        sizeBytes: 1024,
        status: "conflict_same_id"
      },
      {
        key: "material-library:m1",
        kind: "material-library",
        id: "m1",
        title: "新素材库",
        sizeBytes: 2048,
        status: "new"
      },
      {
        key: "skill-library:s1",
        kind: "skill-library",
        id: "s1",
        title: "内置技能",
        sizeBytes: 1024,
        status: "builtin_skipped"
      }
    ]
  };
}

describe("useLocalBackup composable", () => {
  it("计算未勾选依赖提醒并在取消导出和覆盖二次确认时按预期分支执行", async () => {
    const api: LocalBackupApi = {
      getInventory: vi.fn(async (): Promise<LocalBackupInventorySnapshot> => ({
        counts: { works: 1, materials: 1, skills: 0 },
        items: [
          {
            key: "book:b1",
            kind: "book",
            id: "b1",
            title: "长风集",
            workSubtype: "short",
            sizeBytes: 500,
            empty: false,
            linkedMaterialIds: ["m1"],
            linkedSkillIds: []
          },
          {
            key: "material-library:m1",
            kind: "material-library",
            id: "m1",
            title: "核心设定库",
            sizeBytes: 200,
            empty: false,
            linkedMaterialIds: [],
            linkedSkillIds: []
          }
        ]
      })),
      exportPackage: vi.fn(async () => ({
        filePath: "/tmp/out.dwbackup.zip",
        itemCount: 1,
        archiveBytes: 300
      })),
      cancelExport: vi.fn(async () => ({ canceled: true })),
      openExportFolder: vi.fn(async () => undefined),
      chooseImportPackage: vi.fn(async () => makePreview()),
      applyImport: vi.fn(async () => ({
        added: 1,
        duplicated: 0,
        replaced: 1,
        skipped: 0,
        danglingBindingsRemoved: 0,
        warnings: []
      })),
      discardImportPreview: vi.fn(async () => undefined)
    };

    const confirm = vi.fn(async () => false);
    const success = vi.fn();
    const error = vi.fn();
    const backup = useLocalBackup({
      api: () => api,
      notifications: { success, error },
      confirm
    });

    await backup.openExportDialog();
    expect(backup.selectedExportKeys.value).toEqual([
      "book:b1",
      "material-library:m1"
    ]);
    backup.setGroupExportSelection(["material-library:m1"], false);
    expect(backup.missingLinkedTitles.value).toEqual(["核心设定库"]);

    await backup.submitExport();
    expect(api.exportPackage).toHaveBeenCalledWith({
      selectedKeys: ["book:b1"]
    });
    expect(backup.lastExportResult.value?.filePath).toBe(
      "/tmp/out.dwbackup.zip"
    );
    expect(success).toHaveBeenCalledTimes(1);

    await backup.chooseImportPackage();
    expect(backup.selectedImportKeys.value).toEqual([
      "book:b1",
      "material-library:m1"
    ]);
    expect(backup.conflictPolicy.value).toBe("keep_both");
    expect(backup.isReplaceDanger.value).toBe(false);

    backup.conflictPolicy.value = "replace";
    expect(backup.isReplaceDanger.value).toBe(true);

    // 取消覆盖确认则不得调用 applyImport
    await backup.submitImport();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ danger: true })
    );
    expect(api.applyImport).not.toHaveBeenCalled();

    // 确认后带上 confirmReplace: true 提交
    confirm.mockResolvedValueOnce(true);
    await backup.submitImport();
    expect(api.applyImport).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId: "prev-1",
        conflictPolicy: "replace",
        confirmReplace: true
      })
    );
    expect(backup.importPreview.value).toBeNull();
  });
});
