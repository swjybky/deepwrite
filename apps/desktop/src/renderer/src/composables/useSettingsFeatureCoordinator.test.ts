import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ModelUsageDashboard
} from "@deepwrite/contracts";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import {
  useSettingsFeatureCoordinator,
  type SettingsFeatureNotifications
} from "./useSettingsFeatureCoordinator";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function modelSettings(defaultModelId: string): ModelSettings {
  return {
    defaultModelId,
    models: []
  } as ModelSettings;
}

function usageDashboard(generatedAt: string): ModelUsageDashboard {
  return {
    generatedAt,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      requestCount: 0
    },
    trendGranularity: "day",
    trend: [],
    models: [],
    modules: [],
    recentCalls: []
  };
}

function createNotifications(): SettingsFeatureNotifications {
  return {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
}

function createApi(overrides: Record<string, unknown> = {}): DeepWriteApi {
  return {
    models: {
      list: vi.fn(),
      save: vi.fn()
    },
    modelUsage: {
      query: vi.fn()
    },
    workspaceAgents: {
      list: vi.fn()
    },
    longAgents: {
      list: vi.fn()
    },
    agentTeams: {
      list: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
      activate: vi.fn(),
      save: vi.fn()
    },
    ...overrides
  } as unknown as DeepWriteApi;
}

function createHarness(api: DeepWriteApi) {
  const settingsStore = useSettingsStore();
  const notifications = createNotifications();
  const onModelsLoaded = vi.fn();
  const coordinator = useSettingsFeatureCoordinator({
    api: () => api,
    settingsStore,
    notifications,
    onModelsLoaded
  });
  return {
    coordinator,
    notifications,
    onModelsLoaded,
    settingsStore
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("settings feature coordinator", () => {
  it("single-flights concurrent model loads and publishes the shared snapshot once", async () => {
    const pending = deferred<ModelSettings>();
    const list = vi.fn(() => pending.promise);
    const api = createApi({ models: { list, save: vi.fn() } });
    const { coordinator, onModelsLoaded, settingsStore } = createHarness(api);

    const first = coordinator.loadModelSettings();
    const second = coordinator.loadModelSettings();

    expect(list).toHaveBeenCalledOnce();
    expect(settingsStore.modelLoading).toBe(true);

    const loaded = modelSettings("model-shared");
    pending.resolve(loaded);
    await Promise.all([first, second]);

    expect(settingsStore.modelSettings).toBe(loaded);
    expect(settingsStore.modelsLoaded).toBe(true);
    expect(settingsStore.modelLoading).toBe(false);
    expect(onModelsLoaded).toHaveBeenCalledOnce();
    expect(onModelsLoaded).toHaveBeenCalledWith(loaded);

    await coordinator.loadModelSettings();
    expect(list).toHaveBeenCalledOnce();
    expect(onModelsLoaded).toHaveBeenCalledOnce();
  });

  it("keeps the newest model-usage response when an older request resolves late", async () => {
    const older = deferred<ModelUsageDashboard>();
    const newer = deferred<ModelUsageDashboard>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const api = createApi({ modelUsage: { query } });
    const { coordinator, notifications, settingsStore } = createHarness(api);

    const olderRequest = coordinator.loadModelUsage({
      modelConfigIds: ["model-old"]
    });
    const newerRequest = coordinator.loadModelUsage({
      modelConfigIds: ["model-new"]
    });
    expect(settingsStore.modelUsageLoading).toBe(true);

    const newestDashboard = usageDashboard("2026-08-14T02:00:00.000Z");
    newer.resolve(newestDashboard);
    await newerRequest;

    expect(settingsStore.modelUsageDashboard).toBe(newestDashboard);
    expect(settingsStore.modelUsageQuery).toEqual({
      modelConfigIds: ["model-new"]
    });
    expect(settingsStore.modelUsageLoading).toBe(false);

    older.resolve(usageDashboard("2026-08-14T01:00:00.000Z"));
    await olderRequest;

    expect(settingsStore.modelUsageDashboard).toBe(newestDashboard);
    expect(settingsStore.modelUsageQuery).toEqual({
      modelConfigIds: ["model-new"]
    });
    expect(notifications.warning).not.toHaveBeenCalled();
  });

  it("resets the saving flag and preserves the last model snapshot after save failure", async () => {
    const pending = deferred<ModelSettings>();
    const save = vi.fn(() => pending.promise);
    const api = createApi({ models: { list: vi.fn(), save } });
    const { coordinator, notifications, onModelsLoaded, settingsStore } =
      createHarness(api);
    const existing = modelSettings("model-existing");
    settingsStore.markLoaded("models", existing);

    const saving = coordinator.saveModelSettings({
      defaultModelId: "model-next",
      models: []
    } as ModelSettingsInput);
    expect(settingsStore.modelSaving).toBe(true);
    expect(settingsStore.modelError).toBeNull();

    pending.reject(new Error("模型配置暂时不可写"));
    await saving;

    expect(settingsStore.modelSaving).toBe(false);
    expect(settingsStore.modelError).toBe("模型配置暂时不可写");
    expect(settingsStore.modelSettings).toBe(existing);
    expect(onModelsLoaded).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledOnce();
    expect(notifications.error).toHaveBeenCalledWith("模型配置暂时不可写");
  });

  it("publishes a refreshed free-model snapshot without clearing the cached one first", async () => {
    const existing = modelSettings("model-existing");
    const refreshed = {
      ...modelSettings("free-enabled"),
      deepwriteFreeEnabledModelIds: ["free-enabled"]
    } as ModelSettings;
    const refreshFree = vi.fn(async () => refreshed);
    const api = createApi({ models: { refreshFree } });
    const { coordinator, onModelsLoaded, settingsStore } = createHarness(api);
    settingsStore.markLoaded("models", existing);

    const refreshing = coordinator.refreshFreeModels();
    expect(settingsStore.modelSettings).toBe(existing);
    expect(settingsStore.freeModelsRefreshing).toBe(true);
    await refreshing;

    expect(settingsStore.modelSettings).toBe(refreshed);
    expect(settingsStore.freeModelsRefreshing).toBe(false);
    expect(onModelsLoaded).toHaveBeenCalledWith(refreshed);
  });

  it("publishes free-model enable changes and always releases the saving flag", async () => {
    const enabled = {
      ...modelSettings("free-writing"),
      deepwriteFreeEnabledModelIds: ["free-writing"]
    } as ModelSettings;
    const setFreeModelEnabled = vi.fn(async () => enabled);
    const api = createApi({ models: { setFreeModelEnabled } });
    const { coordinator, onModelsLoaded, settingsStore } = createHarness(api);

    const saving = coordinator.setFreeModelEnabled("free-writing", true);
    expect(settingsStore.freeModelsSaving).toBe(true);
    await saving;

    expect(setFreeModelEnabled).toHaveBeenCalledWith("free-writing", true);
    expect(settingsStore.freeModelsSaving).toBe(false);
    expect(settingsStore.modelSettings).toBe(enabled);
    expect(onModelsLoaded).toHaveBeenCalledWith(enabled);
  });

  it("refreshes the new-site page with quota and hides disabled models from selectors", async () => {
    const refreshed = {
      defaultModelId: "deepwrite-site-official-disabled",
      models: [
        {
          id: "deepwrite-site-official-disabled",
          label: "Disabled site model",
          provider: "example",
          modelId: "site-disabled",
          api: "openai-completions",
          baseUrl: "https://models.example.test/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low"],
          temperatureOptions: [0.1, 0.7, 1],
          hasApiKey: true,
          enabled: false
        },
        {
          id: "custom-enabled",
          label: "Custom",
          provider: "example",
          modelId: "custom",
          api: "openai-completions",
          baseUrl: "https://models.example.test/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low"],
          temperatureOptions: [0.1, 0.7, 1],
          hasApiKey: true
        }
      ]
    } satisfies ModelSettings;
    const quota = {
      queriedAt: "2026-09-01T00:00:00.000Z",
      remaining: 80,
      used: 20,
      total: 100,
      unlimited: false
    };
    const refreshSiteOfficial = vi.fn(async () => refreshed);
    const querySiteOfficialQuota = vi.fn(async () => quota);
    const api = createApi({
      models: { refreshSiteOfficial, querySiteOfficialQuota }
    });
    const { coordinator, onModelsLoaded, settingsStore } = createHarness(api);

    await coordinator.refreshSiteOfficialModels();

    expect(settingsStore.siteOfficialModelsRefreshing).toBe(false);
    expect(settingsStore.siteOfficialQuota).toEqual(quota);
    expect(onModelsLoaded).toHaveBeenCalledWith({
      ...refreshed,
      defaultModelId: "custom-enabled",
      models: [refreshed.models[1]]
    });
  });

  it("tests a model with shared progress state and reports success through notifications", async () => {
    const test = vi.fn(async () => ({
      ok: true,
      message: "模型联通正常。",
      modelId: "free-writing",
      contextWindow: 272_000,
      maxTokens: 128_000
    }));
    const api = createApi({ models: { test } });
    const { coordinator, notifications, settingsStore } = createHarness(api);
    const model: ModelConfigInput = {
      id: "free-writing",
      label: "Free Writing",
      provider: "deepwrite-free",
      modelId: "free-writing",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.1, 0.7, 1]
    };

    const testing = coordinator.testModel(model);
    expect(settingsStore.testingModelId).toBe(model.id);
    await testing;

    expect(test).toHaveBeenCalledWith(model);
    expect(settingsStore.testingModelId).toBeNull();
    expect(settingsStore.modelTestMessage).toBe("模型联通正常。");
    expect(settingsStore.lastModelTestCapacity).toEqual({
      modelId: "free-writing",
      contextWindow: 272_000,
      maxTokens: 128_000
    });
    expect(notifications.success).toHaveBeenCalledWith("模型联通正常。");
  });

  it("reports a failed model test through notifications exactly once", async () => {
    const test = vi.fn(async () => {
      throw new Error("模型端点无法访问");
    });
    const api = createApi({ models: { test } });
    const { coordinator, notifications, settingsStore } = createHarness(api);
    const model: ModelConfigInput = {
      id: "free-writing",
      label: "Free Writing",
      provider: "deepwrite-free",
      modelId: "free-writing",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.1, 0.7, 1]
    };

    await coordinator.testModel(model);

    expect(settingsStore.testingModelId).toBeNull();
    expect(settingsStore.lastModelTestCapacity).toBeNull();
    expect(settingsStore.modelError).toBe("模型端点无法访问");
    expect(notifications.error).toHaveBeenCalledOnce();
    expect(notifications.error).toHaveBeenCalledWith("模型端点无法访问");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("single-flights short/script agent settings across concurrent feature loads", async () => {
    const list = vi.fn(async (workspaceType: "short" | "script") =>
      workspaceType === "short"
        ? structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS)
        : structuredClone(DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS)
    );
    const api = createApi({ workspaceAgents: { list } });
    const { coordinator, notifications, settingsStore } = createHarness(api);

    await Promise.all([
      coordinator.loadShortAndScriptAgentSettings(),
      coordinator.loadShortAndScriptAgentSettings()
    ]);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith("short");
    expect(list).toHaveBeenCalledWith("script");
    expect(settingsStore.workspaceAgentsLoaded).toBe(true);
    expect(settingsStore.workspaceAgentSettings).toHaveLength(2);

    await coordinator.loadShortAndScriptAgentSettings();
    expect(list).toHaveBeenCalledTimes(2);
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("single-flights the unified agent-team catalog", async () => {
    const list = vi.fn(async () => ({
      enabledTeamIds: {},
      teams: [
        {
          id: "team_short_default",
          name: "默认短篇团队",
          workspaceType: "short" as const,
          settings: structuredClone(DEFAULT_AGENT_TEAM_SETTINGS)
        },
        {
          id: "team_script_default",
          name: "默认剧本团队",
          workspaceType: "script" as const,
          settings: structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS)
        },
        {
          id: "team_long_default",
          name: "默认长篇团队",
          workspaceType: "long" as const,
          settings: structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS)
        }
      ]
    }));
    const api = createApi({
      agentTeams: { list }
    });
    const { coordinator, notifications, settingsStore } = createHarness(api);

    await Promise.all([
      coordinator.loadAgentTeamSettings(),
      coordinator.loadAgentTeamSettings()
    ]);

    expect(list).toHaveBeenCalledOnce();
    expect(settingsStore.agentTeamLoaded).toBe(true);

    await coordinator.loadAgentTeamSettings();
    expect(list).toHaveBeenCalledOnce();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("downloads and installs team packages without treating cancellation as success", async () => {
    const installedCatalog = {
      enabledTeamIds: {},
      teams: [
        {
          id: "team_installed",
          name: "安装的团队",
          workspaceType: "short" as const,
          settings: structuredClone(DEFAULT_AGENT_TEAM_SETTINGS)
        }
      ]
    };
    const download = vi
      .fn()
      .mockResolvedValueOnce({ status: "canceled" })
      .mockResolvedValueOnce({
        status: "saved",
        filePath: "/tmp/team.zip"
      });
    const install = vi.fn().mockResolvedValue({
      status: "installed",
      teamId: "team_installed",
      teamName: "安装的团队",
      catalog: installedCatalog
    });
    const api = createApi({ agentTeams: { download, install } });
    const { coordinator, notifications, settingsStore } = createHarness(api);

    await coordinator.downloadAgentTeam({ teamId: "team_source" });
    expect(notifications.success).not.toHaveBeenCalled();
    await coordinator.downloadAgentTeam({ teamId: "team_source" });
    await coordinator.installAgentTeam();

    expect(download).toHaveBeenCalledWith({ teamId: "team_source" });
    expect(notifications.success).toHaveBeenCalledWith(
      "智能体团队压缩包已下载。"
    );
    expect(settingsStore.agentTeamCatalog).toEqual(installedCatalog);
    expect(notifications.success).toHaveBeenCalledWith(
      "智能体团队“安装的团队”已安装。"
    );
  });
});
