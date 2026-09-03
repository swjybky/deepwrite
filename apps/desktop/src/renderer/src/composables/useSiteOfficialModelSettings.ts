import type { DeepWriteApi, ModelSettings } from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";
import { useSettingsStore } from "../stores/settingsStore";

interface SiteOfficialNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

interface SiteOfficialModelSettingsContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: SiteOfficialNotifications;
  applyLoadedModelSettings(settings: ModelSettings): void;
  loadModelSettings(): Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useSiteOfficialModelSettings(
  context: SiteOfficialModelSettingsContext
) {
  const { settingsStore, notifications: uiMessage } = context;

  async function queryQuota(api: DeepWriteApi, notifyFailure = true) {
    try {
      return await api.models.querySiteOfficialQuota();
    } catch (error: unknown) {
      if (notifyFailure) {
        uiMessage.warning(errorMessage(error, "查询新官方小站额度失败。"));
      }
      return null;
    }
  }

  async function loadSiteOfficialModels(): Promise<void> {
    await context.loadModelSettings();
    const api = context.api();
    const configured = settingsStore.modelSettings?.models.some(
      (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
    );
    if (!api || !configured) {
      settingsStore.siteOfficialQuota = null;
      return;
    }
    settingsStore.siteOfficialQuota = await queryQuota(api, false);
  }

  async function saveSiteOfficialToken(apiKey: string): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.siteOfficialModelsSaving) return;
    settingsStore.siteOfficialModelsSaving = true;
    settingsStore.modelError = null;
    try {
      const settings = await api.models.saveSiteOfficialToken(apiKey);
      context.applyLoadedModelSettings(settings);
      settingsStore.siteOfficialQuota = await queryQuota(api);
      uiMessage.success("新官方小站模型密钥已安全保存，模型现在可以直接使用。");
    } catch (error: unknown) {
      settingsStore.modelError = errorMessage(
        error,
        "保存新官方小站模型密钥失败。"
      );
      uiMessage.error(settingsStore.modelError);
    } finally {
      settingsStore.siteOfficialModelsSaving = false;
    }
  }

  async function clearSiteOfficialToken(): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.siteOfficialModelsSaving) return;
    settingsStore.siteOfficialModelsSaving = true;
    settingsStore.modelError = null;
    try {
      const settings = await api.models.clearSiteOfficialToken();
      context.applyLoadedModelSettings(settings);
      settingsStore.siteOfficialQuota = null;
      uiMessage.info("新官方小站模型密钥已移除，历史用量仍保留在本机账本中。");
    } catch (error: unknown) {
      settingsStore.modelError = errorMessage(
        error,
        "移除新官方小站模型密钥失败。"
      );
      uiMessage.error(settingsStore.modelError);
    } finally {
      settingsStore.siteOfficialModelsSaving = false;
    }
  }

  async function refreshSiteOfficialModels(): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.siteOfficialModelsRefreshing) return;
    settingsStore.siteOfficialModelsRefreshing = true;
    try {
      const settings = await api.models.refreshSiteOfficial();
      context.applyLoadedModelSettings(settings);
      settingsStore.siteOfficialQuota = await queryQuota(api);
      uiMessage.success("新官方小站模型页面已刷新。");
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "刷新新官方小站模型失败。"));
    } finally {
      settingsStore.siteOfficialModelsRefreshing = false;
    }
  }

  async function setSiteOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.siteOfficialModelsSaving) return;
    settingsStore.siteOfficialModelsSaving = true;
    try {
      const settings = await api.models.setSiteOfficialModelEnabled(
        modelId,
        enabled
      );
      context.applyLoadedModelSettings(settings);
      uiMessage.success(
        enabled
          ? "模型已启用，并显示在模型选择中。"
          : "模型已停用，并从模型选择中隐藏。"
      );
    } catch (error: unknown) {
      uiMessage.error(errorMessage(error, "更新模型启用状态失败。"));
    } finally {
      settingsStore.siteOfficialModelsSaving = false;
    }
  }

  return {
    loadSiteOfficialModels,
    saveSiteOfficialToken,
    clearSiteOfficialToken,
    refreshSiteOfficialModels,
    setSiteOfficialModelEnabled
  };
}
