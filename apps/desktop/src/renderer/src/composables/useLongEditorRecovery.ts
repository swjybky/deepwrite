import { createScopedTranslator } from "../i18n";
import { onBeforeUnmount, onMounted, type ComputedRef, type Ref } from "vue";
import type {
  LongFileId,
  LongWorkspaceFileReference
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import { isEditableLongFile } from "../types/longWorkspace";
import { optionalUiStorage } from "../utils/uiStorage";

const t = createScopedTranslator("workspace.longEditorRecovery");

export const RECOVERY_STORAGE_PREFIX = "deepwrite:long-editor-recovery:v1:";
export const RECOVERY_WRITE_DEBOUNCE_MS = 300;
export const RECOVERY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RECOVERY_MAX_RECORD_CHARACTERS = 4 * 1024 * 1024;
export const RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface LongEditorRecoveryRecord {
  schemaVersion: 2;
  bookId: string;
  fileId: LongFileId;
  filePath: string;
  content: string;
  savedContent: string;
  timestamp: number;
}

export interface LongEditorRecoverableDocumentState {
  bookId: string;
  file: LongWorkspaceFileReference;
  content: string;
  savedContent: string;
  loaded: boolean;
}

export function useLongEditorRecovery(options: {
  documentStates: Ref<Record<string, LongEditorRecoverableDocumentState>>;
  hasUnsavedChanges: ComputedRef<boolean>;
}): {
  recoveryStorageKey: (bookId: string, fileId: string) => string;
  resolveRecoveryStorage: () => Storage | null;
  cancelRecoveryWrite: (key: string) => void;
  clearRecoveryRecordForKey: (
    key: string,
    bookId: string,
    fileId: string
  ) => void;
  parseStoredRecovery: (
    raw: string,
    expectedBookId: string,
    expectedFileId: LongFileId
  ) => LongEditorRecoveryRecord | null;
  readRecoveryRecord: (
    bookId: string,
    fileId: LongFileId
  ) => LongEditorRecoveryRecord | null;
  persistRecoveryForKey: (key: string) => void;
  scheduleRecoveryWrite: (key: string) => void;
  flushAllRecoveryRecords: () => void;
  handleBeforeUnload: (event: BeforeUnloadEvent) => void;
} {
  const recoveryWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recoveryWriteWarningKeys = new Set<string>();

  function recoveryStorageKey(bookId: string, fileId: string): string {
    return `${RECOVERY_STORAGE_PREFIX}${encodeURIComponent(bookId)}:${encodeURIComponent(fileId)}`;
  }

  function resolveRecoveryStorage(): Storage | null {
    try {
      return optionalUiStorage();
    } catch {
      return null;
    }
  }

  function cancelRecoveryWrite(key: string): void {
    const timer = recoveryWriteTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      recoveryWriteTimers.delete(key);
    }
  }

  function removeStoredRecovery(bookId: string, fileId: string): void {
    try {
      resolveRecoveryStorage()?.removeItem(recoveryStorageKey(bookId, fileId));
    } catch {
      // A disabled or unavailable localStorage must never break the editor.
    }
  }

  function clearRecoveryRecordForKey(
    key: string,
    bookId: string,
    fileId: string
  ): void {
    cancelRecoveryWrite(key);
    removeStoredRecovery(bookId, fileId);
    recoveryWriteWarningKeys.delete(key);
  }

  function parseStoredRecovery(
    raw: string,
    expectedBookId: string,
    expectedFileId: LongFileId
  ): LongEditorRecoveryRecord | null {
    if (raw.length > RECOVERY_MAX_RECORD_CHARACTERS) return null;
    try {
      const value = JSON.parse(raw) as Partial<
        Omit<LongEditorRecoveryRecord, "schemaVersion">
      > & { schemaVersion?: number };
      const now = Date.now();
      if (
        (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
        value.bookId !== expectedBookId ||
        value.fileId !== expectedFileId ||
        typeof value.filePath !== "string" ||
        value.filePath.length > 4096 ||
        typeof value.content !== "string" ||
        typeof value.savedContent !== "string" ||
        typeof value.timestamp !== "number" ||
        !Number.isFinite(value.timestamp) ||
        value.timestamp <= 0 ||
        value.timestamp > now + RECOVERY_CLOCK_SKEW_MS ||
        now - value.timestamp > RECOVERY_MAX_AGE_MS
      ) {
        return null;
      }
      return {
        schemaVersion: 2,
        bookId: value.bookId,
        fileId: value.fileId,
        filePath: value.filePath,
        content: value.content,
        savedContent: value.savedContent,
        timestamp: value.timestamp
      };
    } catch {
      return null;
    }
  }

  function readRecoveryRecord(
    bookId: string,
    fileId: LongFileId
  ): LongEditorRecoveryRecord | null {
    const storage = resolveRecoveryStorage();
    if (!storage) return null;
    const storageKey = recoveryStorageKey(bookId, fileId);
    try {
      const raw = storage.getItem(storageKey);
      if (raw === null) return null;
      const record = parseStoredRecovery(raw, bookId, fileId);
      if (record) return record;
      storage.removeItem(storageKey);
    } catch {
      // Corrupt or inaccessible recovery state is ignored without blocking load.
    }
    return null;
  }

  function warnRecoveryWriteFailure(key: string, message: string): void {
    if (recoveryWriteWarningKeys.has(key)) return;
    recoveryWriteWarningKeys.add(key);
    uiMessage.warning(message);
  }

  function persistRecoveryForKey(key: string): void {
    cancelRecoveryWrite(key);
    const state = options.documentStates.value[key];
    if (!state || !state.loaded || !isEditableLongFile(state.file)) return;
    if (state.content === state.savedContent) {
      clearRecoveryRecordForKey(key, state.bookId, state.file.id);
      return;
    }

    const record: LongEditorRecoveryRecord = {
      schemaVersion: 2,
      bookId: state.bookId,
      fileId: state.file.id,
      filePath: state.file.path,
      content: state.content,
      savedContent: state.savedContent,
      timestamp: Date.now()
    };
    if (
      state.content.length + state.savedContent.length >
      RECOVERY_MAX_RECORD_CHARACTERS - 16 * 1024
    ) {
      removeStoredRecovery(state.bookId, state.file.id);
      warnRecoveryWriteFailure(key, t("thisNovelFileIsTooLargeToSaveA"));
      return;
    }
    const serialized = JSON.stringify(record);
    if (serialized.length > RECOVERY_MAX_RECORD_CHARACTERS) {
      removeStoredRecovery(state.bookId, state.file.id);
      warnRecoveryWriteFailure(key, t("thisNovelFileIsTooLargeToSaveA"));
      return;
    }

    const storage = resolveRecoveryStorage();
    if (!storage) {
      warnRecoveryWriteFailure(
        key,
        t("localStorageIsUnavailableANovelRecoveryCopyCannot")
      );
      return;
    }
    try {
      storage.setItem(
        recoveryStorageKey(state.bookId, state.file.id),
        serialized
      );
      recoveryWriteWarningKeys.delete(key);
    } catch {
      // setItem is atomic, but an older value may still exist after quota failure.
      // Removing it prevents a later restart from restoring an outdated copy.
      removeStoredRecovery(state.bookId, state.file.id);
      warnRecoveryWriteFailure(
        key,
        t("failedToSaveTheNovelRecoveryCopySaveThe")
      );
    }
  }

  function scheduleRecoveryWrite(key: string): void {
    cancelRecoveryWrite(key);
    recoveryWriteTimers.set(
      key,
      setTimeout(() => {
        recoveryWriteTimers.delete(key);
        persistRecoveryForKey(key);
      }, RECOVERY_WRITE_DEBOUNCE_MS)
    );
  }

  function flushAllRecoveryRecords(): void {
    for (const key of Object.keys(options.documentStates.value)) {
      const state = options.documentStates.value[key];
      if (
        state?.loaded &&
        isEditableLongFile(state.file) &&
        state.content !== state.savedContent
      ) {
        persistRecoveryForKey(key);
      }
    }
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    flushAllRecoveryRecords();
    if (!options.hasUnsavedChanges.value) return;
    event.preventDefault();
    event.returnValue = "";
  }

  onMounted(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
  });
  onBeforeUnmount(() => {
    flushAllRecoveryRecords();
    for (const key of [...recoveryWriteTimers.keys()]) {
      cancelRecoveryWrite(key);
    }
    window.removeEventListener("beforeunload", handleBeforeUnload);
  });

  return {
    recoveryStorageKey,
    resolveRecoveryStorage,
    cancelRecoveryWrite,
    clearRecoveryRecordForKey,
    parseStoredRecovery,
    readRecoveryRecord,
    persistRecoveryForKey,
    scheduleRecoveryWrite,
    flushAllRecoveryRecords,
    handleBeforeUnload
  };
}
