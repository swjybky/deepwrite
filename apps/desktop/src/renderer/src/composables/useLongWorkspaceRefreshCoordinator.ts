import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import {
  reconcileLongWorkspaceSelection,
  replaceLongBookSummary,
  type LongWorkspaceRendererApi,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import { createLongWorkspaceRefreshClock } from "../utils/longWorkspaceRefresh";
import { longWorkspaceSummaryFromIndex } from "../utils/longWorkspaceSummary";

const t = createScopedTranslator("workspace.longWorkspaceRefreshCoordinator");

interface LongWorkspaceRefreshState {
  longBooks: Ref<readonly LongBookSummary[]>;
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  selection: Ref<LongWorkspaceSelection | null>;
  fileContext: Ref<LongWorkspaceFileContext | null>;
  refreshStatus: Ref<LongWorkspaceRefreshStatus | null>;
  activeRefreshStatus: Readonly<Ref<LongWorkspaceRefreshStatus | null>>;
}

interface LongWorkspaceRefreshNotifications {
  error(message: string): void;
}

export interface LongWorkspaceRefreshCoordinatorOptions {
  state: LongWorkspaceRefreshState;
  api(): LongWorkspaceRendererApi | undefined;
  isDisposed(): boolean;
  synchronizeSelectedResourceForLayout(bookId: string): void;
  notifications: LongWorkspaceRefreshNotifications;
}

interface RefreshActiveWorkspaceOptions {
  publishPending?: boolean;
}

interface SavedDocumentRefresh {
  trailing: boolean;
  done?: Promise<void>;
}

/** Owns refresh ordering and passive focus reconciliation. */
export function useLongWorkspaceRefreshCoordinator(
  options: LongWorkspaceRefreshCoordinatorOptions
) {
  const { state, notifications } = options;
  const refreshClock = createLongWorkspaceRefreshClock();
  const savedDocumentRefreshes = new Map<string, SavedDocumentRefresh>();
  let pendingRefresh: LongWorkspaceRefreshStatus | undefined;

  async function refreshActiveWorkspace(
    bookId: string,
    refreshOptions: RefreshActiveWorkspaceOptions = {}
  ): Promise<boolean> {
    if (options.isDisposed()) return false;
    const api = options.api();
    if (!api) return false;
    const requestId = refreshClock.begin(bookId);
    if (
      state.activeBookId.value === bookId &&
      refreshOptions.publishPending !== false
    ) {
      pendingRefresh = {
        bookId,
        requestId,
        pending: true,
        error: null
      };
      state.refreshStatus.value = pendingRefresh;
    }

    try {
      const result = await api.getWorkspaceIndex({ bookId });
      if (
        options.isDisposed() ||
        state.activeBookId.value !== bookId ||
        !refreshClock.isCurrent(bookId, requestId)
      ) {
        return false;
      }
      if (result.bookId !== bookId) {
        throw new Error(t("theNovelWorkspaceRefreshReturnedADifferentBook"));
      }
      const currentSummary = state.activeBookSummary.value;
      if (!currentSummary || currentSummary.id !== bookId) {
        throw new Error(
          t("theActiveNovelSummaryChangedRefreshResultsCannotBe")
        );
      }
      const nextSummary = longWorkspaceSummaryFromIndex(result, currentSummary);
      const currentSelection = state.selection.value;
      const nextSelection = currentSelection
        ? (reconcileLongWorkspaceSelection(
            nextSummary,
            result.workspaceIndex,
            currentSelection
          ) ?? null)
        : null;
      const activeFileId = state.fileContext.value?.fileId;
      const nextFile = nextSelection?.files.find(
        ({ file }) => file.id === activeFileId
      )?.file;

      // Publish the matching index, summary, selection and file context as one
      // synchronous boundary.
      state.workspaceIndex.value = result.workspaceIndex;
      state.longBooks.value = replaceLongBookSummary(
        state.longBooks.value,
        nextSummary
      );
      if (currentSelection) {
        state.selection.value = nextSelection;
        state.fileContext.value = nextFile
          ? {
              bookId,
              fileId: nextFile.id
            }
          : null;
      }
      options.synchronizeSelectedResourceForLayout(bookId);
      state.refreshStatus.value = null;
      return true;
    } catch (error: unknown) {
      if (
        !options.isDisposed() &&
        state.activeBookId.value === bookId &&
        refreshClock.isCurrent(bookId, requestId)
      ) {
        const message = formatError(
          error,
          t("failedToRefreshTheNovelWorkspaceIndex")
        );
        state.refreshStatus.value = {
          bookId,
          requestId,
          pending: false,
          error: message
        };
        notifications.error(message);
      }
      return false;
    }
  }

  /**
   * A document write cannot change structure, so its follow-up refresh is
   * passive: publishing `pending` would make the editor read-only mid-sentence
   * after every auto-save. Saves that land while one is in flight coalesce
   * into a single trailing read instead of queueing a Core read per save.
   */
  async function handleDocumentSaved(
    result: LongWriteDocumentResult
  ): Promise<void> {
    const bookId = result.bookId;
    const inflight = savedDocumentRefreshes.get(bookId);
    if (inflight) {
      inflight.trailing = true;
      await inflight.done;
      return;
    }
    const entry: SavedDocumentRefresh = { trailing: false };
    savedDocumentRefreshes.set(bookId, entry);
    entry.done = refreshAfterSaves(bookId, entry);
    await entry.done;
  }

  async function refreshAfterSaves(
    bookId: string,
    entry: SavedDocumentRefresh
  ): Promise<void> {
    try {
      do {
        entry.trailing = false;
        await refreshActiveWorkspace(bookId, { publishPending: false });
      } while (entry.trailing && !options.isDisposed());
    } finally {
      savedDocumentRefreshes.delete(bookId);
    }
  }

  async function retryActiveRefresh(): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId || state.activeRefreshStatus.value?.pending) return;
    await refreshActiveWorkspace(bookId);
  }

  async function refreshOnWindowFocus(bookId: string): Promise<void> {
    await refreshActiveWorkspace(bookId, { publishPending: false });
  }

  function refreshAfterBackgroundWrite(bookId: string): Promise<boolean> {
    return refreshActiveWorkspace(bookId, { publishPending: false });
  }

  function invalidate(bookId: string): void {
    refreshClock.invalidate(bookId);
  }

  function dispose(): void {
    if (state.refreshStatus.value === pendingRefresh) {
      state.refreshStatus.value = null;
    }
    pendingRefresh = undefined;
  }

  return {
    refreshActiveWorkspace,
    handleDocumentSaved,
    retryActiveRefresh,
    refreshOnWindowFocus,
    refreshAfterBackgroundWrite,
    invalidate,
    dispose
  };
}
