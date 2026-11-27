import { createScopedTranslator } from "../i18n";
import {
  beginSiteOfficialQuotaRequest,
  invalidateSiteOfficialQuota
} from "./siteOfficialQuotaRequests";
import type { DeepWriteApi, ModelSettings } from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";
import { useSettingsStore } from "../stores/settingsStore";
import { getErrorDetail } from "../i18n/errors";
import {
  invalidSiteOfficialKeyLine,
  mergeSiteOfficialKeyBatch,
  notifySiteOfficialKeyBatch,
  parseSiteOfficialKeyLines
} from "./siteOfficialKeyBatch";

const t = createScopedTranslator("workspace");

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

function siteOfficialErrorMessage(error: unknown, fallback: string): string {
  return (getErrorDetail(error) ?? fallback).replace(
    /^models\.[a-z_]+:\s*/u,
    ""
  );
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
        uiMessage.warning(
          siteOfficialErrorMessage(
            error,
            t(
              "siteOfficialModelSettings.couldNotRetrieveTheNewOfficialSiteSBalance"
            )
          )
        );
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
    if (!api) return;
    const configured = settingsStore.modelSettings?.models.some(
      (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
    );
    if (!configured) {
      await refreshSiteOfficialModels(false);
      return;
    }
    await queryQuota(api);
  }

  async function saveSiteOfficialToken(rawKeys: string): Promise<void> {
    const api = context.api();
    if (
      !api ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    const keys = parseSiteOfficialKeyLines(rawKeys);
    const target = keys[0];
    const invalidLine = invalidSiteOfficialKeyLine(keys, true);
    if (!target || invalidLine !== undefined) {
      uiMessage.warning(
        invalidLine !== undefined
          ? t("siteOfficialQuotaMerge.invalidKeyLine", { line: invalidLine })
          : t("siteOfficialQuotaMerge.enterAValidSourceKey")
      );
      return;
    }
    invalidateSiteOfficialQuota(settingsStore);
    settingsStore.siteOfficialQuota = null;
    settingsStore.siteOfficialModelsSaving = true;
    settingsStore.modelError = null;
    let targetSaved = false;
    try {
      const settings = await api.models.saveSiteOfficialToken(target.key);
      targetSaved = true;
      context.applyLoadedModelSettings(settings);
      await queryQuota(api);
      uiMessage.success(
        t("siteOfficialModelSettings.theNewOfficialSiteSModelKeyHasBeen")
      );
      if (keys.length > 1) {
        const current = beginSiteOfficialQuotaRequest(settingsStore);
        const result = await mergeSiteOfficialKeyBatch({
          models: api.models,
          sources: keys.slice(1),
          target,
          quota: settingsStore.siteOfficialQuota,
          current,
          applyQuota: (quota) => {
            settingsStore.siteOfficialQuota = quota;
          }
        });
        notifySiteOfficialKeyBatch(result, uiMessage);
        if (result.succeeded.length) {
          // Retain the last authoritative merge balance if refreshing fails.
          try {
            const quota = await api.models.querySiteOfficialQuota();
            if (current()) settingsStore.siteOfficialQuota = quota;
          } catch {
            uiMessage.warning(
              t(
                "siteOfficialQuotaMerge.quotaTransferredUsageHasNotRefreshedYetRefreshThe"
              )
            );
          }
        }
      }
    } catch (error: unknown) {
      settingsStore.modelError = siteOfficialErrorMessage(
        error,
        t("siteOfficialModelSettings.couldNotSaveTheNewOfficialSiteSModel")
      );
      if (keys.length > 1 && !targetSaved) {
        settingsStore.modelError = t(
          "siteOfficialQuotaMerge.targetKeyNotSaved",
          {
            line: target.line,
            reason: settingsStore.modelError
          }
        );
      }
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
      uiMessage.info(
        t("siteOfficialModelSettings.theNewOfficialSiteSModelKeyWasRemoved")
      );
    } catch (error: unknown) {
      settingsStore.modelError = siteOfficialErrorMessage(
        error,
        t("siteOfficialModelSettings.couldNotRemoveTheNewOfficialSiteSModel")
      );
      uiMessage.error(settingsStore.modelError);
    } finally {
      settingsStore.siteOfficialModelsSaving = false;
    }
  }

  async function refreshSiteOfficialModels(
    notifySuccess = true
  ): Promise<void> {
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
        uiMessage.error(
          siteOfficialErrorMessage(
            error,
            t(
              "siteOfficialModelSettings.couldNotRefreshTheNewOfficialSiteSModels"
            )
          )
        );
      }
      // A catalog failure must not prevent querying the saved key's quota.
      // Wait for the catalog operation to release the Main process key lock.
      const configured = settingsStore.modelSettings?.models.some(
        (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
      );
      if (!configured) settingsStore.siteOfficialQuota = null;
      const quotaRefreshed = !configured || (await queryQuota(api));
      if (notifySuccess && quotaRefreshed && catalogRefreshed) {
        uiMessage.success(
          t("siteOfficialModelSettings.theNewOfficialSiteSModelPageHasBeen")
        );
      }
    } finally {
      settingsStore.siteOfficialModelsRefreshing = false;
    }
  }

  async function refreshSiteOfficialModelCatalog(): Promise<void> {
    const api = context.api();
    if (
      !api ||
      settingsStore.modelSaving ||
      settingsStore.siteOfficialModelsSaving ||
      settingsStore.siteOfficialModelsRefreshing
    )
      return;
    settingsStore.siteOfficialModelsRefreshing = true;
    try {
      const settings = await api.models.refreshSiteOfficial();
      context.applyLoadedModelSettings(settings);
      uiMessage.success(
        t("siteOfficialModelSettings.officialSiteModelsRefreshed")
      );
    } catch (error: unknown) {
      uiMessage.error(
        siteOfficialErrorMessage(
          error,
          t(
            "siteOfficialModelSettings.couldNotRefreshTheNewOfficialSiteSModels"
          )
        )
      );
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
          ? t(
              "siteOfficialModelSettings.modelEnabledAndAddedToTheModelSelector"
            )
          : t(
              "siteOfficialModelSettings.modelDisabledAndHiddenFromTheModelSelector"
            )
      );
    } catch (error: unknown) {
      uiMessage.error(
        siteOfficialErrorMessage(
          error,
          t("modelSettingsCoordinator.failedToUpdateModelStatus")
        )
      );
    } finally {
      settingsStore.siteOfficialModelsSaving = false;
    }
  }

  return {
    loadSiteOfficialModels,
    saveSiteOfficialToken,
    clearSiteOfficialToken,
    refreshSiteOfficialModels,
    refreshSiteOfficialModelCatalog,
    setSiteOfficialModelEnabled
  };
}
