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

export interface ModelSettingsNotifications {
  error(message: string): void;
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
  return error instanceof Error ? error.message : fallback;
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
    if (!api) return;
    try {
      const snapshot = await api.get();
      settingsStore.modelAlertMessages = [...snapshot.modelMessages];
      if (snapshot.shouldShowDesktop) {
        settingsStore.startupAlertMessages = [...snapshot.desktopMessages];
        settingsStore.startupAlertRevision = snapshot.desktopRevision;
      }
    } catch (error: unknown) {
      console.warn(
        "DeepWrite app alerts could not be loaded:",
        errorMessage(error, "unknown error")
      );
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
      settingsStore.modelUsageError = errorMessage(error, "加载模型用量失败。");
      uiMessage.warning(settingsStore.modelUsageError);
    } finally {
      if (requestSequence === modelUsageRequestSequence) {
        settingsStore.modelUsageLoading = false;
      }
    }
  }

  async function queryOfficialModelUsage(api: DeepWriteApi) {
    return api.modelUsage.query({ managedBy: "deepwrite-official" });
  }

  async function queryOfficialBalance(api: DeepWriteApi) {
    try {
      return await api.models.queryOfficialBalance();
    } catch (error: unknown) {
      uiMessage.warning(errorMessage(error, "查询官方模型消费信息失败。"));
      return null;
    }
  }

  async function loadOfficialModels(): Promise<void> {
    const api = context.api();
    if (!api) return;
    try {
      const snapshot = await settingsStore.ensureOfficialModelsLoaded(
        async () => {
          const settings = await api.models.refreshOfficial();
          const [usageDashboard, balance] = await Promise.all([
            queryOfficialModelUsage(api),
            queryOfficialBalance(api)
          ]);
          return { settings, usageDashboard, balance };
        }
      );
      applyLoadedModelSettings(snapshot.settings);
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "加载官方模型失败。"));
    }
  }

  async function saveOfficialToken(apiKey: string): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.officialModelsSaving) return;
    settingsStore.officialModelsSaving = true;
    try {
      const settings = await api.models.saveOfficialToken(apiKey);
      const [usageDashboard, balance] = await Promise.all([
        queryOfficialModelUsage(api),
        queryOfficialBalance(api)
      ]);
      settingsStore.markLoaded("officialModels", {
        settings,
        usageDashboard,
        balance
      });
      applyLoadedModelSettings(settings);
      uiMessage.success("官方令牌已安全保存，官方模型现在可以直接使用。");
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "保存官方令牌失败。"));
    } finally {
      settingsStore.officialModelsSaving = false;
    }
  }

  async function clearOfficialToken(): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.officialModelsSaving) return;
    settingsStore.officialModelsSaving = true;
    try {
      const settings = await api.models.clearOfficialToken();
      const [usageDashboard, balance] = await Promise.all([
        queryOfficialModelUsage(api),
        queryOfficialBalance(api)
      ]);
      settingsStore.markLoaded("officialModels", {
        settings,
        usageDashboard,
        balance
      });
      applyLoadedModelSettings(settings);
      uiMessage.info("官方令牌已移除，历史用量仍保留在本机账本中。");
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "移除官方令牌失败。"));
    } finally {
      settingsStore.officialModelsSaving = false;
    }
  }

  async function setOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.officialModelsSaving) return;
    settingsStore.officialModelsSaving = true;
    try {
      const settings = await api.models.setOfficialModelEnabled(
        modelId,
        enabled
      );
      settingsStore.markLoaded("officialModels", {
        settings,
        usageDashboard: settingsStore.officialModelUsageDashboard,
        balance: settingsStore.officialModelBalance
      });
      applyLoadedModelSettings(settings);
      uiMessage.success(
        enabled
          ? "模型已启用，并显示在模型配置中。"
          : "模型已停用，并从模型配置中隐藏。"
      );
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "更新模型启用状态失败。"));
    } finally {
      settingsStore.officialModelsSaving = false;
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
      settingsStore.modelTestMessage = "模型配置已保存，并已同步到后续对话。";
      uiMessage.success(settingsStore.modelTestMessage);
    } catch (error: unknown) {
      settingsStore.modelError = errorMessage(error, "保存模型配置失败。");
      uiMessage.error(settingsStore.modelError);
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
      uiMessage.success("免费模型列表已刷新。");
    } catch (error: unknown) {
      settingsStore.modelError = errorMessage(error, "刷新免费模型配置失败。");
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
          ? "免费模型已启用，并显示在模型配置中。"
          : "免费模型已停用，并从模型配置中隐藏。"
      );
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "更新免费模型启用状态失败。"));
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
      settingsStore.modelError = errorMessage(error, "模型连接测试失败。");
      uiMessage.error(settingsStore.modelError);
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
    loadOfficialModels,
    saveOfficialToken,
    clearOfficialToken,
    setOfficialModelEnabled,
    saveModelSettings,
    refreshFreeModels,
    setFreeModelEnabled,
    testModel
  };
}
