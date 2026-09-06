import type {
  AgentProviderRuntimeConfig,
  LongWorkspaceRuntimeContext
} from "./index.test-support";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  Type,
  buildProviderRuntime,
  buildRuntimeUserPrompt,
  resolveProviderModelCapacity,
  captureDisabledThinkingPayload,
  captureThinkingPayload,
  captureToolPayload,
  describe,
  expect,
  it,
  ollamaGrammarRegressionTool,
  toolWithParameters
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: provider-model-routing", () => {
  it("injects AGENTS.md into every long agent and later plot-design turns", () => {
    const agentsMd = "# 长篇上下文\n\n## 世界观阶段\n维护设定。";
    const navigation = {
      schemaVersion: 1 as const,
      bookId: "longbook_agents_md",
      updatedAt: "2026-07-26T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        volumes: 1,
        arcs: 0,
        chapterCards: 0,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [],
      volumes: [{ id: "volume_agents", title: "第一卷", order: 1 }],
      arcs: [],
      chapterCards: [],
      committedThroughChapterId: null
    };

    for (const profile of DEFAULT_LONG_AGENT_PROFILES) {
      const prompt = buildRuntimeUserPrompt({
        runId: `run_${profile.id}`,
        sessionId: `session_${profile.id}`,
        prompt: "继续",
        longAgentProfile: profile,
        workspaceContext: {
          longWorkspace: {
            bookId: "longbook_agents_md",
            title: "雾港长篇",
            activeRoot: "plot_design",
            activeAgentId: profile.id,
            navigation,
            agentsMd
          }
        }
      });
      expect(prompt).toContain("【长篇上下文（AGENTS.md）】");
      expect(prompt).toContain("## 世界观阶段");
    }

    const emptyPrompt = buildRuntimeUserPrompt({
      runId: "run_empty_agents",
      sessionId: "session_empty_agents",
      prompt: "继续",
      longAgentProfile: DEFAULT_LONG_AGENT_PROFILES.find(
        ({ id }) => id === "long"
      )!,
      workspaceContext: {
        longWorkspace: {
          bookId: "longbook_agents_md",
          title: "雾港长篇",
          activeRoot: "draft",
          activeAgentId: "long",
          navigation,
          agentsMd: "   "
        }
      }
    });
    expect(emptyPrompt).not.toContain("【长篇上下文（AGENTS.md）】");
  });

  it("lets configured long-form teams delegate with the same bounded tools", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_subagents",
      title: "雾港长篇",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_subagents",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_subagents", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for await (const _event of runtime.start({
      runId: "run_long_subagents",
      sessionId: "session_long_subagents",
      prompt: "委派检查时间线",
      thinkingLevel: "off",
      longAgentProfile: profile,
      subagentDefinitions: [
        {
          id: "timeline_reviewer",
          name: "时间线审阅",
          description: "核对事件顺序与叙事落点。",
          systemPrompt: "只检查时间线并把结论交还主智能体。",
          enabled: true,
          modelMode: "inherit"
        }
      ],
      workspaceContext: { longWorkspace }
    })) {
      // Consume the local run before inspecting the cached parent agent.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { tools: Array<{ name: string }> } }
        >;
      }
    ).conversationAgents;
    const names =
      cache
        .get("session_long_subagents:long:long:longbook_subagents")
        ?.state.tools.map(({ name }) => name) ?? [];
    expect(names).toContain("spawn_subagent");
    expect(names).toContain("list");
    expect(names).toContain("read");
    expect(names).not.toContain("get_long_workspace_index");
    expect(names).toContain("create");
  });

  it("keeps model reasoning capability separate from the per-run thinking switch", () => {
    const config: AgentProviderRuntimeConfig = {
      id: "writer",
      label: "Writer",
      provider: "custom",
      modelId: "writer-model",
      api: "openai-completions",
      baseUrl: "https://ollama.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: ""
    };

    expect(
      buildProviderRuntime(config, undefined, "high").model.reasoning
    ).toBe(true);
    expect(buildProviderRuntime(config, 0.6, "off").model.reasoning).toBe(true);
    expect(
      buildProviderRuntime({ ...config, reasoning: true }, 0.6, "off").model
        .reasoning
    ).toBe(true);

    const knownNonReasoningConfig: AgentProviderRuntimeConfig = {
      ...config,
      id: "gpt-5-chat-latest",
      label: "GPT-5 Chat",
      provider: "openai",
      modelId: "gpt-5-chat-latest",
      api: "openai-responses",
      baseUrl: "https://api.openai.com.example.test/v1"
    };
    expect(
      buildProviderRuntime(knownNonReasoningConfig, 0.6, "off").model.reasoning
    ).toBe(false);
  });

  it("uses the GPT-5.6 Sol capacity baseline when no model catalog matches", () => {
    const config: AgentProviderRuntimeConfig = {
      id: "unknown-writer",
      label: "Unknown writer",
      provider: "custom",
      modelId: "unknown-writer-model",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only"
    };

    expect(buildProviderRuntime(config).model).toMatchObject({
      contextWindow: 272_000,
      maxTokens: 128_000
    });
    expect(resolveProviderModelCapacity(config)).toEqual({
      contextWindow: 272_000,
      maxTokens: 128_000
    });
  });

  it("uses saved custom capacity over the catalog and unknown-model baseline", () => {
    const unknownConfig: AgentProviderRuntimeConfig = {
      id: "unknown-writer",
      label: "Unknown writer",
      provider: "custom",
      modelId: "unknown-writer-model",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only",
      contextWindow: 32_000,
      maxTokens: 4_096
    };

    expect(buildProviderRuntime(unknownConfig).model).toMatchObject({
      contextWindow: 32_000,
      maxTokens: 4_096
    });

    const catalogConfig: AgentProviderRuntimeConfig = {
      id: "enterprise-gemini",
      label: "Enterprise Gemini",
      provider: "google",
      modelId: "kdi-gemini-3.1-pro-preview",
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com.example.test/v1beta",
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      apiKey: "test-only",
      contextWindow: 16_000,
      maxTokens: 2_048
    };

    expect(buildProviderRuntime(catalogConfig).model).toMatchObject({
      contextWindow: 16_000,
      maxTokens: 2_048
    });
    expect(resolveProviderModelCapacity(unknownConfig)).toEqual({
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    expect(resolveProviderModelCapacity(catalogConfig)).toEqual({
      contextWindow: 16_000,
      maxTokens: 2_048
    });
  });

  it("matches a provider model when an enterprise route prefixes its catalog id", () => {
    const config: AgentProviderRuntimeConfig = {
      id: "enterprise-gemini",
      label: "Enterprise Gemini",
      provider: "google",
      modelId: "kdi-gemini-3.1-pro-preview",
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com.example.test/v1beta",
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      apiKey: "test-only"
    };

    expect(resolveProviderModelCapacity(config)).toEqual({
      contextWindow: 1_048_576,
      maxTokens: 65_536
    });
    expect(buildProviderRuntime(config).model).toMatchObject({
      id: "kdi-gemini-3.1-pro-preview",
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "LOW",
        medium: null,
        high: "HIGH"
      }
    });
  });

  it.each(["openai-completions", "openai-responses"] as const)(
    "rejects object-union tool roots before an %s request",
    async (api) => {
      const config: AgentProviderRuntimeConfig = {
        id: `schema-${api}`,
        label: `Schema ${api}`,
        provider: "custom",
        modelId: "schema-test-model",
        api,
        baseUrl: "https://schema.example.test/v1",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["off"],
        temperatureOptions: [0.2, 0.7, 1.2],
        apiKey: "test-only"
      };
      const parameters = Type.Union([
        Type.Object({ domain: Type.Literal("worldbuilding") }),
        Type.Object({ domain: Type.Literal("character") })
      ]);
      await expect(
        captureToolPayload(
          config,
          toolWithParameters("list_setting_regression", parameters)
        )
      ).rejects.toThrow('根节点必须声明 type: "object"');
      expect(parameters).not.toHaveProperty("type");
    }
  );

  it("publishes portable string enums to Anthropic-compatible models", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "anthropic-schema",
      label: "Anthropic Schema",
      provider: "custom",
      modelId: "schema-test-model",
      api: "anthropic-messages",
      baseUrl: "https://schema.example.test",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only"
    };
    const parameters = Type.Object({
      kind: Type.Optional(
        StringEnum(["book_line", "chapter", "placement"] as const)
      )
    });
    const payload = await captureToolPayload(
      config,
      toolWithParameters("list_plot_design", parameters)
    );
    const inputSchema = (
      payload.tools as Array<{
        input_schema: {
          properties: Record<string, Record<string, unknown>>;
        };
      }>
    )[0]!.input_schema;

    expect(inputSchema.properties.kind).toEqual({
      type: "string",
      enum: ["book_line", "chapter", "placement"]
    });
    expect(parameters.properties.kind).toHaveProperty("enum");
    expect(parameters.properties.kind).not.toHaveProperty("anyOf");
  });

  it("rejects a non-object tool root before sending a provider request", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "invalid-schema",
      label: "Invalid schema",
      provider: "custom",
      modelId: "schema-test-model",
      api: "openai-completions",
      baseUrl: "https://schema.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only"
    };

    await expect(
      captureToolPayload(
        config,
        toolWithParameters("invalid_text_tool", Type.String())
      )
    ).rejects.toThrow(/invalid_text_tool.*type: "object"/u);
  });

  it("sanitizes only Ollama transport schemas without weakening local validation", async () => {
    const baseConfig: AgentProviderRuntimeConfig = {
      id: "local-writer",
      label: "Local writer",
      provider: "ollama",
      modelId: "qwen3",
      api: "openai-completions",
      baseUrl: "https://ollama.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: ""
    };
    const tool = ollamaGrammarRegressionTool();
    const ollamaPayload = await captureToolPayload(baseConfig, tool);
    const ollamaParameters = (
      ollamaPayload.tools as Array<{
        function: { parameters: Record<string, unknown> };
      }>
    )[0]!.function.parameters;

    expect(ollamaParameters).toMatchObject({
      properties: {
        direct_text: { type: "string", maxLength: 200_000 },
        replacements: {
          items: {
            properties: {
              original_text: { type: "string", minLength: 1 },
              new_text: { type: "string" }
            }
          }
        }
      }
    });
    const ollamaNested = (
      (ollamaParameters.properties as Record<string, unknown>).replacements as {
        items: { properties: Record<string, Record<string, unknown>> };
      }
    ).items.properties;
    expect(ollamaNested.original_text).not.toHaveProperty("maxLength");
    expect(ollamaNested.new_text).not.toHaveProperty("maxLength");

    const originalParameters = tool.parameters as unknown as {
      properties: Record<string, unknown>;
    };
    const originalNested = (
      originalParameters.properties.replacements as {
        items: { properties: Record<string, Record<string, unknown>> };
      }
    ).items.properties;
    expect(originalNested.original_text).toHaveProperty("maxLength", 2_400);
    expect(originalNested.new_text).toHaveProperty("maxLength", 20_000);

    const customPayload = await captureToolPayload(
      { ...baseConfig, provider: "custom", apiKey: "test-only" },
      tool
    );
    const customParameters = (
      customPayload.tools as Array<{
        function: { parameters: Record<string, unknown> };
      }>
    )[0]!.function.parameters;
    const customNested = (
      (customParameters.properties as Record<string, unknown>).replacements as {
        items: { properties: Record<string, Record<string, unknown>> };
      }
    ).items.properties;
    expect(customNested.original_text).toHaveProperty("maxLength", 2_400);
    expect(customNested.new_text).toHaveProperty("maxLength", 20_000);
  });

  it("uses a provider routing id without replacing the public model id", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "routed-model",
      label: "Routed model",
      provider: "custom",
      modelId: "public-model-id",
      requestModelId: "provider-route-id",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      temperatureOptions: [0.1, 0.7, 1],
      apiKey: "test-only"
    };

    const runtime = buildProviderRuntime(config, 0.7, "off");
    expect(runtime.model.id).toBe("provider-route-id");
    expect(new PiAgentRuntimeAdapter().describe(config)).toMatchObject({
      model: "public-model-id",
      configId: config.id
    });
    await expect(captureDisabledThinkingPayload(config)).resolves.toMatchObject(
      {
        model: "provider-route-id"
      }
    );
  });

  it("uses the system role when an official-compatible endpoint disables developer messages", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "deepwrite-deepseek-v4-flash",
      label: "Official DeepSeek Flash",
      provider: "deepseek-official",
      modelId: "deepseek-v4-flash-202605",
      api: "openai-completions",
      baseUrl: "https://tokenhub.tencentmaas.com.example.test/v1",
      reasoning: true,
      supportsDeveloperRole: false,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "high", "max"],
      temperatureOptions: [0.7, 1, 1.5],
      managedBy: "deepwrite-official",
      apiKey: "test-only"
    };

    const payload = await captureDisabledThinkingPayload(config);
    expect(payload.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" })
    ]);
    expect(buildProviderRuntime(config).model.compat).toMatchObject({
      supportsDeveloperRole: false
    });
  });

  it("uses the DeepWrite Kimi K3 runtime catalog for an official gateway route", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "deepwrite-kimi-k3",
      label: "Kimi K3",
      provider: "deepseek-official",
      modelId: "kimi-k3",
      api: "openai-completions",
      baseUrl: "https://www.moxing.pro.example.test/v1",
      reasoning: true,
      supportsDeveloperRole: false,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "high", "max"],
      temperatureOptions: [0.7, 1, 1.5],
      managedBy: "deepwrite-official",
      apiKey: "test-only"
    };

    const high = buildProviderRuntime(config, undefined, "high").model;
    expect(high).toMatchObject({
      id: "kimi-k3",
      provider: "deepseek-official",
      baseUrl: "https://www.moxing.pro.example.test/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      thinkingLevelMap: {
        off: null,
        low: "low",
        high: "high",
        xhigh: "max"
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        maxTokensField: "max_completion_tokens",
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "openai",
        supportsStrictMode: true
      }
    });

    expect(
      buildProviderRuntime(config, undefined, "max").model.thinkingLevelMap
    ).toMatchObject({ xhigh: "max" });
    await expect(captureThinkingPayload(config, "high")).resolves.toMatchObject(
      {
        model: "kimi-k3",
        reasoning_effort: "high"
      }
    );
    await expect(captureThinkingPayload(config, "max")).resolves.toMatchObject({
      model: "kimi-k3",
      reasoning_effort: "max"
    });
  });

  it("uses the production DeepSeek V4 Flash metadata for the 0731 gateway route", () => {
    const config: AgentProviderRuntimeConfig = {
      id: "deepwrite-deepseek-v4-flash-0731",
      label: "DeepSeek-V4-Flash-正式版",
      provider: "deepseek-official",
      modelId: "deepseek-v4-flash-0731",
      api: "openai-completions",
      baseUrl: "https://www.moxing.pro.example.test/v1/",
      reasoning: true,
      supportsDeveloperRole: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "high", "max"],
      temperatureOptions: [0.7, 1, 1.5],
      managedBy: "deepwrite-official",
      apiKey: "test-only"
    };

    expect(buildProviderRuntime(config, undefined, "max").model).toMatchObject({
      id: "deepseek-v4-flash-0731",
      provider: "deepseek-official",
      baseUrl: "https://www.moxing.pro.example.test/v1/",
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      input: ["text"],
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: "max"
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: true,
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "deepseek"
      }
    });
  });

  it.each([
    ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ["deepseek-v4-flash", "DeepSeek V4 Flash"]
  ] as const)(
    "uses the DeepWrite %s runtime catalog for an official gateway route",
    (modelId, label) => {
      const config: AgentProviderRuntimeConfig = {
        id: `deepwrite-${modelId}`,
        label,
        provider: "deepseek-official",
        modelId,
        api: "openai-completions",
        baseUrl: "https://example.test/v1",
        reasoning: true,
        supportsDeveloperRole: false,
        defaultThinkingLevel: "high",
        thinkingLevelOptions: ["low", "high", "max"],
        temperatureOptions: [0.7, 1, 1.5],
        managedBy: "deepwrite-official",
        apiKey: "test-only"
      };

      expect(
        buildProviderRuntime(config, undefined, "max").model
      ).toMatchObject({
        id: modelId,
        provider: "deepseek-official",
        baseUrl: "https://example.test/v1",
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        input: ["text"],
        thinkingLevelMap: {
          minimal: null,
          low: "high",
          medium: "high",
          high: "high",
          xhigh: "max"
        },
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat: "deepseek",
          supportsStrictMode: true
        }
      });
    }
  );

  it.each([
    ["glm-5.3", "GLM-5.3", 1_000_000, 131_072, "zai"],
    ["glm-5.2", "GLM-5.2", 1_000_000, 131_072, "zai"],
    ["qwen3.7-plus", "Qwen3.7 Plus", 1_000_000, 131_072, "openai"]
  ] as const)(
    "uses the DeepWrite %s runtime catalog for an official gateway route",
    (modelId, label, contextWindow, maxTokens, thinkingFormat) => {
      const config: AgentProviderRuntimeConfig = {
        id: `deepwrite-${modelId}`,
        label,
        provider: "deepseek-official",
        modelId,
        api: "openai-completions",
        baseUrl: "https://example.test/v1",
        reasoning: true,
        supportsDeveloperRole: false,
        defaultThinkingLevel: "high",
        thinkingLevelOptions: ["low", "high", "max"],
        temperatureOptions: [0.7, 1, 1.5],
        managedBy: "deepwrite-official",
        apiKey: "test-only"
      };

      expect(
        buildProviderRuntime(config, undefined, "max").model
      ).toMatchObject({
        id: modelId,
        provider: "deepseek-official",
        baseUrl: "https://example.test/v1",
        contextWindow,
        maxTokens,
        thinkingLevelMap: {
          low: expect.anything(),
          high: expect.anything(),
          xhigh: expect.anything()
        },
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: "max_completion_tokens",
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat,
          supportsStrictMode: true
        }
      });
    }
  );

  it("keeps GLM-5.3 thinking enabled and maps all supported effort levels", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "deepwrite-glm-5.3",
      label: "GLM-5.3",
      provider: "deepseek-official",
      modelId: "glm-5.3",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      reasoning: true,
      supportsDeveloperRole: false,
      defaultThinkingLevel: "max",
      thinkingLevelOptions: ["low", "high", "max"],
      temperatureOptions: [0.7, 1, 1.5],
      managedBy: "deepwrite-official",
      apiKey: "test-only"
    };

    expect(buildProviderRuntime(config, undefined, "max").model).toMatchObject({
      id: "glm-5.3",
      input: ["text"],
      contextWindow: 1_000_000,
      maxTokens: 131_072,
      thinkingLevelMap: {
        off: null,
        low: "low",
        high: "high",
        xhigh: "max"
      },
      compat: {
        thinkingFormat: "zai",
        supportsReasoningEffort: true,
        zaiToolStream: true
      }
    });

    await expect(captureThinkingPayload(config, "low")).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low"
    });
    await expect(captureThinkingPayload(config, "high")).resolves.toMatchObject(
      {
        thinking: { type: "enabled" },
        reasoning_effort: "high"
      }
    );
    await expect(captureThinkingPayload(config, "max")).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
    const disabledPayload = await captureDisabledThinkingPayload(config);
    expect(disabledPayload).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low"
    });
    expect(disabledPayload).not.toHaveProperty("temperature");
  });

  it.each([
    ["gpt-5.6-sol", "GPT-5.6 Sol"],
    ["gpt-5.6-terra", "GPT-5.6 Terra"],
    ["gpt-5.6-luna", "GPT-5.6 Luna"]
  ] as const)(
    "uses the DeepWrite %s runtime catalog instead of the generic fallback",
    (modelId, label) => {
      const config: AgentProviderRuntimeConfig = {
        id: `deepwrite-${modelId}`,
        label,
        provider: "openai",
        modelId,
        api: "openai-responses",
        baseUrl: "https://local-model.example.test/v1",
        reasoning: true,
        defaultThinkingLevel: "medium",
        thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
        temperatureOptions: [0.1, 0.7, 1.5],
        apiKey: "test-only"
      };

      expect(buildProviderRuntime(config).model).toMatchObject({
        id: modelId,
        provider: "openai",
        baseUrl: "https://local-model.example.test/v1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 272_000,
        maxTokens: 128_000,
        thinkingLevelMap: {
          off: "none",
          minimal: null,
          xhigh: "xhigh",
          max: "max"
        }
      });
    }
  );

  it.each([
    ["qwen3.8-max", "none"],
    ["qwen3.8-max-preview", null]
  ] as const)(
    "uses the DeepWrite %s runtime catalog for an official gateway route",
    async (modelId, offMapping) => {
      const config: AgentProviderRuntimeConfig = {
        id: `deepwrite-${modelId}`,
        label:
          modelId === "qwen3.8-max" ? "Qwen3.8 Max" : "Qwen3.8 Max Preview",
        provider: "deepseek-official",
        modelId,
        api: "openai-completions",
        baseUrl: "https://www.moxing.pro.example.test/v1",
        reasoning: true,
        supportsDeveloperRole: false,
        defaultThinkingLevel: "high",
        thinkingLevelOptions: ["low", "high", "max"],
        temperatureOptions: [0.7, 1, 1.5],
        managedBy: "deepwrite-official",
        apiKey: "test-only"
      };

      const high = buildProviderRuntime(config, undefined, "high").model;
      expect(high).toMatchObject({
        id: modelId,
        provider: "deepseek-official",
        baseUrl: "https://www.moxing.pro.example.test/v1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 983_616,
        maxTokens: 131_072,
        thinkingLevelMap: {
          off: offMapping,
          low: "low",
          high: "xhigh",
          xhigh: "xhigh"
        },
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: "max_completion_tokens",
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat: "openai",
          supportsStrictMode: true
        }
      });

      await expect(
        captureThinkingPayload(config, "low")
      ).resolves.toMatchObject({
        model: modelId,
        reasoning_effort: "low"
      });
      await expect(
        captureThinkingPayload(config, "high")
      ).resolves.toMatchObject({
        model: modelId,
        reasoning_effort: "xhigh"
      });
      await expect(
        captureThinkingPayload(config, "max")
      ).resolves.toMatchObject({
        model: modelId,
        reasoning_effort: "max"
      });
      const disabledPayload = await captureDisabledThinkingPayload(config);
      if (offMapping === null) {
        expect(disabledPayload).not.toHaveProperty("reasoning_effort");
        expect(disabledPayload).not.toHaveProperty("temperature");
      } else {
        expect(disabledPayload).toMatchObject({
          reasoning_effort: "none",
          temperature: 1
        });
      }
    }
  );

  it("serializes disabled thinking for supported provider protocols", async () => {
    const baseConfig: AgentProviderRuntimeConfig = {
      id: "writer",
      label: "Writer",
      provider: "deepseek",
      modelId: "deepseek-chat",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: "test-key"
    };

    await expect(
      captureDisabledThinkingPayload(baseConfig)
    ).resolves.toMatchObject({
      thinking: { type: "disabled" },
      temperature: 0.6
    });

    await expect(
      captureDisabledThinkingPayload({
        ...baseConfig,
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com.example.test"
      })
    ).resolves.toMatchObject({
      thinking: { type: "disabled" },
      temperature: 0.6
    });

    await expect(
      captureDisabledThinkingPayload({
        ...baseConfig,
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        provider: "google",
        modelId: "gemini-2.5-flash",
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.googleapis.com.example.test/v1beta"
      })
    ).resolves.toMatchObject({
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.6
      }
    });

    await expect(
      captureDisabledThinkingPayload({
        ...baseConfig,
        id: "gpt-5.4",
        label: "GPT-5.4",
        provider: "openai",
        modelId: "gpt-5.4",
        api: "openai-responses",
        baseUrl: "https://api.openai.com.example.test/v1"
      })
    ).resolves.toMatchObject({
      reasoning: { effort: "none" },
      temperature: 0.6
    });

    await expect(
      captureDisabledThinkingPayload({
        ...baseConfig,
        id: "qwen-plus",
        label: "Qwen Plus",
        provider: "custom",
        modelId: "qwen-plus",
        api: "openai-completions",
        baseUrl:
          "https://dashscope.aliyuncs.com.example.test/compatible-mode/v1"
      })
    ).resolves.toMatchObject({
      enable_thinking: false,
      temperature: 0.6
    });

    await expect(
      captureDisabledThinkingPayload({
        ...baseConfig,
        id: "glm-4.7",
        label: "GLM-4.7",
        provider: "custom",
        modelId: "glm-4.7",
        api: "openai-completions",
        baseUrl: "https://open.bigmodel.cn.example.test/api/paas/v4"
      })
    ).resolves.toMatchObject({
      thinking: { type: "disabled" },
      temperature: 0.6
    });
  });

  it("omits disabled-thinking controls for catalog models that cannot turn thinking off", async () => {
    const payload = await captureDisabledThinkingPayload({
      id: "gpt-5",
      label: "GPT-5",
      provider: "openai",
      modelId: "gpt-5",
      api: "openai-responses",
      baseUrl: "https://api.openai.com.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: "test-key"
    });

    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("temperature");
  });
});
