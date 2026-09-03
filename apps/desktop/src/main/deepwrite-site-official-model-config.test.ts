import { describe, expect, it } from "vitest";
import type { ModelConfig, ModelSettings } from "@deepwrite/contracts";
import {
  DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
  clearDeepWriteSiteOfficialModelInput,
  createDeepWriteSiteOfficialModels,
  deepWriteSiteOfficialGatewayBaseUrl,
  saveDeepWriteSiteOfficialModelInput,
  setDeepWriteSiteOfficialModelEnabledInput
} from "./deepwrite-site-official-model-config";

function model(id: string): ModelConfig {
  return {
    id,
    label: id,
    provider: "custom",
    modelId: id,
    api: "openai-completions",
    baseUrl: "https://models.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["medium"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: true
  };
}

function settings(
  models: ModelConfig[],
  defaultModelId: string
): ModelSettings {
  return { models, defaultModelId };
}

describe("DeepWrite site official model config", () => {
  it("builds both v1 and Google v1beta models returned by the gateway", () => {
    const configured = createDeepWriteSiteOfficialModels(
      "dw_sk_test_only_invalid",
      {
        models: [{ id: "deepseek-v4-flash" }, { id: "gemini-3.7-flash" }],
        googleModels: [{ id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" }]
      },
      "https://gateway.example.test"
    );

    expect(configured).toEqual([
      expect.objectContaining({
        id: DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
        label: "DeepSeek-V4-Flash（新官方小站）",
        provider: "deepseek",
        modelId: "deepseek-v4-flash",
        api: "openai-completions",
        baseUrl: "https://gateway.example.test/v1",
        input: 3,
        output: 6,
        cache: 0.25,
        apiKey: "dw_sk_test_only_invalid"
      }),
      expect.objectContaining({
        id: "deepwrite-site-official-gemini-3.7-flash",
        label: "Gemini 3.7 Flash（新官方小站）",
        provider: "google",
        modelId: "gemini-3.7-flash",
        api: "google-generative-ai",
        baseUrl: "https://gateway.example.test/v1beta",
        input: 1,
        output: 3,
        cache: 0.05,
        apiKey: "dw_sk_test_only_invalid"
      })
    ]);
    expect(configured[0]).not.toHaveProperty("managedBy");
    expect(configured[1]).not.toHaveProperty("managedBy");
  });

  it("normalizes an already-versioned gateway URL for both protocols", () => {
    expect(
      deepWriteSiteOfficialGatewayBaseUrl(
        "openai-completions",
        "https://gateway.example.test/proxy/v1beta/"
      )
    ).toBe("https://gateway.example.test/proxy/v1");
    expect(
      deepWriteSiteOfficialGatewayBaseUrl(
        "google-generative-ai",
        "https://gateway.example.test/proxy/v1"
      )
    ).toBe("https://gateway.example.test/proxy/v1beta");
  });

  it("uses validated remote runtime configuration before local defaults", () => {
    const [configured] = createDeepWriteSiteOfficialModels(
      "dw_sk_test_only_invalid",
      {
        models: [
          {
            id: "deepseek-v4-flash",
            label: "Remote DeepSeek",
            provider: "deepseek-gateway",
            requestModelId: "deepseek-v4-flash-20260901",
            supportsDeveloperRole: true,
            toolSchemaProfile: "portable",
            reasoning: true,
            defaultThinkingLevel: "medium",
            thinkingLevelOptions: ["low", "medium", "high"],
            temperatureOptions: [0.2, 0.5, 0.9],
            contextWindow: 1_000_000,
            maxTokens: 256_000,
            status: 0,
            discount: 0.75,
            input: 2,
            output: 4,
            cache: 0.1
          }
        ],
        googleModels: []
      },
      "https://gateway.example.test"
    );

    expect(configured).toMatchObject({
      label: "Remote DeepSeek（新官方小站）",
      provider: "deepseek-gateway",
      modelId: "deepseek-v4-flash",
      requestModelId: "deepseek-v4-flash-20260901",
      supportsDeveloperRole: true,
      toolSchemaProfile: "portable",
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.5, 0.9],
      contextWindow: 1_000_000,
      maxTokens: 256_000,
      status: 0,
      discount: 0.75,
      input: 2,
      output: 4,
      cache: 0.1
    });
  });

  it("adds or replaces every discovered site model after the user supplies a key", () => {
    const custom = model("custom");
    const previous = {
      ...model(DEEPWRITE_SITE_OFFICIAL_MODEL_ID),
      label: "stale"
    };
    const input = saveDeepWriteSiteOfficialModelInput(
      settings([custom, previous], custom.id),
      "dw_sk_test_only_invalid",
      {
        models: [{ id: "deepseek-v4-flash" }, { id: "gemini-3.7-flash" }],
        googleModels: [{ id: "gemini-3.7-flash" }]
      },
      "https://gateway.example.test"
    );

    expect(input.models.map((candidate) => candidate.id)).toEqual([
      custom.id,
      DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
      "deepwrite-site-official-gemini-3.7-flash"
    ]);
    expect(input.defaultModelId).toBe(custom.id);
    expect(input.models[1]).toMatchObject({
      apiKey: "dw_sk_test_only_invalid",
      baseUrl: "https://gateway.example.test/v1"
    });
    expect(input.models[2]).toMatchObject({
      api: "google-generative-ai",
      apiKey: "dw_sk_test_only_invalid",
      baseUrl: "https://gateway.example.test/v1beta"
    });
  });

  it("preserves model visibility across refreshes and changes the selectable default", () => {
    const custom = model("custom");
    const site = {
      ...model(DEEPWRITE_SITE_OFFICIAL_MODEL_ID),
      enabled: false
    };
    const refreshed = saveDeepWriteSiteOfficialModelInput(
      settings([site, custom], custom.id),
      "dw_sk_test_only_invalid",
      { models: [{ id: "deepseek-v4-flash" }], googleModels: [] },
      "https://gateway.example.test"
    );
    expect(refreshed.models[1]).toMatchObject({
      id: DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
      enabled: false
    });

    const enabled = setDeepWriteSiteOfficialModelEnabledInput(
      settings(
        refreshed.models.map((candidate) => ({
          ...candidate,
          hasApiKey: true
        })),
        custom.id
      ),
      DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
      true
    );
    expect(enabled.models[1]).toMatchObject({ enabled: true });
  });

  it("removes the model and chooses another default without exposing keys", () => {
    const custom = model("custom");
    const site = model(DEEPWRITE_SITE_OFFICIAL_MODEL_ID);
    const input = clearDeepWriteSiteOfficialModelInput(
      settings([site, custom], site.id)
    );

    expect(input.models).toEqual([expect.objectContaining({ id: custom.id })]);
    expect(input.models[0]).not.toHaveProperty("hasApiKey");
    expect(input.defaultModelId).toBe(custom.id);
  });
});
