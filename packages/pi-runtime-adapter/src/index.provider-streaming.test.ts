import type {
  AgentRuntimeEvent,
  AssistantMessage,
  LongWorkspaceRuntimeContext,
  ShortWorkspaceSnapshot
} from "./index.test-support";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  buildRawUserMessage,
  buildRuntimeUserPrompt,
  createAssistantMessageEventStream,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  interceptToolCallStream,
  it,
  providerRuntime,
  reconcileToolCallArguments,
  screenplayWorkspace,
  scriptAgentProfile,
  toToolStreamRuntimeEvent,
  toUsageObservedRuntimeEvent,
  toolCallMessage
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: provider-streaming", () => {
  it("keeps uploaded text and images as native user-message content", () => {
    const message = buildRawUserMessage(
      {
        runId: "run_attachment",
        sessionId: "session_attachment",
        prompt: "结合附件分析场景",
        attachments: [
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
        ]
      },
      123
    );

    expect(message.timestamp).toBe(123);
    expect(message.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("雨夜，旧站台。")
      },
      { type: "image", data: "AQID", mimeType: "image/png" }
    ]);
  });

  it("does not silently ignore images on the local text-only runtime", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const consume = async () => {
      for await (const _event of runtime.start({
        runId: "run_image_faux",
        sessionId: "session_image_faux",
        prompt: "分析图片",
        attachments: [
          {
            id: "reference",
            kind: "image",
            name: "reference.png",
            mediaType: "image/png",
            size: 3,
            data: "AQID"
          }
        ]
      })) {
        // The capability check fails before a stream is created.
      }
    };

    await expect(consume()).rejects.toThrow("Faux 不支持图片理解");
  });

  it("observes raw tool chunks while forwarding them to pi-agent-core", async () => {
    const source = createAssistantMessageEventStream();
    const observed: Array<{ type: string; turn: number }> = [];
    const intercepted = interceptToolCallStream(
      async () => source,
      (event, turn) => observed.push({ type: event.type, turn })
    );
    const message = toolCallMessage("tool_write", "write_workspace_editor");
    const forwarded = await intercepted(
      {} as Parameters<typeof intercepted>[0],
      normalizeContext({ messages: [] }),
      undefined
    );
    const received: string[] = [];
    const consume = (async () => {
      for await (const event of forwarded) received.push(event.type);
    })();

    source.push({ type: "start", partial: message });
    source.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    source.push({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"text":"第一段',
      partial: message
    });
    source.push({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: message.content[0] as Extract<
        AssistantMessage["content"][number],
        { type: "toolCall" }
      >,
      partial: message
    });
    source.push({ type: "done", reason: "toolUse", message });
    await consume;

    expect(observed).toEqual([
      { type: "toolcall_start", turn: 0 },
      { type: "toolcall_delta", turn: 0 },
      { type: "toolcall_end", turn: 0 }
    ]);
    expect(received).toEqual([
      "start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done"
    ]);
  });

  it("turns an intercepted iterator rejection into a retryable error terminal", async () => {
    const partial = toolCallMessage(
      "tool_interrupted",
      "write_workspace_editor"
    );
    const source = {
      async *[Symbol.asyncIterator]() {
        yield { type: "start", partial } as const;
        throw new Error("socket hang up");
      },
      result: async () => partial
    };
    const intercepted = interceptToolCallStream(
      async () =>
        source as unknown as ReturnType<
          typeof createAssistantMessageEventStream
        >,
      () => {}
    );
    const forwarded = await intercepted(
      {} as Parameters<typeof intercepted>[0],
      normalizeContext({ messages: [] }),
      undefined
    );
    const received: string[] = [];
    for await (const event of forwarded) received.push(event.type);

    expect(received).toEqual(["start", "error"]);
    await expect(forwarded.result()).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: "socket hang up"
    });
  });

  it("assigns unique tool stream ids when content indexes repeat across model turns", () => {
    const input = {
      runId: "run_repeated_content_index",
      sessionId: "session_repeated_content_index",
      prompt: "先读取再写入"
    };
    const messageId = "run_repeated_content_index_assistant";
    const firstMessage = toolCallMessage("tool_read", "read_workspace_content");
    const secondMessage = toolCallMessage(
      "tool_write",
      "write_workspace_editor"
    );

    const first = toToolStreamRuntimeEvent(
      {
        type: "toolcall_start",
        contentIndex: 0,
        partial: firstMessage
      },
      input,
      providerRuntime,
      messageId,
      0
    );
    const second = toToolStreamRuntimeEvent(
      {
        type: "toolcall_start",
        contentIndex: 0,
        partial: secondMessage
      },
      input,
      providerRuntime,
      messageId,
      1
    );

    expect(first).toMatchObject({
      type: "agent.tool_stream",
      payload: { streamId: `${messageId}:0:0`, toolCallId: "tool_read" }
    });
    expect(second).toMatchObject({
      type: "agent.tool_stream",
      payload: { streamId: `${messageId}:1:0`, toolCallId: "tool_write" }
    });
  });

  it.each(["write_draft_section", "replace_draft_section_text"])(
    "captures an early argument snapshot for %s",
    (toolName) => {
      const input = {
        runId: `run_${toolName}`,
        sessionId: `session_${toolName}`,
        prompt: "写正文"
      };
      const message = toolCallMessage(`tool_${toolName}`, toolName);
      const toolCall = message.content[0] as Extract<
        AssistantMessage["content"][number],
        { type: "toolCall" }
      > & { partialJson?: string };
      toolCall.partialJson =
        toolName === "write_draft_section"
          ? '{"section_id":"section-1","text":"第一段'
          : '{"section_id":"section-1","replacements":[{"original_text":"旧片段';

      const event = toToolStreamRuntimeEvent(
        { type: "toolcall_start", contentIndex: 0, partial: message },
        input,
        providerRuntime,
        `${input.runId}_assistant`,
        0
      );

      expect(event.payload).toMatchObject({
        toolName,
        phase: "start",
        argumentsDelta: "",
        argumentsSnapshot: toolCall.partialJson
      });
    }
  );

  it("reduces cumulative tool argument snapshots to non-duplicated deltas", () => {
    const first = reconcileToolCallArguments("", "", '{"text":"第一');
    const second = reconcileToolCallArguments(
      first.next,
      "段",
      '{"text":"第一段'
    );
    const completed = reconcileToolCallArguments(
      second.next,
      "",
      '{"text":"第一段正文"}'
    );

    expect(first).toEqual({ delta: '{"text":"第一', next: '{"text":"第一' });
    expect(second).toEqual({ delta: "段", next: '{"text":"第一段' });
    expect(completed).toEqual({
      delta: '正文"}',
      next: '{"text":"第一段正文"}'
    });
    expect(
      reconcileToolCallArguments(completed.next, completed.next, completed.next)
    ).toEqual({ delta: "", next: completed.next });
  });

  it("observes intermediate tool turns and provider errors for accounting", () => {
    const input = {
      runId: "run_usage_observed",
      sessionId: "session_usage_observed",
      prompt: "执行工具后继续"
    };
    const intermediate = toUsageObservedRuntimeEvent(
      toolCallMessage("tool_usage", "write_draft_section"),
      input,
      providerRuntime,
      "run_usage_observed_assistant",
      { turnId: "run_usage_observed:turn:1", attempt: 1, maxAttempts: 6 }
    );
    const failedMessage: AssistantMessage = {
      ...toolCallMessage("tool_unused", "unused"),
      content: [{ type: "text", text: "" }],
      usage: {
        input: 21,
        output: 8,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 34,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "error",
      errorMessage: "connection reset"
    };
    const failed = toUsageObservedRuntimeEvent(
      failedMessage,
      input,
      providerRuntime,
      "run_usage_observed_assistant",
      { turnId: "run_usage_observed:turn:2", attempt: 2, maxAttempts: 6 }
    );

    expect(intermediate).toMatchObject({
      type: "agent.usage_observed",
      payload: {
        observationId: "run_usage_observed:turn:1:attempt:1",
        turnId: "run_usage_observed:turn:1",
        attempt: 1,
        status: "completed",
        hadToolCall: true,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        },
        runtime: providerRuntime
      }
    });
    expect(failed).toMatchObject({
      type: "agent.usage_observed",
      payload: {
        observationId: "run_usage_observed:turn:2:attempt:2",
        status: "error",
        hadToolCall: false,
        usage: {
          inputTokens: 21,
          outputTokens: 8,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
          totalTokens: 34
        }
      }
    });
  });

  it("streams thinking and text through pi-agent-core without an API key", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_1",
      sessionId: "session_1",
      prompt: "续写当前章节",
      thinkingLevel: "medium",
      workspaceContext: {
        activeResource: {
          id: "chapter_3",
          domain: "creation",
          title: "第三章 雨夜回声",
          path: ["雾港来信", "第三章 雨夜回声"],
          format: "正文",
          source: "live-editor",
          content: "雨是在午夜以后落下来的。"
        }
      }
    })) {
      events.push(event);
    }

    const deltas = events
      .filter(
        (event): event is Extract<AgentRuntimeEvent, { type: "agent.delta" }> =>
          event.type === "agent.delta"
      )
      .map((event) => event.payload.delta)
      .join("");
    const thinking = events.filter(
      (event) => event.type === "agent.thinking_delta"
    );
    const completed = events.find((event) => event.type === "agent.completed");
    const usageObserved = events.filter(
      (
        event
      ): event is Extract<
        AgentRuntimeEvent,
        { type: "agent.usage_observed" }
      > => event.type === "agent.usage_observed"
    );

    expect(thinking.length).toBeGreaterThan(0);
    expect(deltas).toBe(completed?.payload.content);
    expect(completed?.payload.content).toContain("第三章 雨夜回声");
    expect(completed?.payload.runtime.mode).toBe("local-faux");
    expect(usageObserved).toHaveLength(1);
    expect(usageObserved[0]).toMatchObject({
      payload: {
        status: "completed",
        hadToolCall: false,
        turnId: "run_1:turn:1",
        attempt: 1
      }
    });
    expect(usageObserved[0]?.payload.usage).toEqual(completed?.payload.usage);
    expect(
      events.some((event) => event.type === "agent.evaluation_snapshot")
    ).toBe(false);
    expect(
      events.filter((event) => event.type === "agent.turn_started")
    ).toEqual([
      expect.objectContaining({
        runId: "run_1",
        sessionId: "session_1",
        payload: expect.objectContaining({ attempt: 1, maxAttempts: 6 })
      })
    ]);
    expect(
      events.filter(
        (event) =>
          event.type === "agent.completed" || event.type === "agent.error"
      )
    ).toHaveLength(1);
    expect(
      events.every(
        (event) => event.runId === "run_1" && event.sessionId === "session_1"
      )
    ).toBe(true);
  });

  it("emits one error terminal when the run stays idle", async () => {
    const runtime = new PiAgentRuntimeAdapter({
      idleTimeoutMs: 1,
      // Still exceeds the idle threshold, but lets the Faux sleep drain after
      // cancellation within this test's deadline.
      tokensPerSecond: 1
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_timeout",
      sessionId: "session_timeout",
      prompt: "验证超时"
    })) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "agent.error")).toHaveLength(
      1
    );
    expect(events.some((event) => event.type === "agent.completed")).toBe(
      false
    );
  });

  it("keeps a run alive while streamed events continue", async () => {
    const runtime = new PiAgentRuntimeAdapter({
      idleTimeoutMs: 100,
      tokensPerSecond: 200
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_active_stream",
      sessionId: "session_active_stream",
      prompt: "验证持续流式事件",
      thinkingLevel: "off"
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "agent.error")).toBe(false);
    expect(
      events.filter((event) => event.type === "agent.completed")
    ).toHaveLength(1);
  });

  it("does not emit thinking when thinking is disabled", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_no_thinking",
      sessionId: "session_no_thinking",
      prompt: "只验证回复流",
      thinkingLevel: "off"
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "agent.thinking_delta")).toBe(
      false
    );
    expect(
      events.filter((event) => event.type === "agent.completed")
    ).toHaveLength(1);
  });

  it("permanently injects context only into the first user message", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for (const [index, prompt] of ["先检查人物", "再检查剧情"].entries()) {
      for await (const _event of runtime.start({
        runId: `run_history_${index}`,
        sessionId: "session_history",
        prompt,
        thinkingLevel: "off",
        workspaceContext: {
          activeResource: {
            id: "chapter_history",
            domain: "creation",
            title: "历史测试",
            path: ["历史测试"],
            source: "live-editor",
            content: `第 ${index + 1} 轮快照`
          }
        }
      })) {
        // Consume the complete run before inspecting the cached transcript.
      }
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get("session_history:default");
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );

    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "实时内容:\n第 1 轮快照"
    );
    expect(String(userMessages?.[0]?.content)).toContain("先检查人物");
    expect(userMessages?.[1]?.content).toBe("再检查剧情");
    expect(String(userMessages?.[0]?.content)).not.toContain("run_history_1");
  });

  it("restores persisted conversation history only when rebuilding an agent", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const history = [
      {
        role: "user" as const,
        content: "先帮我规划一段雨夜相遇。",
        createdAt: "2026-08-17T07:58:00.000Z"
      },
      {
        role: "assistant" as const,
        content: "可以从旧站台的一封错投来信开始。",
        createdAt: "2026-08-17T07:59:00.000Z"
      }
    ];

    for await (const _event of runtime.start({
      runId: "run_restored_history_1",
      sessionId: "session_restored_history",
      prompt: "我上边说了啥？",
      conversationHistory: history,
      thinkingLevel: "off"
    })) {
      // Consume the rebuilt conversation turn.
    }

    for await (const _event of runtime.start({
      runId: "run_restored_history_2",
      sessionId: "session_restored_history",
      prompt: "继续",
      conversationHistory: [
        {
          role: "user",
          content: "这条历史不应重复灌入",
          createdAt: "2026-08-17T08:01:00.000Z"
        }
      ],
      thinkingLevel: "off"
    })) {
      // Consume a normal follow-up turn on the same in-memory agent.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const messages = cache
      .get("session_restored_history:default")
      ?.state.messages.filter((message) => message.role !== "system");

    expect(() =>
      structuredClone(
        cache.get("session_restored_history:default")?.state.messages[0]
      )
    ).not.toThrow();

    expect(messages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
    expect(String(messages?.[0]?.content)).toBe("先帮我规划一段雨夜相遇。");
    expect(JSON.stringify(messages)).toContain(
      "可以从旧站台的一封错投来信开始。"
    );
    expect(JSON.stringify(messages)).not.toContain("这条历史不应重复灌入");
  });

  it("replaces a cached conversation agent with the supplied history", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for await (const _event of runtime.start({
      runId: "run_history_before_replace",
      sessionId: "session_history_replace",
      prompt: "这轮内容稍后应被舍弃",
      thinkingLevel: "off"
    })) {
      // Populate the cached conversation agent.
    }

    for await (const _event of runtime.start({
      runId: "run_history_replace",
      sessionId: "session_history_replace",
      prompt: "修改后的问题",
      conversationHistory: [
        {
          role: "user",
          content: "保留的问题",
          createdAt: "2026-08-25T10:00:00.000Z"
        },
        {
          role: "assistant",
          content: "保留的回答",
          createdAt: "2026-08-25T10:01:00.000Z"
        }
      ],
      conversationHistoryMode: "replace",
      thinkingLevel: "off"
    })) {
      // Consume the replacement turn.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const messages = cache
      .get("session_history_replace:default")
      ?.state.messages.filter((message) => message.role !== "system");

    expect(messages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
    expect(JSON.stringify(messages)).toContain("保留的问题");
    expect(JSON.stringify(messages)).toContain("修改后的问题");
    expect(JSON.stringify(messages)).not.toContain("这轮内容稍后应被舍弃");

    for await (const _event of runtime.start({
      runId: "run_history_replace_empty",
      sessionId: "session_history_replace",
      prompt: "从第一条重新开始",
      conversationHistoryMode: "replace",
      thinkingLevel: "off"
    })) {
      // Consume an empty-prefix replacement turn.
    }

    const resetMessages = cache
      .get("session_history_replace:default")
      ?.state.messages.filter((message) => message.role !== "system");
    expect(resetMessages?.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(JSON.stringify(resetMessages)).toContain("从第一条重新开始");
    expect(JSON.stringify(resetMessages)).not.toContain("保留的问题");
  });

  it("uses the same permanent-context transcript for creative workspace agents", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const scriptWorkspace = screenplayWorkspace();
    const profile = scriptAgentProfile();

    for (const [index, prompt] of ["先规划第一集", "继续细化开场"].entries()) {
      for await (const _event of runtime.start({
        runId: `run_script_history_${index}`,
        sessionId: "session_script_history",
        prompt,
        thinkingLevel: "off",
        scriptAgentProfile: profile,
        workspaceContext: { scriptWorkspace }
      })) {
        // Consume both turns before inspecting the script-agent transcript.
      }
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get("session_script_history:script:script");
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );

    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "剧本作品: 《雾港剧本》"
    );
    expect(String(userMessages?.[0]?.content)).toContain("先规划第一集");
    expect(String(userMessages?.[1]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[1]?.content)).toContain("继续细化开场");

    const shortProfile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    const shortWorkspace = {
      ...(scriptWorkspace as unknown as ShortWorkspaceSnapshot),
      id: "short-history",
      title: "雾港短篇",
      activeAgentId: "short" as const
    };
    for (const [index, prompt] of ["先规划第一节", "继续细化冲突"].entries()) {
      for await (const _event of runtime.start({
        runId: `run_short_history_${index}`,
        sessionId: "session_short_history",
        prompt,
        thinkingLevel: "off",
        agentProfile: shortProfile,
        workspaceContext: { shortWorkspace }
      })) {
        // Consume both turns before inspecting the short-agent transcript.
      }
    }
    const shortAgent = cache.get("session_short_history:short");
    const shortUserMessages = shortAgent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(shortUserMessages).toHaveLength(2);
    expect(String(shortUserMessages?.[0]?.content)).toContain(
      "短篇作品: 《雾港短篇》"
    );
    expect(String(shortUserMessages?.[1]?.content)).toContain(
      "短篇作品: 《雾港短篇》"
    );
    expect(String(shortUserMessages?.[1]?.content)).toContain("继续细化冲突");
  });

  it("permanently injects worldbuilding context only into the first user message", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_world_history",
      title: "雾港长篇",
      activeRoot: "worldbuilding",
      activeAgentId: profile.id,
      activeFileId: "file_faction_watch:content",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_factions",
            title: "势力",
            order: 1,
            format: "list",
            itemCount: 1,
            items: [
              {
                itemId: "worlditem_watchers",
                title: "守夜人",
                order: 1
              }
            ],
            omittedItemCount: 0
          }
        ],
        omittedCategoryCount: 0
      },
      worldbuildingFocus: {
        categoryTitle: "势力",
        format: "list",
        currentStage: {
          kind: "item",
          title: "守夜人",
          text: { content: "守夜人负责执行宵禁。" }
        },
        overview: { content: "各势力争夺港务权。" }
      },
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_world_history",
        updatedAt: "2026-07-30T10:00:00.000Z",
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
        volumes: [{ id: "volume_world_history", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for (const [index, prompt] of [
      "先检查世界规则",
      "再补充力量体系"
    ].entries()) {
      for await (const _event of runtime.start({
        runId: `run_world_history_${index}`,
        sessionId: "session_world_history",
        prompt,
        thinkingLevel: "off",
        longAgentProfile: profile,
        workspaceContext: { longWorkspace }
      })) {
        // Consume both turns before inspecting the cache-stable transcript.
      }
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_world_history:long:long:longbook_world_history"
    );
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );

    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "长篇作品: 《雾港长篇》"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "势力（category_id=world_factions；类型=条目列表；共 1 项）"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "守夜人（item_id=worlditem_watchers；顺序=1）"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "当前用户所处的世界观阶段: 列表型分类「势力」 / 条目「守夜人」（category_id=world_factions；item_id=worlditem_watchers）"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "当前阶段简要信息: 仅定位当前页面，正文未注入"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【当前阶段信息与要求】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "全书共 1 卷、0 个剧情点、0 张章卡、0 条故事情节、0 个故事事件、0 条伏笔线"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain("当前剧情工作区");
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "各势力争夺港务权。"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "守夜人负责执行宵禁。"
    );
    expect(String(userMessages?.[0]?.content)).toContain("先检查世界规则");
    expect(userMessages?.[1]?.content).toContain("再补充力量体系");
  });

  it("assembles only the active library tools and keeps entry bodies out of the prompt", async () => {
    const profile = DEFAULT_LIBRARY_AGENT_PROFILES.find(
      ({ domain }) => domain === "material"
    )!;
    const entryBody = "DO_NOT_INLINE_LIBRARY_BODY_7d9d";
    const input = {
      runId: "run_library",
      sessionId: "session_library",
      prompt: "整理这个素材库",
      thinkingLevel: "off" as const,
      libraryAgentProfile: profile,
      workspaceContext: {
        activeResource: {
          id: "material-document-1",
          domain: "material" as const,
          title: "雨夜人物",
          path: ["人物素材", "雨夜人物"],
          source: "live-editor" as const,
          content: entryBody
        },
        libraryWorkspace: {
          domain: "material" as const,
          libraryId: "material-library-1",
          title: "人物素材",
          libraryType: "short" as const,
          kind: "character" as const,
          overviewDocumentId: "material-overview-1",
          overview: "仅用于都市悬疑人物",
          overviewRevision:
            createShortWorkspaceContentRevision("仅用于都市悬疑人物"),
          readOnly: false,
          activeEntryId: "material-entry-1",
          projectRevision: 2,
          entries: [
            {
              id: "material-entry-1",
              documentId: "material-document-1",
              stageId: "character" as const,
              title: "雨夜人物",
              content: entryBody,
              revision: createShortWorkspaceContentRevision(entryBody),
              readOnly: false
            }
          ]
        }
      }
    };

    const prompt = buildRuntimeUserPrompt(input);
    expect(prompt).toContain("雨夜人物 (material-entry-1)");
    expect(prompt).toContain("仅用于都市悬疑人物");
    expect(prompt).not.toContain(entryBody);

    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for await (const _event of runtime.start(input)) {
      // Consume the local run before inspecting its domain-scoped agent.
    }
    for await (const _event of runtime.start({
      ...input,
      runId: "run_library_followup",
      prompt: "继续整理人物关系"
    })) {
      // Consume the follow-up turn to verify the stable library prefix.
    }
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          {
            state: {
              tools: Array<{ name: string }>;
              systemPrompt: string;
              messages: Array<{ role?: string; content?: unknown }>;
            };
          }
        >;
      }
    ).conversationAgents;
    const agent = cache.get("session_library:library:material");
    expect(agent?.state.tools.map(({ name }) => name)).toEqual([
      "list_material_entries",
      "read_material_entry",
      "search_material_entries",
      "load_skill",
      "create_material_entry",
      "edit_material_entry",
      "edit_material_library_overview",
      "manage_library",
      "manage_group",
      "organize_entries"
    ]);
    expect(agent?.state.systemPrompt).toContain("素材库管理智能体");
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "当前资料库: 《人物素材》"
    );
    expect(userMessages?.[1]?.content).toBe("继续整理人物关系");
  });
});
