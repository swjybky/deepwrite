import type {
  AgentTool,
  AgentToolResult,
  StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  validateToolArguments,
  type Api,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { SUBAGENT_TASK_BATCH_MAX_COUNT } from "@deepwrite/contracts";
import {
  buildSpawnSubagentTool,
  isSubagentToolProgressDetails,
  type RuntimeSubagentDefinition,
  type SubagentToolDetails,
  type SubagentToolProgress
} from "./subagent-runtime";

const writer: RuntimeSubagentDefinition = {
  id: "chapter_writer",
  name: "单章写手",
  description: "写一章正文。",
  systemPrompt: "只写指定章节。",
  enabled: true,
  modelMode: "inherit"
};
const reviewer: RuntimeSubagentDefinition = {
  ...writer,
  id: "reviewer",
  name: "审阅员",
  description: "审阅正文。"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(options: {
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];
  parallel: boolean;
  maxConcurrency?: number;
  definitions?: RuntimeSubagentDefinition[];
  streamGate?: number;
  childTools?: () => AgentTool[];
  onContext?: (context: Context) => void;
}) {
  const faux = fauxProvider({
    api: `subagent-parallel-${Math.random()}`,
    provider: `subagent-parallel-${Math.random()}`,
    models: [{ id: "child-model", name: "Child Model", reasoning: true }],
    tokensPerSecond: 0
  });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(options.responses);
  const model = faux.getModel("child-model") as Model<Api>;
  const source = models.streamSimple.bind(models) as StreamFn;
  let arrivals = 0;
  const gate = deferred<void>();
  const streamFn: StreamFn = async (requestModel, context, streamOptions) => {
    arrivals += 1;
    options.onContext?.(context);
    if (arrivals >= (options.streamGate ?? 1)) gate.resolve();
    await gate.promise;
    return source(requestModel, context, streamOptions);
  };
  let sequence = 0;
  const tool = buildSpawnSubagentTool({
    parentSessionId: "parent-session",
    model,
    thinkingLevel: "medium",
    streamFn,
    definitions: options.definitions ?? [writer, reviewer],
    buildChildTools: options.childTools ?? (() => []),
    createRunId: () => `subrun_${++sequence}`,
    parallel: options.parallel,
    ...(options.maxConcurrency
      ? { maxConcurrency: options.maxConcurrency }
      : {})
  });
  if (!tool) throw new Error("spawn_subagent was not built");
  return tool;
}

type ChildProgress = Exclude<SubagentToolProgress, { type: "planned" }>;

function progressOf(
  updates: AgentToolResult<SubagentToolDetails>[]
): SubagentToolProgress[] {
  return updates.flatMap((update) =>
    isSubagentToolProgressDetails(update.details)
      ? [update.details.progress]
      : []
  );
}

function childProgressOf(
  updates: AgentToolResult<SubagentToolDetails>[]
): ChildProgress[] {
  return progressOf(updates).filter(
    (item): item is ChildProgress => item.type !== "planned"
  );
}

describe("spawn_subagent task lists", () => {
  it("runs independent tasks of a parallel team at the same time", async () => {
    // Both children must reach the model before either may stream.
    const tool = harness({
      parallel: true,
      streamGate: 2,
      responses: [
        fauxAssistantMessage("第三章完成"),
        fauxAssistantMessage("第四章完成")
      ]
    });
    const updates: AgentToolResult<SubagentToolDetails>[] = [];
    const result = await tool.execute(
      "parent-call",
      {
        tasks: [
          { key: "c3", subagent_id: "chapter_writer", task: "写第三章" },
          { key: "c4", subagent_id: "chapter_writer", task: "写第四章" }
        ]
      },
      undefined,
      (update) => updates.push(update)
    );
    const [planned] = progressOf(updates);
    expect(planned).toMatchObject({
      type: "planned",
      parentToolCallId: "parent-call",
      tasks: [
        { index: 0, key: "c3", name: "单章写手", dependsOn: [] },
        { index: 1, key: "c4", name: "单章写手", dependsOn: [] }
      ]
    });
    const progress = childProgressOf(updates);
    const lifecycle = progress
      .filter((item) => item.type === "started" || item.type === "completed")
      .map((item) => `${item.type}:${item.batchTask?.key}`);
    expect(lifecycle.slice(0, 2).sort()).toEqual(["started:c3", "started:c4"]);
    expect(
      progress.find((item) => item.type === "started")?.batchTask
    ).toMatchObject({ index: expect.any(Number), dependsOn: [] });
    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("共 2 个，完成 2 个");
    expect(text).toContain("【c3｜单章写手｜已完成】");
    expect(text).toContain("【c4｜单章写手｜已完成】");
  });

  it("runs no more children at once than the configured limit", async () => {
    const tool = harness({
      parallel: true,
      maxConcurrency: 1,
      responses: [
        fauxAssistantMessage("第三章完成"),
        fauxAssistantMessage("第四章完成")
      ]
    });
    expect(tool.description).toContain("最多 1 个");
    const updates: AgentToolResult<SubagentToolDetails>[] = [];
    await tool.execute(
      "parent-call",
      {
        tasks: [
          { key: "c3", subagent_id: "chapter_writer", task: "写第三章" },
          { key: "c4", subagent_id: "chapter_writer", task: "写第四章" }
        ]
      },
      undefined,
      (update) => updates.push(update)
    );
    expect(
      childProgressOf(updates)
        .filter((item) => item.type === "started" || item.type === "completed")
        .map((item) => `${item.type}:${item.batchTask?.key}`)
    ).toEqual(["started:c3", "completed:c3", "started:c4", "completed:c4"]);
  });

  it("reports a skipped dependent without starting it", async () => {
    const broken: RuntimeSubagentDefinition = {
      ...writer,
      id: "broken_writer",
      name: "缺模型写手",
      modelMode: "custom",
      modelId: "missing-model"
    };
    const tool = harness({
      parallel: false,
      definitions: [broken, reviewer],
      responses: []
    });
    const updates: AgentToolResult<SubagentToolDetails>[] = [];
    const result = await tool.execute(
      "parent-call",
      {
        tasks: [
          { key: "draft", subagent_id: "broken_writer", task: "写" },
          {
            key: "review",
            subagent_id: "reviewer",
            task: "审阅",
            depends_on: ["draft"]
          }
        ]
      },
      undefined,
      (update) => updates.push(update)
    );
    expect(progressOf(updates)[0]).toMatchObject({
      type: "planned",
      tasks: [
        { key: "draft", name: "缺模型写手" },
        { key: "review", name: "审阅员", dependsOn: ["draft"] }
      ]
    });
    const review = childProgressOf(updates).filter(
      (item) => item.batchTask?.key === "review"
    );
    expect(review.map((item) => item.type)).toEqual(["completed"]);
    expect(review[0]).toMatchObject({ status: "skipped" });
    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("失败 1 个");
    expect(text).toContain("跳过 1 个");
  });

  it("keeps the single-task result and accepts older flat arguments", async () => {
    const tool = harness({
      parallel: false,
      responses: [fauxAssistantMessage("只有一个交接摘要")]
    });
    expect(
      tool.prepareArguments?.({ subagent_id: "reviewer", task: "审阅" })
    ).toEqual({ tasks: [{ subagent_id: "reviewer", task: "审阅" }] });
    const updates: AgentToolResult<SubagentToolDetails>[] = [];
    const result = await tool.execute(
      "parent-call",
      { tasks: [{ subagent_id: "reviewer", task: "审阅" }] },
      undefined,
      (update) => updates.push(update)
    );
    expect(result.content[0]).toEqual({
      type: "text",
      text: "只有一个交接摘要"
    });
    expect(progressOf(updates).some((item) => item.type === "planned")).toBe(
      false
    );
    expect(childProgressOf(updates).every((item) => !item.batchTask)).toBe(
      true
    );
  });

  it("does not reject a large task list at schema validation", async () => {
    const count = SUBAGENT_TASK_BATCH_MAX_COUNT;
    const tool = harness({
      parallel: true,
      responses: Array.from({ length: count + 1 }, () =>
        fauxAssistantMessage("审阅完成")
      )
    });
    const taskList = (size: number) =>
      Array.from({ length: size }, (_, index) => ({
        key: `d${index + 1}`,
        subagent_id: "reviewer",
        task: `审阅第 ${index + 1} 章`
      }));
    const validate = (size: number) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "parent-call",
        name: tool.name,
        arguments: { tasks: taskList(size) }
      });
    // One more than the old schema cap of 20 must pass validation and run.
    expect(() => validate(21)).not.toThrow();
    expect(() => validate(count + 1)).not.toThrow();

    const result = await tool.execute("parent-call", {
      tasks: taskList(21)
    });
    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("共 21 个，完成 21 个");

    // Beyond the ceiling the call is refused with a message the model can act
    // on, rather than a schema failure.
    await expect(
      tool.execute("parent-call", { tasks: taskList(count + 1) })
    ).rejects.toThrow(`本次提交了 ${count + 1} 个，未执行任何任务`);
  });

  it("has no write_scope parameter and ignores it in older calls", () => {
    for (const parallel of [true, false]) {
      const tool = harness({ parallel, responses: [] });
      expect(JSON.stringify(tool.parameters)).not.toContain("write_scope");
      expect(
        tool.prepareArguments?.({
          tasks: [
            {
              subagent_id: "chapter_writer",
              task: "写",
              write_scope: ["chapter_3"],
              depends_on: ["a"]
            }
          ]
        })
      ).toEqual({
        tasks: [
          { subagent_id: "chapter_writer", task: "写", depends_on: ["a"] }
        ]
      });
    }
    // Ordering guidance is for the parent of a parallel team only.
    expect(harness({ parallel: true, responses: [] }).description).toContain(
      "用 depends_on 排在它后面"
    );
    expect(
      harness({ parallel: false, responses: [] }).description
    ).not.toContain("不要让并行任务修改同一对象");
  });
});

describe("writes of parallel children", () => {
  /** First `edit` is accepted, the next one finds the object already changed. */
  function conflictingEdit() {
    const state = { active: 0, peak: 0, calls: 0 };
    const tool: AgentTool = {
      name: "edit",
      label: "edit",
      description: "edit",
      parameters: Type.Object({ id: Type.String() }),
      execute: async () => {
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        state.calls += 1;
        const first = state.calls === 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.active -= 1;
        return {
          content: [
            { type: "text", text: first ? "已形成提案" : "未修改：请先读取" }
          ],
          details: { kind: first ? "workspace-mutation" : "none" }
        };
      }
    };
    return { state, tool };
  }

  const editThenFinish = () =>
    Array.from(
      { length: 4 },
      () => (context: Context) =>
        context.messages.some((message) => message.role === "toolResult")
          ? fauxAssistantMessage("完成")
          : fauxAssistantMessage(fauxToolCall("edit", { id: "chapter_3" }), {
              stopReason: "toolUse"
            })
    );

  async function runTwoWriters(parallel: boolean) {
    const { state, tool: edit } = conflictingEdit();
    const contexts: Context[] = [];
    const tool = harness({
      parallel,
      streamGate: parallel ? 2 : 1,
      responses: editThenFinish(),
      childTools: () => [edit],
      onContext: (context) => contexts.push(context)
    });
    await tool.execute("parent-call", {
      tasks: [
        { key: "a", subagent_id: "chapter_writer", task: "改第三章" },
        { key: "b", subagent_id: "chapter_writer", task: "也改第三章" }
      ]
    });
    return { state, contexts: JSON.stringify(contexts) };
  }

  it("runs them one at a time and tells the later child who changed the object", async () => {
    const { state, contexts } = await runTwoWriters(true);
    expect(state.calls).toBe(2);
    expect(state.peak).toBe(1);
    expect(contexts).toContain("与其他子智能体并行运行");
    expect(contexts).toContain("chapter_3 刚被并行子任务 「单章写手」（");
  });

  it("adds no parallel behavior to a serial team", async () => {
    const { state, contexts } = await runTwoWriters(false);
    expect(state.calls).toBe(2);
    expect(contexts).not.toContain("与其他子智能体并行运行");
    expect(contexts).not.toContain("刚被并行子任务");
  });
});
