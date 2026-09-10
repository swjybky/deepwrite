import type {
  AgentConversationPersistenceSnapshot,
  ModelSettings
} from "./useAgentConversation.test-support";
import {
  createDeferredApi,
  createMemoryStorage,
  describe,
  document,
  expect,
  it,
  mergeAgentConversationPersistenceSnapshots,
  reactive,
  storedConversation,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("agent conversation controller: conversation-model-settings", () => {
  it("persists conversation history and restores a selected conversation", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-history-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    const firstSessionId = controller.sessionId.value;
    controller.messages.value = [
      {
        id: "first-user",
        role: "user",
        content: "分析第一章的人物动机",
        createdAt: "2026-07-19T10:00:00.000Z",
        status: "completed"
      }
    ];

    controller.newConversation();
    const secondSessionId = controller.sessionId.value;
    controller.messages.value = [
      {
        id: "second-user",
        role: "user",
        content: "继续完善雨夜场景",
        createdAt: "2026-07-19T10:05:00.000Z",
        status: "completed"
      }
    ];
    controller.draft.value = "补充环境细节";

    expect(controller.history.value).toHaveLength(2);
    expect(controller.history.value[0]).toMatchObject({
      sessionId: secondSessionId,
      title: "继续完善雨夜场景",
      current: true
    });
    expect(controller.selectConversation(firstSessionId)).toBe(true);
    expect(controller.messages.value[0]?.content).toBe("分析第一章的人物动机");
    expect(controller.sessionId.value).toBe(firstSessionId);
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.sessionId.value).toBe(firstSessionId);
    expect(restored.history.value).toHaveLength(2);
    expect(restored.selectConversation(secondSessionId)).toBe(true);
    expect(restored.draft.value).toBe("补充环境细节");
    restored.dispose();
  });

  it("merges structured conversation snapshots into one validated history", () => {
    const activeSessionId = "session-target-active";
    const activeTimestamp = "2026-07-01T00:00:00.000Z";
    const target: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId,
      conversations: [
        storedConversation(activeSessionId, activeTimestamp, "统一桶旧内容")
      ]
    };
    const sourceConversations = [
      storedConversation(
        activeSessionId,
        "2026-07-01T01:00:00.000Z",
        "同一 session 的较新内容"
      ),
      ...Array.from({ length: 19 }, (_, index) =>
        storedConversation(
          `session-source-${index}`,
          new Date(Date.UTC(2026, 6, 2, 0, index)).toISOString(),
          `章卡历史 ${index}`
        )
      )
    ];
    const source: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-source-20",
      conversations: sourceConversations
    };
    const secondSource: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-source-38",
      conversations: Array.from({ length: 20 }, (_, index) => {
        const sourceIndex = index + 19;
        return storedConversation(
          `session-source-${sourceIndex}`,
          new Date(Date.UTC(2026, 6, 2, 1, index)).toISOString(),
          `章卡历史 ${sourceIndex}`
        );
      })
    };

    const merged = mergeAgentConversationPersistenceSnapshots(target, [
      source,
      secondSource,
      "invalid structured snapshot",
      source
    ]);

    expect(merged?.activeSessionId).toBe(activeSessionId);
    expect(merged?.conversations).toHaveLength(40);
    expect(
      merged?.conversations.find(
        (conversation) => conversation.sessionId === activeSessionId
      )?.messages[0]?.content
    ).toBe("同一 session 的较新内容");
    expect(
      merged?.conversations.some(
        (conversation) => conversation.sessionId === "session-source-0"
      )
    ).toBe(true);
  });

  it("uses the configured default model thinking level and carries model identity", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.1, 0.7, 1],
          hasApiKey: true
        }
      ]
    });

    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("high");
    controller.selectThinkingLevel("medium");
    expect(controller.thinkingLevel.value).toBe("high");
    controller.draft.value = "按默认配置运行";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_model",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "writer-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "writer",
      thinkingLevel: "high"
    });
    controller.dispose();
  });

  it("keeps the latest run choices when starting or reopening a conversation", () => {
    const controller = useAgentConversation({
      api: () => undefined
    });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });
    controller.messages.value = [
      {
        id: "first-user",
        role: "user",
        content: "第一条对话",
        createdAt: "2026-07-22T08:00:00.000Z",
        status: "completed"
      }
    ];
    const firstSessionId = controller.sessionId.value;
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");
    controller.selectAgentTeamMode("team");

    controller.newConversation();
    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("auto-approve");
    expect(controller.agentTeamMode.value).toBe("team");

    controller.selectThinkingLevel("low");
    controller.selectApprovalMode("request-approval");
    controller.selectAgentTeamMode("normal");
    expect(controller.selectConversation(firstSessionId)).toBe(true);
    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("low");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("request-approval");
    expect(controller.agentTeamMode.value).toBe("normal");
    controller.dispose();
  });

  it("preserves valid run choices when model settings are refreshed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    const settings: ModelSettings = {
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    };
    controller.applyModelSettings(settings);
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");
    controller.selectAgentTeamMode("team");

    controller.applyModelSettings(settings);

    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);
    expect(controller.approvalMode.value).toBe("auto-approve");
    expect(controller.agentTeamMode.value).toBe("team");
    controller.dispose();
  });

  it("clears a persisted model choice when all configured models are removed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });
    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    controller.selectApprovalMode("auto-approve");

    controller.applyModelSettings({ defaultModelId: "", models: [] });
    controller.applyRunSettings({
      selectedModelId: "writer",
      thinkingLevel: "off",
      temperature: 1.2,
      approvalMode: "auto-approve"
    });

    expect(controller.selectedModelId.value).toBe("");
    expect(controller.thinkingLevel.value).toBe("medium");
    expect(controller.temperature.value).toBe(0.7);
    expect(controller.approvalMode.value).toBe("auto-approve");
    controller.dispose();
  });

  it("falls back to the new default settings when the selected model is removed", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.applyRunSettings({
      selectedModelId: "removed-writer",
      thinkingLevel: "low",
      temperature: 1.2,
      approvalMode: "request-approval"
    });
    controller.applyModelSettings({
      defaultModelId: "replacement",
      models: [
        {
          id: "replacement",
          label: "Replacement",
          provider: "openai",
          modelId: "replacement-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.selectedModelId.value).toBe("replacement");
    expect(controller.thinkingLevel.value).toBe("high");
    expect(controller.temperature.value).toBe(0.6);
    controller.dispose();
  });

  it("sends attachment-only prompts and stores only display metadata", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    expect(controller.canSend.value).toBe(false);
    expect(controller.canSendAttachments.value).toBe(true);

    const proxiedAttachments = reactive([
      {
        id: "notes",
        kind: "text",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 12,
        content: "雨夜，旧站台。"
      },
      {
        id: "reference",
        kind: "image",
        name: "reference.png",
        mediaType: "image/png",
        size: 3,
        data: "AQID"
      }
    ] as const);
    const sending = controller.sendMessage(document, [], {}, [
      ...proxiedAttachments
    ]);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_attachments",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "vision-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      message: "请阅读并分析我上传的附件。",
      attachments: [
        { kind: "text", content: "雨夜，旧站台。" },
        { kind: "image", data: "AQID" }
      ]
    });
    expect(() =>
      structuredClone(deferred.prompts[0]?.attachments)
    ).not.toThrow();
    expect(controller.messages.value[0]).toMatchObject({
      role: "user",
      attachments: [
        { kind: "text", name: "notes.md" },
        { kind: "image", name: "reference.png" }
      ]
    });
    expect(controller.messages.value[0]?.attachments?.[1]).not.toHaveProperty(
      "data"
    );
    controller.dispose();
  });

  it("uses temperature when a reasoning model turns thinking off", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "reasoning-writer",
      models: [
        {
          id: "reasoning-writer",
          label: "Reasoning writer",
          provider: "openai",
          modelId: "reasoning-writer-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    controller.selectThinkingLevel("off");
    controller.selectTemperature(1.2);
    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(1.2);

    controller.draft.value = "关闭思考并提高表达变化";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_reasoning_temperature",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "openai",
        model: "reasoning-writer-model",
        mode: "provider"
      }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "reasoning-writer",
      thinkingLevel: "off",
      temperature: 1.2
    });
    controller.dispose();
  });

  it("uses only configured temperatures when a model defaults to non-thinking mode", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "plain-writer",
      models: [
        {
          id: "plain-writer",
          label: "Plain writer",
          provider: "deepseek",
          modelId: "deepseek-chat",
          api: "openai-completions",
          baseUrl: "https://deepseek.example.test/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["medium"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.thinkingLevel.value).toBe("off");
    expect(controller.temperature.value).toBe(0.6);
    controller.selectTemperature(1.5);
    expect(controller.temperature.value).toBe(0.6);
    controller.selectTemperature(1.2);
    controller.draft.value = "使用更有变化的表达";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_temperature",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "deepseek",
        model: "deepseek-chat",
        mode: "provider"
      }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "plain-writer",
      thinkingLevel: "off",
      temperature: 1.2
    });
    controller.dispose();
  });

  it("can turn thinking on when a model defaults to non-thinking mode", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "plain-writer",
      models: [
        {
          id: "plain-writer",
          label: "Plain writer",
          provider: "deepseek",
          modelId: "deepseek-chat",
          api: "openai-completions",
          baseUrl: "https://deepseek.example.test/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.6, 1.2],
          hasApiKey: true
        }
      ]
    });

    expect(controller.thinkingLevel.value).toBe("off");
    controller.selectThinkingLevel("medium");
    expect(controller.thinkingLevel.value).toBe("off");
    controller.selectThinkingLevel("high");
    expect(controller.thinkingLevel.value).toBe("high");

    controller.draft.value = "开启深度思考";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_temperature_default_thinking_override",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "deepseek",
        model: "deepseek-chat",
        mode: "provider"
      }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "plain-writer",
      thinkingLevel: "high"
    });
    expect(deferred.prompts[0]).not.toHaveProperty("temperature");
    controller.dispose();
  });
});
