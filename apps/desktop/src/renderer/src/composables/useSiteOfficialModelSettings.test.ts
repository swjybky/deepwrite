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

  it("does not query quota without a saved key", async () => {
    const { coordinator, models, store } = setup();
    store.modelSettings = { defaultModelId: "", models: [] };
    models.refreshSiteOfficial.mockRejectedValueOnce(
      new Error("请先添加新官方小站模型密钥。")
    );

    await coordinator.refreshSiteOfficialModels();

    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
    expect(store.siteOfficialModelsRefreshing).toBe(false);
  });
});
