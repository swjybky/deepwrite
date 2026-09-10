import {
  beginSiteOfficialQuotaRequest,
  invalidateSiteOfficialQuota
} from "./siteOfficialQuotaRequests";
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

  async function queryQuota(api: DeepWriteApi): Promise<boolean> {
    const current = beginSiteOfficialQuotaRequest(settingsStore);
    try {
      const quota = await api.models.querySiteOfficialQuota();
      if (!current()) return false;
      settingsStore.siteOfficialQuota = quota;
      return true;
    } catch (error: unknown) {
      if (current()) {
        settingsStore.siteOfficialQuota = null;
        uiMessage.warning(errorMessage(error, "查询新官方小站额度失败。"));
      }
      return false;
    }
  }

  async function loadSiteOfficialModels(): Promise<void> {
    if (
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    await context.loadModelSettings();
    if (
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    const api = context.api();
    const configured = settingsStore.modelSettings?.models.some(
      (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
    );
    if (!api || !configured) {
      settingsStore.siteOfficialQuota = null;
      return;
    }
    await queryQuota(api);
  }

  async function saveSiteOfficialToken(apiKey: string): Promise<void> {
    const api = context.api();
    if (
      !api ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    invalidateSiteOfficialQuota(settingsStore);
    settingsStore.siteOfficialQuota = null;
    settingsStore.siteOfficialModelsSaving = true;
    settingsStore.modelError = null;
    try {
      const settings = await api.models.saveSiteOfficialToken(apiKey);
      context.applyLoadedModelSettings(settings);
      await queryQuota(api);
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
    if (
      !api ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    invalidateSiteOfficialQuota(settingsStore);
    settingsStore.siteOfficialQuota = null;
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
    if (
      !api ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    invalidateSiteOfficialQuota(settingsStore);
    settingsStore.siteOfficialModelsRefreshing = true;
    try {
      let catalogRefreshed = false;
      try {
        const settings = await api.models.refreshSiteOfficial();
        context.applyLoadedModelSettings(settings);
        catalogRefreshed = true;
      } catch (error: unknown) {
        uiMessage.error(errorMessage(error, "刷新新官方小站模型失败。"));
      }
      // A catalog failure must not prevent querying the saved key's quota.
      // Wait for the catalog operation to release the Main process key lock.
      const configured = settingsStore.modelSettings?.models.some(
        (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
      );
      if (configured && (await queryQuota(api)) && catalogRefreshed) {
        uiMessage.success("新官方小站模型页面已刷新。");
      }
    } finally {
      settingsStore.siteOfficialModelsRefreshing = false;
    }
  }

  async function setSiteOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<void> {
    const api = context.api();
    if (
      !api ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    invalidateSiteOfficialQuota(settingsStore);
    settingsStore.siteOfficialQuota = null;
    settingsStore.siteOfficialModelsSaving = true;
    try {
      const settings = await api.models.setSiteOfficialModelEnabled(
        modelId,
        enabled
      );
      context.applyLoadedModelSettings(settings);
      await queryQuota(api);
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
