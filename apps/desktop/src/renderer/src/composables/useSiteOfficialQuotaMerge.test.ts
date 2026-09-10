import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  ModelSettings,
  SiteOfficialQuota
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { useSiteOfficialQuotaMerge } from "./useSiteOfficialQuotaMerge";
import { useSiteOfficialModelSettings } from "./useSiteOfficialModelSettings";
import dialog from "../components/SiteOfficialQuotaMergeDialog.vue?raw";
import panel from "../components/SiteOfficialModelsPanel.vue?raw";

const targetRevision = "10000000-0000-4000-8000-000000000001";
const quota: SiteOfficialQuota = {
  queriedAt: "2026-09-09T00:00:00Z",
  total: 10,
  used: 10,
  remaining: 0,
  unlimited: false,
  targetRevision
};
const settings = {
  defaultModelId: "",
  models: [{ id: "deepwrite-site-official-test", hasApiKey: true }]
} as ModelSettings;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const store = useSettingsStore();
  store.modelSettings = settings;
  store.siteOfficialQuota = quota;
  const models = {
    mergeSiteOfficialQuota: vi.fn(async () => ({
      transferred: "3",
      sourceRevoked: true as const,
      quota: { ...quota, remaining: 3, total: 13 }
    })),
    querySiteOfficialQuota: vi.fn(async (): Promise<SiteOfficialQuota> => ({
      ...quota,
      remaining: 2.5,
      total: 13
    })),
    saveSiteOfficialToken: vi.fn(async () => ({ ...settings })),
    clearSiteOfficialToken: vi.fn(async () => ({
      models: [],
      defaultModelId: ""
    })),
    refreshSiteOfficial: vi.fn(async () => ({ ...settings })),
    setSiteOfficialModelEnabled: vi.fn(async () => ({ ...settings }))
  };
  const notifications = {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn()
  };
  const context = {
    api: () => ({ models }) as unknown as DeepWriteApi,
    settingsStore: store,
    notifications
  };
  return {
    store,
    models,
    notifications,
    merge: useSiteOfficialQuotaMerge(context),
    coordinator: useSiteOfficialModelSettings({
      ...context,
      applyLoadedModelSettings: (value) => {
        store.modelSettings = value;
      },
      loadModelSettings: async () => undefined
    })
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe("quota merge UI behavior", () => {
  it("allows exhausted targets, validates empty input through a toast, and clears cancelled input", async () => {
    const { merge, models, notifications } = setup();
    expect(merge.disabledReason.value).toBe("");
    merge.show();
    await merge.submit();
    expect(notifications.warning).toHaveBeenCalledWith(
      "请输入有效的来源 Key。"
    );
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    merge.sourceKey.value = "source_test_only_invalid";
    merge.close();
    merge.show();
    expect(merge.sourceKey.value).toBe("");
  });

  it("disables unconfigured, unknown and unlimited targets", () => {
    const { merge, store } = setup();
    store.siteOfficialQuota = { ...quota, unlimited: true };
    expect(merge.disabledReason.value).toContain("无限");
    merge.show();
    expect(merge.open.value).toBe(false);
    store.siteOfficialQuota = null;
    expect(merge.disabledReason.value).toContain("刷新");
    store.modelSettings = { defaultModelId: "", models: [] };
    expect(merge.disabledReason.value).toContain("添加");
  });

  it("blocks duplicate submissions and key changes, then closes, clears and refreshes after success", async () => {
    const { merge, models, store, coordinator, notifications } = setup();
    const waiting =
      deferred<Awaited<ReturnType<typeof models.mergeSiteOfficialQuota>>>();
    models.mergeSiteOfficialQuota.mockImplementationOnce(() => waiting.promise);
    merge.show();
    merge.sourceKey.value = " source_test_only_invalid ";
    const pending = merge.submit();
    expect(merge.pending.value).toBe(true);
    expect(store.siteOfficialModelsSaving).toBe(true);
    await merge.submit();
    merge.close();
    expect(merge.open.value).toBe(true);
    await coordinator.saveSiteOfficialToken("replacement_test_only_invalid");
    await coordinator.clearSiteOfficialToken();
    await coordinator.refreshSiteOfficialModels();
    await coordinator.loadSiteOfficialModels();
    expect(models.saveSiteOfficialToken).not.toHaveBeenCalled();
    expect(models.clearSiteOfficialToken).not.toHaveBeenCalled();
    expect(models.refreshSiteOfficial).not.toHaveBeenCalled();
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledExactlyOnceWith({
      sourceKey: "source_test_only_invalid",
      targetRevision
    });
    waiting.resolve({
      transferred: "3",
      sourceRevoked: true,
      quota: { ...quota, remaining: 3, total: 13 }
    });
    await pending;
    expect(merge.sourceKey.value).toBe("");
    expect(merge.open.value).toBe(false);
    expect(merge.pending.value).toBe(false);
    expect(store.siteOfficialModelsSaving).toBe(false);
    expect(store.siteOfficialQuota?.remaining).toBe(2.5);
    expect(notifications.success).toHaveBeenCalledWith(
      expect.stringContaining("永久注销")
    );
  });

  it("clears secrets on failure, shows a toast, and permits a new attempt", async () => {
    const { merge, models, notifications, store } = setup();
    models.mergeSiteOfficialQuota.mockRejectedValueOnce(
      new Error("来源 Key 无效")
    );
    merge.show();
    merge.sourceKey.value = "source_test_only_invalid";
    await merge.submit();
    expect(notifications.error).toHaveBeenCalledWith("来源 Key 无效");
    expect(merge.sourceKey.value).toBe("");
    expect(merge.open.value).toBe(true);
    expect(store.siteOfficialModelsSaving).toBe(false);
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
  });

  it("retains the authoritative merge quota if the follow-up refresh fails", async () => {
    const { merge, models, notifications, store } = setup();
    models.querySiteOfficialQuota.mockRejectedValueOnce(new Error("offline"));
    merge.show();
    merge.sourceKey.value = "source_test_only_invalid";
    await merge.submit();
    expect(store.siteOfficialQuota?.remaining).toBe(3);
    expect(merge.open.value).toBe(false);
    expect(notifications.success).toHaveBeenCalledOnce();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("requires renewed confirmation if the target changes while the dialog is open", async () => {
    const { merge, models, store, notifications } = setup();
    merge.show();
    merge.sourceKey.value = "source_test_only_invalid";
    store.siteOfficialQuota = {
      ...quota,
      targetRevision: "20000000-0000-4000-8000-000000000002"
    };
    await merge.submit();
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    expect(merge.open.value).toBe(false);
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringContaining("配置已变化")
    );
  });

  it("ignores an old quota response after merging or changing model settings", async () => {
    const { merge, models, store, coordinator } = setup();
    const old = deferred<SiteOfficialQuota>();
    models.querySiteOfficialQuota.mockImplementationOnce(() => old.promise);
    const loading = coordinator.loadSiteOfficialModels();
    await vi.waitFor(() =>
      expect(models.querySiteOfficialQuota).toHaveBeenCalledOnce()
    );
    merge.show();
    merge.sourceKey.value = "source_test_only_invalid";
    await merge.submit();
    old.resolve(quota);
    await loading;
    expect(store.siteOfficialQuota?.remaining).toBe(2.5);

    const next = deferred<SiteOfficialQuota>();
    models.querySiteOfficialQuota.mockImplementationOnce(() => next.promise);
    const second = coordinator.loadSiteOfficialModels();
    await vi.waitFor(() =>
      expect(models.querySiteOfficialQuota).toHaveBeenCalledTimes(3)
    );
    store.modelSettings = { ...settings };
    next.resolve({ ...quota, remaining: 99 });
    await second;
    expect(store.siteOfficialQuota?.remaining).toBe(2.5);
  });

  it("wires a password-only dialog with explicit revocation and a busy form", () => {
    expect(panel).toContain("增加额度");
    expect(panel).toContain('v-if="mergeOpen"');
    expect(dialog).toContain('type="password"');
    expect(dialog).toContain('autocomplete="new-password"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain(':aria-busy="pending"');
    expect(dialog).toContain("转入额度并注销来源 Key");
    expect(dialog).toContain("当前密钥和有效期保持不变");
    expect(dialog).toContain("var(--surface-main)");
    expect(dialog).toContain("calc(100dvh - 32px)");
    expect(dialog).not.toContain("localStorage");
  });
});
