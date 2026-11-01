import { formatError, getErrorDetail } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  DeepWriteApi,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ModelUsageQueryInput
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { selectableModelSettings } from "../utils/selectableModelSettings";
import { useSiteOfficialModelSettings } from "./useSiteOfficialModelSettings";

const t = createScopedTranslator("workspace.modelSettingsCoordinator");

// Save and provider failure reasons need longer than the default toast to read.
const MODEL_ERROR_TOAST_MS = 8_000;

export interface ModelSettingsNotifications {
  error(message: string, options?: { duration?: number }): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface ModelSettingsCoordinatorContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: ModelSettingsNotifications;
  onModelsLoaded(settings: ModelSettings): void;
}

function errorMessage(error: unknown, fallback: string): string {
  return formatError(error, fallback);
}

export function useModelSettingsCoordinator(
  context: ModelSettingsCoordinatorContext
) {
  const { settingsStore, notifications: uiMessage } = context;
  let modelUsageRequestSequence = 0;
  let lastPublishedModelSettings: ModelSettings | null = null;

  function applyLoadedModelSettings(settings: ModelSettings): void {
    if (settingsStore.modelSettings !== settings) {
      settingsStore.markLoaded("models", settings);
    }
    if (lastPublishedModelSettings === settings) return;
    lastPublishedModelSettings = settings;
    context.onModelsLoaded(selectableModelSettings(settings));
  }

  async function loadModelSettings(): Promise<void> {
    const api = context.api();
    if (!api) return;
    try {
      const settings = await settingsStore.ensureModelsLoaded(() =>
        api.models.list()
      );
      applyLoadedModelSettings(settings);
    } catch {
      // The store retains a retriable error for the active feature surface.
    }
  }

  async function loadAppAlerts(): Promise<void> {
    const api = context.api()?.appAlerts;
    if (!api) {
      settingsStore.modelAlertMessages = [];
      return;
    }
    try {
      const snapshot = await api.get();
      settingsStore.modelAlertMessages = [...snapshot.modelMessages];
      if (snapshot.shouldShowDesktop) {
        settingsStore.startupAlertMessages = [...snapshot.desktopMessages];
        settingsStore.startupAlertRevision = snapshot.desktopRevision;
      }
    } catch {
      settingsStore.modelAlertMessages = [];
    }
  }

  function closeStartupAlert(): void {
    const revision = settingsStore.startupAlertRevision;
    settingsStore.startupAlertMessages = [];
    settingsStore.startupAlertRevision = "";
    const api = context.api()?.appAlerts;
    if (!revision || !api) return;
    void api.acknowledgeDesktop(revision).catch((error: unknown) => {
      console.warn(
        "DeepWrite desktop alert acknowledgement could not be saved:",
        errorMessage(error, "unknown error")
      );
    });
  }

  async function loadModelUsage(
    input: ModelUsageQueryInput = settingsStore.modelUsageQuery
  ): Promise<void> {
    const api = context.api()?.modelUsage;
    if (!api) return;
    const query = {
      ...(input.startAt ? { startAt: input.startAt } : {}),
      ...(input.endAt ? { endAt: input.endAt } : {}),
      ...(input.modelConfigIds?.length
        ? { modelConfigIds: [...input.modelConfigIds] }
        : {}),
      ...(input.managedBy ? { managedBy: input.managedBy } : {}),
      ...(input.modules?.length ? { modules: [...input.modules] } : {})
    } satisfies ModelUsageQueryInput;
    const requestSequence = ++modelUsageRequestSequence;
    settingsStore.modelUsageLoading = true;
    settingsStore.modelUsageError = null;
    try {
      const dashboard = await api.query(query);
      if (requestSequence !== modelUsageRequestSequence) return;
      settingsStore.modelUsageDashboard = dashboard;
      settingsStore.modelUsageQuery = query;
    } catch (error: unknown) {
      if (requestSequence !== modelUsageRequestSequence) return;
      settingsStore.modelUsageError = errorMessage(
        error,
        t("failedToLoadModelUsage")
      );
      uiMessage.warning(settingsStore.modelUsageError);
    } finally {
      if (requestSequence === modelUsageRequestSequence) {
        settingsStore.modelUsageLoading = false;
      }
    }
  }

  async function saveModelSettings(
    settings: ModelSettingsInput
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.modelSaving) return;
    settingsStore.modelSaving = true;
    settingsStore.modelError = null;
    settingsStore.modelTestMessage = null;
    try {
      const saved = await api.models.save(settings);
      applyLoadedModelSettings(saved);
      settingsStore.modelTestMessage = t(
        "modelSettingsSavedAndAppliedToSubsequentConversations"
      );
      uiMessage.success(settingsStore.modelTestMessage);
    } catch (error: unknown) {
      settingsStore.modelError =
        getErrorDetail(error) ?? t("failedToSaveModelSettings");
      uiMessage.error(settingsStore.modelError, {
        duration: MODEL_ERROR_TOAST_MS
      });
    } finally {
      settingsStore.modelSaving = false;
    }
  }

  async function refreshFreeModels(): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.freeModelsRefreshing) return;
    settingsStore.freeModelsRefreshing = true;
    settingsStore.modelError = null;
    try {
      const settings = await api.models.refreshFree();
      applyLoadedModelSettings(settings);
      uiMessage.success(t("freeModelListRefreshed"));
    } catch (error: unknown) {
      settingsStore.modelError = errorMessage(
        error,
        t("failedToRefreshFreeModelSettings")
      );
      uiMessage.error(settingsStore.modelError);
    } finally {
      settingsStore.freeModelsRefreshing = false;
    }
  }

  async function setFreeModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.freeModelsSaving) return;
    settingsStore.freeModelsSaving = true;
    try {
      const settings = await api.models.setFreeModelEnabled(modelId, enabled);
      applyLoadedModelSettings(settings);
      uiMessage.success(
        enabled
          ? t("freeModelEnabledAndAddedToModelSettings")
          : t("freeModelDisabledAndHiddenFromModelSettings")
      );
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, t("failedToUpdateFreeModelStatus")));
    } finally {
      settingsStore.freeModelsSaving = false;
    }
  }

  async function testModel(model: ModelConfigInput): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.testingModelId) return;
    settingsStore.testingModelId = model.id;
    settingsStore.modelError = null;
    settingsStore.modelTestMessage = null;
    try {
      const result = await api.models.test(model);
      settingsStore.modelTestMessage = result.message;
      if (
        Number.isInteger(result.contextWindow) &&
        Number.isInteger(result.maxTokens)
      ) {
        settingsStore.lastModelTestCapacity = {
          modelId: result.modelId,
          contextWindow: result.contextWindow,
          maxTokens: result.maxTokens
        };
      }
      uiMessage.success(result.message);
    } catch (error: unknown) {
      const headline = t("modelConnectionTestFailed");
      const reason = getErrorDetail(error);
      settingsStore.modelError =
        reason && reason !== headline
          ? t("modelConnectionTestFailedWithReason", { reason })
          : headline;
      uiMessage.error(settingsStore.modelError, {
        duration: MODEL_ERROR_TOAST_MS
      });
    } finally {
      settingsStore.testingModelId = null;
    }
  }

  const siteOfficialModelSettings = useSiteOfficialModelSettings({
    api: context.api,
    settingsStore,
    notifications: uiMessage,
    applyLoadedModelSettings,
    loadModelSettings
  });

  return {
    ...siteOfficialModelSettings,
    loadModelSettings,
    loadAppAlerts,
    closeStartupAlert,
    loadModelUsage,
    saveModelSettings,
    refreshFreeModels,
    setFreeModelEnabled,
    testModel
  };
}
