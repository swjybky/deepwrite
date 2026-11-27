import {
  formatError,
  getErrorCode,
  getErrorDetail,
  getErrorPayload
} from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { ref } from "vue";
import type {
  ConversationCompactionStatus,
  DeepWriteApi,
  StorageSettingsErrorCode
} from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.storageSettings");

type StorageMessageKey = Parameters<typeof t>[0];

const errorMessages: Record<StorageSettingsErrorCode, StorageMessageKey> = {
  "storage_settings.busy": "storageBusy",
  "storage_settings.invalid_directory": "invalidDirectory",
  "storage_settings.unresolvable_path": "unresolvablePath",
  "storage_settings.overlaps_installation": "overlapsInstallation",
  "storage_settings.nested_location": "nestedLocation",
  "storage_settings.target_not_empty": "targetNotEmpty",
  "storage_settings.not_writable": "notWritable",
  "storage_settings.save_failed": "saveFailed",
  "storage_settings.open_failed": "openFailed"
};

function isStorageErrorCode(
  code: string | undefined
): code is StorageSettingsErrorCode {
  return code !== undefined && Object.hasOwn(errorMessages, code);
}

/** Known reasons are translated by code; unknown Main failures keep their diagnostic. */
function describeError(
  error: unknown,
  fallback: string,
  withReason?: (reason: string) => string
): string {
  const code = getErrorCode(error);
  if (isStorageErrorCode(code)) return t(errorMessages[code]);
  if (withReason && getErrorPayload(error)) {
    const reason = getErrorDetail(error);
    if (reason) return withReason(reason);
  }
  return formatError(error, fallback);
}

type StorageApi = NonNullable<DeepWriteApi["storageSettings"]>;
type StorageSettings = Awaited<ReturnType<StorageApi["get"]>>;
type DirectoryKind = Parameters<StorageApi["openDirectory"]>[0];

interface StorageSettingsContext {
  api(): StorageApi | undefined;
  notifications: {
    error(message: string): unknown;
    success(message: string): unknown;
  };
}

export function useStorageSettings(context: StorageSettingsContext) {
  const settings = ref<StorageSettings | null>(null);
  const loading = ref(false);
  const migrating = ref(false);
  const restarting = ref(false);
  const compacting = ref(false);
  const releasingBackup = ref(false);
  let disposed = false;
  let loadGeneration = 0;

  function applyCompactionStatus(status: ConversationCompactionStatus): void {
    if (disposed || !settings.value) return;
    settings.value = {
      ...settings.value,
      conversationCompaction: status
    };
  }

  function showError(
    error: unknown,
    fallback: string,
    withReason?: (reason: string) => string
  ): void {
    if (!disposed) {
      context.notifications.error(describeError(error, fallback, withReason));
    }
  }

  async function load(): Promise<void> {
    const api = context.api();
    if (!api || disposed || migrating.value || restarting.value) return;
    const generation = ++loadGeneration;
    loading.value = true;
    try {
      const result = await api.get();
      if (!disposed && generation === loadGeneration) settings.value = result;
    } catch (error) {
      if (generation === loadGeneration) {
        showError(error, t("failedToReadStorageSettingsPleaseTryAgain"));
      }
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  async function changeUserData(reset = false): Promise<void> {
    const api = context.api();
    if (
      !api ||
      disposed ||
      !settings.value ||
      loading.value ||
      migrating.value ||
      restarting.value
    ) {
      return;
    }
    migrating.value = true;
    try {
      const result = await (reset ? api.resetUserData() : api.chooseUserData());
      if (disposed) return;
      restarting.value = result.restarting;
      if (result.restarting) {
        context.notifications.success(
          t("dataMigrationIsReadyTheAppWillRestart")
        );
      }
    } catch (error) {
      showError(
        error,
        t("failedToChangeTheUserDataDirectoryPleaseTry"),
        (reason) =>
          t("failedToChangeTheUserDataDirectoryWithReason", { reason })
      );
    } finally {
      migrating.value = false;
    }
  }

  async function openDirectory(kind: DirectoryKind): Promise<void> {
    const api = context.api();
    if (!api || disposed || migrating.value || restarting.value) return;
    try {
      await api.openDirectory(kind);
    } catch (error) {
      showError(error, t("failedToOpenDirectoryPleaseTryAgain"));
    }
  }

  async function compactConversations(): Promise<void> {
    const api = context.api();
    if (
      !api ||
      disposed ||
      loading.value ||
      migrating.value ||
      restarting.value ||
      compacting.value ||
      releasingBackup.value
    ) {
      return;
    }
    compacting.value = true;
    try {
      const status = await api.compactConversations();
      if (disposed) return;
      applyCompactionStatus(status);
      if (status.phase === "completed_with_backup") {
        context.notifications.success(t("compactionCompletedWithBackup"));
      } else if (status.phase === "failed") {
        context.notifications.error(
          status.failureDetail
            ? t("compactionFailedWithReason", { reason: status.failureDetail })
            : t("compactionFailed")
        );
      }
    } catch (error) {
      showError(error, t("compactionFailed"), (detail) =>
        t("compactionFailedWithReason", { reason: detail })
      );
    } finally {
      compacting.value = false;
    }
  }

  async function releaseConversationBackup(): Promise<void> {
    const api = context.api();
    if (
      !api ||
      disposed ||
      loading.value ||
      migrating.value ||
      restarting.value ||
      compacting.value ||
      releasingBackup.value
    ) {
      return;
    }
    releasingBackup.value = true;
    try {
      const status = await api.releaseConversationBackup();
      if (disposed) return;
      applyCompactionStatus(status);
      if (status.phase === "backup_released") {
        context.notifications.success(t("compactionBackupReleased"));
      } else if (status.failureDetail) {
        context.notifications.error(
          t("compactionFailedWithReason", { reason: status.failureDetail })
        );
      }
    } catch (error) {
      showError(error, t("compactionFailed"), (detail) =>
        t("compactionFailedWithReason", { reason: detail })
      );
    } finally {
      releasingBackup.value = false;
    }
  }

  function dispose(): void {
    disposed = true;
    loadGeneration += 1;
  }

  return {
    settings,
    loading,
    migrating,
    restarting,
    compacting,
    releasingBackup,
    load,
    changeUserData,
    openDirectory,
    applyCompactionStatus,
    compactConversations,
    releaseConversationBackup,
    dispose
  };
}
