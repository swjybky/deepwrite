import { shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongLedgerCommitDeleteTarget } from "../stores/longWorkspaceStore";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import type { ResourceTreeNode } from "../types/workspace";
import { useLongLedgerCommitDeletionCoordinator } from "./useLongLedgerCommitDeletionCoordinator";

function indexFixture(
  commitIds: readonly string[] = ["commit_first", "commit_latest"]
): LongWorkspaceIndexSnapshot {
  return {
    bookId: "longbook_delete",
    ledger: {
      commits: commitIds.map((id, index) => ({
        id,
        mode: id === "commit_latest" ? "text_files_batch" : "text_files",
        sequence: index + 1,
        chapterCardId: id === "commit_latest" ? "chapter_two" : "chapter_one",
        ...(id === "commit_latest"
          ? {
              chapterCardIds: ["chapter_one", "chapter_two"],
              checkpointChapterCardId: "chapter_two"
            }
          : {}),
        committedAt: "2026-09-02T00:00:00.000Z",
        placementIds: [],
        foreshadowingBeatIds: [],
        recordFile: {
          id: `file_${id}:ledger-record`,
          path: `long/ledger/${id}.json`,
          updatedAt: "2026-09-02T00:00:00.000Z"
        }
      }))
    }
  } as unknown as LongWorkspaceIndexSnapshot;
}

function nodeFixture(commitId: string, deletable: boolean): ResourceTreeNode {
  return {
    id: `node_${commitId}`,
    label: commitId === "commit_latest" ? "第一至二章" : "第一章",
    workspaceType: "long",
    longBookId: "longbook_delete",
    longLedgerCommit: { id: commitId, deletable }
  };
}

function createHarness() {
  const activeBookId = shallowRef<string | null>("longbook_delete");
  const workspaceIndex = shallowRef<LongWorkspaceIndexSnapshot | null>(
    indexFixture()
  );
  const target = shallowRef<LongLedgerCommitDeleteTarget | null>(null);
  const pending = shallowRef(false);
  const deleteLedgerCommit = vi.fn(async () => ({
    bookId: "longbook_delete",
    deletedCommitId: "commit_latest",
    chapterCardIds: ["chapter_one", "chapter_two"]
  }));
  const api = { deleteLedgerCommit } as unknown as LongWorkspaceRendererApi;
  const saveActiveEditorChanges = vi.fn(async () => true);
  const refreshActiveWorkspace = vi.fn(async () => true);
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const coordinator = useLongLedgerCommitDeletionCoordinator({
    api: () => api,
    activeBookId,
    workspaceIndex,
    target,
    pending,
    saveActiveEditorChanges,
    refreshActiveWorkspace,
    notifications
  });
  return {
    coordinator,
    refs: { activeBookId, workspaceIndex, target, pending },
    api,
    deleteLedgerCommit,
    saveActiveEditorChanges,
    refreshActiveWorkspace,
    notifications
  };
}

describe("useLongLedgerCommitDeletionCoordinator", () => {
  it("only opens the confirmation target for the current last record", () => {
    const test = createHarness();
    test.coordinator.request(nodeFixture("commit_first", false));
    expect(test.refs.target.value).toBeNull();
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "请先删除最后一条提交记录。"
    );

    test.coordinator.request(nodeFixture("commit_latest", true));
    expect(test.refs.target.value).toEqual({
      bookId: "longbook_delete",
      commitId: "commit_latest",
      title: "第一至二章",
      chapterCardIds: ["chapter_one", "chapter_two"]
    });
  });

  it("saves, refreshes and revalidates order before deletion", async () => {
    const test = createHarness();
    test.coordinator.request(nodeFixture("commit_latest", true));
    test.refreshActiveWorkspace.mockImplementationOnce(async () => {
      test.refs.workspaceIndex.value = indexFixture([
        "commit_first",
        "commit_newer"
      ]);
      return true;
    });

    await test.coordinator.confirm();

    expect(test.saveActiveEditorChanges).toHaveBeenCalledTimes(1);
    expect(test.refreshActiveWorkspace).toHaveBeenCalledTimes(1);
    expect(test.deleteLedgerCommit).not.toHaveBeenCalled();
    expect(test.refs.target.value).toBeNull();
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "提交记录顺序已经变化，请重新选择最后一条记录。"
    );
    expect(test.refs.pending.value).toBe(false);
  });

  it("prevents duplicate confirmation and refreshes the workspace after success", async () => {
    const test = createHarness();
    test.coordinator.request(nodeFixture("commit_latest", true));
    let releaseSave: ((saved: boolean) => void) | undefined;
    test.saveActiveEditorChanges.mockImplementationOnce(
      async () =>
        await new Promise<boolean>((resolve) => {
          releaseSave = resolve;
        })
    );

    const first = test.coordinator.confirm();
    const duplicate = test.coordinator.confirm();
    expect(test.refs.pending.value).toBe(true);
    expect(test.saveActiveEditorChanges).toHaveBeenCalledTimes(1);
    await duplicate;
    releaseSave?.(true);
    await first;

    expect(test.deleteLedgerCommit).toHaveBeenCalledTimes(1);
    expect(test.deleteLedgerCommit).toHaveBeenCalledWith({
      bookId: "longbook_delete",
      commitId: "commit_latest"
    });
    expect(test.refreshActiveWorkspace).toHaveBeenCalledTimes(2);
    expect(test.notifications.success).toHaveBeenCalledWith(
      "提交记录已删除，2 个章节已回到待提交状态。"
    );
    expect(test.refs.target.value).toBeNull();
    expect(test.refs.pending.value).toBe(false);
  });

  it("reports a completed deletion distinctly when the final refresh fails", async () => {
    const test = createHarness();
    test.coordinator.request(nodeFixture("commit_latest", true));
    test.refreshActiveWorkspace
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await test.coordinator.confirm();

    expect(test.deleteLedgerCommit).toHaveBeenCalledTimes(1);
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "提交记录已删除，但界面未能同步最新状态；请重新打开长篇。"
    );
    expect(test.notifications.error).not.toHaveBeenCalled();
  });
});
