import { describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";
import type {
  CatalogIndexSnapshot,
  DeepWriteApi,
  LibraryPackagePreview
} from "@deepwrite/contracts";
import type { ResourceTreeNode, WorkspaceDocument } from "../types/workspace";
import { useLibraryPackageCoordinator } from "./useLibraryPackageCoordinator";

const preview: LibraryPackagePreview = {
  sourceName: "都市素材组.zip",
  sourceKind: "zip",
  recognition: "package",
  domain: "material",
  group: { title: "都市素材组", suggested: true },
  libraries: [
    {
      key: "lib-1",
      title: "都市人设",
      kind: "character",
      kindEditable: false,
      libraryType: "short",
      entryCount: 2,
      contentBytes: 20,
      stageHints: [{ hint: "character", count: 2 }],
      blocked: null
    }
  ],
  skipped: {
    unsupported: 0,
    empty: 0,
    tooLarge: 0,
    undecodable: 0,
    missing: 0,
    unassigned: 0,
    limit: 0
  },
  skippedFiles: [],
  notes: []
};

function harness(
  options: { packageApiAvailable?: boolean; desktop?: boolean } = {}
) {
  const api = {
    exportPackage: vi.fn<DeepWriteApi["libraryPackage"]["exportPackage"]>(
      async () => ({
        status: "saved",
        filePath: "/导出/都市素材组.zip",
        libraryCount: 2,
        entryCount: 5,
        skippedLibraryCount: 0
      })
    ),
    chooseSource: vi.fn<DeepWriteApi["libraryPackage"]["chooseSource"]>(
      async () => ({
        previewId: "preview-1",
        expiresAt: "2026-10-09T09:00:00.000Z",
        preview
      })
    ),
    importPackage: vi.fn<DeepWriteApi["libraryPackage"]["importPackage"]>(
      async () => ({
        domain: "material",
        libraryIds: ["material-new"],
        entryCount: 2,
        groupId: "group-new"
      })
    ),
    discardPreview: vi.fn(async () => undefined)
  };
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const prepare = vi.fn(async (_ids: ReadonlySet<string>) => true);
  const navigate = vi.fn(async (_id: string) => undefined);
  const mutationPending = ref(false);
  const coordinator = useLibraryPackageCoordinator({
    api: () => (options.packageApiAvailable === false ? undefined : api),
    isDesktop: () => options.desktop ?? true,
    snapshot: ref({
      materialGroups: [
        {
          id: "group-1",
          title: "都市素材组",
          members: { character: "material-1", plot: "material-2" },
          createdAt: "2026-10-09T08:00:00.000Z",
          updatedAt: "2026-10-09T08:00:00.000Z"
        }
      ],
      skillGroups: []
    } as unknown as CatalogIndexSnapshot),
    documents: shallowRef([
      { id: "doc-new", libraryId: "material-new" } as WorkspaceDocument
    ]),
    mutationPending,
    prepareProjectsForExport: prepare,
    refreshCatalog: vi.fn(async () => true),
    refreshWorkspaceDirectory: vi.fn(async () => undefined),
    navigateToDocumentResource: navigate,
    notifications
  });
  return {
    api,
    notifications,
    prepare,
    navigate,
    mutationPending,
    coordinator
  };
}

const groupNode = {
  id: "group-node",
  label: "都市素材组",
  groupId: "group-1"
} as ResourceTreeNode;

describe("useLibraryPackageCoordinator", () => {
  it.each(["material", "skill"] as const)(
    "asks to restart an older desktop bridge for %s import and export",
    async (domain) => {
      const { api, prepare, notifications, coordinator } = harness({
        packageApiAvailable: false
      });
      await coordinator.exportPackage({
        domain,
        action: "export-library",
        node: { id: "n", label: "资料库", libraryId: "library-1" }
      });
      coordinator.openImport(domain);

      expect(notifications.warning.mock.calls).toEqual([
        ["资料库导入导出功能尚未就绪，请完整退出并重新启动 DeepWrite 后重试。"],
        ["资料库导入导出功能尚未就绪，请完整退出并重新启动 DeepWrite 后重试。"]
      ]);
      expect(prepare).not.toHaveBeenCalled();
      expect(api.exportPackage).not.toHaveBeenCalled();
      expect(coordinator.importDialog.value).toBeNull();
    }
  );

  it("keeps the browser preview notices when there is no desktop bridge", async () => {
    const { notifications, coordinator } = harness({
      packageApiAvailable: false,
      desktop: false
    });
    await coordinator.exportPackage({
      domain: "material",
      action: "export-group",
      node: groupNode
    });
    coordinator.openImport("skill");

    expect(notifications.warning.mock.calls).toEqual([
      ["浏览器预览不能导出本地资料库，请使用桌面客户端。"],
      ["浏览器预览不能导入本地文件，请使用桌面客户端。"]
    ]);
    expect(coordinator.importDialog.value).toBeNull();
  });

  it("saves member drafts before exporting a group", async () => {
    const { api, prepare, notifications, coordinator } = harness();
    await coordinator.exportPackage({
      domain: "material",
      action: "export-group",
      node: groupNode
    });
    expect([...prepare.mock.calls[0]![0]]).toEqual([
      "material-1",
      "material-2"
    ]);
    expect(api.exportPackage).toHaveBeenCalledWith({
      domain: "material",
      target: { type: "group", id: "group-1" }
    });
    expect(notifications.success).toHaveBeenCalledWith(
      expect.stringContaining("/导出/都市素材组.zip")
    );
  });

  it("does not export when drafts cannot be saved or the picker is cancelled", async () => {
    const { api, prepare, notifications, coordinator } = harness();
    prepare.mockResolvedValueOnce(false);
    const payload = {
      domain: "material" as const,
      action: "export-library" as const,
      node: {
        id: "n",
        label: "人设",
        libraryId: "material-1"
      } as ResourceTreeNode
    };
    await coordinator.exportPackage(payload);
    expect(api.exportPackage).not.toHaveBeenCalled();
    api.exportPackage.mockResolvedValueOnce({ status: "cancelled" });
    await coordinator.exportPackage(payload);
    expect(notifications.success).not.toHaveBeenCalled();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("previews, imports and selects the first new library", async () => {
    const { api, navigate, notifications, mutationPending, coordinator } =
      harness();
    coordinator.openImport("material");
    await coordinator.chooseSource("zip");
    expect(coordinator.importDialog.value?.preview).toEqual(preview);
    const choices = {
      libraries: [{ key: "lib-1", include: true, title: "都市人设" }],
      createGroup: true
    };
    const pending = coordinator.submitImport(choices);
    expect(coordinator.importing.value).toBe(true);
    expect(mutationPending.value).toBe(true);
    await pending;
    expect(api.importPackage).toHaveBeenCalledWith({
      previewId: "preview-1",
      choices
    });
    expect(coordinator.importDialog.value).toBeNull();
    expect(navigate).toHaveBeenCalledWith("doc-new");
    expect(notifications.success).toHaveBeenCalledOnce();
    expect(mutationPending.value).toBe(false);
  });

  it("returns to source selection when the source changed", async () => {
    const { api, notifications, coordinator } = harness();
    coordinator.openImport("skill");
    await coordinator.chooseSource("directory");
    api.importPackage.mockRejectedValueOnce({
      code: "catalog.package_source_changed",
      message: "来源在识别后发生了变化，请重新选择。"
    });
    await coordinator.submitImport({
      libraries: [{ key: "lib-1", include: true, title: "都市人设" }],
      createGroup: false
    });
    expect(coordinator.importDialog.value).toEqual({ domain: "skill" });
    expect(notifications.warning).toHaveBeenCalledOnce();
  });

  it("shows the reason when recognition fails and releases previews on close", async () => {
    const { api, notifications, coordinator } = harness();
    coordinator.openImport("material");
    api.chooseSource.mockRejectedValueOnce({
      code: "catalog.library_package_failed",
      message: "没有找到可导入的 .md、.markdown 或 .txt 文件。"
    });
    await coordinator.chooseSource("directory");
    expect(notifications.error).toHaveBeenCalledWith(
      expect.stringContaining("没有找到可导入的")
    );
    await coordinator.chooseSource("zip");
    coordinator.closeImport();
    expect(api.discardPreview).toHaveBeenCalledWith({ previewId: "preview-1" });
    expect(coordinator.importDialog.value).toBeNull();
  });
});
