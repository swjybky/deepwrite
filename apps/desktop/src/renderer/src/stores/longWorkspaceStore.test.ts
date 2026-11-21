import type {
  LongBookSummary,
  LongListBooksResult,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia, setActivePinia } from "pinia";
import { isReactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { useLongWorkspaceStore } from "./longWorkspaceStore";

const NOW = "2026-08-14T03:00:00.000Z";

function summary(
  bookId: string,
  _sequence = 1,
  _catalogSequence = _sequence
): LongBookSummary {
  return {
    id: bookId,
    title: `长篇 ${bookId}`,
    updatedAt: NOW,
    navigation: {
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
        foreshadowingThreads: 0,
        committedChapters: 0
      }
    }
  } as unknown as LongBookSummary;
}

function index(bookId: string, _sequence = 1): LongWorkspaceIndexSnapshot {
  return {
    schemaVersion: 1,
    bookId,
    updatedAt: NOW,
    worldbuilding: [],
    characterTypes: [],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [],
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

function selection(bookId: string): LongWorkspaceSelection {
  return {
    key: `selection:${bookId}`,
    root: "worldbuilding",
    title: `选择 ${bookId}`,
    breadcrumbs: [`长篇 ${bookId}`],
    files: [],
    preferredRole: "content"
  };
}

function listResult(...books: LongBookSummary[]): LongListBooksResult {
  return {
    updatedAt: NOW,
    books,
    diagnostics: []
  };
}

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

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("long workspace store", () => {
  it("publishes a book, index and selection as shallow values", () => {
    const store = useLongWorkspaceStore();
    const book = summary("book-a", 4, 7);
    const workspace = index("book-a", 4);
    const requestedSelection = selection("book-a");

    expect(store.publishBook(book, workspace, requestedSelection)).toBe(true);
    expect(store.activeBookId).toBe("book-a");
    expect(store.activeBookSummary).toBe(book);
    expect(store.workspaceIndex).toBe(workspace);
    expect(store.selection).toBe(requestedSelection);
    expect(isReactive(store.longBooks)).toBe(false);
    expect(isReactive(store.workspaceIndex)).toBe(false);
    expect(isReactive(store.selection)).toBe(false);
    expect(store.activeContextReady).toBe(true);
  });

  it("single-flights the book list and ignores an invalidated late result", async () => {
    const store = useLongWorkspaceStore();
    const pending = deferred<LongListBooksResult>();
    const loader = vi.fn(() => pending.promise);

    const first = store.ensureBookList(loader);
    const second = store.ensureBookList(loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.bookListLoading).toBe(true);

    store.invalidateBookList();
    pending.resolve(listResult(summary("stale-book")));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(store.longBooks).toEqual([]);

    const freshLoader = vi.fn(async () => listResult(summary("fresh-book")));
    await store.ensureBookList(freshLoader);
    expect(store.longBooks.map(({ id }) => id)).toEqual(["fresh-book"]);
  });

  it("releases a failed book-list request so the next call can retry", async () => {
    const store = useLongWorkspaceStore();
    const loader = vi
      .fn<() => Promise<LongListBooksResult>>()
      .mockRejectedValueOnce(new Error("temporary list failure"))
      .mockResolvedValueOnce(listResult(summary("book-a")));

    await expect(store.ensureBookList(loader)).rejects.toThrow(
      "temporary list failure"
    );
    expect(store.bookListLoading).toBe(false);
    expect(store.bookListError).toBe("temporary list failure");
    await store.ensureBookList(loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(store.bookListError).toBeNull();
  });

  it("single-flights workspace loads for the same active book", async () => {
    const store = useLongWorkspaceStore();
    store.publishBookList(listResult(summary("book-a")));
    const pending = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
      summary: LongBookSummary;
    }>();
    const loader = vi.fn(() => pending.promise);

    const first = store.ensureWorkspace("book-a", loader);
    const second = store.ensureWorkspace("book-a", loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.workspaceLoading).toBe(true);

    const loadedSummary = summary("book-a", 2, 3);
    const loadedIndex = index("book-a", 2);
    pending.resolve({
      bookId: "book-a",
      workspaceIndex: loadedIndex,
      summary: loadedSummary
    });
    expect(await first).not.toBeNull();
    expect(await second).not.toBeNull();
    expect(store.workspaceIndex).toBe(loadedIndex);
    expect(store.activeBookSummary).toBe(loadedSummary);
    expect(store.workspaceLoading).toBe(false);
  });

  it("prevents a previous book's late workspace result from overwriting a switch", async () => {
    const store = useLongWorkspaceStore();
    store.publishBookList(listResult(summary("book-a"), summary("book-b")));
    const bookA = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
      summary: LongBookSummary;
    }>();
    const bookB = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
      summary: LongBookSummary;
    }>();

    const requestA = store.ensureWorkspace("book-a", () => bookA.promise);
    const requestB = store.ensureWorkspace("book-b", () => bookB.promise);
    const bookBIndex = index("book-b", 5);
    bookB.resolve({
      bookId: "book-b",
      workspaceIndex: bookBIndex,
      summary: summary("book-b", 5, 8)
    });
    expect(await requestB).not.toBeNull();

    bookA.resolve({
      bookId: "book-a",
      workspaceIndex: index("book-a", 9),
      summary: summary("book-a", 9, 9)
    });
    expect(await requestA).toBeNull();
    expect(store.activeBookId).toBe("book-b");
    expect(store.workspaceIndex).toBe(bookBIndex);
    expect(store.activeBookSummary?.id).toBe("book-b");
  });

  it("invalidates an active workspace load and retries with a new generation", async () => {
    const store = useLongWorkspaceStore();
    const stale = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
      summary: LongBookSummary;
    }>();
    const staleRequest = store.ensureWorkspace("book-a", () => stale.promise);
    store.invalidateWorkspace("book-a");
    stale.resolve({
      bookId: "book-a",
      workspaceIndex: index("book-a", 1),
      summary: summary("book-a", 1)
    });
    expect(await staleRequest).toBeNull();
    expect(store.workspaceIndex).toBeNull();

    const freshIndex = index("book-a", 2);
    await store.ensureWorkspace("book-a", async () => ({
      bookId: "book-a",
      workspaceIndex: freshIndex,
      summary: summary("book-a", 2)
    }));
    expect(store.workspaceIndex).toBe(freshIndex);
  });

  it("releases a failed workspace request so the same book can retry", async () => {
    const store = useLongWorkspaceStore();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary workspace failure"))
      .mockResolvedValueOnce({
        bookId: "book-a",
        workspaceIndex: index("book-a", 2),
        summary: summary("book-a", 2)
      });

    await expect(store.ensureWorkspace("book-a", loader)).rejects.toThrow(
      "temporary workspace failure"
    );
    expect(store.workspaceLoading).toBe(false);
    expect(store.workspaceLoadError).toBe("temporary workspace failure");
    expect(store.activeRefreshStatus).toMatchObject({
      bookId: "book-a",
      pending: false,
      error: "temporary workspace failure"
    });

    await store.ensureWorkspace("book-a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(store.workspaceLoadError).toBeNull();
    expect(store.activeRefreshStatus).toBeNull();
    expect(store.workspaceIndex?.bookId).toBe("book-a");
  });

  it("does not publish a workspace result that settles after disposal", async () => {
    const store = useLongWorkspaceStore();
    const pending = deferred<{
      bookId: string;
      workspaceIndex: LongWorkspaceIndexSnapshot;
      summary: LongBookSummary;
    }>();
    const request = store.ensureWorkspace("book-a", () => pending.promise);
    await Promise.resolve();
    expect(store.workspaceLoading).toBe(true);

    store.$dispose();
    pending.resolve({
      bookId: "book-a",
      workspaceIndex: index("book-a", 3),
      summary: summary("book-a", 3)
    });

    expect(await request).toBeNull();
    expect(store.activeBookId).toBeNull();
    expect(store.workspaceIndex).toBeNull();
    expect(store.workspaceLoading).toBe(false);
  });

  it("clears dialog targets, pending flags and rejects new work after disposal", async () => {
    const store = useLongWorkspaceStore();
    store.bookRenameTarget = { bookId: "book-a", title: "待改名" };
    store.structureDialogOpen = true;
    store.structureAgentsMd = "# 长篇上下文";
    store.structureAgentsMdPending = true;
    store.mutationPending = true;
    store.proposalApprovalPending = true;
    store.clearDialogTargets();
    expect(store.bookRenameTarget).toBeNull();
    expect(store.structureDialogOpen).toBe(false);
    expect(store.structureAgentsMd).toBeNull();
    expect(store.structureAgentsMdPending).toBe(false);
    expect(store.mutationPending).toBe(true);

    store.clear();
    expect(store.mutationPending).toBe(false);
    expect(store.proposalApprovalPending).toBe(false);
    expect(store.activeBookId).toBeNull();

    store.$dispose();
    await expect(
      store.ensureWorkspace("book-a", async () => ({
        bookId: "book-a",
        workspaceIndex: index("book-a"),
        summary: summary("book-a")
      }))
    ).rejects.toThrow("disposed");
  });
});
