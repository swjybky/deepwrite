import type { AgentTool, AgentToolResult, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
  buildSpawnSubagentTool,
  buildSubagentSystemPrompt,
  isSubagentToolProgressDetails,
  type BuildSpawnSubagentToolInput,
  type SubagentToolDetails,
  type SubagentToolProgress
} from "./subagent-runtime";

const enabledDefinition = {
  id: "continuity_checker",
  name: "连续性检查员",
  description: "检查情节与人物状态连续性。",
  systemPrompt: "只检查连续性，并给出简洁证据。",
  enabled: true,
  modelMode: "inherit" as const
};

function childTool(): AgentTool {
  const parameters = Type.Object({ text: Type.String() });
  return {
    name: "echo_child_context",
    label: "回显子任务",
    description: "测试子智能体工具。",
    parameters,
    execute: async (_toolCallId, params) => ({
      content: [{
        type: "text",
        text: `已检查：${String((params as { text?: unknown }).text)}`
      }],
      details: { kind: "none" }
    })
  };
}

function makeHarness(options: {
  tokensPerSecond?: number;
  responses?: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];
  definitions?: BuildSpawnSubagentToolInput["definitions"];
  subagentRuntimeConfigs?: BuildSpawnSubagentToolInput["subagentRuntimeConfigs"];
  buildCustomModelRuntime?: BuildSpawnSubagentToolInput["buildCustomModelRuntime"];
  depth?: number;
  createRunId?: () => string;
  onContext?: (context: Context) => void;
  onModel?: (model: Model<Api>) => void;
  buildChildTools?: () => AgentTool[];
  toolExecutionHooks?: BuildSpawnSubagentToolInput["toolExecutionHooks"];
  timeoutMs?: number;
}) {
  const faux = fauxProvider({
    api: `subagent-test-${Math.random()}`,
    provider: `subagent-test-${Math.random()}`,
    models: [{ id: "subagent-model", name: "Subagent Model", reasoning: true }],
    tokensPerSecond: options.tokensPerSecond ?? 0
  });
  const models = createModels();
  models.setProvider(faux.provider);
  if (options.responses) faux.setResponses(options.responses);
  const model = faux.getModel("subagent-model") as Model<Api>;
  const sourceStream = models.streamSimple.bind(models) as StreamFn;
  const streamFn: StreamFn = (requestModel, context, streamOptions) => {
    options.onModel?.(requestModel);
    options.onContext?.(context);
    return sourceStream(requestModel, context, streamOptions);
  };
  const tool = buildSpawnSubagentTool({
    parentSessionId: "parent-session",
    model,
    thinkingLevel: "medium",
    streamFn,
    definitions: options.definitions ?? [enabledDefinition],
    ...(options.subagentRuntimeConfigs
      ? { subagentRuntimeConfigs: options.subagentRuntimeConfigs }
      : {}),
    ...(options.buildCustomModelRuntime
      ? { buildCustomModelRuntime: options.buildCustomModelRuntime }
      : {}),
    buildChildTools: options.buildChildTools ?? (() => [childTool()]),
    ...(options.toolExecutionHooks
      ? { toolExecutionHooks: options.toolExecutionHooks }
      : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.depth === undefined ? {} : { depth: options.depth }),
    ...(options.createRunId ? { createRunId: options.createRunId } : {})
  });
  return { tool, faux, parentModel: model };
}

function progressFrom(
  updates: AgentToolResult<SubagentToolDetails>[]
): SubagentToolProgress[] {
  return updates.flatMap((update) =>
    isSubagentToolProgressDetails(update.details)
      ? [update.details.progress]
      : []
  );
}

describe("blocking subagent runtime", () => {
  it("keeps the child role prompt but injects tool-use handoff boundaries", () => {
    const prompt = buildSubagentSystemPrompt(
      {
        ...enabledDefinition,
        systemPrompt: "你是章节写手，负责把委派任务写成章节正文。"
      },
      [
        {
          ...childTool(),
          name: "write_expert_draft_section",
          label: "写入章节正文"
        },
        {
          ...childTool(),
          name: "replace_expert_draft_section_text",
          label: "替换正文小节文本"
        }
      ]
    );

    expect(prompt).toContain("你是章节写手，负责把委派任务写成章节正文。");
    expect(prompt).toContain("【当前子智能体：连续性检查员 / continuity_checker】");
    expect(prompt).toContain("write_expert_draft_section（写入章节正文）");
    expect(prompt).toContain("replace_expert_draft_section_text（替换正文小节文本）");
    expect(prompt).toContain("禁止把应写入章节文件的小说正文整段粘贴进最终交接摘要");
    expect(prompt).not.toContain("你是短篇正文主智能体");
  });

  it("only exposes spawn for enabled definitions and never at child depth", () => {
    expect(makeHarness({ definitions: [] }).tool).toBeUndefined();
    expect(makeHarness({
      definitions: [{ ...enabledDefinition, enabled: false }]
    }).tool).toBeUndefined();
    expect(makeHarness({ depth: 1 }).tool).toBeUndefined();

    const tool = makeHarness({
      definitions: [
        enabledDefinition,
        {
          id: "disabled_writer",
          name: "停用写手",
          description: "不应暴露。",
          systemPrompt: "不要运行。",
          enabled: false,
          modelMode: "inherit"
        }
      ]
    }).tool;
    expect(tool?.name).toBe("spawn_subagent");
    expect(tool?.executionMode).toBe("sequential");
    expect(tool?.description).toContain("continuity_checker");
    expect(tool?.description).not.toContain("disabled_writer");
  });

  it("closes the lifecycle with an error when child initialization fails", async () => {
    const { tool } = makeHarness({
      createRunId: () => "subrun-init-error",
      buildChildTools: () => {
        throw new Error("工具权限初始化失败");
      }
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-init-error",
      { subagent_id: "continuity_checker", task: "初始化检查" } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );

    expect(progressFrom(updates).map((item) => item.type)).toEqual([
      "started",
      "completed"
    ]);
    expect(progressFrom(updates).at(-1)).toMatchObject({
      status: "error",
      errorMessage: "工具权限初始化失败"
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("工具权限初始化失败")
    });
  });

  it("runs with a clean transcript, projects activity, and returns only the final summary", async () => {
    const contexts: Context[] = [];
    let createdRunCount = 0;
    const { tool, faux } = makeHarness({
      createRunId: () => `subrun-fixed-${++createdRunCount}`,
      onContext: (context) => contexts.push(context),
      buildChildTools: () => [
        childTool(),
        { ...childTool(), name: "load_skill", label: "加载技能" },
        { ...childTool(), name: "spawn_subagent", label: "调用子智能体" }
      ],
      responses: [
        fauxAssistantMessage([
          fauxThinking("先检查当前工作区。"),
          fauxToolCall("echo_child_context", { text: "第一节" }, { id: "child-tool" })
        ], { stopReason: "toolUse" }),
        fauxAssistantMessage([
          fauxThinking("整理交接结论。"),
          fauxText("连续性检查完成：第一节时间线一致。")
        ])
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-spawn-call",
      { subagent_id: "continuity_checker", task: "检查第一节时间线" } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );
    const progress = progressFrom(updates);

    expect(contexts[0]?.messages).toHaveLength(1);
    expect(contexts[0]?.messages[0]).toMatchObject({
      role: "user",
      content: "检查第一节时间线"
    });
    expect(contexts[0]?.systemPrompt).toContain(enabledDefinition.systemPrompt);
    expect(contexts[0]?.systemPrompt).toContain("【子智能体执行边界】");
    expect(contexts[0]?.systemPrompt).toContain("echo_child_context");
    expect(contexts[0]?.systemPrompt).toContain(
      "不能只在聊天或交接摘要里写正文"
    );
    expect(JSON.stringify(contexts[0])).not.toContain("你是短篇正文主智能体");
    expect(JSON.stringify(contexts[0])).not.toContain("雾港回声");
    expect(contexts[0]?.tools?.map((candidate) => candidate.name)).toEqual([
      "echo_child_context"
    ]);
    expect(contexts[0]?.tools?.some((candidate) => candidate.name === "load_skill"))
      .toBe(false);
    expect(contexts[0]?.tools?.some((candidate) => candidate.name === "spawn_subagent"))
      .toBe(false);
    expect(progress[0]).toMatchObject({
      type: "started",
      parentToolCallId: "parent-spawn-call",
      subagentRunId: "subrun-fixed-1"
    });
    expect(progress.some((item) =>
      item.type === "activity" && item.activity.type === "thinking_delta"
    )).toBe(true);
    expect(progress.some((item) =>
      item.type === "activity" &&
      item.activity.type === "tool_requested" &&
      item.activity.toolCallId === "subrun-fixed-1:child-tool"
    )).toBe(true);
    expect(progress.some((item) => item.type === "child_tool_details")).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      type: "completed",
      status: "completed",
      summary: "连续性检查完成：第一节时间线一致。"
    });
    const requestedIndex = progress.findIndex((item) =>
      item.type === "activity" && item.activity.type === "tool_requested"
    );
    const completedToolIndex = progress.findIndex((item) =>
      item.type === "activity" && item.activity.type === "tool_completed"
    );
    const detailsIndex = progress.findIndex((item) => item.type === "child_tool_details");
    expect(requestedIndex).toBeGreaterThan(0);
    expect(completedToolIndex).toBeGreaterThan(requestedIndex);
    expect(detailsIndex).toBeGreaterThan(completedToolIndex);
    expect(progress.length - 1).toBeGreaterThan(detailsIndex);
    expect(result.content).toEqual([{
      type: "text",
      text: "连续性检查完成：第一节时间线一致。"
    }]);
    expect(result.details).toEqual({ kind: "subagent-result" });
    expect(JSON.stringify(result)).not.toContain("先检查当前工作区");
    expect(JSON.stringify(result)).not.toContain("已检查：第一节");

    faux.setResponses([
      fauxAssistantMessage(fauxText("第二次独立检查完成。"))
    ]);
    const secondResult = await tool.execute(
      "parent-spawn-call-2",
      { subagent_id: "continuity_checker", task: "重新独立检查" } as never
    );
    expect(contexts.at(-1)?.messages).toHaveLength(1);
    expect(contexts.at(-1)?.messages[0]).toMatchObject({
      role: "user",
      content: "重新独立检查"
    });
    expect(JSON.stringify(contexts.at(-1)?.messages)).not.toContain("第一节时间线一致");
    expect(secondResult.content).toEqual([{
      type: "text",
      text: "第二次独立检查完成。"
    }]);
  });

  it("propagates parent cancellation to the active child agent", async () => {
    const { tool } = makeHarness({
      tokensPerSecond: 1,
      createRunId: () => "subrun-abort",
      responses: [fauxAssistantMessage(fauxText("不会完整输出".repeat(1_000)))]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const controller = new AbortController();
    const updates: AgentToolResult<SubagentToolDetails>[] = [];
    const running = tool.execute(
      "parent-abort-call",
      { subagent_id: "continuity_checker", task: "长时间检查" } as never,
      controller.signal,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );
    queueMicrotask(() => controller.abort());

    const result = await running;
    expect(progressFrom(updates).at(-1)).toMatchObject({
      type: "completed",
      status: "aborted",
      subagentRunId: "subrun-abort"
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("已中止")
    });
  }, 5_000);

  it("applies the same tool execution hooks inside the isolated child", async () => {
    let beforeCalls = 0;
    let afterCalls = 0;
    const { tool } = makeHarness({
      toolExecutionHooks: {
        beforeToolCall: async () => {
          beforeCalls += 1;
          return undefined;
        },
        afterToolCall: async () => {
          afterCalls += 1;
          return undefined;
        }
      },
      responses: [
        fauxAssistantMessage([
          fauxToolCall("echo_child_context", { text: "权限检查" }, { id: "hook-tool" })
        ], { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxText("权限 hook 继承完成。"))
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    const result = await tool.execute(
      "parent-hook-call",
      { subagent_id: "continuity_checker", task: "验证权限 hook" } as never
    );

    expect(beforeCalls).toBe(1);
    expect(afterCalls).toBe(1);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "权限 hook 继承完成。"
    });
  });

  it("enforces a wall-clock deadline even while the child keeps streaming", async () => {
    const { tool } = makeHarness({
      tokensPerSecond: 1,
      timeoutMs: 20,
      responses: [fauxAssistantMessage(fauxText("持续输出".repeat(1_000)))]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-timeout-call",
      { subagent_id: "continuity_checker", task: "验证硬截止时间" } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );

    expect(progressFrom(updates).at(-1)).toMatchObject({
      type: "completed",
      status: "error",
      errorMessage: expect.stringContaining("硬截止时间")
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("硬截止时间")
    });
  }, 5_000);

  it("uses a custom model runtime when the subagent is configured separately", async () => {
    const customFaux = fauxProvider({
      api: `custom-subagent-${Math.random()}`,
      provider: `custom-subagent-${Math.random()}`,
      models: [{ id: "custom-child-model", name: "Custom Child", reasoning: true }],
      tokensPerSecond: 0
    });
    const customModels = createModels();
    customModels.setProvider(customFaux.provider);
    customFaux.setResponses([
      fauxAssistantMessage(fauxText("自定义模型交接完成。"))
    ]);
    const customModel = customFaux.getModel("custom-child-model") as Model<Api>;
    const customSourceStream = customModels.streamSimple.bind(customModels) as StreamFn;
    const seenModels: Model<Api>[] = [];

    const { tool, parentModel } = makeHarness({
      definitions: [
        {
          ...enabledDefinition,
          modelMode: "custom",
          modelId: "cfg-custom-1",
          thinkingLevel: "low"
        }
      ],
      subagentRuntimeConfigs: {
        "cfg-custom-1": {
          id: "cfg-custom-1",
          label: "自定义子模型",
          provider: "openai-compatible",
          api: "openai-completions",
          modelId: "custom-child-model",
          baseUrl: "https://example.test/v1",
          reasoning: true,
          thinkingLevelOptions: ["low", "medium", "high"],
          defaultThinkingLevel: "medium",
          temperatureOptions: [0, 0.7, 1],
          apiKey: "test-key"
        }
      },
      buildCustomModelRuntime: (_config, options) => {
        expect(options?.thinkingLevel).toBe("low");
        return {
          model: customModel,
          streamFn: (requestModel, context, streamOptions) => {
            seenModels.push(requestModel);
            return customSourceStream(requestModel, context, streamOptions);
          },
          thinkingLevel: "low"
        };
      },
      responses: [fauxAssistantMessage(fauxText("不应使用父模型。"))]
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    const result = await tool.execute(
      "parent-custom-model",
      { subagent_id: "continuity_checker", task: "用单独模型执行" } as never
    );

    expect(seenModels[0]?.id).toBe("custom-child-model");
    expect(seenModels[0]?.id).not.toBe(parentModel.id);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "自定义模型交接完成。"
    });
  });

  it("passes temperature into custom runtime when thinking is off", async () => {
    const customFaux = fauxProvider({
      api: `custom-temp-${Math.random()}`,
      provider: `custom-temp-${Math.random()}`,
      models: [{ id: "custom-temp-model", name: "Custom Temp", reasoning: false }],
      tokensPerSecond: 0
    });
    const customModels = createModels();
    customModels.setProvider(customFaux.provider);
    customFaux.setResponses([
      fauxAssistantMessage(fauxText("关闭思考后的温度执行完成。"))
    ]);
    const customModel = customFaux.getModel("custom-temp-model") as Model<Api>;
    let seenTemperature: number | undefined;

    const { tool } = makeHarness({
      definitions: [
        {
          ...enabledDefinition,
          modelMode: "custom",
          modelId: "cfg-temp-1",
          thinkingLevel: "off",
          temperature: 1
        }
      ],
      subagentRuntimeConfigs: {
        "cfg-temp-1": {
          id: "cfg-temp-1",
          label: "温度模型",
          provider: "openai-compatible",
          api: "openai-completions",
          modelId: "custom-temp-model",
          baseUrl: "https://example.test/v1",
          reasoning: false,
          thinkingLevelOptions: ["low", "medium", "high"],
          defaultThinkingLevel: "off",
          temperatureOptions: [0, 0.7, 1],
          apiKey: "test-key"
        }
      },
      buildCustomModelRuntime: (_config, options) => {
        seenTemperature = options?.temperature;
        return {
          model: customModel,
          streamFn: customModels.streamSimple.bind(customModels) as StreamFn,
          thinkingLevel: "off"
        };
      }
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    const result = await tool.execute(
      "parent-temp-model",
      { subagent_id: "continuity_checker", task: "验证温度" } as never
    );

    expect(seenTemperature).toBe(1);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "关闭思考后的温度执行完成。"
    });
  });

  it("fails clearly when a custom model config is missing at spawn time", async () => {
    const { tool } = makeHarness({
      definitions: [
        {
          ...enabledDefinition,
          modelMode: "custom",
          modelId: "missing-model"
        }
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-missing-model",
      { subagent_id: "continuity_checker", task: "缺少模型" } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );

    expect(progressFrom(updates).at(-1)).toMatchObject({
      status: "error",
      errorMessage: expect.stringContaining("模型不可用")
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("模型不可用")
    });
  });
});
