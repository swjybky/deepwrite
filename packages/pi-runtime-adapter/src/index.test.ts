import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage
} from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  cloneEmptyLearningImitationResult,
  createShortWorkspaceContentRevision,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import {
  buildProviderRuntime,
  buildRawUserMessage,
  buildRuntimeUserPrompt,
  interceptToolCallStream,
  PiAgentRuntimeAdapter,
  reconcileToolCallArguments,
  toRuntimeEvents,
  toToolStreamRuntimeEvent,
  type AgentRuntimeEvent
} from "./index";

const providerRuntime = {
  provider: "deepseek",
  model: "deepseek-chat",
  mode: "provider" as const
};

function toolCallMessage(id: string, name: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: {} }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "toolUse",
    timestamp: Date.now()
  };
}

describe("DeepWrite Pi runtime adapter", () => {
  it("enables Pi reasoning when a run selects thinking after non-thinking configuration", () => {
    const config: AgentProviderRuntimeConfig = {
      id: "writer",
      label: "Writer",
      provider: "custom",
      modelId: "writer-model",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: ""
    };

    expect(buildProviderRuntime(config, undefined, "high").model.reasoning).toBe(true);
    expect(buildProviderRuntime(config, 0.6, "off").model.reasoning).toBe(false);
    expect(
      buildProviderRuntime({ ...config, reasoning: true }, 0.6, "off").model.reasoning
    ).toBe(false);
  });

  it("preserves built-in thinking maps while carrying max and custom levels", () => {
    const builtinConfig: AgentProviderRuntimeConfig = {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
      temperatureOptions: [0.2, 0.6, 1.2],
      apiKey: ""
    };

    expect(buildProviderRuntime(builtinConfig, undefined, "low").model.thinkingLevelMap)
      .toMatchObject({ low: null, xhigh: "max" });
    expect(buildProviderRuntime(builtinConfig, undefined, "xhigh").model.thinkingLevelMap)
      .toMatchObject({ low: null, xhigh: "max" });
    expect(buildProviderRuntime(builtinConfig, undefined, "max").model.thinkingLevelMap)
      .toMatchObject({ low: null, xhigh: "max" });

    const customConfig: AgentProviderRuntimeConfig = {
      ...builtinConfig,
      provider: "custom",
      modelId: "custom-writer",
      baseUrl: "http://127.0.0.1:11434/v1",
      thinkingLevelOptions: [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra"
      ]
    };
    expect(buildProviderRuntime(customConfig, undefined, "xhigh").model.thinkingLevelMap)
      .toMatchObject({ xhigh: "xhigh" });
    expect(buildProviderRuntime(customConfig, undefined, "ultra").model.thinkingLevelMap)
      .toMatchObject({ xhigh: "ultra" });
  });

  it("keeps uploaded text and images as native user-message content", () => {
    const message = buildRawUserMessage({
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
    }, 123);

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
        attachments: [{
          id: "reference",
          kind: "image",
          name: "reference.png",
          mediaType: "image/png",
          size: 3,
          data: "AQID"
        }]
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
      { messages: [] },
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
      toolCall: message.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
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

  it("assigns unique tool stream ids when content indexes repeat across model turns", () => {
    const input = {
      runId: "run_repeated_content_index",
      sessionId: "session_repeated_content_index",
      prompt: "先读取再写入"
    };
    const messageId = "run_repeated_content_index_assistant";
    const firstMessage = toolCallMessage("tool_read", "read_workspace_content");
    const secondMessage = toolCallMessage("tool_write", "write_workspace_editor");

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

  it.each([
    "write_section_body",
    "write_expert_draft_section"
  ])("captures an early argument snapshot for %s", (toolName) => {
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
    toolCall.partialJson = toolName === "write_section_body"
      ? '{"text":"第一段'
      : '{"section_id":"section-1","text":"第一段';

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
  });

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
      .filter((event): event is Extract<AgentRuntimeEvent, { type: "agent.delta" }> => event.type === "agent.delta")
      .map((event) => event.payload.delta)
      .join("");
    const thinking = events.filter((event) => event.type === "agent.thinking_delta");
    const completed = events.find((event) => event.type === "agent.completed");

    expect(thinking.length).toBeGreaterThan(0);
    expect(deltas).toBe(completed?.payload.content);
    expect(completed?.payload.content).toContain("第三章 雨夜回声");
    expect(completed?.payload.runtime.mode).toBe("local-faux");
    expect(events.filter((event) => event.type === "agent.completed" || event.type === "agent.error")).toHaveLength(1);
    expect(events.every((event) => event.runId === "run_1" && event.sessionId === "session_1")).toBe(true);
  });

  it("emits one error terminal when the run stays idle", async () => {
    const runtime = new PiAgentRuntimeAdapter({ idleTimeoutMs: 1, tokensPerSecond: 0.01 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_timeout",
      sessionId: "session_timeout",
      prompt: "验证超时"
    })) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "agent.error")).toHaveLength(1);
    expect(events.some((event) => event.type === "agent.completed")).toBe(false);
  });

  it("keeps a run alive while streamed events continue", async () => {
    const runtime = new PiAgentRuntimeAdapter({ idleTimeoutMs: 100, tokensPerSecond: 200 });
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
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
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

    expect(events.some((event) => event.type === "agent.thinking_delta")).toBe(false);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
  });

  it("keeps multi-turn history but removes per-run context wrappers", async () => {
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

    expect(userMessages?.map((message) => message.content)).toEqual([
      "先检查人物",
      "再检查剧情"
    ]);
    expect(
      agent?.state.messages.some((message) =>
        String(message.content).includes("run_history_")
      )
    ).toBe(false);
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
          overview: "仅用于都市悬疑人物",
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
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { tools: Array<{ name: string }>; systemPrompt: string } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_library:library:material:material-library-1"
    );
    expect(agent?.state.tools.map(({ name }) => name)).toEqual([
      "list_material_entries",
      "read_material_entry",
      "search_material_entries",
      "load_skill",
      "create_material_entry",
      "edit_material_entry"
    ]);
    expect(agent?.state.systemPrompt).toContain("素材库管理智能体");
  });

  it("injects spawn_subagent only when the active short agent has enabled definitions", async () => {
    const agentProfile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
      ({ id }) => id === "character_design"
    )!;
    const shortWorkspace = {
      id: "short-subagent-test",
      title: "雾港回声",
      categories: ["悬疑"],
      activeStageId: "character_design" as const,
      activeAgentId: "character_design" as const,
      expertDraft: {
        id: "draft" as const,
        title: "正文",
        revision: createShortWorkspaceContentRevision(""),
        sections: []
      },
      stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
        stageId,
        title: stageId,
        content: "",
        revision: createShortWorkspaceContentRevision("")
      }))
    };
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for await (const _event of runtime.start({
      runId: "run_with_subagent",
      sessionId: "session_with_subagent",
      prompt: "检查人物",
      thinkingLevel: "off",
      agentProfile,
      subagentDefinitions: [{
        id: "character_reviewer",
        name: "人物审校",
        description: "检查人物设定冲突。",
        systemPrompt: "只做人物一致性检查。",
        enabled: true
      }],
      workspaceContext: { shortWorkspace }
    })) {
      // Consume before reading the parent agent's current tool set.
    }
    for await (const _event of runtime.start({
      runId: "run_without_subagent",
      sessionId: "session_without_subagent",
      prompt: "检查人物",
      thinkingLevel: "off",
      agentProfile,
      subagentDefinitions: [{
        id: "disabled_reviewer",
        name: "停用审校",
        description: "当前停用。",
        systemPrompt: "不要执行。",
        enabled: false
      }],
      workspaceContext: { shortWorkspace }
    })) {
      // Consume before reading the second parent agent's current tool set.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<string, { state: { tools: Array<{ name: string }> } }>;
      }
    ).conversationAgents;
    expect(
      cache.get("session_with_subagent:character_design")?.state.tools.map(({ name }) => name)
    ).toContain("spawn_subagent");
    expect(
      cache.get("session_without_subagent:character_design")?.state.tools.map(({ name }) => name)
    ).not.toContain("spawn_subagent");
  });

  it("projects child mutation details onto the parent run with a namespaced tool id", () => {
    const baseRevision = createShortWorkspaceContentRevision("修改前");
    const events = toRuntimeEvents(
      {
        type: "tool_execution_update",
        toolCallId: "parent-spawn-call",
        toolName: "spawn_subagent",
        args: {},
        partialResult: {
          content: [{ type: "text", text: "子工具结果已同步" }],
          details: {
            kind: "subagent-progress",
            progress: {
              type: "child_tool_details",
              parentToolCallId: "parent-spawn-call",
              subagentRunId: "subrun-1",
              subagentId: "draft_reviewer",
              name: "正文审校",
              toolCallId: "subrun-1:child-write",
              toolName: "write_workspace_editor",
              isError: false,
              result: {
                content: [{ type: "text", text: "等待审阅" }],
                details: {
                  kind: "workspace-editor-mutation",
                  workspaceId: "short-1",
                  stageId: "character_design",
                  text: "修改后",
                  baseRevision,
                  summary: "等待审阅"
                }
              }
            }
          }
        }
      } as never,
      {
        runId: "parent-run",
        sessionId: "parent-session",
        prompt: "委派修改"
      },
      providerRuntime,
      "parent-assistant"
    );

    expect(events).toEqual([{
      type: "workspace.editor_mutation",
      runId: "parent-run",
      sessionId: "parent-session",
      payload: {
        toolCallId: "subrun-1:child-write",
        workspaceId: "short-1",
        stageId: "character_design",
        text: "修改后",
        baseRevision,
        summary: "等待审阅",
        runtime: providerRuntime
      }
    }]);
  });

  it("maps a batch chapter-file creation result into one reviewable workspace event", () => {
    const baseRevision = createShortWorkspaceContentRevision("draft-directory");
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "create-chapters",
        toolName: "create_expert_draft_sections",
        isError: false,
        result: {
          content: [{ type: "text", text: "等待审阅" }],
          details: {
            kind: "workspace-expert-draft-section-creation",
            workspaceId: "short-1",
            stageId: "draft",
            sections: [
              { title: "第二章", wordCountRequirement: "1200 字" },
              { title: "第三章", wordCountRequirement: "" }
            ],
            afterSectionId: "section-1",
            baseRevision,
            summary: "已生成创建 2 个空白章节文件的变更，等待用户审阅。"
          }
        }
      } as never,
      {
        runId: "run-create-chapters",
        sessionId: "session-create-chapters",
        prompt: "初始化正文"
      },
      providerRuntime,
      "assistant-create-chapters"
    );

    expect(events.at(-1)).toEqual({
      type: "workspace.editor_mutation",
      runId: "run-create-chapters",
      sessionId: "session-create-chapters",
      payload: {
        toolCallId: "create-chapters",
        workspaceId: "short-1",
        stageId: "draft",
        text: "1. 第二章（1200 字）\n2. 第三章",
        mutationTarget: {
          kind: "expert-draft-section-creation",
          sections: [
            { title: "第二章", wordCountRequirement: "1200 字" },
            { title: "第三章", wordCountRequirement: "" }
          ],
          afterSectionId: "section-1"
        },
        baseRevision,
        summary: "已生成创建 2 个空白章节文件的变更，等待用户审阅。",
        runtime: providerRuntime
      }
    });
  });

  it("maps subagent progress updates in started-activity-completed order", () => {
    const input = {
      runId: "parent-run-order",
      sessionId: "parent-session-order",
      prompt: "委派检查"
    };
    const progress = [
      {
        type: "started",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        task: "检查时间线"
      },
      {
        type: "activity",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        activity: { type: "message_delta", delta: "结论" }
      },
      {
        type: "completed",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        status: "completed",
        summary: "检查完成"
      }
    ];
    const events = progress.flatMap((item) =>
      toRuntimeEvents(
        {
          type: "tool_execution_update",
          toolCallId: "spawn-order",
          toolName: "spawn_subagent",
          args: {},
          partialResult: {
            content: [{ type: "text", text: "progress" }],
            details: { kind: "subagent-progress", progress: item }
          }
        } as never,
        input,
        providerRuntime,
        "parent-assistant-order"
      )
    );

    expect(events.map((event) => event.type)).toEqual([
      "subagent.started",
      "subagent.activity",
      "subagent.completed"
    ]);
    expect(events.every((event) =>
      event.runId === input.runId && event.sessionId === input.sessionId
    )).toBe(true);
  });

  it("maps library mutation tool details to the renderer event contract", () => {
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "tool_edit_material",
        toolName: "edit_material_entry",
        isError: false,
        result: {
          content: [{ type: "text", text: "等待审阅" }],
          details: {
            kind: "library-entry-mutation",
            operation: "edit",
            domain: "material",
            libraryId: "material-library-1",
            entryId: "entry-1",
            documentId: "document-1",
            stageId: "character",
            title: "人物甲",
            text: "修改后",
            baseRevision: createShortWorkspaceContentRevision("修改前"),
            baseProjectRevision: 4,
            summary: "等待审阅"
          }
        }
      } as never,
      {
        runId: "run_library_event",
        sessionId: "session_library_event",
        prompt: "修改人物"
      },
      providerRuntime,
      "assistant-library"
    );

    expect(events).toContainEqual({
      type: "library.editor_mutation",
      runId: "run_library_event",
      sessionId: "session_library_event",
      payload: {
        toolCallId: "tool_edit_material",
        operation: "edit",
        domain: "material",
        libraryId: "material-library-1",
        entryId: "entry-1",
        documentId: "document-1",
        stageId: "character",
        title: "人物甲",
        text: "修改后",
        baseRevision: createShortWorkspaceContentRevision("修改前"),
        baseProjectRevision: 4,
        summary: "等待审阅",
        runtime: providerRuntime
      }
    });
  });

  it("starts each learning-imitation preset from a clean runtime transcript", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for (const [index, prompt] of ["第一次素材学习", "第二次素材学习"].entries()) {
      for await (const _event of runtime.start({
        runId: `run_learning_${index}`,
        sessionId: "session_learning",
        prompt,
        thinkingLevel: "off",
        learningImitationProfile: {
          id: "material_split",
          label: "素材拆分",
          systemPrompt: "分析当前样本文档。"
        },
        workspaceContext: {
          learningImitation: {
            stageId: "material_split",
            documents: [{
              id: "sample",
              name: "sample.txt",
              extension: "txt",
              mediaType: "text/plain",
              size: 4,
              text: "测试正文",
              charCount: 4
            }],
            result: cloneEmptyLearningImitationResult()
          }
        }
      })) {
        // Consume both complete runs before inspecting the stage-scoped cache.
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
    const agent = cache.get("session_learning:learning-imitation:material_split");
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );

    expect(userMessages?.map((message) => message.content)).toEqual([
      "第二次素材学习"
    ]);
  });

  it("aborts an active run through the caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0.01 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_aborted",
      sessionId: "session_aborted",
      prompt: "验证主动中止",
      signal: controller.signal
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agent.error",
      payload: { code: "pi_agent.aborted" }
    });
  });
});
