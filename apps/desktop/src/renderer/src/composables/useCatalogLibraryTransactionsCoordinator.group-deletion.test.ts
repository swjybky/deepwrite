import { describe, expect, it, vi } from "vitest";
import type { ResourceTreeNode } from "../types/workspace";
import {
  NOW,
  createHarness,
  action,
  workspaceDocument
} from "./useCatalogLibraryTransactionsCoordinator.test-support";

function groupNode(): ResourceTreeNode {
  return {
    id: "node:group-a",
    label: "待删除分组",
    catalogNodeType: "group",
    groupId: "group-a",
    projectRevision: 3,
    children: [
      {
        id: "library-a",
        label: "成员库",
        libraryId: "library-a",
        children: [{ id: "document-a", label: "成员条目" }]
      }
    ]
  };
}

describe("catalog group deletion", () => {
  it.each(["material", "skill"] as const)(
    "confirms %s group deletion and clears only the deleted members' drafts and conversations",
    async (domain) => {
      const harness = createHarness({
        documents: [
          workspaceDocument("document-b", domain, "library-b", "entry-b")
        ],
        drafts: {
          "document-a": { title: "待删除", content: "草稿 A", dirty: true },
          "document-b": { title: "待删除", content: "草稿 B", dirty: true },
          "document-keep": { title: "保留", content: "其他草稿", dirty: true }
        }
      });
      harness.apiMocks.deleteProject.mockResolvedValue({
        deleted: true,
        deletedMemberLibraryIds: ["library-a", "library-b"]
      });

      harness.coordinator.handleResourceNodeAction(
        action(domain, "delete-group", groupNode())
      );
      expect(harness.apiMocks.deleteProject).not.toHaveBeenCalled();
      expect(harness.coordinator.libraryRemovalDialog.value?.action).toBe(
        "delete"
      );
      harness.coordinator.confirmLibraryRemoval();
      harness.coordinator.confirmLibraryRemoval();

      await vi.waitFor(() => {
        expect(harness.coordinator.libraryRemovalDialog.value).toBeNull();
      });
      expect(harness.apiMocks.deleteProject).toHaveBeenCalledExactlyOnceWith({
        domain: `${domain}-group`,
        projectId: "group-a",
        baseProjectRevision: 3
      });
      expect(harness.drafts.value).toEqual({
        "document-keep": { title: "保留", content: "其他草稿", dirty: true }
      });
      expect(harness.disposeLibraryConversation.mock.calls).toEqual([
        [domain, "library-a"],
        [domain, "library-b"]
      ]);
      expect(harness.refreshCatalog).toHaveBeenCalledOnce();
      expect(harness.refreshWorkspaceDirectory).toHaveBeenCalledOnce();
      expect(harness.notifications.success).toHaveBeenCalledWith(
        "已删除分组“待删除分组”及 2 个成员库的本地文件夹"
      );
      expect(harness.mutationPending.value).toBe(false);
    }
  );

  it("leaves files, drafts, and the confirmation open when deletion fails", async () => {
    const harness = createHarness({
      drafts: { "document-a": { title: "保留", content: "草稿", dirty: true } }
    });
    harness.apiMocks.deleteProject.mockRejectedValue({
      message: "目录无法写入"
    });
    harness.coordinator.handleResourceNodeAction(
      action("material", "delete-group", groupNode())
    );
    harness.coordinator.confirmLibraryRemoval();

    await vi.waitFor(() =>
      expect(harness.notifications.error).toHaveBeenCalled()
    );
    expect(harness.coordinator.libraryRemovalDialog.value).not.toBeNull();
    expect(harness.drafts.value["document-a"]?.content).toBe("草稿");
    expect(harness.disposeLibraryConversation).not.toHaveBeenCalled();
    expect(harness.refreshCatalog).not.toHaveBeenCalled();
    expect(harness.notifications.success).not.toHaveBeenCalled();
    expect(harness.mutationPending.value).toBe(false);
  });

  it("refreshes a changed group and requires the new members to be reviewed", async () => {
    const harness = createHarness({
      materialGroups: [
        {
          id: "group-a",
          title: "待删除分组",
          memberIds: [],
          projectRevision: 4,
          createdAt: NOW,
          updatedAt: NOW
        }
      ]
    });
    harness.apiMocks.deleteProject.mockRejectedValue(harness.conflictError);
    harness.coordinator.handleResourceNodeAction(
      action("material", "delete-group", groupNode())
    );
    harness.coordinator.confirmLibraryRemoval();

    await vi.waitFor(() =>
      expect(harness.notifications.warning).toHaveBeenCalled()
    );
    expect(harness.apiMocks.deleteProject).toHaveBeenCalledWith({
      domain: "material-group",
      projectId: "group-a",
      baseProjectRevision: 4
    });
    expect(harness.refreshCatalog).toHaveBeenCalledOnce();
    expect(harness.coordinator.libraryRemovalDialog.value).toBeNull();
    expect(harness.disposeLibraryConversation).not.toHaveBeenCalled();
    expect(harness.mutationPending.value).toBe(false);
  });

  it("keeps dissolving a group separate from permanent deletion", async () => {
    const harness = createHarness();
    harness.apiMocks.unregisterProject.mockResolvedValue({
      unregistered: true
    });
    harness.coordinator.handleResourceNodeAction(
      action("skill", "dissolve-group", groupNode())
    );

    await vi.waitFor(() =>
      expect(harness.refreshCatalog).toHaveBeenCalledOnce()
    );
    expect(harness.apiMocks.unregisterProject).toHaveBeenCalledWith({
      domain: "skill-group",
      projectId: "group-a"
    });
    expect(harness.apiMocks.deleteProject).not.toHaveBeenCalled();
    expect(harness.disposeLibraryConversation).not.toHaveBeenCalled();
    expect(harness.coordinator.libraryRemovalDialog.value).toBeNull();
  });

  it("rejects a group action without a group id", () => {
    const harness = createHarness();
    harness.coordinator.handleResourceNodeAction(
      action("material", "delete-group", {
        id: "invalid",
        label: "无效分组",
        catalogNodeType: "group"
      })
    );
    expect(harness.coordinator.libraryRemovalDialog.value).toBeNull();
    expect(harness.apiMocks.deleteProject).not.toHaveBeenCalled();
    expect(harness.notifications.error).toHaveBeenCalledWith(
      "未找到对应的分组"
    );
  });
});
