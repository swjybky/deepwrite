import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelConfig,
  type ModelSettings
} from "@deepwrite/contracts";
import type { IpcCommandContext } from "./command-types";
import { UtilityCommandTimeoutError } from "../supervisor";
import { handleModelCommands } from "./model-commands";
import { ModelTestRegistry } from "./model-test-registry";

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

  it("validates a new-site key and discovers every protocol through the public catalog", async () => {
    const list = vi.fn(async () => settings());
    const save = vi.fn(async () => settings());
    const listRemoteModels = vi.fn(async () => [
      { id: "deepseek-v4-flash" },
      { id: "gemini-3.7-flash", api: "google-generative-ai" }
    ]);
    const remoteFetch = vi.fn(async () =>
      Response.json({
        object: "api_key_quota",
        unlimited: false,
        total: 10,
        used: 0,
        remaining: 10
      })
    );
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ list, save }),
      requireModelUsageStore: () => ({ syncConfiguredModels }),
      listRemoteModels,
      remoteFetch
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
    expect(remoteFetch).toHaveBeenCalledOnce();
    expect(listRemoteModels).toHaveBeenCalledOnce();
    expect(listRemoteModels).toHaveBeenCalledWith(
      expect.objectContaining({
        api: "openai-completions",
        baseUrl: "https://gateway.example.test/api/v1/public",
        apiKey: "",
        allowUnauthenticated: true
      })
    );
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
  });

  it("retains the new-site catalog with models disabled when its user key is cleared", async () => {
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
        models: [
          expect.objectContaining({
            id: siteModel.id,
            clearApiKey: true,
            enabled: false
          }),
          expect.objectContaining({ id: freeModel.id })
        ],
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

  it("persists supportsDeveloperRole=false when a custom model test detects fallback", async () => {
    const custom = {
      ...freeModel,
      id: "custom-modelscope",
      managedBy: undefined,
      provider: "custom",
      modelId: "qwen3-writer"
    };
    const resolveDraft = vi.fn(async () => ({ ...custom, apiKey: "test-key" }));
    const disableDeveloperRole = vi.fn(async () => undefined);
    const requestCommand = vi.fn(async () => ({
      status: "accepted" as const,
      requestId: "cmd_test",
      payload: {
        modelId: custom.id,
        ok: true,
        message:
          "连接成功，检测到接口不支持 developer 角色，已自动开启兼容配置。",
        testedAt: "2026-10-01T00:00:00.000Z",
        contextWindow: 272_000,
        maxTokens: 128_000,
        supportsDeveloperRole: false
      }
    }));
    const ctx = {
      requireModelConfigStore: () => ({ resolveDraft, disableDeveloperRole }),
      supervisor: { requestCommand }
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope("models.test", { model: custom }, { id: "cmd_test" })
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { supportsDeveloperRole: false }
    });
    expect(disableDeveloperRole).toHaveBeenCalledWith(
      custom.id,
      expect.objectContaining({
        provider: custom.provider,
        modelId: custom.modelId,
        api: custom.api,
        baseUrl: custom.baseUrl
      })
    );
  });

  it("isolates models.cancelTest by ownerId, forwards agent.model_test_cancel, and prevents stale developer-role writes", async () => {
    const custom = {
      ...freeModel,
      id: "custom-gemini-test",
      managedBy: undefined,
      provider: "google",
      modelId: "gemini-2.5-pro",
      api: "google-generative-ai" as const,
      baseUrl: "https://provider.example.test/v1beta"
    };
    const resolveDraft = vi.fn(async () => ({ ...custom, apiKey: "test-key" }));
    const disableDeveloperRole = vi.fn(async () => undefined);
    let resolveAgentTest!: (value: {
      status: "accepted";
      requestId: string;
      payload: unknown;
    }) => void;
    const requestCommand = vi.fn((_worker: string, cmd: { type: string }) => {
      if (cmd.type === "agent.model_test") {
        return new Promise((resolve) => {
          resolveAgentTest = resolve as typeof resolveAgentTest;
        });
      }
      return Promise.resolve({
        status: "accepted" as const,
        requestId: "cmd_cancel_agent",
        payload: { cancelled: true }
      });
    });
    const modelTestRegistry = new ModelTestRegistry();
    const baseCtx = {
      requireModelConfigStore: () => ({ resolveDraft, disableDeveloperRole }),
      supervisor: { requestCommand },
      modelTestRegistry
    };

    const testCommand = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.test",
        { model: custom, requestId: "req_owner_1" },
        { id: "cmd_test_owner_1" }
      )
    );
    const pendingTest = handleModelCommands(
      { ...baseCtx, ownerId: 101 } as unknown as IpcCommandContext,
      testCommand
    );
    await vi.waitFor(() => expect(requestCommand).toHaveBeenCalledTimes(1));

    // Different owner cannot cancel
    const foreignCancel = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.cancelTest",
        { requestId: "req_owner_1" },
        { id: "cmd_cancel_foreign" }
      )
    );
    await expect(
      handleModelCommands(
        { ...baseCtx, ownerId: 202 } as unknown as IpcCommandContext,
        foreignCancel
      )
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { cancelled: false }
    });

    // Same owner cancels
    const ownCancel = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.cancelTest",
        { requestId: "req_owner_1" },
        { id: "cmd_cancel_own" }
      )
    );
    await expect(
      handleModelCommands(
        { ...baseCtx, ownerId: 101 } as unknown as IpcCommandContext,
        ownCancel
      )
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { cancelled: true }
    });

    expect(requestCommand).toHaveBeenNthCalledWith(
      2,
      "agent",
      expect.objectContaining({
        type: "agent.model_test_cancel",
        payload: { requestId: "req_owner_1" }
      }),
      5_000
    );

    // Even if agent resolves accepted right as cancel arrived, Main keeps cancelled semantics and skips disableDeveloperRole
    resolveAgentTest({
      status: "accepted",
      requestId: "cmd_test_owner_1",
      payload: {
        modelId: custom.id,
        ok: true,
        message: "ok",
        testedAt: "2026-10-01T00:00:00.000Z",
        contextWindow: 272_000,
        maxTokens: 128_000,
        supportsDeveloperRole: false
      }
    });
    await expect(pendingTest).resolves.toMatchObject({
      status: "rejected",
      error: { code: "models.test_cancelled" }
    });
    expect(disableDeveloperRole).not.toHaveBeenCalled();
  });

  it("cancels all active tests on cancelOwner and notifies agent on UtilityCommandTimeoutError", async () => {
    const custom = {
      ...freeModel,
      id: "custom-timeout-test",
      managedBy: undefined,
      provider: "google",
      modelId: "gemini-2.5-pro",
      api: "google-generative-ai" as const
    };
    const resolveDraft = vi.fn(async () => ({ ...custom, apiKey: "test-key" }));
    const cancelSpy = vi.fn(async () => true);
    const modelTestRegistry = new ModelTestRegistry();
    const requestCommand = vi.fn(
      async (_worker: string, cmd: { type: string }) => {
        if (cmd.type === "agent.model_test") {
          throw new UtilityCommandTimeoutError(
            "agent utility command timed out"
          );
        }
        return {
          status: "accepted" as const,
          requestId: "cmd_cancel",
          payload: { cancelled: true }
        };
      }
    );
    const ctx = {
      requireModelConfigStore: () => ({ resolveDraft }),
      supervisor: { requestCommand },
      ownerId: 55,
      modelTestRegistry
    } as unknown as IpcCommandContext;

    const timeoutCommand = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.test",
        { model: custom, requestId: "req_timeout_1" },
        { id: "cmd_timeout_1" }
      )
    );
    await expect(
      handleModelCommands(ctx, timeoutCommand)
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "models.test_timeout" }
    });
    expect(requestCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        type: "agent.model_test_cancel",
        payload: { requestId: "req_timeout_1" }
      }),
      5_000
    );

    modelTestRegistry.begin("req_owner_unload", 77);
    modelTestRegistry.markDispatched("req_owner_unload");
    await modelTestRegistry.cancelOwner(77, cancelSpy);
    expect(cancelSpy).toHaveBeenCalledWith("req_owner_unload");
    expect(modelTestRegistry.isCancelled("req_owner_unload")).toBe(true);
  });
});
