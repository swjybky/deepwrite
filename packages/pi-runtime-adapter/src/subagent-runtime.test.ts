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
  enabled: true
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
  depth?: number;
  createRunId?: () => string;
  onContext?: (context: Context) => void;
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
    options.onContext?.(context);
    return sourceStream(requestModel, context, streamOptions);
  };
  const tool = buildSpawnSubagentTool({
    parentSessionId: "parent-session",
    model,
    thinkingLevel: "medium",
    streamFn,
    parentSystemPrompt: "你是短篇正文主智能体。",
    definitions: options.definitions ?? [enabledDefinition],
    buildChildTools: options.buildChildTools ?? (() => [childTool()]),
    buildChildUserMessage: (_definition, task, subagentRunId) => ({
      role: "user",
      content: `workspace=雾港回声\nsubagentRunId=${subagentRunId}\ntask=${task}`,
      timestamp: 123
    }),
    ...(options.toolExecutionHooks
      ? { toolExecutionHooks: options.toolExecutionHooks }
      : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.depth === undefined ? {} : { depth: options.depth }),
    ...(options.createRunId ? { createRunId: options.createRunId } : {})
  });
  return { tool, faux };
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
          enabled: false
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
      content: expect.stringContaining("task=检查第一节时间线")
    });
    expect(contexts[0]?.tools?.map((candidate) => candidate.name)).toEqual([
      "echo_child_context"
    ]);
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
      content: expect.stringContaining("task=重新独立检查")
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
});
