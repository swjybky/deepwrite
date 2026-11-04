import type {
  LongBookSummary,
  LongFileId,
  LongListBooksResult,
  LongWorkspaceIndexSnapshot,
  LongWriteDocumentResult
} from "@deepwrite/contracts";
import { storeToRefs } from "pinia";
import { vi } from "vitest";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import type {
  LongWorkspaceRendererApi,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import {
  useLongWorkspaceSessionCoordinator,
  type LongWorkspaceEditorPort
} from "./useLongWorkspaceSessionCoordinator";

export const NOW = "2026-08-14T08:00:00.000Z";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

export function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

export function index(
  bookId: string,
  sequence = 1
): LongWorkspaceIndexSnapshot {
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

export function summary(bookId: string, sequence = 1): LongBookSummary {
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

export function savedResult(bookId: string): LongWriteDocumentResult {
  return {
    bookId,
    file: { id: "long_file_chapter_body" },
    summary: summary(bookId, 2)
  } as unknown as LongWriteDocumentResult;
}

export function listResult(
  books: readonly LongBookSummary[],
  diagnostics: LongListBooksResult["diagnostics"] = []
): LongListBooksResult {
  return {
    updatedAt: NOW,
    books: [...books],
    diagnostics
  };
}

export function selection(
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

export function editorPort(overrides: Partial<LongWorkspaceEditorPort> = {}) {
  return {
    saveAllChanges: vi.fn(async () => true),
    hasUnsavedEdits: vi.fn(() => false),
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

export function createHarness(apiOverrides: Record<string, unknown> = {}) {
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
