import {
  createLongWorkspaceNavigationSnapshot,
  type LongApplyLegacySyncResult,
  type LongBookSummary,
  type LongCharacterGroup,
  type LongChooseContinuationImportSourceResult,
  type LongChooseLegacySyncSourceResult,
  type LongFileId,
  type LongListBooksResult,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { ResourceTreeNode } from "../types/workspace";
import {
  reconcileLongWorkspaceSelection,
  replaceLongBookSummary,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

export type LongCatalogDiagnostic = NonNullable<
  LongListBooksResult["diagnostics"]
>[number];

export interface LongWorkspaceFileContext {
  readonly bookId: string;
  readonly fileId: LongFileId;
}

export interface LongWorkspaceRefreshStatus {
  readonly bookId: string;
  readonly requestId: number;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface LongWorkspaceLoadPayload {
  readonly bookId: string;
  readonly workspaceIndex: LongWorkspaceIndexSnapshot;
  readonly summary?: LongBookSummary;
}

export type LongBookListLoader = () => Promise<LongListBooksResult>;
export type LongWorkspaceLoader = () => Promise<LongWorkspaceLoadPayload>;

export interface LongCharacterCreateTarget {
  readonly bookId: string;
  readonly group: LongCharacterGroup;
  readonly groupLabel: string;
}

export interface LongPlotPointCreateTarget {
  readonly bookId: string;
  readonly volumeId: string;
  readonly volumeTitle: string;
}

export interface LongWorldbuildingItemCreateTarget {
  readonly bookId: string;
  readonly categoryId: string;
  readonly categoryTitle: string;
}

export interface LongChapterCardCreateTarget {
  readonly bookId: string;
  readonly volumeId: string;
  readonly volumeTitle: string;
  readonly arcOptions: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
  }>;
  readonly source: "chapter-card" | "draft";
}

export interface LongVolumeCreateTarget {
  readonly bookId: string;
  readonly source: "book-line" | "draft";
}

export interface LongDraftSectionDeleteTarget {
  readonly bookId: string;
  readonly chapterCardId: string;
  readonly volumeId: string;
  readonly operationUpdatedAt: string;
  readonly title: string;
  readonly description: string;
  readonly expectedImpact: LongWorkspaceImpactConfirmation;
}

export interface LongTreeItemDeleteTarget {
  readonly bookId: string;
  readonly node: ResourceTreeNode;
  readonly operationUpdatedAt: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly expectedImpact: LongWorkspaceImpactConfirmation;
}

export interface LongLedgerCommitDeleteTarget {
  readonly bookId: string;
  readonly commitId: string;
  readonly title: string;
  readonly chapterCardIds: readonly string[];
}

export interface LongBookRenameTarget {
  readonly bookId: string;
  readonly title: string;
}

export interface LongBookRemovalTarget extends LongBookRenameTarget {
  readonly action: "unregister" | "delete";
}

interface WorkspaceLoadRecord {
  readonly generation: number;
  readonly activeGeneration: number;
  readonly requestId: number;
  readonly promise: Promise<LongWorkspaceLoadPayload | null>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function disposedError(): Error {
  return new Error("Long workspace store has been disposed.");
}

export const useLongWorkspaceStore = defineStore("longWorkspace", () => {
  const longBooks = shallowRef<readonly LongBookSummary[]>([]);
  const longCatalogDiagnostics = shallowRef<readonly LongCatalogDiagnostic[]>(
    []
  );
  const catalogUpdatedAt = ref<string | null>(null);
  const activeBookId = ref<string | null>(null);
  const workspaceIndex = shallowRef<LongWorkspaceIndexSnapshot | null>(null);
  const selection = shallowRef<LongWorkspaceSelection | null>(null);
  const fileContext = shallowRef<LongWorkspaceFileContext | null>(null);
  const refreshStatus = shallowRef<LongWorkspaceRefreshStatus | null>(null);
  const bookListLoading = ref(false);
  const bookListError = ref<string | null>(null);
  const workspaceLoading = ref(false);
  const workspaceLoadError = ref<string | null>(null);
  const sendPreflightPending = ref(false);
  const mutationPending = ref(false);
  const proposalApprovalPending = ref(false);
  const bookActionPending = ref(false);
  const manuscriptExportPending = ref(false);

  const continuationImportPreview =
    shallowRef<LongChooseContinuationImportSourceResult | null>(null);
  const legacySyncPreview = shallowRef<LongChooseLegacySyncSourceResult | null>(
    null
  );
  const legacySyncResult = shallowRef<LongApplyLegacySyncResult | null>(null);
  const structureDialogOpen = ref(false);
  const structureAgentsMd = ref<string | null>(null);
  const structureAgentsMdPending = ref(false);
  const characterCreateTarget = shallowRef<LongCharacterCreateTarget | null>(
    null
  );
  const worldbuildingItemCreateTarget =
    shallowRef<LongWorldbuildingItemCreateTarget | null>(null);
  const plotPointCreateTarget = shallowRef<LongPlotPointCreateTarget | null>(
    null
  );
  const chapterCardCreateTarget =
    shallowRef<LongChapterCardCreateTarget | null>(null);
  const draftSectionDeleteTarget =
    shallowRef<LongDraftSectionDeleteTarget | null>(null);
  const treeItemDeleteTarget = shallowRef<LongTreeItemDeleteTarget | null>(
    null
  );
  const ledgerCommitDeleteTarget =
    shallowRef<LongLedgerCommitDeleteTarget | null>(null);
  const volumeCreateTarget = shallowRef<LongVolumeCreateTarget | null>(null);
  const bindingsDialogMode = ref<"skill" | "material" | null>(null);
  const exportTarget = shallowRef<LongBookRenameTarget | null>(null);
  const bookRenameTarget = shallowRef<LongBookRenameTarget | null>(null);
  const bookRemovalTarget = shallowRef<LongBookRemovalTarget | null>(null);

  const activeBookSummary = computed<LongBookSummary | null>(
    () => longBooks.value.find((book) => book.id === activeBookId.value) ?? null
  );
  const activeRefreshStatus = computed(() => {
    const current = refreshStatus.value;
    return current?.bookId === activeBookId.value ? current : null;
  });
  const activeContextReady = computed(() => {
    const summary = activeBookSummary.value;
    return (
      activeRefreshStatus.value === null &&
      workspaceIndex.value !== null &&
      summary !== null
    );
  });

  let disposed = false;
  let lifecycleGeneration = 0;
  let stateGeneration = 0;
  let bookListGeneration = 0;
  let activeGeneration = 0;
  let workspaceRequestClock = 0;
  let bookListLoad: Promise<LongListBooksResult | null> | null = null;
  const workspaceLoads = new Map<string, WorkspaceLoadRecord>();
  const workspaceGenerations = new Map<string, number>();

  function assertActive(): void {
    if (disposed) throw disposedError();
  }

  function workspaceGeneration(bookId: string): number {
    return workspaceGenerations.get(bookId) ?? 0;
  }

  function advanceWorkspaceGeneration(bookId: string): number {
    const next = workspaceGeneration(bookId) + 1;
    workspaceGenerations.set(bookId, next);
    workspaceLoads.delete(bookId);
    return next;
  }

  function publishBookList(result: LongListBooksResult): void {
    assertActive();
    const diagnostics = result.diagnostics ?? [];
    const unavailableBookIds = new Set(diagnostics.map(({ bookId }) => bookId));
    const activeSummary = activeBookSummary.value;
    longBooks.value =
      activeSummary &&
      workspaceIndex.value &&
      !unavailableBookIds.has(activeSummary.id)
        ? replaceLongBookSummary(result.books, activeSummary)
        : result.books;
    longCatalogDiagnostics.value = diagnostics;
    catalogUpdatedAt.value = result.updatedAt;
  }

  function activateBook(
    bookId: string,
    requestedSelection: LongWorkspaceSelection | null = null,
    force = false
  ): number {
    assertActive();
    if (activeBookId.value === bookId && !force) {
      if (requestedSelection !== null) selection.value = requestedSelection;
      return activeGeneration;
    }

    const previousBookId = activeBookId.value;
    activeGeneration += 1;
    if (previousBookId) advanceWorkspaceGeneration(previousBookId);
    advanceWorkspaceGeneration(bookId);
    activeBookId.value = bookId;
    workspaceIndex.value = null;
    selection.value = requestedSelection;
    fileContext.value = null;
    refreshStatus.value = null;
    workspaceLoadError.value = null;
    workspaceLoading.value = false;
    clearDialogTargets();
    return activeGeneration;
  }

  function summaryForWorkspacePayload(
    payload: LongWorkspaceLoadPayload
  ): LongBookSummary {
    if (payload.summary) return payload.summary;
    const current = activeBookSummary.value;
    if (!current || current.id !== payload.bookId) {
      throw new Error(
        "Long workspace result does not include its book summary."
      );
    }
    return {
      ...current,
      updatedAt: payload.workspaceIndex.updatedAt,
      navigation: createLongWorkspaceNavigationSnapshot(payload.workspaceIndex)
    };
  }

  function publishWorkspace(payload: LongWorkspaceLoadPayload): boolean {
    assertActive();
    if (
      payload.bookId !== activeBookId.value ||
      payload.workspaceIndex.bookId !== payload.bookId
    ) {
      return false;
    }

    const summary = summaryForWorkspacePayload(payload);
    const previousSelection = selection.value;
    const nextSelection = previousSelection
      ? (reconcileLongWorkspaceSelection(
          summary,
          payload.workspaceIndex,
          previousSelection
        ) ?? null)
      : null;
    const previousFileId = fileContext.value?.fileId;
    const nextFile = nextSelection?.files.find(
      ({ file }) => file.id === previousFileId
    )?.file;

    // Publish the summary, index and reconciled navigation state in one action.
    longBooks.value = replaceLongBookSummary(longBooks.value, summary);
    workspaceIndex.value = payload.workspaceIndex;
    selection.value = nextSelection;
    fileContext.value = nextFile
      ? {
          bookId: payload.bookId,
          fileId: nextFile.id
        }
      : null;
    refreshStatus.value = null;
    workspaceLoadError.value = null;
    return true;
  }

  function publishBook(
    summary: LongBookSummary,
    index: LongWorkspaceIndexSnapshot,
    requestedSelection: LongWorkspaceSelection | null = selection.value
  ): boolean {
    if (activeBookId.value !== summary.id) {
      activateBook(summary.id, requestedSelection);
    } else {
      selection.value = requestedSelection;
    }
    return publishWorkspace({
      bookId: summary.id,
      workspaceIndex: index,
      summary
    });
  }

  function publishSelection(
    bookId: string,
    nextSelection: LongWorkspaceSelection | null
  ): boolean {
    assertActive();
    if (bookId !== activeBookId.value) return false;
    selection.value = nextSelection;
    fileContext.value = null;
    return true;
  }

  function publishFileContext(
    context: LongWorkspaceFileContext | null
  ): boolean {
    assertActive();
    if (context && context.bookId !== activeBookId.value) return false;
    fileContext.value = context;
    return true;
  }

  async function ensureBookList(
    loader: LongBookListLoader
  ): Promise<LongListBooksResult | null> {
    assertActive();
    if (bookListLoad) return await bookListLoad;

    const requestLifecycleGeneration = lifecycleGeneration;
    const requestStateGeneration = stateGeneration;
    const requestBookListGeneration = bookListGeneration;
    const request = Promise.resolve()
      .then(loader)
      .then((result) => {
        if (
          disposed ||
          requestLifecycleGeneration !== lifecycleGeneration ||
          requestStateGeneration !== stateGeneration ||
          requestBookListGeneration !== bookListGeneration
        ) {
          return null;
        }
        publishBookList(result);
        bookListError.value = null;
        return result;
      })
      .catch((error: unknown) => {
        if (
          !disposed &&
          requestLifecycleGeneration === lifecycleGeneration &&
          requestStateGeneration === stateGeneration &&
          requestBookListGeneration === bookListGeneration
        ) {
          bookListError.value = errorMessage(
            error,
            "Failed to load long workspace books."
          );
        }
        throw error;
      })
      .finally(() => {
        if (bookListLoad === request) {
          bookListLoad = null;
          bookListLoading.value = false;
        }
      });
    bookListLoad = request;
    bookListLoading.value = true;
    return await request;
  }

  function invalidateBookList(): void {
    bookListGeneration += 1;
    bookListLoad = null;
    bookListLoading.value = false;
  }

  async function ensureWorkspace(
    bookId: string,
    loader: LongWorkspaceLoader
  ): Promise<LongWorkspaceLoadPayload | null> {
    assertActive();
    if (activeBookId.value !== bookId) activateBook(bookId);

    const generation = workspaceGeneration(bookId);
    const existing = workspaceLoads.get(bookId);
    if (
      existing &&
      existing.generation === generation &&
      existing.activeGeneration === activeGeneration
    ) {
      return await existing.promise;
    }

    const requestLifecycleGeneration = lifecycleGeneration;
    const requestStateGeneration = stateGeneration;
    const requestActiveGeneration = activeGeneration;
    const requestId = ++workspaceRequestClock;
    const request = Promise.resolve()
      .then(loader)
      .then((payload) => {
        if (
          payload.bookId !== bookId ||
          payload.workspaceIndex.bookId !== bookId
        ) {
          throw new Error("Long workspace loader returned a different book.");
        }
        if (
          disposed ||
          requestLifecycleGeneration !== lifecycleGeneration ||
          requestStateGeneration !== stateGeneration ||
          requestActiveGeneration !== activeGeneration ||
          generation !== workspaceGeneration(bookId) ||
          activeBookId.value !== bookId
        ) {
          return null;
        }
        publishWorkspace(payload);
        return payload;
      })
      .catch((error: unknown) => {
        if (
          !disposed &&
          requestLifecycleGeneration === lifecycleGeneration &&
          requestStateGeneration === stateGeneration &&
          requestActiveGeneration === activeGeneration &&
          generation === workspaceGeneration(bookId) &&
          activeBookId.value === bookId
        ) {
          const message = errorMessage(
            error,
            "Failed to load the long workspace."
          );
          workspaceLoadError.value = message;
          refreshStatus.value = {
            bookId,
            requestId,
            pending: false,
            error: message
          };
        }
        throw error;
      })
      .finally(() => {
        const ownsLoad = workspaceLoads.get(bookId) === record;
        if (ownsLoad) {
          workspaceLoads.delete(bookId);
        }
        if (
          ownsLoad &&
          requestActiveGeneration === activeGeneration &&
          activeBookId.value === bookId
        ) {
          workspaceLoading.value = false;
        }
      });
    const record: WorkspaceLoadRecord = {
      generation,
      activeGeneration: requestActiveGeneration,
      requestId,
      promise: request
    };
    workspaceLoads.set(bookId, record);
    workspaceLoading.value = true;
    workspaceLoadError.value = null;
    refreshStatus.value = {
      bookId,
      requestId,
      pending: true,
      error: null
    };
    return await request;
  }

  function invalidateWorkspace(bookId = activeBookId.value): void {
    if (!bookId) return;
    advanceWorkspaceGeneration(bookId);
    if (activeBookId.value === bookId) {
      workspaceLoading.value = false;
      refreshStatus.value = null;
    }
  }

  function clearDialogTargets(): void {
    continuationImportPreview.value = null;
    legacySyncPreview.value = null;
    legacySyncResult.value = null;
    structureDialogOpen.value = false;
    structureAgentsMd.value = null;
    structureAgentsMdPending.value = false;
    characterCreateTarget.value = null;
    worldbuildingItemCreateTarget.value = null;
    plotPointCreateTarget.value = null;
    chapterCardCreateTarget.value = null;
    draftSectionDeleteTarget.value = null;
    treeItemDeleteTarget.value = null;
    ledgerCommitDeleteTarget.value = null;
    volumeCreateTarget.value = null;
    bindingsDialogMode.value = null;
    exportTarget.value = null;
    bookRenameTarget.value = null;
    bookRemovalTarget.value = null;
  }

  function clearActiveBook(): void {
    assertActive();
    const currentBookId = activeBookId.value;
    activeGeneration += 1;
    if (currentBookId) advanceWorkspaceGeneration(currentBookId);
    activeBookId.value = null;
    workspaceIndex.value = null;
    selection.value = null;
    fileContext.value = null;
    refreshStatus.value = null;
    workspaceLoading.value = false;
    workspaceLoadError.value = null;
    clearDialogTargets();
  }

  function resetPendingState(): void {
    sendPreflightPending.value = false;
    mutationPending.value = false;
    proposalApprovalPending.value = false;
    bookActionPending.value = false;
    manuscriptExportPending.value = false;
  }

  function clear(): void {
    assertActive();
    stateGeneration += 1;
    bookListGeneration += 1;
    activeGeneration += 1;
    bookListLoad = null;
    workspaceLoads.clear();
    workspaceGenerations.clear();
    longBooks.value = [];
    longCatalogDiagnostics.value = [];
    catalogUpdatedAt.value = null;
    bookListLoading.value = false;
    bookListError.value = null;
    activeBookId.value = null;
    workspaceIndex.value = null;
    selection.value = null;
    fileContext.value = null;
    refreshStatus.value = null;
    workspaceLoading.value = false;
    workspaceLoadError.value = null;
    clearDialogTargets();
    resetPendingState();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    stateGeneration += 1;
    bookListGeneration += 1;
    activeGeneration += 1;
    bookListLoad = null;
    workspaceLoads.clear();
    workspaceGenerations.clear();
    longBooks.value = [];
    longCatalogDiagnostics.value = [];
    catalogUpdatedAt.value = null;
    activeBookId.value = null;
    workspaceIndex.value = null;
    selection.value = null;
    fileContext.value = null;
    refreshStatus.value = null;
    bookListLoading.value = false;
    bookListError.value = null;
    workspaceLoading.value = false;
    workspaceLoadError.value = null;
    clearDialogTargets();
    resetPendingState();
  }

  onScopeDispose(dispose);

  return {
    longBooks,
    longCatalogDiagnostics,
    catalogUpdatedAt,
    activeBookId,
    activeBookSummary,
    workspaceIndex,
    selection,
    fileContext,
    refreshStatus,
    activeRefreshStatus,
    activeContextReady,
    bookListLoading,
    bookListError,
    workspaceLoading,
    workspaceLoadError,
    sendPreflightPending,
    mutationPending,
    proposalApprovalPending,
    bookActionPending,
    manuscriptExportPending,
    continuationImportPreview,
    legacySyncPreview,
    legacySyncResult,
    structureDialogOpen,
    structureAgentsMd,
    structureAgentsMdPending,
    characterCreateTarget,
    worldbuildingItemCreateTarget,
    plotPointCreateTarget,
    chapterCardCreateTarget,
    draftSectionDeleteTarget,
    treeItemDeleteTarget,
    ledgerCommitDeleteTarget,
    volumeCreateTarget,
    bindingsDialogMode,
    exportTarget,
    bookRenameTarget,
    bookRemovalTarget,
    publishBookList,
    activateBook,
    publishWorkspace,
    publishBook,
    publishSelection,
    publishFileContext,
    ensureBookList,
    invalidateBookList,
    ensureWorkspace,
    invalidateWorkspace,
    clearDialogTargets,
    clearActiveBook,
    resetPendingState,
    clear,
    dispose
  };
});
