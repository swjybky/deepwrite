import {
  type LongBookSummary,
  type LongFileId,
  type LongListBooksResult,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import type {
  LongWorkspaceRendererApi,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import {
  isLongWorkspaceEditorPort,
  useLongWorkspaceSessionCoordinator,
  type LongWorkspaceEditorPort
} from "./useLongWorkspaceSessionCoordinator";

const NOW = "2026-08-14T08:00:00.000Z";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

function index(bookId: string, sequence = 1): LongWorkspaceIndexSnapshot {
  const stableBookId = bookId.startsWith("longbook_")
    ? bookId
    : `longbook_${bookId.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
  return {
    schemaVersion: 1,
    bookId: stableBookId,
    updatedAt: `2026-08-14T08:00:0${sequence}.000Z`,
    worldbuilding: [],
    characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷",
          order: 1,
          summary: ""
        }
      ],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: { committedThroughChapterId: null, commits: [] }
  } as unknown as LongWorkspaceIndexSnapshot;
}

function summary(bookId: string, sequence = 1): LongBookSummary {
  return {
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: bookId,
    title: `长篇 ${bookId}`,
    bookType: "long",
    genre: "测试",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
    createdAt: NOW,
    updatedAt: `2026-08-14T08:00:0${sequence}.000Z`,
    navigation: {
      schemaVersion: 1,
      bookId,
      updatedAt: `2026-08-14T08:00:0${sequence}.000Z`,
      worldbuilding: [],
      characterTypes: [],
      characters: [],
      volumes: [],
      arcs: [],
      chapterCards: [],
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        arcs: 0,
        volumes: 0,
        chapterCards: 0,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      committedThroughChapterId: null
    }
  };
}

function listResult(
  books: readonly LongBookSummary[],
  diagnostics: LongListBooksResult["diagnostics"] = []
): LongListBooksResult {
  return {
    updatedAt: NOW,
    books: [...books],
    diagnostics
  };
}

function selection(
  key: string,
  files: LongWorkspaceSelection["files"] = [],
  preferredFileId?: LongFileId
): LongWorkspaceSelection {
  return {
    key,
    root: "worldbuilding",
    title: key,
    breadcrumbs: [key],
    files,
    preferredRole: "content",
    ...(preferredFileId ? { preferredFileId } : {})
  };
}

function editorPort(overrides: Partial<LongWorkspaceEditorPort> = {}) {
  return {
    saveAllChanges: vi.fn(async () => true),
    selectBookLineVolume: vi.fn(),
    focusFile: vi.fn(async () => true),
    focusTarget: vi.fn(async () => true),
    locateEditorReference: vi.fn(async () => true),
    captureNavigationSelection: vi.fn(() => ({})),
    captureForeshadowingFocus: vi.fn(() => ({
      threadId: null,
      beatId: null
    })),
    ensureDocumentsLoaded: vi.fn(async () => true),
    ...overrides
  } satisfies LongWorkspaceEditorPort;
}

function createHarness(apiOverrides: Record<string, unknown> = {}) {
  const store = useLongWorkspaceStore();
  const refs = storeToRefs(store);
  const api = {
    list: vi.fn(async () => listResult([])),
    open: vi.fn(),
    getWorkspaceIndex: vi.fn(),
    ...apiOverrides
  };
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const prepareOpenDependencies = vi.fn(async () => undefined);
  const activateProposalBook = vi.fn();
  const synchronizeSelectedResourceForLayout = vi.fn();
  const selectFallbackAfterClear = vi.fn(async () => undefined);
  const coordinator = useLongWorkspaceSessionCoordinator({
    store,
    state: {
      longBooks: refs.longBooks,
      activeBookId: refs.activeBookId,
      activeBookSummary: refs.activeBookSummary,
      workspaceIndex: refs.workspaceIndex,
      selection: refs.selection,
      fileContext: refs.fileContext,
      refreshStatus: refs.refreshStatus,
      activeRefreshStatus: refs.activeRefreshStatus
    },
    api: () => api as unknown as LongWorkspaceRendererApi,
    isWorkspaceActive: () => false,
    prepareOpenDependencies,
    activateProposalBook,
    synchronizeSelectedResourceForLayout,
    selectFallbackAfterClear,
    notifications,
    scheduler: {
      setTimeout: (task, delayMs) => setTimeout(task, delayMs),
      clearTimeout: (handle) => clearTimeout(handle)
    }
  });
  return {
    activateProposalBook,
    api,
    coordinator,
    notifications,
    prepareOpenDependencies,
    refs,
    selectFallbackAfterClear,
    store,
    synchronizeSelectedResourceForLayout
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("long workspace session coordinator", () => {
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
    const pendingOpen = deferred<{
      book: { workspaceIndex: LongWorkspaceIndexSnapshot };
      summary: LongBookSummary;
    }>();
    const harness = createHarness({
      open: vi.fn(() => pendingOpen.promise)
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
    expect(harness.api.open).not.toHaveBeenCalled();
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

    pendingOpen.resolve({
      book: { workspaceIndex: index("longbook_b", 2) },
      summary: summary("longbook_b", 2)
    });
    await opening;
    expect(harness.refs.workspaceIndex.value?.updatedAt).toBe(
      "2026-08-14T08:00:02.000Z"
    );
    expect(harness.prepareOpenDependencies).toHaveBeenCalledOnce();
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

  it("invalidates and clears the active session before selecting a fallback", async () => {
    const harness = createHarness();
    harness.store.publishBook(summary("longbook_a"), index("longbook_a"));

    await harness.coordinator.clearActiveBook("longbook_a");
    expect(harness.refs.activeBookId.value).toBeNull();
    expect(harness.refs.workspaceIndex.value).toBeNull();
    expect(harness.selectFallbackAfterClear).toHaveBeenCalledOnce();
  });
});
