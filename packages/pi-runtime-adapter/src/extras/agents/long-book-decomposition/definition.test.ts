import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  DECOMPOSITION_CHILD_QUERY_LIMIT,
  DecompositionResolvedInputSchema,
  type DecompositionSubmissionData,
  type DecompositionSubmitInput,
  type ExtrasAgentResolvedTaskOf
} from "@deepwrite/contracts";
import type { ExtrasAgentRunServices } from "../../definition";
import { toolNamed } from "../../extras.test-support";
import { assertProviderToolParameterSchema } from "../../../provider-tool-schema-compat";
import { longBookDecompositionAgent } from "./definition";
import { decompositionRoleDefinitions } from "./roles";
import { decompositionSubmissionTools } from "./submissions";
import { decompositionQueryTools } from "./tools";

const receipt = (input: DecompositionSubmitInput) => ({
  id: `receipt_${input.unitId.replaceAll(":", "_")}`,
  jobId: input.jobId,
  outputVersion: input.outputVersion,
  unitId: input.unitId,
  inputRevision: input.inputRevision,
  refs: [],
  savedAt: "2026-10-03T00:00:00.000Z"
});

function fixture(save: "fail" | "ok" = "fail") {
  const unit = (dependencies: string[] = []) => ({
    phase: "read",
    status: "running",
    attempts: 0,
    inputRevision: "revision_1",
    dependencies,
    updatedAt: "2026-10-02T00:00:00.000Z"
  });
  const task: ExtrasAgentResolvedTaskOf<"long-book-decomposition"> = {
    agentId: "long-book-decomposition",
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    input: DecompositionResolvedInputSchema.parse({
      jobId: "job_test",
      phase: "read",
      unitIds: ["chunk:1", "chunk:2"],
      outputVersion: 1,
      attemptId: "attempt_test",
      mode: "continuation",
      modelId: "model_test",
      thinkingLevel: "off",
      inputBudget: 16_000,
      contextWindow: 200_000,
      maxTokens: 32_000,
      units: {
        "chunk:1": unit(["reading:chapter_1", "reading:chapter_3"]),
        "chunk:2": unit(["reading:chapter_2"]),
        "reading:chapter_1": unit(),
        "reading:chapter_2": unit(),
        "reading:chapter_3": unit()
      }
    })
  };
  const submit = vi.fn(async (input: DecompositionSubmitInput) => {
    if (save === "fail" || input.unitId === "reading:chapter_3")
      throw new Error("测试保存失败。");
    return receipt(input);
  });
  const query = vi.fn(async () => ({
    content: "【阅读块 chunk:1】雨夜原文",
    nextCursor: null,
    totalCharacters: 12
  }));
  const services: ExtrasAgentRunServices = {
    runId: "run_test",
    sessionId: "session_test",
    localFaux: false,
    decompositionSubmit: submit,
    decompositionQuery: query
  };
  const prepare = longBookDecompositionAgent.orchestration!(
    task,
    services
  ).prepareChild;
  const roleDefinition = (id: string) =>
    decompositionRoleDefinitions().find((definition) => definition.id === id)!;
  const prepareRole = (role: string, description: string) =>
    prepare(roleDefinition(role), undefined, undefined, {
      index: 0,
      key: "t1",
      definition: roleDefinition(role),
      task: description,
      dependsOn: []
    });
  const prepareReader = (description: string) =>
    prepareRole("reader", description);
  return { task, submit, query, services, prepareRole, prepareReader };
}

const reading = (
  chapterId: string,
  order: number
): DecompositionSubmissionData => ({
  kind: "reading",
  card: {
    chunkId: "chunk:1",
    chapters: [
      {
        chapterId,
        order,
        title: `第${order}章`,
        summary: "雨夜发现铜铃。",
        events: [],
        characters: []
      }
    ],
    characters: [],
    world: [],
    plot: { events: [], foreshadowing: [] },
    style: { notes: [], excerpts: [] }
  }
});

/** The path a model's call takes in PI: repair, whole-call check, execute. */
function callAsModel(tool: AgentTool, args: Record<string, unknown>) {
  return tool.execute(
    "write",
    validateToolArguments(tool, {
      type: "toolCall",
      id: "write",
      name: tool.name,
      arguments: (tool.prepareArguments?.(args) ?? args) as JsonObject
    })
  );
}

function worldTask(category: string) {
  const setup = fixture();
  const { task } = setup;
  task.input.phase = "integrate";
  task.input.unitIds = [`world:${category}`];
  task.input.units = {
    [`world:${category}`]: {
      ...task.input.units["chunk:2"]!,
      phase: "integrate",
      dependencies: []
    }
  };
  return setup;
}

describe("decomposition child execution boundaries", () => {
  it("runs a package with the task's concurrency, five when unset", () => {
    const { task, services } = fixture();
    const limit = (input: typeof task.input) =>
      longBookDecompositionAgent.orchestration!({ ...task, input }, services)
        .maxConcurrency;
    expect(limit(task.input)).toBe(5);
    expect(limit({ ...task.input, maxConcurrency: 2 })).toBe(2);
  });
  it("defaults a single-unit status query to its current package", async () => {
    const { task, query, services } = fixture();
    task.input.unitIds = ["chunk:1"];
    await toolNamed(
      decompositionQueryTools(task, services),
      "get_decomposition_status"
    ).execute("query", {});
    expect(query).toHaveBeenCalledWith("job_test", {
      kind: "status",
      unitId: "chunk:1"
    });
  });

  it("exposes every role's batch schema through the real provider boundary", () => {
    const { task } = fixture();
    for (const definition of decompositionRoleDefinitions())
      for (const tool of decompositionSubmissionTools(
        task,
        { runId: "run_test", sessionId: "session_test" },
        definition.id as Parameters<typeof decompositionSubmissionTools>[2]
      ))
        expect(() =>
          assertProviderToolParameterSchema(tool.name, tool.parameters)
        ).not.toThrow();
  });

  it("gives every child of a role the same prompt and tools", async () => {
    const tools = (category: string) => {
      const { task, services } = worldTask(category);
      return [
        ...decompositionQueryTools(task, services, "world_archivist"),
        ...decompositionSubmissionTools(task, services, "world_archivist")
      ].map(({ name, description, parameters }) =>
        JSON.stringify({ name, description, parameters })
      );
    };
    expect(tools("items")).toEqual(tools("geography"));
    const first = await fixture().prepareReader("通读 chunk:1");
    const second = await fixture().prepareReader("通读 chunk:2");
    expect(first.systemPrompt).toBe(second.systemPrompt);
    expect(first.systemPrompt).not.toMatch(/chunk:\d/u);
  });

  it("rejects invented unit identifiers when the batch executes", async () => {
    const { task, services, submit } = worldTask("items");
    const writer = toolNamed(
      decompositionSubmissionTools(task, services, "world_archivist"),
      "write_world_category"
    );
    await expect(
      writer.execute("write", {
        items: [
          {
            unitId: "world:geography",
            data: {
              kind: "asset",
              asset: {
                kind: "world",
                categoryId: "geography",
                overview: "地理。",
                items: []
              }
            }
          }
        ]
      })
    ).rejects.toThrow(
      "world:geography：未保存（提交单元不在本工作包授权范围内。）"
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("hands the child its evidence pack and a proportional context budget", async () => {
    const { prepareReader, query } = fixture();
    const child = await prepareReader("通读 chunk:1");
    expect(query).toHaveBeenCalledWith("job_test", {
      kind: "brief",
      unitIds: ["chunk:1"]
    });
    expect(child.task).toContain("雨夜原文");
    expect(child.task).toContain("【主控任务说明】\n通读 chunk:1");
    expect(child.contextPolicy).toMatchObject({
      settings: { enabled: true, budgetTokens: 160_000 },
      thresholdCompaction: false,
      inPlaceSummary: true
    });
    expect(child.tools.map(({ name }) => name)).toEqual([
      "submit_chapter_reading"
    ]);
  });

  it("saves a reader's chapters in one call and closes the block", async () => {
    const { task, prepareReader, submit } = fixture("ok");
    task.input.units["chunk:1"]!.dependencies = ["reading:chapter_1"];
    const child = await prepareReader("通读 chunk:1");
    const result = await toolNamed(
      child.tools,
      "submit_chapter_reading"
    ).execute("write", {
      items: [{ unitId: "reading:chapter_1", data: reading("chapter_1", 1) }]
    });
    expect(submit.mock.calls.map(([input]) => input.unitId)).toEqual([
      "reading:chapter_1",
      "chunk:1"
    ]);
    expect(JSON.stringify(result.content)).toContain("阅读块已完成");
  });

  it("reports failed items of a batch while keeping the saved ones", async () => {
    const { prepareReader, submit } = fixture("ok");
    const child = await prepareReader("通读 chunk:1");
    const result = await toolNamed(
      child.tools,
      "submit_chapter_reading"
    ).execute("write", {
      items: [
        { unitId: "reading:chapter_1", data: reading("chapter_1", 1) },
        { unitId: "reading:chapter_3", data: reading("chapter_3", 3) }
      ]
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain("reading:chapter_1：已保存");
    expect(text).toContain("reading:chapter_3：未保存（测试保存失败。）");
    expect(text).toContain("仍未保存：reading:chapter_3");
    expect(submit.mock.calls.map(([input]) => input.unitId)).not.toContain(
      "chunk:1"
    );
  });

  it("keeps a batch's valid chapters when another breaks a schema limit", async () => {
    const { prepareReader, submit } = fixture("ok");
    const child = await prepareReader("通读 chunk:1");
    const tool = toolNamed(child.tools, "submit_chapter_reading");
    const over = reading("chapter_3", 3);
    if (over.kind !== "reading") throw new Error("reading data");
    over.card.chapters[0]!.events = Array.from(
      { length: 9 },
      (_, index) => `第${index + 1}件私密事件`
    );
    // The path PI really takes: whole-call validation, then execute.
    const args = validateToolArguments(tool, {
      type: "toolCall",
      id: "write",
      name: tool.name,
      arguments: JSON.parse(
        JSON.stringify({
          items: [
            { unitId: "reading:chapter_1", data: reading("chapter_1", 1) },
            { unitId: "reading:chapter_3", data: over }
          ]
        })
      ) as JsonObject
    });
    const text = JSON.stringify((await tool.execute("write", args)).content);
    expect(text).toContain("reading:chapter_1：已保存");
    expect(text).toContain(
      "reading:chapter_3：未保存（格式校验失败：card.chapters.0.events：当前 9 项，上限 8）"
    );
    expect(text).not.toContain("私密事件");
    expect(submit.mock.calls.map(([input]) => input.unitId)).toEqual([
      "reading:chapter_1"
    ]);
    // Limits still reach the model, as field descriptions.
    expect(JSON.stringify(tool.parameters)).toContain("最多 8 项");
    expect(JSON.stringify(tool.parameters)).not.toContain('"maxItems":8');
  });

  it("accepts a first submission that leaves out fixed kinds and empty sections", async () => {
    const { prepareReader, submit } = fixture("ok");
    const reader = toolNamed(
      (await prepareReader("通读 chunk:1")).tools,
      "submit_chapter_reading"
    );
    const card = (chapterId: string, order: number) => ({
      chunkId: "chunk:1",
      chapters: [
        {
          chapterId,
          order,
          title: `第${order}章`,
          summary: "雨夜发现铜铃。",
          events: []
        }
      ],
      characters: [],
      world: []
    });
    // What a real model sent: `kind` beside `unitId`; plot, style and the
    // chapter's characters left out because they had nothing in them.
    await callAsModel(reader, {
      items: [
        {
          unitId: "reading:chapter_1",
          kind: "reading",
          data: { card: card("chapter_1", 1) }
        }
      ]
    });
    expect(JSON.stringify(reader.parameters)).not.toContain('"reading"');
    expect(submit.mock.calls[0]![0].data).toMatchObject({
      kind: "reading",
      card: {
        chapters: [{ characters: [] }],
        plot: { events: [], foreshadowing: [] },
        style: { notes: [], excerpts: [] }
      }
    });
    // Items sent as JSON text, with the card beside `unitId`, are repaired.
    // The fixture's save fails here; reaching it means the call was accepted.
    await expect(
      callAsModel(reader, {
        items: JSON.stringify([
          { unitId: "reading:chapter_3", card: card("chapter_3", 3) }
        ])
      })
    ).rejects.toThrow("reading:chapter_3：未保存（测试保存失败。）");
    expect(submit.mock.calls[1]![0].unitId).toBe("reading:chapter_3");
    // Encoded twice, a "\n" in the summary arrives as a raw line break.
    const plain = card("chapter_3", 3);
    const withFacts = {
      ...plain,
      chapters: [{ ...plain.chapters[0]!, summary: "雨夜\n发现铜铃。" }],
      characters: [
        { name: "沈砚", facts: [{ text: "沈砚拾到铜铃。", chapterOrder: 3 }] }
      ]
    };
    await expect(
      callAsModel(reader, {
        items: JSON.stringify(
          JSON.stringify([
            { unitId: "reading:chapter_3", data: { card: withFacts } }
          ])
        ).replace("\\\\n", "\\n")
      })
    ).rejects.toThrow("reading:chapter_3：未保存（测试保存失败。）");
    expect(submit.mock.calls[2]![0].data).toMatchObject({
      card: {
        chapters: [{ summary: "雨夜\n发现铜铃。" }],
        characters: [{ name: "沈砚" }]
      }
    });
    // Text that still does not parse gets a short reason, not `items.0` and
    // an echo of every argument.
    const broken = `[{"unitId":"reading:chapter_3","data":{"card":{"world":[{"name":"他称之为"血玄功""}]}}}]`;
    expect(() => callAsModel(reader, { items: broken })).toThrow(
      /^items 被写成了文本，且无法解析为 JSON（第 \d+ 个字符附近）/u
    );
    expect(() =>
      callAsModel(reader, {
        items: [{ unitId: "reading:chapter_3", data: broken }]
      })
    ).toThrow(/^items\.0\.data 被写成了文本/u);

    const world = worldTask("items");
    const writer = toolNamed(
      decompositionSubmissionTools(
        world.task,
        world.services,
        "world_archivist"
      ),
      "write_world_category"
    );
    // The fixture's save fails; reaching it means the kinds were accepted.
    await expect(
      writer.execute("write", {
        items: [
          {
            unitId: "world:items",
            data: {
              kind: "reading",
              asset: { categoryId: "items", overview: "器物。", items: [] }
            }
          }
        ]
      })
    ).rejects.toThrow("world:items：未保存（测试保存失败。）");
    expect(world.submit.mock.calls[0]![0].data).toMatchObject({
      kind: "asset",
      asset: { kind: "world", categoryId: "items" }
    });
  });

  it("keeps returning failed submissions to the model instead of ending the child", async () => {
    const { prepareReader, submit } = fixture("fail");
    const child = await prepareReader("通读 chunk:1");
    const tool = toolNamed(child.tools, "submit_chapter_reading");
    const call = () =>
      callAsModel(tool, {
        items: [{ unitId: "reading:chapter_1", data: reading("chapter_1", 1) }]
      });
    for (let index = 0; index < 3; index++)
      await expect(call()).rejects.toThrow(
        /^reading:chapter_1：未保存（测试保存失败。）\n仍未保存：reading:chapter_1、reading:chapter_3$/u
      );
    // A long streak advises the model what to do; the tool still accepts calls.
    for (let index = 0; index < 2; index++)
      await expect(call()).rejects.toThrow(
        "停止提交，在最终回复中列出未保存单元"
      );
    expect(submit).toHaveBeenCalledTimes(5);
  });

  it("closes a block whose chapters were already saved while preparing", async () => {
    const { task, prepareReader, submit } = fixture("ok");
    task.input.units["reading:chapter_2"]!.status = "done";
    await prepareReader("通读 chunk:2");
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: "chunk:2",
        data: { kind: "finish-card" }
      })
    );
  });

  it("caps a child's follow-up lookups", async () => {
    const { task, services, query } = worldTask("items");
    const lookup = toolNamed(
      decompositionQueryTools(task, services, "world_archivist"),
      "search_source"
    );
    for (let index = 0; index < DECOMPOSITION_CHILD_QUERY_LIMIT; index++)
      await lookup.execute("query", { query: "铜铃" });
    await expect(lookup.execute("query", { query: "铜铃" })).rejects.toThrow(
      "补充查询次数已用完"
    );
    expect(query).toHaveBeenCalledTimes(DECOMPOSITION_CHILD_QUERY_LIMIT);
  });

  it("rejects unknown, incomplete and multiple reading block assignments", async () => {
    const { prepareReader } = fixture();
    for (const description of [
      "完成 chunk:3",
      "完成 chunk:10",
      "完成 chunk:1-extra"
    ])
      await expect(prepareReader(description)).rejects.toThrow("本包的单元 id");
    await expect(prepareReader("完成 chunk:1、chunk:2")).rejects.toThrow(
      "只能处理一个阅读块"
    );
  });

  it("tells the coordinator what to dispatch instead", async () => {
    const { prepareReader, prepareRole } = fixture();
    await expect(prepareReader("通读 reading:chapter_1")).rejects.toThrow(
      "可分派的 reader 单元：chunk:1、chunk:2；reading:… 是阅读块的章节检查点"
    );
    await expect(prepareRole("registrar", "完成 chunk:1")).rejects.toThrow(
      "chunk:1 属于 reader，subagent_id 应为该角色"
    );
  });

  it("permits one redispatch per unit without consuming other units' attempts", async () => {
    const { prepareReader } = fixture();
    await prepareReader("完成 chunk:1");
    await prepareReader("重试 chunk:1");
    await expect(prepareReader("再次重试 chunk:1")).rejects.toThrow(
      "最多分派两次"
    );
    await expect(prepareReader("完成 chunk:2")).resolves.toBeDefined();
  });

  it("keeps package data out of the coordinator's system prompt", () => {
    const { task } = fixture();
    const message = longBookDecompositionAgent.userMessage(task);
    const plan = JSON.parse(message.split("\n")[0]!.slice("工作包：".length));
    // Chapter checkpoints are not shown as units the coordinator could dispatch.
    expect(plan.units["chunk:1"]).toEqual({ role: "reader", chapterCount: 2 });
    expect(message).not.toContain("reading:");
    expect(message).not.toContain("雨夜发现铜铃");
    expect(longBookDecompositionAgent.boundary(task).join("\n")).not.toContain(
      "chunk:1"
    );
  });
});
