import { formatError, getErrorCode, getErrorDetail } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  DeepWriteApi,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ModelUsageQueryInput
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { useSettingsStore } from "../stores/settingsStore";
import {
  isModelTestActiveStatus,
  modelTestConfigSignature,
  type ModelTestStateEntry
} from "../utils/modelTestState";
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

export function useModelSettingsCoordinator(
  context: ModelSettingsCoordinatorContext
) {
  const { settingsStore, notifications: uiMessage } = context;
  let modelUsageRequestSequence = 0;
  let modelRefreshSequence = 0;
  let lastPublishedModelSettings: ModelSettings | null = null;
  const activeRequestByModelId = new Map<string, string>();
  const inFlightModelTests = new Map<
    string,
    {
      modelId: string;
      requestId: string;
      configSignature: string;
      savedBaselineSignature: string | null;
      cancelledByUser: boolean;
      silentCancel: boolean;
      sawConcurrency: boolean;
    }
  >();

  function syncTestingModelId(): void {
    const activeEntry = Object.values(settingsStore.modelTestStates).find(
      (entry) => isModelTestActiveStatus(entry.status)
    );
    settingsStore.testingModelId = activeEntry?.modelId ?? null;
  }

  function setModelTestEntry(
    modelId: string,
    entry: ModelTestStateEntry
  ): void {
    settingsStore.modelTestStates = {
      ...settingsStore.modelTestStates,
      [modelId]: entry
    };
    syncTestingModelId();
  }

  function deleteModelTestEntry(modelId: string): void {
    if (!(modelId in settingsStore.modelTestStates)) {
      syncTestingModelId();
      return;
    }
    const next = { ...settingsStore.modelTestStates };
    delete next[modelId];
    settingsStore.modelTestStates = next;
    syncTestingModelId();
  }

  function reconcileTestStatesAfterSave(
    previousSettings: ModelSettings | null,
    saved: ModelSettings
  ): void {
    const entries = Object.entries(settingsStore.modelTestStates);
    if (entries.length === 0) return;
    const clearStaleEntry = (
      modelId: string,
      entry: ModelTestStateEntry
    ): void => {
      if (isModelTestActiveStatus(entry.status)) {
        void cancelModelTest(modelId, { silent: true });
      } else {
        deleteModelTestEntry(modelId);
      }
    };
    const previousById = new Map(
      (previousSettings?.models ?? []).map((model) => [model.id, model])
    );
    const savedById = new Map(saved.models.map((model) => [model.id, model]));
    for (const [modelId, entry] of entries) {
      const nextSaved = savedById.get(modelId);
      const prevSaved = previousById.get(modelId);
      if (!nextSaved) {
        clearStaleEntry(modelId, entry);
        continue;
      }
      const nextSig = modelTestConfigSignature(nextSaved);
      if (prevSaved) {
        const prevSig = modelTestConfigSignature(prevSaved);
        const onlyDevRoleAutoDisabled =
          prevSaved.supportsDeveloperRole === undefined &&
          nextSaved.supportsDeveloperRole === false &&
          modelTestConfigSignature({
            ...nextSaved,
            supportsDeveloperRole: undefined
          }) === prevSig;
        if (
          onlyDevRoleAutoDisabled &&
          !isModelTestActiveStatus(entry.status) &&
          entry.configSignature === prevSig
        ) {
          setModelTestEntry(modelId, {
            ...entry,
            configSignature: nextSig
          });
          continue;
        }
        if (prevSig !== nextSig && entry.configSignature !== nextSig) {
          clearStaleEntry(modelId, entry);
        }
      } else if (entry.configSignature !== nextSig) {
        clearStaleEntry(modelId, entry);
      }
    }
  }

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
      // A newer refresh or save may have superseded this read.
      if (settingsStore.modelSettings === settings) {
        applyLoadedModelSettings(settings);
      }
    } catch {
      // The store retains a retriable error for the active feature surface.
    }
  }

  async function refreshModelSettings(): Promise<void> {
    if (!context.api()) return;
    const sequence = ++modelRefreshSequence;
    settingsStore.invalidate("models");
    await loadModelSettings();
    if (sequence === modelRefreshSequence && settingsStore.modelError) {
      uiMessage.error(settingsStore.modelError);
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
        formatError(error, "unknown error")
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
      settingsStore.modelUsageError = formatError(
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
    const previousSettings = settingsStore.modelSettings;
    settingsStore.modelSaving = true;
    settingsStore.modelError = null;
    settingsStore.modelTestMessage = null;
    try {
      const saved = await api.models.save(settings);
      settingsStore.modelError = null;
      applyLoadedModelSettings(saved);
      reconcileTestStatesAfterSave(previousSettings, saved);
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
      settingsStore.modelError = formatError(
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
      uiMessage.error(formatError(error, t("failedToUpdateFreeModelStatus")));
    } finally {
      settingsStore.freeModelsSaving = false;
    }
  }

  async function cancelModelTest(
    modelId: string,
    options?: { silent?: boolean }
  ): Promise<void> {
    const api = context.api();
    const requestId = activeRequestByModelId.get(modelId);
    if (!requestId) return;
    const meta = inFlightModelTests.get(requestId);
    if (!meta) return;
    if (options?.silent) {
      meta.silentCancel = true;
    }
    meta.cancelledByUser = true;
    const existing = settingsStore.modelTestStates[modelId];
    if (options?.silent) {
      deleteModelTestEntry(modelId);
    } else if (existing && existing.requestId === requestId) {
      setModelTestEntry(modelId, {
        ...existing,
        status: "cancelling",
        message: t("cancelingConnectionTest"),
        updatedAt: Date.now()
      });
    }
    await api?.models.cancelTest?.({ requestId }).catch(() => undefined);
  }

  async function testModel(model: ModelConfigInput): Promise<void> {
    const api = context.api();
    if (!api) return;
    const currentState = settingsStore.modelTestStates[model.id];
    if (isModelTestActiveStatus(currentState?.status)) return;

    const requestId = createId("model_test");
    const configSignature = modelTestConfigSignature(model);
    const savedAtStart = settingsStore.modelSettings?.models.find(
      (entry) => entry.id === model.id
    );
    const savedBaselineSignature = savedAtStart
      ? modelTestConfigSignature(savedAtStart)
      : null;
    const hasExistingInFlight = activeRequestByModelId.size > 0;
    if (hasExistingInFlight) {
      for (const activeMeta of inFlightModelTests.values()) {
        activeMeta.sawConcurrency = true;
      }
    }
    const meta = {
      modelId: model.id,
      requestId,
      configSignature,
      savedBaselineSignature,
      cancelledByUser: false,
      silentCancel: false,
      sawConcurrency: hasExistingInFlight
    };
    inFlightModelTests.set(requestId, meta);
    activeRequestByModelId.set(model.id, requestId);

    const writeStatus = (
      status: ModelTestStateEntry["status"],
      message: string,
      errorCode?: string
    ): void => {
      setModelTestEntry(model.id, {
        modelId: model.id,
        modelLabel: model.label,
        requestId,
        configSignature,
        status,
        message,
        ...(errorCode ? { errorCode } : {}),
        updatedAt: Date.now()
      });
    };

    const isStaleTestResult = (): boolean => {
      if (meta.silentCancel) return true;
      const latest = settingsStore.modelTestStates[model.id];
      if (!latest || latest.requestId !== requestId) return true;
      const currentSaved = settingsStore.modelSettings?.models.find(
        (entry) => entry.id === model.id
      );
      if (meta.savedBaselineSignature !== null) {
        return (
          !currentSaved ||
          modelTestConfigSignature(currentSaved) !== meta.savedBaselineSignature
        );
      }
      return Boolean(
        currentSaved &&
        modelTestConfigSignature(currentSaved) !== meta.configSignature
      );
    };

    const clearIfStale = (): boolean => {
      if (!isStaleTestResult()) return false;
      if (settingsStore.modelTestStates[model.id]?.requestId === requestId) {
        deleteModelTestEntry(model.id);
      }
      return true;
    };

    const toastText = (message: string): string =>
      meta.sawConcurrency
        ? t("modelTestResultForModel", { model: model.label, message })
        : message;

    writeStatus("testing", t("testingConnection"));
    if (!settingsStore.modelSaving && !hasExistingInFlight) {
      settingsStore.modelError = null;
      settingsStore.modelTestMessage = null;
    }

    try {
      const result = await api.models.test(model, { requestId });
      if (clearIfStale()) return;
      if (meta.cancelledByUser) {
        writeStatus("cancelled", t("modelConnectionTestCanceled"));
        return;
      }
      settingsStore.modelTestMessage = result.message;
      if (
        Number.isInteger(result.contextWindow) &&
        Number.isInteger(result.maxTokens)
      ) {
        settingsStore.lastModelTestCapacity = {
          modelId: result.modelId,
          contextWindow: result.contextWindow,
          maxTokens: result.maxTokens,
          configSignature,
          ...(result.supportsDeveloperRole !== undefined
            ? { supportsDeveloperRole: result.supportsDeveloperRole }
            : {})
        };
      }
      writeStatus("succeeded", result.message);
      uiMessage.success(toastText(result.message));
    } catch (error: unknown) {
      if (clearIfStale()) return;
      const errorCode = getErrorCode(error);
      if (meta.cancelledByUser || errorCode === "models.test_cancelled") {
        writeStatus("cancelled", t("modelConnectionTestCanceled"));
        return;
      }
      const timedOut = errorCode === "models.test_timeout";
      const headline = timedOut
        ? t("modelConnectionTestTimedOut")
        : t("modelConnectionTestFailed");
      const reason = timedOut ? undefined : getErrorDetail(error);
      const message =
        reason && reason !== headline
          ? t("modelConnectionTestFailedWithReason", { reason })
          : headline;
      settingsStore.modelError = message;
      writeStatus("failed", message, errorCode);
      uiMessage.error(toastText(message), {
        duration: MODEL_ERROR_TOAST_MS
      });
    } finally {
      inFlightModelTests.delete(requestId);
      if (activeRequestByModelId.get(model.id) === requestId) {
        activeRequestByModelId.delete(model.id);
      }
      syncTestingModelId();
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
    refreshModelSettings,
    loadAppAlerts,
    closeStartupAlert,
    loadModelUsage,
    saveModelSettings,
    refreshFreeModels,
    setFreeModelEnabled,
    testModel,
    cancelModelTest
  };
}
