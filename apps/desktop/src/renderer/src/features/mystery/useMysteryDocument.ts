import type {
  DeepWriteApi,
  MysteryBookSummary,
  MysteryDocumentTarget
} from "@deepwrite/contracts";
import { mysteryDocumentTargetKey } from "@deepwrite/contracts/renderer";
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";

import { getErrorCode } from "../../i18n/errors";

export function useMysteryDocument(options: {
  api(): DeepWriteApi["mystery"] | undefined;
  bookId(): string;
  target(): MysteryDocumentTarget;
  selectTarget?(target: MysteryDocumentTarget): void;
  autoSaveEnabled(): boolean;
  refreshBook(summary: MysteryBookSummary): Promise<void>;
  onLoadError(error: unknown): void;
  onSaveError(error: unknown): void;
}) {
  const docContent = ref("");
  const savedContent = ref("");
  const docLoading = ref(false);
  const docSaving = ref(false);
  const composing = ref(false);
  const loadedKey = ref("");
  const conflict = shallowRef<{
    key: string;
    content: string;
    revision: string;
  } | null>(null);
  const docDirty = computed(() => docContent.value !== savedContent.value);
  let revision: string | undefined;
  let loadClock = 0;
  let editClock = 0;
  let pendingWrite: Promise<boolean> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const documentKey = (bookId = options.bookId(), target = options.target()) =>
    JSON.stringify([bookId, mysteryDocumentTargetKey(target)]);
  const docReady = computed(() => loadedKey.value === documentKey());

  function readTarget(
    api: NonNullable<DeepWriteApi["mystery"]>,
    bookId: string,
    target: MysteryDocumentTarget
  ) {
    return target.kind === "agents_md"
      ? api.readAgentsMd({ bookId })
      : api.readDocument({ bookId, target: { ...target } });
  }

  async function loadDocument(
    target = options.target(),
    discardDraft = false
  ): Promise<boolean> {
    const api = options.api();
    if (!api || disposed) return false;
    const bookId = options.bookId();
    const key = documentKey(bookId, target);
    if (
      !discardDraft &&
      key === loadedKey.value &&
      (docDirty.value || docSaving.value || composing.value)
    )
      return true;

    const request = ++loadClock;
    const editAtLoad = editClock;
    docLoading.value = discardDraft || key !== loadedKey.value;
    try {
      const read = await readTarget(api, bookId, target);
      if (
        request !== loadClock ||
        bookId !== options.bookId() ||
        editAtLoad !== editClock ||
        composing.value
      )
        return false;
      if (key !== documentKey()) options.selectTarget?.(target);
      loadedKey.value = key;
      conflict.value = null;
      docContent.value = read.content;
      savedContent.value = read.content;
      revision = read.revision;
      return true;
    } catch (error: unknown) {
      if (request === loadClock && bookId === options.bookId())
        options.onLoadError(error);
      return false;
    } finally {
      if (request === loadClock) docLoading.value = false;
    }
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    if (
      !disposed &&
      options.autoSaveEnabled() &&
      docDirty.value &&
      !composing.value &&
      !pendingWrite
    ) {
      const key = documentKey();
      saveTimer = setTimeout(() => {
        if (key === documentKey() && options.autoSaveEnabled())
          void saveDocument();
      }, 800);
    }
  }

  async function writeSnapshot(): Promise<boolean> {
    const api = options.api();
    const bookId = options.bookId();
    const target = { ...options.target() };
    const key = documentKey(bookId, target);
    if (!api || !docReady.value || revision === undefined) return false;

    const content = docContent.value;
    const input = { bookId, content, expectedRevision: revision };
    try {
      const result =
        target.kind === "agents_md"
          ? await api.writeAgentsMd(input)
          : await api.writeDocument({ ...input, target });
      if (disposed || key !== documentKey()) return false;
      savedContent.value = content;
      revision = result.revision;
      if ("summary" in result) await options.refreshBook(result.summary);
      return !disposed && key === documentKey();
    } catch (error: unknown) {
      if (disposed || key !== documentKey()) return false;
      if (getErrorCode(error) === "mystery.conflict") {
        try {
          const disk = await readTarget(api, bookId, target);
          if (!disposed && key === documentKey())
            conflict.value = {
              key,
              content: disk.content,
              revision: disk.revision
            };
        } catch (readError) {
          if (!disposed && key === documentKey())
            options.onSaveError(readError);
        }
      } else options.onSaveError(error);
      return false;
    }
  }

  function persist(): Promise<boolean> {
    if (disposed || composing.value) return Promise.resolve(false);
    if (pendingWrite) return pendingWrite;
    if (conflict.value) return Promise.resolve(false);
    if (!docDirty.value) return Promise.resolve(true);
    clearTimeout(saveTimer);
    docSaving.value = true;
    pendingWrite = writeSnapshot().then((ok) => {
      pendingWrite = undefined;
      docSaving.value = false;
      if (ok) scheduleSave();
      return ok;
    });
    return pendingWrite;
  }

  async function saveDocument(): Promise<boolean> {
    return (await persist()) && !docDirty.value;
  }

  async function flushDocument(): Promise<boolean> {
    const key = documentKey();
    do {
      if (!(await persist()) || key !== documentKey() || disposed) return false;
    } while (docDirty.value);
    return true;
  }

  async function reloadConflict(): Promise<void> {
    if (conflict.value?.key === documentKey() && !docSaving.value)
      await loadDocument(options.target(), true);
  }

  async function overwriteConflict(): Promise<void> {
    const shown = conflict.value;
    if (
      !shown ||
      shown.key !== documentKey() ||
      docLoading.value ||
      docSaving.value
    )
      return;
    revision = shown.revision;
    savedContent.value = shown.content;
    conflict.value = null;
    await flushDocument();
  }

  function handleContentUpdate(content: string): void {
    if (!docReady.value || content === docContent.value) return;
    editClock += 1;
    docContent.value = content;
    scheduleSave();
  }

  watch([options.autoSaveEnabled, composing], scheduleSave, { flush: "sync" });

  onScopeDispose(() => {
    disposed = true;
    loadClock += 1;
    clearTimeout(saveTimer);
  });

  return {
    conflict,
    reloadConflict,
    overwriteConflict,
    docContent,
    docDirty,
    docLoading,
    docReady,
    docSaving,
    composing,
    handleContentUpdate,
    loadDocument,
    saveDocument,
    flushDocument
  };
}
