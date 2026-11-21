import {
  createLongWorkspaceNavigationSnapshot,
  type LongFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLongWorkspaceEditorPort,
  type LongWorkspaceEditorPort
} from "./useLongWorkspaceSessionCoordinator";
import {
  NOW,
  createHarness,
  deferred,
  editorPort,
  flushMicrotasks,
  index,
  listResult,
  savedResult,
  selection,
  summary
} from "./useLongWorkspaceSessionCoordinator.test-support";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("long workspace session coordinator", () => {
  it.each(["response", "index", "metadata", "version"])(
    "preserves the current workspace when the refreshed %s does not match",
    async (mismatch) => {
      const freshIndex = index("longbook_a", 2);
      const { navigation: _navigation, ...metadata } = summary("longbook_a", 2);
      const result = {
        bookId: "longbook_a",
        workspaceIndex: freshIndex,
        metadata
      };
      if (mismatch === "response") result.bookId = "longbook_b";
      if (mismatch === "index") result.workspaceIndex.bookId = "longbook_b";
      if (mismatch === "metadata") result.metadata.id = "longbook_b";
      if (mismatch === "version") result.metadata.updatedAt = NOW;
      const harness = createHarness({
        getWorkspaceIndex: vi.fn(async () => result)
      });
      const currentSummary = summary("longbook_a");
      const currentIndex = index("longbook_a");
      harness.store.publishBook(currentSummary, currentIndex);

      await expect(
        harness.coordinator.refreshActiveWorkspace("longbook_a")
      ).resolves.toBe(false);

      expect(harness.refs.activeBookSummary.value).toBe(currentSummary);
      expect(harness.refs.workspaceIndex.value).toBe(currentIndex);
      expect(harness.notifications.error).toHaveBeenCalledOnce();
    }
  );

  it.each(["refreshOnWindowFocus", "refreshAfterBackgroundWrite"] as const)(
    "%s publishes authoritative metadata together with the refreshed directory",
    async (refresh) => {
      const freshIndex = index("longbook_a", 2);
      const { navigation: _navigation, ...metadata } = {
        ...summary("longbook_a", 2),
        title: "外部更新的作品名称",
        linkedSkillIdsByKind: {
          general: ["skill_current"],
          plot: [],
          style: [],
          other: []
        }
      };
      const harness = createHarness({
        getWorkspaceIndex: vi.fn(async () => ({
          bookId: "longbook_a",
          workspaceIndex: freshIndex,
          metadata
        }))
      });
      harness.store.publishBook(summary("longbook_a"), index("longbook_a"));

      await harness.coordinator[refresh]("longbook_a");

      expect(harness.refs.activeBookSummary.value).toEqual({
        ...metadata,
        navigation: createLongWorkspaceNavigationSnapshot(freshIndex)
      });
      expect(harness.refs.activeRefreshStatus.value).toBeNull();
      expect(harness.notifications.error).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    "opens with authoritative metadata from the index response (listed: %s)",
    async (listed) => {
      const freshIndex = index("longbook_a", 2);
      const freshSummary = {
        ...summary("longbook_a", 2),
        title: "外部更新的作品名称",
        navigation: createLongWorkspaceNavigationSnapshot(freshIndex),
        linkedSkillIdsByKind: {
          general: ["skill_current"],
          plot: [],
          style: [],
          other: []
        }
      };
      const { navigation: _navigation, ...metadata } = freshSummary;
      const harness = createHarness({
        getWorkspaceIndex: vi.fn(async () => ({
          bookId: "longbook_a",
          workspaceIndex: freshIndex,
          metadata
        }))
      });
      if (listed)
        harness.store.publishBookList(listResult([summary("longbook_a")]));

      await harness.coordinator.openBook("longbook_a");

      expect(harness.refs.activeBookSummary.value).toEqual(freshSummary);
      expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
        freshSummary.updatedAt
      );
      expect(harness.notifications.error).not.toHaveBeenCalled();
      expect(harness.api.open).not.toHaveBeenCalled();
    }
  );

  it("rejects incomplete editor instances instead of calling a missing save method", async () => {
    const harness = createHarness();
    harness.store.publishBook(summary("longbook_a"), index("longbook_a"));
    const incompleteEditor = { focusFile: vi.fn() };

    expect(isLongWorkspaceEditorPort(incompleteEditor)).toBe(false);
    harness.coordinator.editor.value =
      incompleteEditor as unknown as LongWorkspaceEditorPort;

    await expect(harness.coordinator.saveActiveEditorChanges()).resolves.toBe(
      false
    );
    expect(harness.notifications.error).toHaveBeenCalledWith(
      "长篇编辑器尚未准备好，已取消当前操作，请重试。"
    );
  });

  it("saves before switching and publishes the requested selection before open settles", async () => {
    const pendingIndex = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi.fn(() => pendingIndex.promise)
    });
    harness.store.publishBookList(
      listResult([summary("longbook_a"), summary("longbook_b")])
    );
    harness.store.publishBook(summary("longbook_a"), index("longbook_a"));
    const saveAllChanges = vi.fn(async () => false);
    const currentEditor = editorPort({ saveAllChanges });
    harness.coordinator.editor.value = currentEditor;
    const requestedSelection = selection("worldbuilding:book-b");

    await harness.coordinator.openBook("longbook_b", requestedSelection);
    expect(harness.api.getWorkspaceIndex).not.toHaveBeenCalled();
    expect(harness.refs.activeBookId.value).toBe("longbook_a");

    saveAllChanges.mockResolvedValue(true);
    const opening = harness.coordinator.openBook(
      "longbook_b",
      requestedSelection
    );
    await flushMicrotasks();
    expect(harness.refs.activeBookId.value).toBe("longbook_b");
    expect(harness.refs.selection.value).toBe(requestedSelection);
    expect(harness.activateProposalBook).toHaveBeenCalledWith("longbook_b");

    pendingIndex.resolve({
      bookId: "longbook_b",
      workspaceIndex: index("longbook_b", 2)
    });
    await opening;
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:02.000Z"
    );
    expect(harness.prepareOpenDependencies).toHaveBeenCalledOnce();
    expect(harness.api.open).not.toHaveBeenCalled();
  });

  it("publishes only the latest refresh request and synchronizes layout", async () => {
    const first = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const second = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
        .mockResolvedValueOnce({
          bookId: "longbook_a",
          workspaceIndex: index("longbook_a", 2)
        })
    });
    harness.store.publishBook(summary("longbook_a", 1), index("longbook_a", 1));
    const staleRefresh =
      harness.coordinator.refreshActiveWorkspace("longbook_a");
    const currentRefresh =
      harness.coordinator.refreshActiveWorkspace("longbook_a");
    second.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 3)
    });
    await expect(currentRefresh).resolves.toBe(true);
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:03.000Z"
    );
    first.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 2)
    });
    await expect(staleRefresh).resolves.toBe(false);
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:03.000Z"
    );
    expect(harness.synchronizeSelectedResourceForLayout).toHaveBeenCalledOnce();

    await expect(
      harness.coordinator.refreshActiveWorkspace("longbook_a")
    ).resolves.toBe(true);
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:02.000Z"
    );
  });

  it("saves and preloads the preferred file before publishing a new selection", async () => {
    const order: string[] = [];
    const firstFileId = "long-file-first" as LongFileId;
    const preferredFileId = "long-file-preferred" as LongFileId;
    const currentEditor = editorPort({
      saveAllChanges: vi.fn(async () => {
        order.push("save");
        return true;
      }),
      ensureDocumentsLoaded: vi.fn(async (files) => {
        order.push(`load:${files[0]?.file.id}`);
        return true;
      })
    });
    const harness = createHarness();
    harness.store.publishBook(summary("longbook_a"), index("longbook_a"));
    harness.store.publishSelection("longbook_a", selection("old"));
    harness.coordinator.editor.value = currentEditor;
    const nextSelection = selection(
      "next",
      [
        {
          role: "content",
          label: "首文件",
          file: {
            id: firstFileId,
            path: "drafts/first.md",
            updatedAt: NOW
          }
        },
        {
          role: "content",
          label: "目标文件",
          file: {
            id: preferredFileId,
            path: "drafts/preferred.md",
            updatedAt: NOW
          }
        }
      ],
      preferredFileId
    );

    await expect(
      harness.coordinator.selectWorkspaceFile(nextSelection)
    ).resolves.toBe(true);
    expect(order).toEqual(["save", `load:${preferredFileId}`]);
    expect(harness.refs.selection.value).toBe(nextSelection);
  });

  it("deduplicates diagnostics and allows a resolved diagnostic to be reported again", async () => {
    const diagnostic = {
      bookId: "book-unavailable",
      code: "unavailable" as const,
      message: "测试项目暂时不可读"
    };
    const harness = createHarness({
      list: vi
        .fn()
        .mockResolvedValueOnce(listResult([], [diagnostic]))
        .mockResolvedValueOnce(listResult([], [diagnostic]))
        .mockResolvedValueOnce(listResult([], []))
        .mockResolvedValueOnce(listResult([], [diagnostic]))
    });

    await harness.coordinator.loadBookList({ notify: true, force: true });
    await harness.coordinator.loadBookList({ notify: true, force: true });
    await harness.coordinator.loadBookList({ notify: true, force: true });
    await harness.coordinator.loadBookList({ notify: true, force: true });
    expect(harness.notifications.warning).toHaveBeenCalledTimes(2);
  });

  it("retries silent book-list failures twice and cancels pending retry on dispose", async () => {
    const harness = createHarness({
      list: vi.fn(async () => {
        throw new Error("temporary list failure");
      })
    });

    await harness.coordinator.loadBookList({ notify: false });
    expect(harness.api.list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(harness.api.list).toHaveBeenCalledTimes(2);
    harness.coordinator.dispose();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(harness.api.list).toHaveBeenCalledTimes(2);
    expect(harness.refs.activeBookId.value).toBeNull();
  });

  it("keeps the shared long workspace usable when a replacement session mounts", async () => {
    const pendingSave = deferred<boolean>();
    const pendingRefresh = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const previous = createHarness({
      getWorkspaceIndex: vi.fn(() => pendingRefresh.promise)
    });
    previous.store.publishBook(summary("longbook_a"), index("longbook_a"));
    previous.store.publishSelection("longbook_a", selection("current"));
    previous.coordinator.editor.value = editorPort({
      saveAllChanges: vi.fn(() => pendingSave.promise)
    });
    const staleNavigation = previous.coordinator.selectWorkspaceFile(
      selection("stale")
    );
    const staleRefresh =
      previous.coordinator.refreshActiveWorkspace("longbook_a");

    previous.coordinator.dispose();
    const anotherBook = summary("longbook_b");
    const replacement = createHarness({
      list: vi.fn(async () => listResult([summary("longbook_a"), anotherBook]))
    });
    await replacement.coordinator.loadBookList({ notify: true, force: true });
    pendingSave.resolve(true);
    pendingRefresh.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a")
    });

    expect(await staleNavigation).toBe(false);
    expect(await staleRefresh).toBe(false);
    expect(replacement.store.longBooks).toContainEqual(anotherBook);
    expect(replacement.refs.activeBookId.value).toBe("longbook_a");
    expect(replacement.refs.selection.value?.key).toBe("current");
    expect(replacement.refs.activeRefreshStatus.value).toBeNull();
    expect(replacement.notifications.error).not.toHaveBeenCalled();
  });

  it("keeps the editor writable during a passive window-focus refresh", async () => {
    const pendingRefresh = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi.fn(() => pendingRefresh.promise)
    });
    harness.store.publishBook(summary("longbook_a", 1), index("longbook_a", 1));

    const refreshing = harness.coordinator.refreshOnWindowFocus("longbook_a");
    await flushMicrotasks();
    expect(harness.refs.activeRefreshStatus.value).toBeNull();

    pendingRefresh.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 1)
    });
    await refreshing;
    expect(harness.refs.activeRefreshStatus.value).toBeNull();
  });

  it("background writes publish current metadata without locking or saving the active editor", async () => {
    const response = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi.fn(() => response.promise)
    });
    const editor = editorPort();
    harness.coordinator.editor.value = editor;
    harness.store.publishBook(summary("longbook_a", 1), index("longbook_a", 1));
    const syncing =
      harness.coordinator.refreshAfterBackgroundWrite("longbook_a");
    await flushMicrotasks();
    expect(harness.refs.activeRefreshStatus.value).toBeNull();
    expect(editor.saveAllChanges).not.toHaveBeenCalled();
    response.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 2)
    });
    await expect(syncing).resolves.toBe(true);
    expect(
      harness.refs.longBooks.value.find(({ id }) => id === "longbook_a")
        ?.updatedAt
    ).toBe(index("longbook_a", 2).updatedAt);
    expect(harness.refs.activeRefreshStatus.value).toBeNull();
  });

  it("keeps the editor writable while refreshing after a document save", async () => {
    const pendingRefresh = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi.fn(() => pendingRefresh.promise)
    });
    harness.store.publishBook(summary("longbook_a", 1), index("longbook_a", 1));

    const refreshing = harness.coordinator.handleDocumentSaved(
      savedResult("longbook_a")
    );
    await flushMicrotasks();
    expect(harness.api.getWorkspaceIndex).toHaveBeenCalledOnce();
    expect(harness.refs.activeRefreshStatus.value).toBeNull();

    pendingRefresh.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 2)
    });
    await refreshing;
    expect(harness.refs.activeRefreshStatus.value).toBeNull();
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:02.000Z"
    );
  });

  it("coalesces saves that land during a refresh into one trailing read", async () => {
    const first = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
    }>();
    const harness = createHarness({
      getWorkspaceIndex: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({
          bookId: "longbook_a",
          workspaceIndex: index("longbook_a", 3)
        })
    });
    harness.store.publishBook(summary("longbook_a", 1), index("longbook_a", 1));

    const initial = harness.coordinator.handleDocumentSaved(
      savedResult("longbook_a")
    );
    const second = harness.coordinator.handleDocumentSaved(
      savedResult("longbook_a")
    );
    const third = harness.coordinator.handleDocumentSaved(
      savedResult("longbook_a")
    );
    await flushMicrotasks();
    expect(harness.api.getWorkspaceIndex).toHaveBeenCalledOnce();

    first.resolve({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 2)
    });
    await Promise.all([initial, second, third]);
    expect(harness.api.getWorkspaceIndex).toHaveBeenCalledTimes(2);
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:03.000Z"
    );
    expect(harness.refs.activeRefreshStatus.value).toBeNull();

    harness.api.getWorkspaceIndex.mockResolvedValueOnce({
      bookId: "longbook_a",
      workspaceIndex: index("longbook_a", 4)
    });
    await harness.coordinator.handleDocumentSaved(savedResult("longbook_a"));
    expect(harness.api.getWorkspaceIndex).toHaveBeenCalledTimes(3);
  });

  it("invalidates and clears the active session before selecting a fallback", async () => {
    const harness = createHarness();
    harness.store.publishBook(summary("longbook_a"), index("longbook_a"));

    await harness.coordinator.clearActiveBook("longbook_a");
    expect(harness.refs.activeBookId.value).toBeNull();
    expect(harness.refs.workspaceIndex.value).toBeNull();
    expect(harness.selectFallbackAfterClear).toHaveBeenCalledOnce();
  });
});
