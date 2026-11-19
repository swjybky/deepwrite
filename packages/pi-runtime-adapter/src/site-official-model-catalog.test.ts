import type {
  AgentProviderRuntimeConfig,
  ModelApi
} from "@deepwrite/contracts";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildSkillDraftTools } from "./extras/tools/skill-draft";
import { buildProviderRuntime } from "./provider-runtime";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";
import {
  SITE_OFFICIAL_MODEL_ROUTES,
  findSiteOfficialRuntimeModel
} from "./site-official-model-catalog";
import { createTeamManagementRuntime } from "./team-management-runtime";
import { buildWebFetchTool } from "./web-search/fetch-tool";
import type { WebSearchSession } from "./web-search/session";
import { buildWebSearchTool } from "./web-search/tool";

const routes: Array<[string, ModelApi]> = [
  ["claude-opus-5-5", "anthropic-messages"],
  ["claude-sonnet-5-5", "anthropic-messages"],
  ["deepseek-flash", "openai-completions"],
  ["doubao-seed-2-1-turbo-260628", "openai-completions"],
  ["gemini-3.1-pro-low", "openai-completions"],
  ["gemini-3.8-flash", "google-generative-ai"],
  ["gemini-3.8-flash-high", "openai-completions"],
  ["gemini-4-argon", "google-generative-ai"],
  ["glm-5.3-flash", "openai-completions"],
  ["gpt-6-astra", "openai-completions"],
  ["gpt-6-astra-max", "openai-completions"],
  ["gpt-6.1-sol", "openai-completions"],
  ["gpt-6.1-sol-max", "openai-completions"],
  ["MiniMax-M3", "openai-completions"],
  ["qwen3.8-flash", "openai-completions"]
];

function configFor(modelId: string, api: ModelApi): AgentProviderRuntimeConfig {
  return {
    id: `deepwrite-site-official-${modelId.toLowerCase()}`,
    label: "Official test model",
    provider: "deepwrite-site",
    modelId,
    requestModelId: `gateway-${modelId}`,
    api,
    baseUrl: `https://gateway.example.test/${api === "google-generative-ai" ? "v1beta" : "v1"}`,
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    contextWindow: 32_000,
    maxTokens: 4_096,
    apiKey: "invalid-official-catalog-test-key"
  };
}

async function payloadFor(
  config: AgentProviderRuntimeConfig,
  thinking: "high" | "xhigh" = "high",
  tools: Tool[] = [
    {
      name: "read",
      description: "Read a document by stable id.",
      parameters: Type.Object({ id: Type.String() })
    }
  ]
): Promise<Record<string, unknown>> {
  const { model, streamFn } = buildProviderRuntime(config, undefined, thinking);
  let payload: Record<string, unknown> | undefined;
  const result = await (
    await streamFn(
      model,
      {
        systemPrompt: "Read the requested document with tools.",
        messages: [
          { role: "user", content: "Read the chapter.", timestamp: 1 }
        ],
        tools
      },
      {
        reasoning: thinking,
        maxTokens: 2_048,
        onPayload: (value) => {
          payload = value as Record<string, unknown>;
          throw new Error("Captured official request before transport");
        }
      }
    )
  ).result();
  expect(result.stopReason).toBe("error");
  expect(payload).toBeDefined();
  return payload!;
}

describe("dedicated official-site runtime model catalog", () => {
  it.each(routes)(
    "keeps %s on its %s gateway route with remote overrides",
    (modelId, api) => {
      const config = configFor(modelId, api);
      const metadata = findSiteOfficialRuntimeModel(config);
      expect(metadata).toBeDefined();
      expect(metadata).toMatchObject({ id: modelId, api, baseUrl: "" });
      expect(metadata).not.toHaveProperty("headers");
      expect(buildProviderRuntime(config).model).toMatchObject({
        id: config.requestModelId,
        name: config.label,
        provider: config.provider,
        api,
        baseUrl:
          api === "anthropic-messages"
            ? "https://gateway.example.test"
            : config.baseUrl,
        contextWindow: 32_000,
        maxTokens: 4_096
      });
    }
  );

  it.each(routes)(
    "serializes %s tools using its declared %s protocol",
    async (modelId, api) => {
      const config = configFor(modelId, api);
      const payload = await payloadFor(config);
      if (api === "openai-completions") {
        expect(payload).toMatchObject({
          model: config.requestModelId,
          messages: [
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" })
          ],
          tools: [
            {
              type: "function",
              function: { name: "read", parameters: { type: "object" } }
            }
          ]
        });
        expect(payload).not.toHaveProperty("store");
        expect(payload).not.toHaveProperty("input");
      } else if (api === "google-generative-ai") {
        expect(payload).toMatchObject({
          contents: [{ role: "user" }],
          config: {
            tools: [
              {
                functionDeclarations: [
                  { name: "read", parametersJsonSchema: { type: "object" } }
                ]
              }
            ]
          }
        });
      } else {
        expect(payload).toMatchObject({
          model: config.requestModelId,
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "read",
              input_schema: expect.objectContaining({ type: "object" })
            })
          ])
        });
      }
    }
  );

  it("inherits supplemental metadata for a new official model without saved capacity overrides", () => {
    const config = {
      ...configFor("gemini-4-argon", "google-generative-ai"),
      contextWindow: undefined,
      maxTokens: undefined
    };
    const supplemental = findDeepWriteRuntimeModel(config.modelId)!;
    expect(supplemental).toBeDefined();
    expect(buildProviderRuntime(config).model).toMatchObject({
      id: config.requestModelId,
      baseUrl: config.baseUrl,
      contextWindow: supplemental.contextWindow,
      maxTokens: supplemental.maxTokens,
      thinkingLevelMap: supplemental.thinkingLevelMap
    });
  });

  it("uses the Gemini Pro alias's native reasoning metadata", () => {
    expect(
      findSiteOfficialRuntimeModel(
        configFor("gemini-3.1-pro-low", "openai-completions")
      )
    ).toMatchObject({
      id: "gemini-3.1-pro-low",
      thinkingLevelMap: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      compat: { maxTokensField: "max_tokens", requiresToolResultName: true }
    });
  });

  it.each(["gpt-6-astra-max", "gpt-6.1-sol-max"])(
    "keeps %s completion tools separate from Responses metadata",
    async (modelId) => {
      const config = configFor(modelId, "openai-completions");
      const model = buildProviderRuntime(config).model;
      expect(model.compat).not.toHaveProperty("supportsToolSearch");
      expect(model.compat).not.toHaveProperty("supportsAdditionalTools");
      expect(await payloadFor(config, "xhigh")).toHaveProperty(
        "reasoning_effort",
        "xhigh"
      );
    }
  );

  it("uses OpenAI effort controls for the site's Qwen route", async () => {
    const payload = await payloadFor(
      configFor("qwen3.8-flash", "openai-completions")
    );
    expect(payload).toHaveProperty("reasoning_effort", "xhigh");
    expect(payload).not.toHaveProperty("enable_thinking");
  });

  it("recognizes managed identity while preserving an explicit developer-role override", () => {
    const config = {
      ...configFor("gemini-3.8-flash-high", "openai-completions"),
      provider: "gateway-alias",
      supportsDeveloperRole: true
    };
    expect(findSiteOfficialRuntimeModel(config)).toBeDefined();
    expect(buildProviderRuntime(config).model).toMatchObject({
      provider: "gateway-alias",
      compat: { supportsDeveloperRole: true }
    });
  });

  it("does not substitute another protocol, unrelated routes or custom model settings", () => {
    const config = configFor("gemini-3.8-flash-high", "openai-completions");
    expect(
      findSiteOfficialRuntimeModel({ ...config, api: "google-generative-ai" })
    ).toBeUndefined();
    expect(
      findSiteOfficialRuntimeModel({
        ...config,
        modelId: "gemini-3.8-flash-high-other-route"
      })
    ).toBeUndefined();
    expect(
      findSiteOfficialRuntimeModel({
        ...config,
        id: "custom",
        provider: "custom"
      })
    ).toBeUndefined();
  });

  it("requires the configured official endpoint instead of falling back to the native provider", () => {
    expect(() =>
      buildProviderRuntime({
        ...configFor("gemini-3.8-flash", "google-generative-ai"),
        baseUrl: ""
      })
    ).toThrow("请填写 API 地址");
  });

  it("maintains one entry per public route", () => {
    expect(
      new Set(SITE_OFFICIAL_MODEL_ROUTES.map((route) => route.id.toLowerCase()))
        .size
    ).toBe(routes.length);
  });

  it("disables strict tool mode on site DeepSeek models when strict and non-strict tools coexist", async () => {
    const searchSession: WebSearchSession = {
      providerId: "deepseek",
      maxResults: 8,
      queryHint: "",
      canFetch: true,
      fetchUrlMaxChars: 8192,
      search: async () => ({
        hits: [],
        cached: false,
        callIndex: 1,
        callLimit: 10
      }),
      fetchPage: async () => ({
        page: {
          url: "https://example.test",
          title: "",
          content: "",
          totalChars: 0
        },
        cached: false,
        callIndex: 1,
        callLimit: 10
      })
    };
    const teamTools = createTeamManagementRuntime(
      {
        runId: "run_strict_check",
        sessionId: "session_strict_check",
        prompt: "检查团队与联网工具",
        teamManagement: {
          scope: { bookType: "short", bookId: "book_strict_check" },
          description: "管理生效团队"
        }
      },
      async () => ({
        sessionId: "session_strict_check",
        runId: "run_strict_check",
        requestId: "req_1",
        answers: []
      })
    ).tools;
    const skillDraftTools = buildSkillDraftTools({
      agentId: "revision-analysis",
      jobId: "job_strict_check"
    });
    const mixedTools: Tool[] = [
      buildWebSearchTool(searchSession),
      buildWebFetchTool(searchSession),
      ...teamTools,
      ...skillDraftTools
    ];

    const config = configFor("deepseek-flash", "openai-completions");
    expect(buildProviderRuntime(config).model.compat).toMatchObject({
      supportsStrictMode: false
    });
    const payload = await payloadFor(config, "high", mixedTools);
    const serializedTools = payload.tools as Array<{
      type: string;
      function: Record<string, unknown>;
    }>;
    expect(serializedTools.map((tool) => tool.function.name)).toEqual(
      mixedTools.map((tool) => tool.name)
    );
    for (const tool of serializedTools) {
      expect(tool.function).not.toHaveProperty("strict");
    }
  });
});
