import { shallowRef } from "vue";
import { createPinia, disposePinia, storeToRefs } from "pinia";
import { describe, expect, it, vi } from "vitest";
import {
  LongWorkspaceIndexSnapshotSchema,
  type LongListBooksResult,
  type LongResolveConflictsResult
} from "@deepwrite/contracts";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import { useLongConflictResolution } from "./useLongConflictResolution";
import { useLongWorkspaceRefreshCoordinator } from "./useLongWorkspaceRefreshCoordinator";
import { createUnusedLongApi } from "./unusedLongApi.test-support";

type Options = Parameters<typeof useLongConflictResolution>[0];
function fixture(activeBookId = "longbook_a") {
  const result = {
    book: { id: "longbook_a" },
    summary: { id: "longbook_a", updatedAt: "2026-09-11T00:00:00.000Z" },
    resolvedPaths: ["long/index.json"],
    backupPath: ".deepwrite/conflict-backups/test"
  } as LongResolveConflictsResult;
  const resolveConflicts = vi.fn(async () => result);
  const refreshActiveWorkspace = vi.fn(async () => true);
  const saveActiveEditorChanges = vi.fn(async () => false);
  const state = {
    activeBookId: shallowRef(activeBookId),
    longBooks: shallowRef([]),
    bookActionPending: shallowRef(false),
    mutationPending: shallowRef(false)
  } as unknown as Options["state"];
  const notifications = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  };
  const stopBookAgentRuns = vi.fn(async () => undefined);
  let disposed = false;
  const options = {
    state,
    notifications,
    isDisposed: () => disposed,
    api: () => ({ resolveConflicts }),
    workflow: { stopBookAgentRuns },
    session: {
      refreshActiveWorkspace,
      saveActiveEditorChanges,
      invalidateWorkspaceRefresh: vi.fn()
    },
    catalog: {
      loadBookList: vi.fn(async () => undefined),
      refreshWorkspaceDirectory: vi.fn(async () => undefined)
    },
    runTracked: async (task: () => Promise<void>) => await task()
  } as unknown as Options;
  return {
    options,
    result,
    state,
    notifications,
    resolveConflicts,
    refreshActiveWorkspace,
    saveActiveEditorChanges,
    stopBookAgentRuns,
    run: useLongConflictResolution(options),
    dispose: () => {
      disposed = true;
    }
  };
}

describe("long conflict recovery action", () => {
  it("discards a pre-repair unavailable list response before refreshing the active workspace", async () => {
    const f = fixture();
    const pinia = createPinia();
    const store = useLongWorkspaceStore(pinia);
    const refs = storeToRefs(store);
    const bookId = f.result.summary.id;
    const index = LongWorkspaceIndexSnapshotSchema.parse({
      schemaVersion: 1,
      bookId,
      updatedAt: f.result.summary.updatedAt,
      bookLine: {
        id: "file_long-book-line",
        path: "long/plot/book-line.md",
        updatedAt: f.result.summary.updatedAt
      },
      worldbuilding: [],
      characters: [],
      characterFiles: [],
      plot: {
        volumes: [],
        arcs: [],
        chapterCards: [],
        storyEvents: [],
        storyPlots: [],
        foreshadowing: [],
        eventConnections: [],
        narrativePlacements: []
      },
      chapters: [],
      ledger: { committedThroughChapterId: null, commits: [] }
    });
    store.publishBook(f.result.summary, index);
    let releaseOldList!: (result: LongListBooksResult) => void;
    const oldResponse = new Promise<LongListBooksResult>((resolve) => {
      releaseOldList = resolve;
    });
    const oldRequest = store.ensureBookList(() => oldResponse);
    const refresh = useLongWorkspaceRefreshCoordinator({
      state: refs,
      api: () => ({
        ...createUnusedLongApi(),
        async getWorkspaceIndex() {
          releaseOldList({
            updatedAt: index.updatedAt,
            books: [],
            diagnostics: [
              { bookId, code: "invalid", message: "项目文件已在其他位置更新" }
            ]
          });
          await oldRequest;
          return { bookId, workspaceIndex: index };
        }
      }),
      isDisposed: () => false,
      synchronizeSelectedResourceForLayout: vi.fn(),
      notifications: f.notifications
    });
    try {
      await useLongConflictResolution({
        ...f.options,
        state: { ...f.options.state, ...refs },
        session: {
          ...f.options.session,
          refreshActiveWorkspace: refresh.refreshActiveWorkspace
        },
        catalog: {
          ...f.options.catalog,
          async loadBookList(options) {
            if (options?.force) store.invalidateBookList();
            await store.ensureBookList(async () => ({
              updatedAt: index.updatedAt,
              books: [f.result.summary]
            }));
          }
        }
      })(bookId);
      expect(store.activeBookSummary?.id).toBe(bookId);
      expect(store.workspaceIndex).toEqual(index);
      expect(store.longCatalogDiagnostics).toEqual([]);
      expect(f.notifications.error).not.toHaveBeenCalled();
      expect(f.notifications.warning).not.toHaveBeenCalled();
      expect(f.notifications.success).toHaveBeenCalledOnce();
    } finally {
      disposePinia(pinia);
    }
  });

  it("repairs before refreshing without invoking the blocked save or dropping editor drafts", async () => {
    const f = fixture();
    await f.run("longbook_a");
    expect(f.stopBookAgentRuns).toHaveBeenCalledWith("longbook_a");
    expect(f.resolveConflicts).toHaveBeenCalledWith({ bookId: "longbook_a" });
    expect(f.refreshActiveWorkspace).toHaveBeenCalledWith("longbook_a");
    expect(f.saveActiveEditorChanges).not.toHaveBeenCalled();
    expect(f.notifications.success).toHaveBeenCalledWith(
      expect.stringContaining("已解决 1 处")
    );
    expect(f.state.mutationPending.value).toBe(false);
    expect(f.state.bookActionPending.value).toBe(false);
  });

  it("repairs unavailable inactive books without navigating away from the editor", async () => {
    const f = fixture("longbook_b");
    await f.run("longbook_a");
    expect(f.resolveConflicts).toHaveBeenCalledOnce();
    expect(f.refreshActiveWorkspace).not.toHaveBeenCalled();
    expect(f.state.activeBookId.value).toBe("longbook_b");
  });

  it("deduplicates repeated clicks and releases pending state after failure", async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    f.resolveConflicts.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    const first = f.run("longbook_a");
    await vi.waitFor(() => expect(f.resolveConflicts).toHaveBeenCalledOnce());
    await f.run("longbook_a");
    reject(new Error("索引不是有效 JSON"));
    await first;
    expect(f.resolveConflicts).toHaveBeenCalledOnce();
    expect(f.notifications.error).toHaveBeenCalledWith(
      expect.stringContaining("索引不是有效 JSON")
    );
    expect(f.state.bookActionPending.value).toBe(false);
  });

  it("distinguishes a completed repair from a refresh failure", async () => {
    const f = fixture();
    f.refreshActiveWorkspace.mockResolvedValueOnce(false);
    await f.run("longbook_a");
    expect(f.notifications.warning).toHaveBeenCalledWith(
      expect.stringContaining("文件冲突已解决")
    );
    expect(f.notifications.success).not.toHaveBeenCalled();
  });
});
