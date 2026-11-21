import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from "vue";
import {
  type LongArcId,
  type LongFileId,
  type LongReadDocumentResult,
  type LongWorkspaceFileReference,
  type LongWriteDocumentResult,
  type TextViewMode
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  isEditableLongFile,
  resolveLongWorkspaceApi,
  type LongWorkspaceSelection,
  type LongWorkspaceSelectionFile
} from "../types/longWorkspace";
import type { LongEditorRecoveryRecord } from "./useLongEditorRecovery";
import { createLongDocumentLoadQueue } from "./longDocumentLoadQueue";

const t = createScopedTranslator("workspace.longEditorDocumentSession");

export interface LongDocumentState {
  bookId: string;
  file: LongWorkspaceFileReference;
  content: string;
  savedContent: string;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  loadError: string | null;
}

export interface LongVolumeOutlineDraft {
  content: string;
  savedContent: string;
  saving: boolean;
}

interface EditorViewportSnapshot {
  documentKey: string;
  scrollTop: number;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
  focused: boolean;
}

const DOCUMENT_PAGE_CHARACTERS = 256 * 1024;
const AUTO_SAVE_DELAY_MS = 800;

export function useLongEditorDocumentSession(options: {
  props: {
    bookId: string;
    selection: LongWorkspaceSelection | null;
    locked?: boolean;
    autoSaveEnabled: boolean;
  };
  emit: {
    (event: "saved", result: LongWriteDocumentResult): void;
    (
      event: "contextChange",
      context: {
        bookId: string;
        fileId: LongFileId;
      } | null
    ): void;
  };
  documentStates: Ref<Record<string, LongDocumentState>>;
  volumeOutlineDrafts: Ref<Record<string, LongVolumeOutlineDraft>>;
  plotPointSummaryDrafts: Ref<Record<string, LongVolumeOutlineDraft>>;
  currentSelectionFile: ComputedRef<LongWorkspaceSelectionFile | undefined>;
  pendingFileId?: Readonly<Ref<string | null>>;
  currentReadOnly: ComputedRef<boolean>;
  currentDirty: ComputedRef<boolean>;
  currentIsStructuredText: ComputedRef<boolean>;
  currentIsWorldbuildingList: ComputedRef<boolean>;
  viewMode: Ref<TextViewMode>;
  editorInput: Ref<HTMLTextAreaElement | null>;
  isComposing?: Readonly<Ref<boolean>>;
  activeWorldbuildingItemId: Ref<string | null>;
  activeBookLineVolumeId: Ref<string | null>;
  activeBookLineContentTab: Ref<"outline" | "foreshadowing">;
  activePlotPointTab: Ref<"summary" | "storyline" | "foreshadowing">;
  activeStoryPlotId: Ref<string | null>;
  saveVolumeOutline: (volumeId: string) => Promise<boolean>;
  savePlotPointContent: (
    plotPointId: LongArcId,
    field?: "summary"
  ) => Promise<boolean>;
  readRecoveryRecord: (
    bookId: string,
    fileId: LongFileId
  ) => LongEditorRecoveryRecord | null;
  clearRecoveryRecordForKey: (
    key: string,
    bookId: string,
    fileId: string
  ) => void;
  persistRecoveryForKey: (key: string) => void;
}): {
  heldSelectionFile: Ref<LongWorkspaceSelectionFile | null>;
  workspaceSavePending: Ref<boolean>;
  manualSaving: Ref<boolean>;
  currentState: ComputedRef<LongDocumentState | undefined>;
  isDocumentSwitchPending: ComputedRef<boolean>;
  displayDocumentState: ComputedRef<LongDocumentState | undefined>;
  showEditorLoading: ComputedRef<boolean>;
  showEditorLoadError: ComputedRef<boolean>;
  stateKey: (fileId: string, bookId?: string) => string;
  replaceDocumentState: (key: string, state: LongDocumentState) => void;
  loadWorkspaceDocument: (
    selectedFile: LongWorkspaceSelectionFile,
    force?: boolean
  ) => Promise<void>;
  loadSelectedDocument: (force?: boolean) => Promise<void>;
  prefetchWorldbuildingSelectionFiles: () => Promise<void>;
  prefetchActiveSelectionFiles: () => Promise<void>;
  ensureDocumentsLoaded: (
    files: LongWorkspaceSelectionFile[]
  ) => Promise<boolean>;
  saveDocumentState: (
    key: string,
    announceSuccess: boolean
  ) => Promise<boolean>;
  saveCurrentDocument: () => Promise<void>;
  saveAllChanges: () => Promise<boolean>;
} {
  const { props, emit } = options;
  const { documentStates } = options;
  const heldSelectionFile = ref<LongWorkspaceSelectionFile | null>(null);
  const workspaceSavePending = ref(false);
  const manualSaving = ref(false);
  const requestClockByFile = new Map<string, number>();
  const inflightDocumentLoads = new Map<string, Promise<void>>();
  const documentLoadQueue = createLongDocumentLoadQueue();
  let requestClock = 0;
  let activeSavePromise: Promise<boolean> | null = null;
  let pendingSaveViewport: EditorViewportSnapshot | null = null;
  let completedSaveViewport: EditorViewportSnapshot | null = null;
  let worldbuildingPrefetchRequest = 0;
  let selectionPrefetchRequest = 0;
  let deferredSelectedReload: {
    bookId: string;
    fileId: LongFileId;
    force: boolean;
  } | null = null;

  function stateKey(fileId: string, bookId = props.bookId): string {
    return `${bookId}\u0000${fileId}`;
  }

  const currentState = computed<LongDocumentState | undefined>(() => {
    const selectedFile = options.currentSelectionFile.value;
    return selectedFile
      ? documentStates.value[stateKey(selectedFile.file.id)]
      : undefined;
  });
  const isDocumentSwitchPending = computed(() => {
    const target = options.currentSelectionFile.value;
    if (!target) return false;
    const targetState = documentStates.value[stateKey(target.file.id)];
    if (targetState?.loaded || Boolean(targetState?.content)) return false;
    const held = heldSelectionFile.value;
    if (!held || held.file.id === target.file.id) return false;
    const heldState = documentStates.value[stateKey(held.file.id)];
    return Boolean(heldState?.loaded || heldState?.content);
  });
  const displayDocumentState = computed<LongDocumentState | undefined>(() => {
    if (isDocumentSwitchPending.value && heldSelectionFile.value) {
      return documentStates.value[stateKey(heldSelectionFile.value.file.id)];
    }
    return currentState.value;
  });
  const showEditorLoading = computed(() => {
    if (isDocumentSwitchPending.value) return false;
    const state = currentState.value;
    return Boolean(state?.loading && !state.loaded && !state.content);
  });
  const showEditorLoadError = computed(() => {
    if (isDocumentSwitchPending.value) return false;
    const state = currentState.value;
    return Boolean(state?.loadError && !state.loaded && !state.content);
  });

  function replaceDocumentState(key: string, state: LongDocumentState): void {
    documentStates.value = {
      ...documentStates.value,
      [key]: state
    };
  }

  function currentEditorViewportKey(): string {
    return [
      props.bookId,
      props.selection?.key ?? "",
      options.currentSelectionFile.value?.file.id ?? "",
      options.activeWorldbuildingItemId.value ?? "",
      options.activeBookLineVolumeId.value ?? "",
      options.activeBookLineContentTab.value,
      props.selection?.plotPointId ?? "",
      options.activePlotPointTab.value,
      options.activeStoryPlotId.value ?? "",
      props.selection?.chapterCardId ?? ""
    ].join("\u0000");
  }

  function captureCurrentEditorViewport(): EditorViewportSnapshot | null {
    const input = options.editorInput.value;
    if (
      !input ||
      options.viewMode.value !== "edit" ||
      options.isComposing?.value
    )
      return null;
    return {
      documentKey: currentEditorViewportKey(),
      scrollTop: input.scrollTop,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectionDirection: input.selectionDirection,
      focused: input.ownerDocument?.activeElement === input
    };
  }

  async function restoreCurrentEditorViewport(
    snapshot: EditorViewportSnapshot | null
  ): Promise<void> {
    if (!snapshot) return;
    await nextTick();
    if (
      options.viewMode.value !== "edit" ||
      options.isComposing?.value ||
      currentEditorViewportKey() !== snapshot.documentKey
    ) {
      return;
    }
    const input = options.editorInput.value;
    if (!input) return;
    if (snapshot.focused && input.ownerDocument.activeElement !== input) {
      input.focus({ preventScroll: true });
    }
    if (
      input.selectionStart !== snapshot.selectionStart ||
      input.selectionEnd !== snapshot.selectionEnd ||
      input.selectionDirection !== snapshot.selectionDirection
    ) {
      input.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.selectionDirection
      );
    }
    if (Math.abs(input.scrollTop - snapshot.scrollTop) > 0.5) {
      input.scrollTop = snapshot.scrollTop;
    }
  }

  const currentVisibleSaving = computed(() => {
    if (options.currentIsStructuredText.value) {
      const plotPointId = props.selection?.plotPointId;
      if (plotPointId && options.activePlotPointTab.value === "summary") {
        return Boolean(
          options.plotPointSummaryDrafts.value[plotPointId]?.saving
        );
      }
      const volumeId = options.activeBookLineVolumeId.value;
      if (volumeId && options.activeBookLineContentTab.value === "outline") {
        return Boolean(options.volumeOutlineDrafts.value[volumeId]?.saving);
      }
    }
    return Boolean(currentState.value?.saving);
  });

  watch(
    currentVisibleSaving,
    (saving, wasSaving) => {
      if (saving) {
        if (!wasSaving) {
          pendingSaveViewport =
            captureCurrentEditorViewport() ?? pendingSaveViewport;
        }
        return;
      }
      if (!wasSaving || !pendingSaveViewport) return;
      const latest = captureCurrentEditorViewport();
      if (!latest || latest.documentKey !== pendingSaveViewport.documentKey) {
        return;
      }
      // The editor stays writable during persistence. Capture immediately
      // before the successful result patches its reactive state so later
      // restoration never rewinds scrolling or selection to save-start values.
      pendingSaveViewport = latest;
      completedSaveViewport = latest;
    },
    { flush: "pre" }
  );

  function initializeLoadingState(
    key: string,
    bookId: string,
    file: LongWorkspaceFileReference
  ): void {
    const existing = documentStates.value[key];
    const dirty = existing
      ? existing.loaded && existing.content !== existing.savedContent
      : false;
    const refreshingJustSavedDocument = Boolean(
      pendingSaveViewport &&
      pendingSaveViewport.documentKey === currentEditorViewportKey() &&
      options.currentSelectionFile.value?.file.id === file.id
    );
    replaceDocumentState(key, {
      bookId,
      file,
      content: existing?.content ?? "",
      savedContent: existing?.savedContent ?? "",
      loading: true,
      saving: false,
      // Keep the just-saved editor mounted while the refreshed file is read.
      // `loading` still makes the textarea read-only, without flashing a loading
      // placeholder or swapping the editor background during the refresh.
      loaded: dirty || refreshingJustSavedDocument,
      loadError: null
    });
  }

  function assertSameReadSnapshot(
    first: LongReadDocumentResult,
    next: LongReadDocumentResult
  ): void {
    if (
      first.file.id !== next.file.id ||
      first.file.updatedAt !== next.file.updatedAt ||
      first.totalCharacters !== next.totalCharacters
    ) {
      throw new Error(t("theLongFormFileChangedWhileItsPagesWere"));
    }
  }

  async function loadWorkspaceDocument(
    selectedFile: LongWorkspaceSelectionFile,
    force = false,
    first = false
  ): Promise<void> {
    const bookId = props.bookId;
    await documentLoadQueue.load(
      () => readWorkspaceDocument(selectedFile, force, bookId),
      first
    );
  }

  async function readWorkspaceDocument(
    selectedFile: LongWorkspaceSelectionFile,
    force: boolean,
    bookId: string
  ): Promise<void> {
    if (selectedFile.inlineContent !== undefined) {
      const key = stateKey(selectedFile.file.id, bookId);
      const content = selectedFile.inlineContent;
      replaceDocumentState(key, {
        bookId,
        file: selectedFile.file,
        content,
        savedContent: content,
        loading: false,
        saving: false,
        loaded: true,
        loadError: null
      });
      return;
    }
    const api = resolveLongWorkspaceApi();
    if (!api) {
      uiMessage.warning(
        t("theLongFormWorkspaceIsUnavailableInThisEnvironment")
      );
      return;
    }

    const key = stateKey(selectedFile.file.id, bookId);
    const existing = documentStates.value[key];
    if (
      !force &&
      existing?.loaded &&
      !existing.loading &&
      (existing.file.updatedAt === selectedFile.file.updatedAt ||
        existing.content !== existing.savedContent)
    ) {
      return;
    }
    if (
      options.isComposing?.value &&
      existing?.loaded &&
      options.currentSelectionFile.value?.file.id === selectedFile.file.id
    ) {
      deferredSelectedReload = { bookId, fileId: selectedFile.file.id, force };
      return;
    }
    const inflight = inflightDocumentLoads.get(key);
    if (
      !force &&
      inflight &&
      existing?.file.updatedAt === selectedFile.file.updatedAt
    ) {
      await inflight;
      return;
    }
    const ownRequest = ++requestClock;
    requestClockByFile.set(key, ownRequest);
    initializeLoadingState(key, bookId, selectedFile.file);

    let loadPromise: Promise<void> | null = null;
    loadPromise = (async () => {
      try {
        let offset = 0;
        const contentChunks: string[] = [];
        let firstPage: LongReadDocumentResult | undefined;
        while (true) {
          const page = await api.readDocument({
            bookId,
            fileId: selectedFile.file.id,
            offset,
            maxCharacters: DOCUMENT_PAGE_CHARACTERS
          });
          if (requestClockByFile.get(key) !== ownRequest) return;
          if (page.file.id !== selectedFile.file.id) {
            throw new Error(t("theLoadedLongFormDocumentDoesNotMatchThe"));
          }
          if (firstPage) {
            assertSameReadSnapshot(firstPage, page);
          } else {
            firstPage = page;
          }
          contentChunks.push(page.content);
          if (page.nextOffset === null) break;
          if (page.nextOffset <= offset) {
            throw new Error(
              t("theLongFormDocumentHasAnInvalidPaginationCursor")
            );
          }
          offset = page.nextOffset;
        }

        if (!firstPage || requestClockByFile.get(key) !== ownRequest) return;
        const content = contentChunks.join("");
        // `locked` is a transient write barrier (proposal approval / send
        // preflight), not a property of the document. Recovery still needs to be
        // discovered while that barrier is active so it is not silently skipped
        // until a later remount.
        const editable =
          !selectedFile.readOnly && isEditableLongFile(firstPage.file);
        const recovery = editable
          ? options.readRecoveryRecord(bookId, firstPage.file.id)
          : null;
        const recoveredContent =
          recovery && recovery.content !== content ? recovery.content : content;
        replaceDocumentState(key, {
          bookId,
          file: firstPage.file,
          content: recoveredContent,
          savedContent: content,
          loading: false,
          saving: false,
          loaded: true,
          loadError: null
        });
        if (recovery?.content === content) {
          options.clearRecoveryRecordForKey(key, bookId, firstPage.file.id);
        } else if (recovery) {
          uiMessage.info(
            t("restoredUnsavedLocalContentFor", {
              value: props.selection?.title ?? firstPage.file.path
            })
          );
        }
        if (
          props.bookId === bookId &&
          !props.selection?.key.startsWith("chapter:") &&
          options.currentSelectionFile.value?.file.id === firstPage.file.id
        ) {
          emit("contextChange", {
            bookId,
            fileId: firstPage.file.id
          });
        }
      } catch (error: unknown) {
        const latest = documentStates.value[key];
        if (requestClockByFile.get(key) === ownRequest && latest) {
          const message = formatError(error, t("couldNotReadTheLongFormFile"));
          replaceDocumentState(key, {
            ...latest,
            loading: false,
            // Preserve previously shown text while the failed read is retried.
            loaded: false,
            loadError: message
          });
          uiMessage.error(message);
        }
      } finally {
        if (inflightDocumentLoads.get(key) === loadPromise) {
          inflightDocumentLoads.delete(key);
        }
      }
    })();
    inflightDocumentLoads.set(key, loadPromise);
    await loadPromise;
  }

  async function loadSelectedDocument(force = false): Promise<void> {
    const selectedFile = options.currentSelectionFile.value;
    if (!selectedFile) return;
    await loadWorkspaceDocument(selectedFile, force, true);
  }

  async function prefetchWorldbuildingSelectionFiles(): Promise<void> {
    if (!options.currentIsWorldbuildingList.value) return;
    const selection = props.selection;
    if (!selection?.files.length) return;
    const request = ++worldbuildingPrefetchRequest;
    const bookId = props.bookId;
    const selectionKey = selection.key;
    const files = [...selection.files];
    await documentLoadQueue.prefetch(
      files.map((file) => async () => {
        if (
          request !== worldbuildingPrefetchRequest ||
          props.bookId !== bookId ||
          props.selection?.key !== selectionKey
        ) {
          return;
        }
        await readWorkspaceDocument(file, false, bookId);
      })
    );
  }

  async function prefetchActiveSelectionFiles(): Promise<void> {
    // Worldbuilding list has its own prefetch. Avoid unbounded sibling character
    // prefetches: only warm the files belonging to the active selection.
    if (options.currentIsWorldbuildingList.value) return;
    const selection = props.selection;
    if (!selection?.files.length) return;
    const request = ++selectionPrefetchRequest;
    const bookId = props.bookId;
    const selectionKey = selection.key;
    const characterId = selection.characterId ?? null;
    const files = [...selection.files];
    await documentLoadQueue.prefetch(
      files.map((file) => async () => {
        if (
          request !== selectionPrefetchRequest ||
          props.bookId !== bookId ||
          props.selection?.key !== selectionKey ||
          (characterId !== null &&
            (props.selection?.characterId ?? null) !== characterId)
        ) {
          return;
        }
        await readWorkspaceDocument(file, false, bookId);
      })
    );
  }

  async function ensureDocumentsLoaded(
    files: LongWorkspaceSelectionFile[]
  ): Promise<boolean> {
    if (!files.length) return true;
    await Promise.all(files.map((file) => loadWorkspaceDocument(file)));
    return files.every((file) => {
      const state = documentStates.value[stateKey(file.file.id)];
      return Boolean(state?.loaded || state?.content);
    });
  }

  async function saveDocumentState(
    key: string,
    announceSuccess: boolean
  ): Promise<boolean> {
    const api = resolveLongWorkspaceApi();
    const state = documentStates.value[key];
    if (
      !api ||
      !state ||
      state.loading ||
      state.saving ||
      state.content === state.savedContent
    ) {
      if (!api) {
        uiMessage.warning(
          t("theLongFormWorkspaceIsUnavailableInThisEnvironment")
        );
      }
      return Boolean(api && state && !state.loading && !state.saving);
    }

    const bookId = state.bookId;
    const submittedContent = state.content;
    replaceDocumentState(key, { ...state, saving: true });
    try {
      const result = await api.writeDocument({
        bookId,
        fileId: state.file.id,
        content: submittedContent
      });
      const latest = documentStates.value[key];
      if (!latest) return false;
      replaceDocumentState(key, {
        ...latest,
        file: result.file,
        savedContent: submittedContent,
        saving: false,
        loaded: true,
        loadError: null
      });
      emit("saved", result);
      if (
        props.bookId === bookId &&
        !props.selection?.key.startsWith("chapter:") &&
        options.currentSelectionFile.value?.file.id === result.file.id
      ) {
        emit("contextChange", {
          bookId,
          fileId: result.file.id
        });
      }
      const savedState = documentStates.value[key];
      if (savedState?.content === savedState?.savedContent) {
        options.clearRecoveryRecordForKey(key, bookId, result.file.id);
      } else if (savedState) {
        options.persistRecoveryForKey(key);
      }
      if (announceSuccess) {
        if (savedState?.content === savedState?.savedContent) {
          uiMessage.success(
            t("saved", {
              value: props.selection?.title ?? state.file.path
            })
          );
        } else {
          uiMessage.info(t("theSubmittedContentWasSavedNewEditsMadeDuring"));
        }
      }
      return true;
    } catch (error: unknown) {
      const latest = documentStates.value[key];
      if (latest) {
        replaceDocumentState(key, { ...latest, saving: false });
      }
      const message = formatError(error, t("couldNotSaveTheLongFormFile"));
      uiMessage.error(message);
      return false;
    }
  }

  function runExclusiveSave(task: () => Promise<boolean>): Promise<boolean> {
    if (activeSavePromise) return activeSavePromise;
    workspaceSavePending.value = true;
    const pending = task().finally(() => {
      workspaceSavePending.value = false;
      if (activeSavePromise === pending) {
        activeSavePromise = null;
      }
    });
    activeSavePromise = pending;
    return pending;
  }

  async function saveCurrentDocument(): Promise<void> {
    if (manualSaving.value) return;
    manualSaving.value = true;
    try {
      await persistCurrentDocument();
    } finally {
      manualSaving.value = false;
    }
  }

  async function persistCurrentDocument(): Promise<void> {
    const viewport = captureCurrentEditorViewport();
    pendingSaveViewport = viewport;
    completedSaveViewport = null;
    if (options.currentIsStructuredText.value) {
      let saved = true;
      if (!options.currentReadOnly.value && options.currentDirty.value) {
        saved = await saveAllChanges();
      }
      await restoreCurrentEditorViewport(
        completedSaveViewport ?? pendingSaveViewport ?? viewport
      );
      completedSaveViewport = null;
      if (!saved && pendingSaveViewport === viewport) {
        pendingSaveViewport = null;
      }
      return;
    }
    const selectedFile = options.currentSelectionFile.value;
    if (
      !selectedFile ||
      options.currentReadOnly.value ||
      !options.currentDirty.value
    ) {
      pendingSaveViewport = null;
      return;
    }
    const saved = await runExclusiveSave(() =>
      saveDocumentState(stateKey(selectedFile.file.id), true)
    );
    await restoreCurrentEditorViewport(
      completedSaveViewport ?? pendingSaveViewport ?? viewport
    );
    completedSaveViewport = null;
    if (!saved && pendingSaveViewport === viewport) {
      pendingSaveViewport = null;
    }
  }

  /** Writes all dirty long-form drafts through the existing serialized save lane. */
  async function persistAllChanges(announceResult: boolean): Promise<boolean> {
    if (activeSavePromise && !(await activeSavePromise)) {
      return false;
    }
    const bookPrefix = `${props.bookId}\u0000`;
    const dirtyKeys = Object.entries(documentStates.value)
      .filter(
        ([key, state]) =>
          key.startsWith(bookPrefix) &&
          state.loaded &&
          state.content !== state.savedContent
      )
      .map(([key]) => key);
    const dirtyVolumeIds = Object.entries(options.volumeOutlineDrafts.value)
      .filter(
        ([, draft]) => !draft.saving && draft.content !== draft.savedContent
      )
      .map(([volumeId]) => volumeId);
    const dirtyPlotPointSummaryIds = Object.entries(
      options.plotPointSummaryDrafts.value
    )
      .filter(
        ([, draft]) => !draft.saving && draft.content !== draft.savedContent
      )
      .map(([plotPointId]) => plotPointId as LongArcId);
    if (
      !dirtyKeys.length &&
      !dirtyVolumeIds.length &&
      !dirtyPlotPointSummaryIds.length
    ) {
      return true;
    }

    const saved = await runExclusiveSave(async () => {
      for (const key of dirtyKeys) {
        if (!(await saveDocumentState(key, false))) {
          return false;
        }
      }
      for (const volumeId of dirtyVolumeIds) {
        if (!(await options.saveVolumeOutline(volumeId))) {
          return false;
        }
      }
      for (const plotPointId of dirtyPlotPointSummaryIds) {
        if (!(await options.savePlotPointContent(plotPointId, "summary"))) {
          return false;
        }
      }
      // Editing remains available during an asynchronous save. A keystroke
      // after a file's submitted snapshot must keep navigation blocked instead
      // of being mistaken for part of the successful write.
      return (
        !Object.entries(documentStates.value).some(
          ([key, state]) =>
            key.startsWith(bookPrefix) &&
            state.loaded &&
            state.content !== state.savedContent
        ) &&
        !Object.values(options.volumeOutlineDrafts.value).some(
          (draft) => draft.content !== draft.savedContent
        ) &&
        !Object.values(options.plotPointSummaryDrafts.value).some(
          (draft) => draft.content !== draft.savedContent
        )
      );
    });
    if (saved && announceResult) {
      const savedCount =
        dirtyKeys.length +
        dirtyVolumeIds.length +
        dirtyPlotPointSummaryIds.length;
      uiMessage.success(
        t("automaticallySavedLongFormChangesBeforeLeaving", {
          savedCount: savedCount
        })
      );
    } else if (!saved && announceResult) {
      uiMessage.warning(
        t("longFormChangesAreStillUnsavedNavigationWasCanceled")
      );
    }
    return saved;
  }

  async function saveAllChanges(): Promise<boolean> {
    return persistAllChanges(true);
  }

  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function cancelAutoSave(): void {
    if (autoSaveTimer !== undefined) clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
  }

  function scheduleAutoSave(): void {
    cancelAutoSave();
    if (
      disposed ||
      !props.autoSaveEnabled ||
      props.locked ||
      options.isComposing?.value
    )
      return;
    const bookId = props.bookId;
    const hasDirtyChanges =
      Object.entries(documentStates.value).some(
        ([key, state]) =>
          key.startsWith(`${bookId}\u0000`) &&
          state.loaded &&
          state.content !== state.savedContent
      ) ||
      Object.values(options.volumeOutlineDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      ) ||
      Object.values(options.plotPointSummaryDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      );
    if (!hasDirtyChanges) return;
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = undefined;
      void (async () => {
        if (activeSavePromise) await activeSavePromise;
        if (
          disposed ||
          !props.autoSaveEnabled ||
          props.locked ||
          options.isComposing?.value ||
          props.bookId !== bookId
        ) {
          return;
        }
        await persistAllChanges(false);
      })();
    }, AUTO_SAVE_DELAY_MS);
  }

  watch(
    () => [
      props.bookId,
      ...Object.entries(documentStates.value)
        .filter(
          ([key, state]) =>
            key.startsWith(`${props.bookId}\u0000`) && state.loaded
        )
        .flatMap(([key, state]) => [key, state.content]),
      ...Object.entries(options.volumeOutlineDrafts.value).flatMap(
        ([key, draft]) => [key, draft.content]
      ),
      ...Object.entries(options.plotPointSummaryDrafts.value).flatMap(
        ([key, draft]) => [key, draft.content]
      )
    ],
    (next, previous) => {
      if (
        previous &&
        next.length === previous.length &&
        next.every((value, index) => value === previous[index])
      ) {
        return;
      }
      scheduleAutoSave();
    },
    { immediate: true }
  );

  watch(
    () =>
      [
        props.autoSaveEnabled,
        props.locked,
        options.isComposing?.value
      ] as const,
    scheduleAutoSave,
    { flush: "sync" }
  );

  watch(
    () => props.bookId,
    () => {
      heldSelectionFile.value = null;
    },
    { flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        options.currentSelectionFile.value?.file.id,
        currentState.value?.loaded,
        currentState.value?.content,
        currentState.value?.loading
      ] as const,
    () => {
      const target = options.currentSelectionFile.value;
      if (!target) {
        heldSelectionFile.value = null;
        return;
      }
      const state = documentStates.value[stateKey(target.file.id)];
      if (state?.loaded || Boolean(state?.content)) {
        heldSelectionFile.value = target;
        return;
      }
      const held = heldSelectionFile.value;
      if (held) {
        const heldState = documentStates.value[stateKey(held.file.id)];
        if (heldState?.loaded || Boolean(heldState?.content)) {
          return;
        }
      }
      heldSelectionFile.value = target;
    },
    { immediate: true, flush: "sync" }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        options.currentIsWorldbuildingList.value,
        (props.selection?.worldbuildingItems ?? [])
          .map(({ id }) => id)
          .join("\u0000")
      ] as const,
    () => {
      if (options.currentIsWorldbuildingList.value) {
        selectionPrefetchRequest += 1;
        void prefetchWorldbuildingSelectionFiles();
        return;
      }
      worldbuildingPrefetchRequest += 1;
      documentLoadQueue.cancelPrefetch();
    },
    { immediate: true }
  );

  watch(
    () =>
      [
        props.bookId,
        props.selection?.key,
        props.selection?.characterId ?? null,
        props.selection?.files.map(({ file }) => file.id).join("\u0000") ?? ""
      ] as const,
    () => {
      if (options.currentIsWorldbuildingList.value) return;
      void prefetchActiveSelectionFiles();
    },
    { immediate: true }
  );

  watch(
    [
      () => props.bookId,
      () => {
        const file = options.currentSelectionFile.value?.file;
        const chapter = props.selection?.key.startsWith("chapter:");
        return file &&
          (!chapter ||
            (!options.pendingFileId?.value && currentState.value?.loaded))
          ? file.id
          : null;
      }
    ],
    ([bookId, fileId]) =>
      emit("contextChange", fileId ? { bookId, fileId } : null),
    { immediate: true }
  );

  watch(
    () =>
      [
        props.bookId,
        options.currentSelectionFile.value?.file.id,
        options.currentSelectionFile.value?.file.updatedAt
      ] as const,
    () => {
      const selectedFile = options.currentSelectionFile.value;
      const snapshot = pendingSaveViewport;
      const selectedKey = selectedFile
        ? stateKey(selectedFile.file.id)
        : undefined;
      const requestBefore = selectedKey
        ? requestClockByFile.get(selectedKey)
        : undefined;
      void loadSelectedDocument().finally(() => {
        if (!snapshot || pendingSaveViewport !== snapshot) return;
        pendingSaveViewport = null;
        // Only a disk reload replaces the textarea. The post-save refresh
        // usually skips it, and the editor stays writable meanwhile, so
        // restoring the save-time caret would rewind text typed since then.
        if (
          selectedKey &&
          requestClockByFile.get(selectedKey) !== requestBefore
        ) {
          void restoreCurrentEditorViewport(snapshot);
        }
      });
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    disposed = true;
    deferredSelectedReload = null;
    documentLoadQueue.dispose();
    cancelAutoSave();
    worldbuildingPrefetchRequest += 1;
    selectionPrefetchRequest += 1;
    requestClockByFile.clear();
    inflightDocumentLoads.clear();
  });

  watch(
    () => options.isComposing?.value,
    (composing) => {
      if (composing || !deferredSelectedReload) return;
      const deferred = deferredSelectedReload;
      deferredSelectedReload = null;
      // Let compositionend publish committed text before deciding whether a
      // refreshed disk read is still safe for this document's dirty draft.
      void nextTick(() => {
        if (
          disposed ||
          props.bookId !== deferred.bookId ||
          options.currentSelectionFile.value?.file.id !== deferred.fileId
        )
          return;
        return loadSelectedDocument(deferred.force);
      });
    },
    { flush: "sync" }
  );

  return {
    heldSelectionFile,
    workspaceSavePending,
    manualSaving,
    currentState,
    isDocumentSwitchPending,
    displayDocumentState,
    showEditorLoading,
    showEditorLoadError,
    stateKey,
    replaceDocumentState,
    loadWorkspaceDocument,
    loadSelectedDocument,
    prefetchWorldbuildingSelectionFiles,
    prefetchActiveSelectionFiles,
    ensureDocumentsLoaded,
    saveDocumentState,
    saveCurrentDocument,
    saveAllChanges
  };
}
