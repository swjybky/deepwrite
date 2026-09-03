import {
  type LongArcId,
  type LongBookSummary,
  type LongCharacterId,
  type LongOpenBookResult,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { shallowRef, type Ref } from "vue";
import type { LongApprovalEditorFocus } from "../utils/approvalNavigation";
import {
  createLongChapterCardVolumeSelection,
  createLongCharacterGroupSelection,
  createLongPlotPointVolumeSelection,
  replaceLongBookSummary,
  type LongForeshadowingFocus,
  type LongWorkspaceRendererApi,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import type { EditorTextReference } from "../types/conversation";
import {
  useLongWorkspaceStore,
  type LongWorkspaceFileContext,
  type LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import { useLongWorkspaceRefreshCoordinator } from "./useLongWorkspaceRefreshCoordinator";

export interface LongWorkspaceSessionNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongWorkspaceEditorPort {
  saveAllChanges(): Promise<boolean>;
  selectBookLineVolume(volumeId: string): void;
  focusFile(fileId: string): Promise<boolean>;
  focusTarget(target: LongApprovalEditorFocus): Promise<boolean>;
  locateEditorReference(reference: EditorTextReference): Promise<boolean>;
  captureNavigationSelection(): Partial<LongWorkspaceSelection>;
  captureForeshadowingFocus(): LongForeshadowingFocus;
  ensureDocumentsLoaded(
    files: LongWorkspaceSelection["files"]
  ): Promise<boolean>;
}

const LONG_WORKSPACE_EDITOR_PORT_METHODS = [
  "saveAllChanges",
  "selectBookLineVolume",
  "focusFile",
  "focusTarget",
  "locateEditorReference",
  "captureNavigationSelection",
  "captureForeshadowingFocus",
  "ensureDocumentsLoaded"
] as const satisfies readonly (keyof LongWorkspaceEditorPort)[];

export function isLongWorkspaceEditorPort(
  value: unknown
): value is LongWorkspaceEditorPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<
    Record<keyof LongWorkspaceEditorPort, unknown>
  >;
  return LONG_WORKSPACE_EDITOR_PORT_METHODS.every(
    (method) => typeof candidate[method] === "function"
  );
}

export interface LongWorkspaceSessionState {
  longBooks: Ref<readonly LongBookSummary[]>;
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  selection: Ref<LongWorkspaceSelection | null>;
  fileContext: Ref<LongWorkspaceFileContext | null>;
  refreshStatus: Ref<LongWorkspaceRefreshStatus | null>;
  activeRefreshStatus: Readonly<Ref<LongWorkspaceRefreshStatus | null>>;
}

export interface LongWorkspaceSessionScheduler<TimerHandle> {
  setTimeout(task: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface LongWorkspaceSessionCoordinatorContext<TimerHandle> {
  store: ReturnType<typeof useLongWorkspaceStore>;
  state: LongWorkspaceSessionState;
  api(): LongWorkspaceRendererApi | undefined;
  isWorkspaceActive(): boolean;
  prepareOpenDependencies(): Promise<unknown>;
  activateProposalBook(bookId: string): void;
  synchronizeSelectedResourceForLayout(bookId: string): void;
  selectFallbackAfterClear(): void | Promise<void>;
  notifications: LongWorkspaceSessionNotifications;
  scheduler: LongWorkspaceSessionScheduler<TimerHandle>;
}

export interface LoadLongBookListOptions {
  notify?: boolean;
  force?: boolean;
}

export function useLongWorkspaceSessionCoordinator<TimerHandle>(
  context: LongWorkspaceSessionCoordinatorContext<TimerHandle>
) {
  const { state, store, notifications } = context;
  const editor = shallowRef<LongWorkspaceEditorPort | null>(null);
  const seenCatalogDiagnosticKeys = new Set<string>();
  let catalogRetryAttempts = 0;
  let catalogRetryTimer: TimerHandle | undefined;
  let disposed = false;
  const refresh = useLongWorkspaceRefreshCoordinator({
    state,
    api: context.api,
    isDisposed: () => disposed,
    synchronizeSelectedResourceForLayout:
      context.synchronizeSelectedResourceForLayout,
    notifications
  });

  function cancelCatalogRetry(): void {
    if (catalogRetryTimer === undefined) return;
    context.scheduler.clearTimeout(catalogRetryTimer);
    catalogRetryTimer = undefined;
  }

  async function loadBookList(
    options: LoadLongBookListOptions = {}
  ): Promise<void> {
    if (disposed) return;
    const api = context.api();
    if (!api) return;
    const notify = options.notify ?? context.isWorkspaceActive();
    const force = options.force ?? false;
    if (notify) cancelCatalogRetry();
    if (force) store.invalidateBookList();

    try {
      const result = await store.ensureBookList(() => api.list());
      if (disposed || !result) return;
      catalogRetryAttempts = 0;
      cancelCatalogRetry();
      const currentDiagnosticKeys = new Set(
        (result.diagnostics ?? []).map(
          (diagnostic) =>
            `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
        )
      );
      for (const key of seenCatalogDiagnosticKeys) {
        if (!currentDiagnosticKeys.has(key)) {
          seenCatalogDiagnosticKeys.delete(key);
        }
      }
      const unseen = (result.diagnostics ?? []).filter((diagnostic) => {
        const key = `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
        return !seenCatalogDiagnosticKeys.has(key);
      });
      if (notify && unseen.length) {
        for (const diagnostic of unseen) {
          seenCatalogDiagnosticKeys.add(
            `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
          );
        }
        const first = unseen[0]!;
        notifications.warning(
          `长篇项目暂时无法读取：${first.message}${
            unseen.length > 1 ? `（另有 ${unseen.length - 1} 个项目）` : ""
          }`
        );
      }
    } catch (error: unknown) {
      if (disposed) return;
      const message =
        error instanceof Error ? error.message : "加载长篇创作空间失败。";
      if (notify) {
        notifications.error(message);
      } else if (catalogRetryAttempts < 2 && catalogRetryTimer === undefined) {
        catalogRetryAttempts += 1;
        catalogRetryTimer = context.scheduler.setTimeout(() => {
          catalogRetryTimer = undefined;
          void loadBookList({ notify: false });
        }, catalogRetryAttempts * 1_500);
      }
    }
  }

  async function saveActiveEditorChanges(): Promise<boolean> {
    if (!state.activeBookId.value) return true;
    const currentEditor = editor.value;
    if (!currentEditor) return true;
    if (!isLongWorkspaceEditorPort(currentEditor)) {
      notifications.error("长篇编辑器尚未准备好，已取消当前操作，请重试。");
      return false;
    }
    try {
      return await currentEditor.saveAllChanges();
    } catch (error: unknown) {
      notifications.error(
        error instanceof Error
          ? error.message
          : "保存长篇修改失败，已取消切换。"
      );
      return false;
    }
  }

  async function saveActiveEditorBeforeLeaving(
    nextBookId?: string
  ): Promise<boolean> {
    const currentBookId = state.activeBookId.value;
    if (!currentBookId || currentBookId === nextBookId) return true;
    return saveActiveEditorChanges();
  }

  async function openBook(
    bookId: string,
    requestedSelection: LongWorkspaceSelection | null = null
  ): Promise<void> {
    if (disposed) return;
    const api = context.api();
    if (!api) {
      notifications.warning("浏览器预览不能打开长篇项目，请使用桌面客户端。");
      return;
    }
    if (!(await saveActiveEditorBeforeLeaving(bookId)) || disposed) return;

    const featureDependencies = context.prepareOpenDependencies();
    context.activateProposalBook(bookId);
    store.activateBook(bookId, requestedSelection, true);
    refresh.invalidate(bookId);
    try {
      await Promise.all([
        featureDependencies,
        store.ensureWorkspace(bookId, async () => {
          const opened = await api.open({ bookId });
          return {
            bookId,
            workspaceIndex: opened.book.workspaceIndex,
            summary: opened.summary
          };
        })
      ]);
    } catch (error: unknown) {
      if (disposed) return;
      notifications.error(
        error instanceof Error ? error.message : "打开长篇项目失败。"
      );
    }
  }

  async function selectWorkspaceFile(
    nextSelection: LongWorkspaceSelection
  ): Promise<boolean> {
    if (
      (state.selection.value?.key !== nextSelection.key ||
        state.selection.value?.worldbuildingItemId !==
          nextSelection.worldbuildingItemId ||
        state.selection.value?.preferredFileId !==
          nextSelection.preferredFileId ||
        state.selection.value?.bookLineVolumeId !==
          nextSelection.bookLineVolumeId ||
        state.selection.value?.characterId !== nextSelection.characterId ||
        state.selection.value?.plotPointId !== nextSelection.plotPointId ||
        state.selection.value?.chapterCardId !== nextSelection.chapterCardId) &&
      !(await saveActiveEditorChanges())
    ) {
      return false;
    }
    const preferredFile =
      nextSelection.files.find(
        ({ file }) => file.id === nextSelection.preferredFileId
      ) ??
      nextSelection.files.find(
        (file) => file.role === nextSelection.preferredRole
      ) ??
      nextSelection.files[0];
    if (preferredFile) {
      await editor.value?.ensureDocumentsLoaded([preferredFile]);
    }
    state.fileContext.value = null;
    state.selection.value = nextSelection;
    return true;
  }

  async function selectCharacterTab(
    characterId: LongCharacterId,
    done?: (accepted: boolean) => void
  ): Promise<void> {
    const summary = state.activeBookSummary.value;
    const index = state.workspaceIndex.value;
    const group = state.selection.value?.characterGroup;
    if (!summary || !index || !group) {
      done?.(false);
      return;
    }
    const accepted = await selectWorkspaceFile(
      createLongCharacterGroupSelection(summary, index, group, characterId)
    );
    done?.(accepted);
  }

  async function selectPlotPointTab(plotPointId: LongArcId): Promise<void> {
    const summary = state.activeBookSummary.value;
    const index = state.workspaceIndex.value;
    const volumeId = state.selection.value?.plotPointVolumeId;
    if (!summary || !index || !volumeId) return;
    const nextSelection = createLongPlotPointVolumeSelection(
      summary,
      index,
      volumeId,
      plotPointId
    );
    if (nextSelection) await selectWorkspaceFile(nextSelection);
  }

  async function selectChapterCardTab(chapterCardId: string): Promise<void> {
    const summary = state.activeBookSummary.value;
    const index = state.workspaceIndex.value;
    const volumeId = state.selection.value?.chapterCardVolumeId;
    if (!summary || !index || !volumeId) return;
    const nextSelection = createLongChapterCardVolumeSelection(
      summary,
      index,
      volumeId,
      chapterCardId
    );
    if (nextSelection) await selectWorkspaceFile(nextSelection);
  }

  function handleFileContextChange(
    nextContext: LongWorkspaceFileContext | null
  ): void {
    if (nextContext && nextContext.bookId !== state.activeBookId.value) return;
    state.fileContext.value = nextContext;
  }

  function deactivateActiveBook(): void {
    const bookId = state.activeBookId.value;
    if (bookId) refresh.invalidate(bookId);
    store.clearActiveBook();
  }

  async function clearActiveBook(bookId: string): Promise<void> {
    if (state.activeBookId.value !== bookId) return;
    deactivateActiveBook();
    await context.selectFallbackAfterClear();
  }

  function activateOpenedBook(opened: LongOpenBookResult): void {
    context.activateProposalBook(opened.book.id);
    refresh.invalidate(opened.book.id);
    state.refreshStatus.value = null;
    state.activeBookId.value = opened.book.id;
    state.workspaceIndex.value = opened.book.workspaceIndex;
    state.longBooks.value = replaceLongBookSummary(
      state.longBooks.value,
      opened.summary
    );
    state.selection.value = null;
    state.fileContext.value = null;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelCatalogRetry();
    seenCatalogDiagnosticKeys.clear();
    editor.value = null;
    store.dispose();
  }

  return {
    editor,
    loadBookList,
    saveActiveEditorChanges,
    saveActiveEditorBeforeLeaving,
    openBook,
    refreshActiveWorkspace: refresh.refreshActiveWorkspace,
    selectWorkspaceFile,
    selectCharacterTab,
    selectPlotPointTab,
    selectChapterCardTab,
    handleFileContextChange,
    handleDocumentSaved: refresh.handleDocumentSaved,
    retryActiveRefresh: refresh.retryActiveRefresh,
    refreshOnWindowFocus: refresh.refreshOnWindowFocus,
    invalidateRefresh: refresh.invalidate,
    deactivateActiveBook,
    clearActiveBook,
    activateOpenedBook,
    dispose
  };
}
