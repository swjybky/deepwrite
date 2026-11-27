import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepWriteApi, ModelSettings } from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { useSiteOfficialModelSettings } from "./useSiteOfficialModelSettings";

const settings = {
  defaultModelId: "deepwrite-site-official-test",
  models: [{ id: "deepwrite-site-official-test", hasApiKey: true }]
} as ModelSettings;
const quota = {
  queriedAt: "2026-09-09T00:00:00Z",
  remaining: 8,
  used: 2,
  total: 10,
  unlimited: false,
  targetRevision: "10000000-0000-4000-8000-000000000001"
};

function setup() {
  const store = useSettingsStore();
  store.modelSettings = settings;
  const models = {
    refreshSiteOfficial: vi.fn(async () => ({ ...settings })),
    querySiteOfficialQuota: vi.fn(async () => quota)
  };
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const coordinator = useSiteOfficialModelSettings({
    api: () => ({ models }) as unknown as DeepWriteApi,
    settingsStore: store,
    notifications,
    applyLoadedModelSettings: (value) => {
      store.modelSettings = value;
    },
    loadModelSettings: async () => undefined
  });
  return { store, models, notifications, coordinator };
}

beforeEach(() => setActivePinia(createPinia()));

describe("new-site quota loading and refresh feedback", () => {
  it("reports the quota error when opening the page instead of silently leaving it empty", async () => {
    const { coordinator, models, notifications, store } = setup();
    models.querySiteOfficialQuota.mockRejectedValueOnce(
      new Error("额度查询超时")
    );

    await coordinator.loadSiteOfficialModels();

    expect(store.siteOfficialQuota).toBeNull();
    expect(notifications.warning).toHaveBeenCalledWith("额度查询超时");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("does not announce a successful refresh when the quota query fails", async () => {
    const { coordinator, models, notifications, store } = setup();
    store.siteOfficialQuota = quota;
    models.querySiteOfficialQuota.mockRejectedValueOnce(
      new Error("额度接口暂不可用")
    );

    await coordinator.refreshSiteOfficialModels();

    expect(store.modelSettings).toEqual(settings);
    expect(store.siteOfficialQuota).toBeNull();
    expect(store.siteOfficialModelsRefreshing).toBe(false);
    expect(notifications.warning).toHaveBeenCalledWith("额度接口暂不可用");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("queries quota after a catalog failure, once the key operation has settled", async () => {
    const { coordinator, models, notifications, store } = setup();
    let failCatalog!: (error: Error) => void;
    models.refreshSiteOfficial.mockImplementationOnce(
      () =>
        new Promise<ModelSettings>((_resolve, reject) => {
          failCatalog = reject;
        })
    );

    const refreshing = coordinator.refreshSiteOfficialModels();
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
    failCatalog(new Error("模型目录请求失败"));
    await refreshing;

    expect(models.querySiteOfficialQuota).toHaveBeenCalledOnce();
    expect(store.siteOfficialQuota).toEqual(quota);
    expect(store.siteOfficialModelsRefreshing).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith("模型目录请求失败");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("announces success only after both catalog and quota refresh", async () => {
    const { coordinator, notifications, store } = setup();

    await coordinator.refreshSiteOfficialModels();

    expect(store.siteOfficialQuota).toEqual(quota);
    expect(notifications.success).toHaveBeenCalledWith(
      "新官方小站模型页面已刷新。"
    );
    expect(notifications.warning).not.toHaveBeenCalled();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("refreshes the catalog without querying quota when no key is saved", async () => {
    const { coordinator, models, store, notifications } = setup();
    store.modelSettings = { defaultModelId: "", models: [] };
    models.refreshSiteOfficial.mockResolvedValueOnce({
      ...settings,
      models: settings.models.map((model) => ({
        ...model,
        hasApiKey: false,
        enabled: false
      }))
    });

    await coordinator.refreshSiteOfficialModels();

    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
    expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();
    expect(store.modelSettings?.models[0]?.hasApiKey).toBe(false);
    expect(store.siteOfficialQuota).toBeNull();
    expect(notifications.success).toHaveBeenCalledOnce();
    expect(store.siteOfficialModelsRefreshing).toBe(false);
  });

  it("loads a keyless catalog when opening the page without a success toast", async () => {
    const { coordinator, models, store, notifications } = setup();
    store.modelSettings = { defaultModelId: "", models: [] };
    models.refreshSiteOfficial.mockResolvedValueOnce({
      ...settings,
      models: settings.models.map((model) => ({
        ...model,
        hasApiKey: false,
        enabled: false
      }))
    });
    await coordinator.loadSiteOfficialModels();
    expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
    expect(store.modelSettings?.models).toHaveLength(1);
    expect(notifications.success).not.toHaveBeenCalled();
  });

  describe("refreshSiteOfficialModelCatalog", () => {
    it("refreshes the catalog without querying quota, preserves custom models and default, and announces success", async () => {
      const { coordinator, models, notifications, store } = setup();
      const customModel = {
        id: "custom-openai",
        label: "Custom OpenAI",
        hasApiKey: true
      };
      const refreshed = {
        defaultModelId: customModel.id,
        models: [
          customModel,
          { id: "deepwrite-site-official-new-model", hasApiKey: true }
        ]
      } as ModelSettings;
      models.refreshSiteOfficial.mockResolvedValueOnce(refreshed);

      await coordinator.refreshSiteOfficialModelCatalog();

      expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();
      expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
      expect(store.modelSettings).toEqual(refreshed);
      expect(store.siteOfficialModelsRefreshing).toBe(false);
      expect(notifications.success).toHaveBeenCalledWith(
        "官方小站模型列表已刷新。"
      );
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent clicks and respects saving locks", async () => {
      const { coordinator, models, store } = setup();
      let resolveRefresh!: (value: ModelSettings) => void;
      models.refreshSiteOfficial.mockImplementationOnce(
        () =>
          new Promise<ModelSettings>((resolve) => {
            resolveRefresh = resolve;
          })
      );

      const first = coordinator.refreshSiteOfficialModelCatalog();
      const second = coordinator.refreshSiteOfficialModelCatalog();
      expect(store.siteOfficialModelsRefreshing).toBe(true);
      expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();

      resolveRefresh({ ...settings });
      await Promise.all([first, second]);
      expect(store.siteOfficialModelsRefreshing).toBe(false);

      store.modelSaving = true;
      await coordinator.refreshSiteOfficialModelCatalog();
      expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();
      store.modelSaving = false;

      store.siteOfficialModelsSaving = true;
      await coordinator.refreshSiteOfficialModelCatalog();
      expect(models.refreshSiteOfficial).toHaveBeenCalledOnce();
    });

    it("keeps existing displayed models on failure and allows immediate retry", async () => {
      const { coordinator, models, notifications, store } = setup();
      models.refreshSiteOfficial.mockRejectedValueOnce(new Error("网络超时"));

      await coordinator.refreshSiteOfficialModelCatalog();

      expect(store.modelSettings).toEqual(settings);
      expect(store.siteOfficialModelsRefreshing).toBe(false);
      expect(notifications.error).toHaveBeenCalledWith("网络超时");
      expect(notifications.success).not.toHaveBeenCalled();

      const updated = {
        defaultModelId: "deepwrite-site-official-updated",
        models: [{ id: "deepwrite-site-official-updated", hasApiKey: true }]
      } as ModelSettings;
      models.refreshSiteOfficial.mockResolvedValueOnce(updated);

      await coordinator.refreshSiteOfficialModelCatalog();

      expect(models.refreshSiteOfficial).toHaveBeenCalledTimes(2);
      expect(store.modelSettings).toEqual(updated);
      expect(notifications.success).toHaveBeenCalledWith(
        "官方小站模型列表已刷新。"
      );
    });
  });
});
