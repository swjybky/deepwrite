import type {
  AgentTool,
  AgentToolResult,
  StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api,
  type Context,
  type JsonObject,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { inspectTranscript } from "./transcript.test-support";
import { describe, expect, it, vi } from "vitest";
import { buildShortWorkspaceTools } from "./short-agent-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
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
      content: [
        {
          type: "text",
          text: `已检查：${String((params as { text?: unknown }).text)}`
        }
      ],
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
  onStreamOptions?: (options: Parameters<StreamFn>[2]) => void;
  buildChildTools?: () => AgentTool[];
  toolExecutionHooks?: BuildSpawnSubagentToolInput["toolExecutionHooks"];
  retryPolicy?: BuildSpawnSubagentToolInput["retryPolicy"];
  systemPromptRequirements?: string;
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
    options.onContext?.(inspectTranscript(context));
    options.onStreamOptions?.(streamOptions);
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
    ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
    ...(options.systemPromptRequirements
      ? { systemPromptRequirements: options.systemPromptRequirements }
      : {}),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
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
  it("disables provider SDK retries for child model requests", async () => {
    const streamOptions: Array<Parameters<StreamFn>[2]> = [];
    const { tool } = makeHarness({
      responses: [fauxAssistantMessage("child done")],
      onStreamOptions: (options) => streamOptions.push(options)
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    await tool.execute("parent-sdk-retry-call", {
      subagent_id: "continuity_checker",
      task: "检查 SDK 重试配置"
    } as never);

    expect(streamOptions).toHaveLength(1);
    expect(streamOptions[0]?.maxRetries).toBe(0);
  });

  it("keeps the child role prompt and appends runtime facts without a write policy", () => {
    const prompt = buildSubagentSystemPrompt(
      {
        ...enabledDefinition,
        systemPrompt: "你是章节写手，负责把委派任务写成章节正文。"
      },
      [
        {
          ...childTool(),
          name: "write_draft_section",
          label: "写入章节正文"
        },
        {
          ...childTool(),
          name: "replace_draft_section_text",
          label: "替换正文章节文本"
        }
      ]
    );

    expect(prompt).toContain("你是章节写手，负责把委派任务写成章节正文。");
    expect(prompt).toContain(
      "【当前子智能体：连续性检查员 / continuity_checker】"
    );
    expect(prompt).toContain("write_draft_section（写入章节正文）");
    expect(prompt).toContain("replace_draft_section_text（替换正文章节文本）");
    expect(prompt).toContain("不继承主对话历史");
    expect(prompt).toContain("你不能创建或调用其它子智能体。");
    expect(prompt).toContain("文档中的 ![…](images/…) 是作者插图");
    expect(prompt).toContain("不要新增图片引用");
    expect(prompt).toContain("不要整段粘贴文件原文");
    expect(prompt).not.toContain("你是短篇正文主智能体");
  });

  it("appends runtime-owned screenplay requirements after the editable child prompt", () => {
    const requirements = [
      "场景标题使用“序号. 内景/外景 地点 - 时间”。",
      "write_draft_section 中不得使用 Markdown 表格、分析标题或格式讲解。"
    ].join("\n");
    const prompt = buildSubagentSystemPrompt(
      {
        ...enabledDefinition,
        systemPrompt: "用户可编辑的子智能体提示词。"
      },
      [{ ...childTool(), name: "write_draft_section", label: "写入剧集正文" }],
      requirements
    );

    expect(prompt).toContain("用户可编辑的子智能体提示词。");
    expect(prompt).toContain("【本轮不可编辑的写作约束】");
    expect(prompt).toContain(requirements);
    expect(prompt.indexOf(requirements)).toBeGreaterThan(
      prompt.indexOf("用户可编辑的子智能体提示词。")
    );
  });

  it("keeps runtime-owned screenplay requirements in the executed child context", async () => {
    const contexts: Context[] = [];
    const requirements =
      "剧本正文场景标题必须使用“序号. 内景/外景 地点 - 时间”。";
    const { tool } = makeHarness({
      systemPromptRequirements: requirements,
      onContext: (context) => contexts.push(context),
      responses: [fauxAssistantMessage(fauxText("剧本格式检查完成。"))]
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    await tool.execute("parent-screenplay-call", {
      subagent_id: "continuity_checker",
      task: "检查第一集格式"
    } as never);

    expect(contexts[0]?.systemPrompt).toContain("【本轮不可编辑的写作约束】");
    expect(contexts[0]?.systemPrompt).toContain(requirements);
  });

  it("leaves the write-versus-handoff decision to the definition prompt", () => {
    const prompt = buildSubagentSystemPrompt(
      {
        ...enabledDefinition,
        systemPrompt: "你只做一致性审阅，把问题清单交回主智能体，不要写文件。"
      },
      [{ ...childTool(), name: "write_draft_section", label: "写入章节正文" }]
    );

    expect(prompt).toContain("你只做一致性审阅");
    expect(prompt).not.toContain("必须通过这些工具完成");
    expect(prompt).not.toContain("先用读取工具核对目标");
    expect(prompt).not.toContain("代替工具调用");
  });

  it("only exposes spawn for enabled definitions and never at child depth", () => {
    expect(makeHarness({ definitions: [] }).tool).toBeUndefined();
    expect(
      makeHarness({
        definitions: [{ ...enabledDefinition, enabled: false }]
      }).tool
    ).toBeUndefined();
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
    expect(tool?.description).toContain("#成员名");
  });

  it("lets child tools inherit cross-stage auto approval", async () => {
    const requestUserInput = vi.fn(async () => {
      throw new Error("cross-stage input should have been auto-approved");
    });
    const { tool } = makeHarness({
      buildChildTools: () =>
        buildShortWorkspaceTools({
          workspace: shortWorkspace("character_design"),
          profile: shortProfile(),
          autoApproveCrossStageOperations: true,
          requestUserInput
        }),
      responses: [
        fauxAssistantMessage(
          fauxToolCall(
            "read",
            { kind: "plot_stage", id: "plot_design" },
            { id: "child-read-plot" }
          ),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage(
          fauxToolCall(
            "edit",
            {
              kind: "plot_stage",
              id: "plot_design",
              replacements: [
                { original_text: "唯一片段", new_text: "子智能体自动允许" }
              ],
              summary: "子智能体跨阶段修改"
            },
            { id: "child-edit-plot" }
          ),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage(fauxText("子智能体修改提案已生成。"))
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    await tool.execute(
      "parent-auto-approve-call",
      {
        subagent_id: "continuity_checker",
        task: "跨阶段修改剧情"
      } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(progressFrom(updates)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "child_tool_details",
          toolName: "edit",
          result: expect.objectContaining({
            details: expect.objectContaining({
              kind: "workspace-editor-mutation",
              stageId: "plot_design",
              summary: "子智能体跨阶段修改"
            })
          })
        })
      ])
    );
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
        fauxAssistantMessage(
          [
            fauxThinking("先检查当前工作区。"),
            fauxToolCall(
              "echo_child_context",
              { text: "第一节" },
              { id: "child-tool" }
            )
          ],
          { stopReason: "toolUse" }
        ),
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
    const usageObserved = progress.filter(
      (
        item
      ): item is Extract<SubagentToolProgress, { type: "usage_observed" }> =>
        item.type === "usage_observed"
    );

    expect(contexts[0]?.messages).toHaveLength(1);
    expect(contexts[0]?.messages[0]).toMatchObject({
      role: "user",
      content: "检查第一节时间线"
    });
    expect(contexts[0]?.systemPrompt).toContain(enabledDefinition.systemPrompt);
    expect(contexts[0]?.systemPrompt).toContain("【本轮运行事实】");
    expect(contexts[0]?.systemPrompt).toContain("echo_child_context");
    expect(JSON.stringify(contexts[0])).not.toContain("你是短篇正文主智能体");
    expect(JSON.stringify(contexts[0])).not.toContain("雾港回声");
    expect(contexts[0]?.tools?.map((candidate) => candidate.name)).toEqual([
      "echo_child_context"
    ]);
    expect(
      contexts[0]?.tools?.some((candidate) => candidate.name === "load_skill")
    ).toBe(false);
    expect(
      contexts[0]?.tools?.some(
        (candidate) => candidate.name === "spawn_subagent"
      )
    ).toBe(false);
    expect(progress[0]).toMatchObject({
      type: "started",
      parentToolCallId: "parent-spawn-call",
      subagentRunId: "subrun-fixed-1"
    });
    expect(
      progress.some(
        (item) =>
          item.type === "activity" && item.activity.type === "thinking_delta"
      )
    ).toBe(true);
    expect(
      progress.some(
        (item) =>
          item.type === "activity" &&
          item.activity.type === "tool_requested" &&
          item.activity.toolCallId === "subrun-fixed-1:child-tool"
      )
    ).toBe(true);
    expect(progress.some((item) => item.type === "child_tool_details")).toBe(
      true
    );
    expect(usageObserved).toHaveLength(2);
    expect(
      usageObserved.map((item) => ({
        status: item.status,
        hadToolCall: item.hadToolCall,
        attempt: item.attempt
      }))
    ).toEqual([
      { status: "completed", hadToolCall: true, attempt: 1 },
      { status: "completed", hadToolCall: false, attempt: 1 }
    ]);
    expect(progress.at(-1)).toMatchObject({
      type: "completed",
      status: "completed",
      summary: "连续性检查完成：第一节时间线一致。"
    });
    const requestedIndex = progress.findIndex(
      (item) =>
        item.type === "activity" && item.activity.type === "tool_requested"
    );
    const completedToolIndex = progress.findIndex(
      (item) =>
        item.type === "activity" && item.activity.type === "tool_completed"
    );
    const detailsIndex = progress.findIndex(
      (item) => item.type === "child_tool_details"
    );
    expect(requestedIndex).toBeGreaterThan(0);
    expect(completedToolIndex).toBeGreaterThan(requestedIndex);
    expect(detailsIndex).toBeGreaterThan(completedToolIndex);
    expect(progress.length - 1).toBeGreaterThan(detailsIndex);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "连续性检查完成：第一节时间线一致。"
      }
    ]);
    expect(result.details).toEqual({ kind: "subagent-result" });
    expect(JSON.stringify(result)).not.toContain("先检查当前工作区");
    expect(JSON.stringify(result)).not.toContain("已检查：第一节");

    faux.setResponses([fauxAssistantMessage(fauxText("第二次独立检查完成。"))]);
    const secondResult = await tool.execute("parent-spawn-call-2", {
      subagent_id: "continuity_checker",
      task: "重新独立检查"
    } as never);
    expect(contexts.at(-1)?.messages).toHaveLength(1);
    expect(contexts.at(-1)?.messages[0]).toMatchObject({
      role: "user",
      content: "重新独立检查"
    });
    expect(JSON.stringify(contexts.at(-1)?.messages)).not.toContain(
      "第一节时间线一致"
    );
    expect(secondResult.content).toEqual([
      {
        type: "text",
        text: "第二次独立检查完成。"
      }
    ]);
  });

  it("retries only the failed model turn and never replays a completed child tool", async () => {
    let toolExecutions = 0;
    const countingTool = childTool();
    const originalExecute = countingTool.execute;
    countingTool.execute = async (...args) => {
      toolExecutions += 1;
      return originalExecute(...args);
    };
    const { tool, faux } = makeHarness({
      createRunId: () => "subrun-retry",
      buildChildTools: () => [countingTool],
      retryPolicy: {
        delaysMs: [0, 0, 0, 0, 0],
        random: () => 0.5
      },
      responses: [
        fauxAssistantMessage(
          fauxToolCall(
            "echo_child_context",
            { text: "只执行一次" },
            { id: "once" }
          ),
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("第一次残片", {
          stopReason: "error",
          errorMessage: "fetch failed: connection reset"
        }),
        fauxAssistantMessage("网络恢复后的最终交接。")
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-retry-call",
      {
        subagent_id: "continuity_checker",
        task: "验证子任务断线恢复"
      } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );
    const progress = progressFrom(updates);
    const retry = progress.find(
      (item) =>
        item.type === "activity" && item.activity.type === "retry_scheduled"
    );
    const usageObserved = progress.filter(
      (
        item
      ): item is Extract<SubagentToolProgress, { type: "usage_observed" }> =>
        item.type === "usage_observed"
    );

    expect(faux.state.callCount).toBe(3);
    expect(toolExecutions).toBe(1);
    expect(
      usageObserved.map((item) => ({
        status: item.status,
        hadToolCall: item.hadToolCall,
        turnId: item.turnId,
        attempt: item.attempt
      }))
    ).toEqual([
      {
        status: "completed",
        hadToolCall: true,
        turnId: "subrun-retry:turn:1",
        attempt: 1
      },
      {
        status: "error",
        hadToolCall: false,
        turnId: "subrun-retry:turn:2",
        attempt: 1
      },
      {
        status: "completed",
        hadToolCall: false,
        turnId: "subrun-retry:turn:2",
        attempt: 2
      }
    ]);
    expect(retry).toMatchObject({
      type: "activity",
      activity: {
        type: "retry_scheduled",
        failedAttempt: 1,
        nextAttempt: 2,
        maxAttempts: 6
      }
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "网络恢复后的最终交接。"
    });
    expect(progress.at(-1)).toMatchObject({
      type: "completed",
      status: "completed"
    });
  });

  it("propagates parent cancellation to the active child agent", async () => {
    const { tool } = makeHarness({
      tokensPerSecond: 100,
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
    expect(
      progressFrom(updates).find((event) => event.type === "completed")
    ).toMatchObject({
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
        fauxAssistantMessage(
          [
            fauxToolCall(
              "echo_child_context",
              { text: "权限检查" },
              { id: "hook-tool" }
            )
          ],
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage(fauxText("权限 hook 继承完成。"))
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    const result = await tool.execute("parent-hook-call", {
      subagent_id: "continuity_checker",
      task: "验证权限 hook"
    } as never);

    expect(beforeCalls).toBe(1);
    expect(afterCalls).toBe(1);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "权限 hook 继承完成。"
    });
  });

  it("returns failed tool calls to the child so it can resend them", async () => {
    let executions = 0;
    const parameters = Type.Object({ text: Type.String() });
    const flaky: AgentTool = {
      name: "flaky_submit",
      label: "提交",
      description: "测试提交工具。",
      parameters,
      execute: async () => {
        executions += 1;
        if (executions === 1) throw new Error("模拟保存失败。");
        return {
          content: [{ type: "text", text: "已保存" }],
          details: { kind: "none" }
        };
      }
    };
    const call = (args: JsonObject, id: string) =>
      fauxAssistantMessage([fauxToolCall("flaky_submit", args, { id })], {
        stopReason: "toolUse"
      });
    let lastContext: Context | undefined;
    const { tool } = makeHarness({
      buildChildTools: () => [flaky],
      onContext: (context) => (lastContext = context),
      responses: [
        call({}, "missing-field"),
        call({ text: "第一次" }, "save-fails"),
        call({ text: "第二次" }, "save-works"),
        fauxAssistantMessage(fauxText("重交后已保存。"))
      ]
    });
    if (!tool) throw new Error("spawn_subagent was not built");

    const result = await tool.execute("parent-retry-call", {
      subagent_id: "continuity_checker",
      task: "提交结果"
    } as never);

    expect(result.content[0]).toMatchObject({ text: "重交后已保存。" });
    expect(executions).toBe(2);
    const errors = lastContext!.messages.flatMap((message) =>
      message.role === "toolResult" && message.isError
        ? [JSON.stringify(message.content)]
        : []
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Validation failed");
    expect(errors[1]).toContain("模拟保存失败。");
  });

  it("enforces a wall-clock deadline even while the child keeps streaming", async () => {
    const { tool } = makeHarness({
      tokensPerSecond: 100,
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

    expect(
      progressFrom(updates).find((event) => event.type === "completed")
    ).toMatchObject({
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
      models: [
        { id: "custom-child-model", name: "Custom Child", reasoning: true }
      ],
      tokensPerSecond: 0
    });
    const customModels = createModels();
    customModels.setProvider(customFaux.provider);
    customFaux.setResponses([
      fauxAssistantMessage(fauxText("自定义模型交接完成。"))
    ]);
    const customModel = customFaux.getModel("custom-child-model") as Model<Api>;
    const customSourceStream = customModels.streamSimple.bind(
      customModels
    ) as StreamFn;
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
    const updates: AgentToolResult<SubagentToolDetails>[] = [];

    const result = await tool.execute(
      "parent-custom-model",
      { subagent_id: "continuity_checker", task: "用单独模型执行" } as never,
      undefined,
      (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
    );

    expect(seenModels[0]?.id).toBe("custom-child-model");
    expect(seenModels[0]?.id).not.toBe(parentModel.id);
    expect(
      progressFrom(updates).find((item) => item.type === "usage_observed")
    ).toMatchObject({
      runtime: {
        provider: "openai-compatible",
        model: "custom-child-model",
        mode: "provider",
        configId: "cfg-custom-1"
      }
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "自定义模型交接完成。"
    });
  });

  it("passes temperature into custom runtime when thinking is off", async () => {
    const customFaux = fauxProvider({
      api: `custom-temp-${Math.random()}`,
      provider: `custom-temp-${Math.random()}`,
      models: [
        { id: "custom-temp-model", name: "Custom Temp", reasoning: false }
      ],
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

    const result = await tool.execute("parent-temp-model", {
      subagent_id: "continuity_checker",
      task: "验证温度"
    } as never);

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
