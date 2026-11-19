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
  it("shows a readable replacement-key failure and keeps the previous models", async () => {
    const { models, notifications, store, coordinator } = setup();
    const message = "当前新官方小站密钥额度已用完，请补充额度后重试。";
    models.saveSiteOfficialToken.mockRejectedValueOnce(
      new Error(`models.save_site_official_token_failed: ${message}`)
    );
    await coordinator.saveSiteOfficialToken("replacement_test_only_invalid");
    expect(notifications.error).toHaveBeenCalledWith(message);
    expect(notifications.success).not.toHaveBeenCalled();
    expect(store.modelSettings).toEqual(settings);
    expect(store.siteOfficialModelsSaving).toBe(false);
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
  });

  it("preserves single-key saving without attempting a transfer", async () => {
    const { models, store, coordinator } = setup();
    await coordinator.saveSiteOfficialToken(" target_test_only_invalid ");
    expect(models.saveSiteOfficialToken).toHaveBeenCalledExactlyOnceWith(
      "target_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    expect(models.querySiteOfficialQuota).toHaveBeenCalledOnce();
    expect(store.siteOfficialModelsSaving).toBe(false);
  });

  it("saves only the first key and continues past a failed source with its original line number", async () => {
    const { models, notifications, coordinator, store } = setup();
    models.mergeSiteOfficialQuota.mockRejectedValueOnce({
      code: "invalid_source_key",
      message: "来源 Key 无效、已注销或已过期，请检查后重试。"
    });
    await coordinator.saveSiteOfficialToken(
      " target_test_only_invalid\r\n failed_test_only_invalid\r\n\r\n source_test_only_invalid \r\n last_test_only_invalid "
    );
    expect(models.saveSiteOfficialToken).toHaveBeenCalledExactlyOnceWith(
      "target_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota.mock.calls).toEqual([
      [{ sourceKey: "failed_test_only_invalid", targetRevision }],
      [{ sourceKey: "source_test_only_invalid", targetRevision }],
      [{ sourceKey: "last_test_only_invalid", targetRevision }]
    ]);
    expect(models.querySiteOfficialQuota).toHaveBeenCalledTimes(2);
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringMatching(/成功 2 个.*第 2 行：来源 Key 无效/u),
      { duration: 15_000 }
    );
    expect(JSON.stringify(notifications.warning.mock.calls)).not.toContain(
      "failed_test_only_invalid"
    );
    expect(store.siteOfficialModelsSaving).toBe(false);
  });

  it("does not transfer sources if saving the first key fails", async () => {
    const { models, coordinator, notifications } = setup();
    models.saveSiteOfficialToken.mockRejectedValueOnce({
      code: "models.save_site_official_token_failed",
      message: "第一行密钥无效"
    });
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nsource_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith(
      expect.stringMatching(/第 1 行密钥未保存：第一行密钥无效.*均未转入/u)
    );
  });

  it("reports every unattempted source when the saved target quota is unavailable", async () => {
    const { models, coordinator, notifications, store } = setup();
    models.querySiteOfficialQuota.mockRejectedValueOnce(new Error("offline"));
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nsource_test_only_invalid\nlast_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith(
      expect.stringMatching(/第 2 行：尚未转入.*第 3 行：尚未转入/u),
      { duration: 15_000 }
    );
    expect(store.siteOfficialQuota).toBeNull();
  });

  it("does not repeat a transfer for duplicated sources or the first saved key", async () => {
    const { models, coordinator, notifications } = setup();
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nsource_test_only_invalid\ntarget_test_only_invalid\nsource_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledExactlyOnceWith({
      sourceKey: "source_test_only_invalid",
      targetRevision
    });
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringMatching(/第 3 行：与第 1 行.*第 4 行：与第 2 行/u),
      { duration: 15_000 }
    );
  });

  it("validates each key before saving or transferring any quota", async () => {
    const { models, coordinator, merge, notifications } = setup();
    const input = `target_test_only_invalid\n${"x".repeat(1_025)}`;
    await coordinator.saveSiteOfficialToken(input);
    merge.show();
    merge.sourceKey.value = input;
    await merge.submit();
    expect(models.saveSiteOfficialToken).not.toHaveBeenCalled();
    expect(models.mergeSiteOfficialQuota).not.toHaveBeenCalled();
    expect(notifications.warning).toHaveBeenCalledTimes(2);
    expect(notifications.warning).toHaveBeenLastCalledWith(
      expect.stringContaining("第 2 行密钥过长")
    );
  });

  it("continues after a source cannot transfer unlimited quota", async () => {
    const { models, coordinator, notifications } = setup();
    models.mergeSiteOfficialQuota.mockRejectedValueOnce({
      code: "unlimited_key",
      message: "无限额度密钥不支持额度转入。"
    });
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nunlimited_test_only_invalid\nsource_test_only_invalid"
    );
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledTimes(2);
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringMatching(/成功 1 个.*第 2 行：无限额度/u),
      { duration: 15_000 }
    );
  });

  it("retains transferred quota when refreshing after multiline saving fails", async () => {
    const { models, coordinator, store } = setup();
    models.querySiteOfficialQuota.mockResolvedValueOnce(quota);
    models.querySiteOfficialQuota.mockRejectedValueOnce(new Error("offline"));
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nsource_test_only_invalid\nlast_test_only_invalid"
    );
    expect(store.siteOfficialQuota?.remaining).toBe(3);
    expect(store.siteOfficialModelsSaving).toBe(false);
  });

  it("does not echo pasted keys from unexpected errors into batch notifications", async () => {
    const { models, coordinator, notifications } = setup();
    models.mergeSiteOfficialQuota.mockRejectedValueOnce(
      new Error(
        "failed with target_test_only_invalid and source_test_only_invalid"
      )
    );
    await coordinator.saveSiteOfficialToken(
      "target_test_only_invalid\nsource_test_only_invalid"
    );
    const messages = JSON.stringify(notifications.error.mock.calls);
    expect(messages).toContain("第 2 行");
    expect(messages).not.toContain("target_test_only_invalid");
    expect(messages).not.toContain("source_test_only_invalid");
  });

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
    expect(notifications.error).toHaveBeenCalledWith("来源 Key 无效", {
      duration: 15_000
    });
    expect(merge.sourceKey.value).toBe("");
    expect(merge.open.value).toBe(true);
    expect(store.siteOfficialModelsSaving).toBe(false);
    expect(models.querySiteOfficialQuota).not.toHaveBeenCalled();
  });

  it("transfers multiple sources sequentially, keeps successes, and reports a failed middle line", async () => {
    const { merge, models, notifications, store } = setup();
    const waiting =
      deferred<Awaited<ReturnType<typeof models.mergeSiteOfficialQuota>>>();
    models.mergeSiteOfficialQuota.mockImplementationOnce(() => waiting.promise);
    models.mergeSiteOfficialQuota.mockRejectedValueOnce({
      code: "source_quota_empty",
      message: "来源 Key 没有可转入的剩余额度。"
    });
    merge.show();
    merge.sourceKey.value =
      " first_test_only_invalid\n failed_test_only_invalid\n last_test_only_invalid ";
    const pending = merge.submit();
    await merge.submit();
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledOnce();
    expect(store.siteOfficialModelsSaving).toBe(true);
    waiting.resolve({
      transferred: "3",
      sourceRevoked: true,
      quota: { ...quota, remaining: 3, total: 13 }
    });
    await pending;
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledTimes(3);
    expect(models.mergeSiteOfficialQuota).toHaveBeenLastCalledWith({
      sourceKey: "last_test_only_invalid",
      targetRevision
    });
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringMatching(/成功 2 个.*第 2 行：来源 Key 没有/u),
      { duration: 15_000 }
    );
    expect(merge.sourceKey.value).toBe("");
    expect(merge.open.value).toBe(true);
    expect(store.siteOfficialModelsSaving).toBe(false);
  });

  it("stops the remaining transfers when the target changes and reports their line numbers", async () => {
    const { merge, models, notifications } = setup();
    models.mergeSiteOfficialQuota.mockRejectedValueOnce({
      code: "target_changed",
      message: "当前密钥配置已变化，请刷新额度后重新确认。"
    });
    merge.show();
    merge.sourceKey.value =
      "first_test_only_invalid\nsecond_test_only_invalid\nthird_test_only_invalid";
    await merge.submit();
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledOnce();
    expect(notifications.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /第 1 行：当前密钥配置已变化.*第 2 行：尚未转入.*第 3 行：尚未转入/u
      ),
      { duration: 15_000 }
    );
  });

  it("does not overwrite a new model snapshot or transfer more keys after it changes during a batch", async () => {
    const { merge, models, store, notifications } = setup();
    const waiting =
      deferred<Awaited<ReturnType<typeof models.mergeSiteOfficialQuota>>>();
    models.mergeSiteOfficialQuota.mockImplementationOnce(() => waiting.promise);
    merge.show();
    merge.sourceKey.value = "first_test_only_invalid\nsecond_test_only_invalid";
    const pending = merge.submit();
    store.modelSettings = { ...settings };
    waiting.resolve({
      transferred: "3",
      sourceRevoked: true,
      quota: { ...quota, remaining: 3, total: 13 }
    });
    await pending;
    expect(models.mergeSiteOfficialQuota).toHaveBeenCalledOnce();
    expect(store.siteOfficialQuota).toEqual(quota);
    expect(notifications.warning).toHaveBeenCalledWith(
      expect.stringMatching(/第 2 行：尚未转入.*配置已变化/u),
      { duration: 15_000 }
    );
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
});
