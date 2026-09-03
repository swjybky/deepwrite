import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelConfig,
  type ModelSettings
} from "@deepwrite/contracts";
import type { IpcCommandContext } from "./command-types";
import { handleModelCommands } from "./model-commands";

vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test"
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const freeModel: ModelConfig = {
  id: "deepwrite-free-writer",
  label: "Free Writer",
  provider: "deepwrite",
  modelId: "writer-v1",
  api: "openai-completions" as const,
  baseUrl: "https://models.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off" as const,
  thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
  temperatureOptions: [0.1, 0.7, 1],
  managedBy: "deepwrite-free",
  hasApiKey: true
};

function settings(): ModelSettings {
  return {
    models: [freeModel],
    defaultModelId: freeModel.id,
    deepwriteFreeModels: [freeModel],
    deepwriteFreeEnabledModelIds: [freeModel.id],
    deepwriteFreeDeprecatedModels: []
  };
}

describe("model commands", () => {
  it("synchronizes the usage registry after refreshing free models", async () => {
    const refreshFreeModels = vi.fn(async () => settings());
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ refreshFreeModels }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope("models.refreshFree", {}, { id: "cmd_refresh_free" })
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { deepwriteFreeEnabledModelIds: [freeModel.id] }
    });
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
    expect(refreshFreeModels.mock.invocationCallOrder[0]).toBeLessThan(
      syncConfiguredModels.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("updates free-model enablement and synchronizes configured models", async () => {
    const setFreeModelEnabled = vi.fn(async () => settings());
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ setFreeModelEnabled }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.setFreeModelEnabled",
        { modelId: freeModel.id, enabled: true },
        { id: "cmd_enable_free" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { defaultModelId: freeModel.id }
    });
    expect(setFreeModelEnabled).toHaveBeenCalledWith(freeModel.id, true);
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
  });

  it("returns a focused error when free-model enablement is rejected", async () => {
    const setFreeModelEnabled = vi.fn(async () => {
      throw new Error("该免费模型当前不可用。");
    });
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ setFreeModelEnabled }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.setFreeModelEnabled",
        { modelId: freeModel.id, enabled: true },
        { id: "cmd_enable_unavailable_free" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: {
        code: "models.set_free_model_enabled_failed",
        message: "该免费模型当前不可用。"
      }
    });
    expect(syncConfiguredModels).not.toHaveBeenCalled();
  });

  it("saves a new-site key after discovering v1 and Google v1beta models", async () => {
    const list = vi.fn(async () => settings());
    const save = vi.fn(async () => settings());
    const listRemoteModels = vi.fn(async (input: { api: string }) =>
      input.api === "google-generative-ai"
        ? [{ id: "gemini-3.7-flash" }]
        : [{ id: "deepseek-v4-flash" }, { id: "gemini-3.7-flash" }]
    );
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ list, save }),
      requireModelUsageStore: () => ({ syncConfiguredModels }),
      listRemoteModels
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.saveSiteOfficialToken",
        { apiKey: "dw_sk_test_only_invalid" },
        { id: "cmd_save_site_official" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted"
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "deepwrite-site-official-deepseek-v4-flash",
            api: "openai-completions",
            apiKey: "dw_sk_test_only_invalid"
          }),
          expect.objectContaining({
            id: "deepwrite-site-official-gemini-3.7-flash",
            api: "google-generative-ai",
            apiKey: "dw_sk_test_only_invalid"
          })
        ])
      })
    );
    expect(listRemoteModels).toHaveBeenCalledTimes(2);
    expect(listRemoteModels).toHaveBeenCalledWith(
      expect.objectContaining({
        api: "openai-completions",
        baseUrl: "https://gateway.example.test/v1"
      })
    );
    expect(listRemoteModels).toHaveBeenCalledWith(
      expect.objectContaining({
        api: "google-generative-ai",
        baseUrl: "https://gateway.example.test/v1beta"
      })
    );
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
  });

  it("removes the new-site model when its user key is cleared", async () => {
    const siteModel = {
      ...freeModel,
      id: "deepwrite-site-official-deepseek-v4-flash",
      managedBy: undefined
    };
    const current = {
      models: [siteModel, freeModel],
      defaultModelId: siteModel.id
    } satisfies ModelSettings;
    const cleared = settings();
    const list = vi.fn(async () => current);
    const save = vi.fn(async () => cleared);
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ list, save }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.clearSiteOfficialToken",
        {},
        { id: "cmd_clear_site_official" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted"
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({ id: freeModel.id })],
        defaultModelId: freeModel.id
      })
    );
  });

  it("refreshes a saved new-site catalog and queries its quota without exposing the key", async () => {
    const siteModel = {
      ...freeModel,
      id: "deepwrite-site-official-deepseek-v4-flash",
      managedBy: undefined,
      enabled: false
    };
    const current = {
      models: [siteModel, freeModel],
      defaultModelId: freeModel.id
    } satisfies ModelSettings;
    const list = vi.fn(async () => current);
    const resolveDraftApiKey = vi.fn(async () => "dw_sk_test_only_invalid");
    const save = vi.fn(async () => current);
    const listRemoteModels = vi.fn(async () => [{ id: "deepseek-v4-flash" }]);
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ list, resolveDraftApiKey, save }),
      requireModelUsageStore: () => ({ syncConfiguredModels }),
      listRemoteModels
    } as unknown as IpcCommandContext;

    const refresh = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.refreshSiteOfficial",
        {},
        { id: "cmd_refresh_site_official" }
      )
    );
    await expect(handleModelCommands(ctx, refresh)).resolves.toMatchObject({
      status: "accepted"
    });
    expect(resolveDraftApiKey).toHaveBeenCalledWith({ id: siteModel.id });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({ id: siteModel.id, enabled: false })
        ])
      })
    );

    const remoteFetch = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://gateway.example.test/v1/key/quota");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer dw_sk_test_only_invalid"
      );
      return new Response(
        JSON.stringify({
          object: "api_key_quota",
          currency: "CNY",
          queried_at: "2026-09-01T00:00:00.000Z",
          status: "active",
          unlimited: false,
          total: "100",
          used: "25",
          remaining: "75"
        }),
        { status: 200 }
      );
    });
    const queryCtx = { ...ctx, remoteFetch };
    const query = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.querySiteOfficialQuota",
        {},
        { id: "cmd_query_site_official_quota" }
      )
    );
    await expect(handleModelCommands(queryCtx, query)).resolves.toMatchObject({
      status: "accepted",
      payload: {
        remaining: 75,
        used: 25,
        total: 100,
        unlimited: false
      }
    });
  });

  it("resolves model capacity without loading stored API credentials", async () => {
    const resolveDraft = vi.fn(async () => {
      throw new Error("API Key 解密失败");
    });
    const requestCommand = vi.fn(async () => ({
      status: "accepted" as const,
      requestId: "cmd_capacity",
      payload: {
        modelId: freeModel.modelId,
        contextWindow: 456_000,
        maxTokens: 32_000
      }
    }));
    const ctx = {
      requireModelConfigStore: () => ({ resolveDraft }),
      supervisor: { requestCommand }
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.resolveCapacity",
        {
          model: {
            ...freeModel,
            contextWindow: 456_000,
            maxTokens: 32_000
          }
        },
        { id: "cmd_capacity" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { contextWindow: 456_000, maxTokens: 32_000 }
    });
    expect(resolveDraft).not.toHaveBeenCalled();
    expect(requestCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        type: "agent.model_capacity",
        payload: {
          runtimeConfig: expect.objectContaining({
            apiKey: "",
            contextWindow: 456_000,
            maxTokens: 32_000
          })
        }
      }),
      10_000
    );
  });
});
