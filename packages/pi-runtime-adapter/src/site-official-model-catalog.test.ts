import type {
  AgentProviderRuntimeConfig,
  ModelApi
} from "@deepwrite/contracts";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
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

  function buildMixedStrictTools(): Tool[] {
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
    return [
      buildWebSearchTool(searchSession),
      buildWebFetchTool(searchSession),
      ...teamTools,
      ...skillDraftTools
    ];
  }

  it.each([
    {
      label: "official exact route deepseek-flash",
      id: "deepwrite-site-official-deepseek-flash",
      provider: "deepwrite-site",
      modelId: "deepseek-flash"
    },
    {
      label: "official fallback deepseek-v4-flash",
      id: "deepwrite-site-official-deepseek-v4-flash",
      provider: "deepwrite-site",
      modelId: "deepseek-v4-flash"
    },
    {
      label: "official fallback deepseek-v4-pro",
      id: "deepwrite-site-official-deepseek-v4-pro",
      provider: "deepwrite-site",
      modelId: "deepseek-v4-pro"
    },
    {
      label: "official fallback deepseek-v4-flash-vision-exp",
      id: "deepwrite-site-official-deepseek-v4-flash-vision-exp",
      provider: "deepwrite-site",
      modelId: "deepseek-v4-flash-vision-exp"
    },
    {
      label: "official fallback deepseek-v4-flash-0731",
      id: "deepwrite-site-official-deepseek-v4-flash-0731",
      provider: "deepwrite-site",
      modelId: "deepseek-v4-flash-0731"
    },
    {
      label: "official fallback deepseek-v4.1-flash",
      id: "deepwrite-site-official-deepseek-v4.1-flash",
      provider: "deepwrite-site",
      modelId: "deepseek-v4.1-flash"
    },
    {
      label: "official fallback deepseek-flash-202609 under deepseek provider",
      id: "deepwrite-site-official-deepseek-flash-202609",
      provider: "deepseek",
      modelId: "deepseek-flash-202609"
    },
    {
      label: "custom deepseek deepseek-flash",
      id: "custom-deepseek-flash",
      provider: "deepseek",
      modelId: "deepseek-flash"
    },
    {
      label: "custom deepseek deepseek-v4-pro",
      id: "custom-deepseek-v4-pro",
      provider: "deepseek",
      modelId: "deepseek-v4-pro"
    },
    {
      label: "custom deepseek deepseek-v4-flash",
      id: "custom-deepseek-v4-flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash"
    },
    {
      label: "custom deepseek deepseek-chat",
      id: "custom-deepseek-chat",
      provider: "deepseek",
      modelId: "deepseek-chat"
    },
    {
      label: "custom compat route deepseek-v4-pro",
      id: "custom-compat-deepseek-v4-pro",
      provider: "custom",
      modelId: "deepseek-v4-pro"
    }
  ])(
    "disables strict tool mode on $label when strict and non-strict tools coexist",
    async ({ id, provider, modelId }) => {
      const mixedTools = buildMixedStrictTools();
      const config: AgentProviderRuntimeConfig = {
        ...configFor(modelId, "openai-completions"),
        id,
        provider,
        requestModelId: undefined
      };
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
    }
  );

  it("completes a full mixed-tool turn against a strictness-rejecting DeepSeek upstream", async () => {
    const mixedTools = buildMixedStrictTools();
    const sentPayloads: Array<{
      tools: Array<{ function: Record<string, unknown> }>;
      messages: Array<Record<string, unknown>>;
    }> = [];
    const fetcher: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model: string;
        tools?: Array<{ function: Record<string, unknown> }>;
        messages?: Array<Record<string, unknown>>;
      };
      const tools = body.tools ?? [];
      const messages = body.messages ?? [];
      sentPayloads.push({ tools, messages });
      const strictFlags = new Set(
        tools
          .filter((tool) =>
            Object.prototype.hasOwnProperty.call(tool.function, "strict")
          )
          .map((tool) => tool.function.strict)
      );
      if (strictFlags.size > 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Cannot mix strict and non-strict tools in one request."
            }
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      const hasToolResult = messages.some((message) => message.role === "tool");
      if (!hasToolResult) {
        const chunks = [
          {
            id: "chatcmpl-turn-1",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  reasoning_content: "Searching reference first."
                }
              }
            ]
          },
          {
            id: "chatcmpl-turn-1",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_web_search_1",
                      type: "function",
                      function: {
                        name: "web_search",
                        arguments: '{"query":"DeepWrite"}'
                      }
                    }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }
        ];
        const sse = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        });
      }

      const finalChunk = {
        id: "chatcmpl-turn-2",
        object: "chat.completion.chunk",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Search completed." },
            finish_reason: "stop"
          }
        ]
      };
      return new Response(
        `data: ${JSON.stringify(finalChunk)}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    };

    vi.stubGlobal("fetch", fetcher);
    try {
      const config: AgentProviderRuntimeConfig = {
        ...configFor("deepseek-v4-pro", "openai-completions"),
        id: "custom-deepseek-v4-pro",
        provider: "deepseek",
        requestModelId: undefined
      };
      const { model, streamFn } = buildProviderRuntime(
        config,
        undefined,
        "high"
      );
      const userMessage = {
        role: "user" as const,
        content: "Search DeepWrite docs.",
        timestamp: 1
      };
      const firstStream = await streamFn(
        model,
        {
          systemPrompt: "Use tools when needed.",
          messages: [userMessage],
          tools: mixedTools
        },
        { reasoning: "high", maxTokens: 512, maxRetries: 0 }
      );
      const firstResult = await firstStream.result();
      expect(firstResult.stopReason).toBe("toolUse");
      const toolCall = firstResult.content.find(
        (block) => block.type === "toolCall"
      );
      expect(toolCall).toMatchObject({
        type: "toolCall",
        id: "call_web_search_1",
        name: "web_search"
      });

      const secondStream = await streamFn(
        model,
        {
          systemPrompt: "Use tools when needed.",
          messages: [
            userMessage,
            firstResult,
            {
              role: "toolResult",
              toolCallId: toolCall!.id,
              toolName: toolCall!.name,
              content: [{ type: "text", text: "[]" }],
              isError: false,
              timestamp: 2
            }
          ],
          tools: mixedTools
        },
        { reasoning: "high", maxTokens: 512, maxRetries: 0 }
      );
      const secondResult = await secondStream.result();
      expect(secondResult.stopReason).toBe("stop");
      expect(sentPayloads).toHaveLength(2);
      for (const payload of sentPayloads) {
        expect(payload.tools).toHaveLength(mixedTools.length);
        for (const tool of payload.tools) {
          expect(tool.function).not.toHaveProperty("strict");
        }
      }
      const assistantReplay = sentPayloads[1]!.messages.find(
        (message) => message.role === "assistant"
      );
      expect(assistantReplay).toHaveProperty(
        "reasoning_content",
        "Searching reference first."
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
