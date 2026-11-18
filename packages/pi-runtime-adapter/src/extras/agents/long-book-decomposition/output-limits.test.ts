import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  DecompositionResolvedInputSchema,
  type DecompositionSubmitInput,
  type ExtrasAgentResolvedTaskOf
} from "@deepwrite/contracts";
import { toolNamed } from "../../extras.test-support";
import { longBookDecompositionAgent } from "./definition";
import {
  DECOMPOSITION_ROLES,
  decompositionRoleDefinitions,
  type DecompositionRole
} from "./roles";
import { decompositionSubmissionTools } from "./submissions";

function setup(
  unitIds: string[],
  model: { maxTokens: number; thinkingLevel: string } = {
    maxTokens: 32_000,
    thinkingLevel: "off"
  }
) {
  const task: ExtrasAgentResolvedTaskOf<"long-book-decomposition"> = {
    agentId: "long-book-decomposition",
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    input: DecompositionResolvedInputSchema.parse({
      jobId: "job_test",
      phase: unitIds[0]!.startsWith("registry") ? "registry" : "integrate",
      unitIds,
      outputVersion: 1,
      attemptId: "attempt_test",
      mode: "materials",
      modelId: "model_test",
      inputBudget: 16_000,
      contextWindow: 200_000,
      ...model,
      units: Object.fromEntries(
        unitIds.map((id) => [
          id,
          {
            phase: "integrate",
            status: "running",
            attempts: 0,
            inputRevision: "revision_1",
            dependencies: [],
            updatedAt: "2026-10-05T00:00:00.000Z"
          }
        ])
      )
    })
  };
  const submit = vi.fn(async (input: DecompositionSubmitInput) => ({
    id: "receipt_test",
    jobId: input.jobId,
    outputVersion: input.outputVersion,
    unitId: input.unitId,
    inputRevision: input.inputRevision,
    refs: [],
    savedAt: "2026-10-05T00:00:00.000Z",
    ...(input.data.kind === "asset-part" ? { staged: 2 } : {})
  }));
  const services = {
    runId: "run_test",
    sessionId: "session_test",
    decompositionSubmit: submit,
    decompositionQuery: vi.fn(async () => ({
      content: "【材料】",
      nextCursor: null,
      totalCharacters: 4
    }))
  };
  return { task, submit, services };
}

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

describe("decomposition output limits", () => {
  it("stages a partial batch and finishes the unit with the final one", async () => {
    const { task, services, submit } = setup(["world:items"]);
    const writer = toolNamed(
      decompositionSubmissionTools(task, services, "world_archivist"),
      "write_world_category"
    );
    const item = (title: string) => ({ title, content: `${title}的来历。` });
    const finalBatch = {
      unitId: "world:items",
      data: {
        asset: {
          categoryId: "items",
          overview: "器物。",
          items: [item("铁甲")]
        }
      }
    };
    for (const batchMode of [true, null]) {
      expect(() =>
        callAsModel(writer, {
          items: [{ ...finalBatch, batch_mode: batchMode }]
        })
      ).toThrow("items.0.batch_mode");
    }
    await expect(
      callAsModel(writer, { items: [{ ...finalBatch, more: true }] })
    ).rejects.toThrow("batch_mode=partial");
    expect(submit).not.toHaveBeenCalled();
    expect(task.input.units["world:items"]!.status).toBe("running");
    const staged = await callAsModel(writer, {
      items: [
        {
          unitId: "world:items",
          data: {
            asset: { categoryId: "items", items: [item("铜铃"), item("木剑")] }
          },
          batch_mode: "partial"
        }
      ]
    });
    expect(JSON.stringify(staged.content)).toContain("本批已暂存（累计 2 条）");
    expect(submit.mock.calls[0]![0].data).toEqual({
      kind: "asset-part",
      asset: {
        kind: "world",
        categoryId: "items",
        items: [item("铜铃"), item("木剑")]
      }
    });
    expect(task.input.units["world:items"]!.status).toBe("running");
    await callAsModel(writer, {
      items: [{ ...finalBatch, batch_mode: "final" }]
    });
    expect(submit.mock.calls[1]![0].data).toMatchObject({
      kind: "asset",
      asset: { kind: "world", overview: "器物。", items: [item("铁甲")] }
    });
    expect(task.input.units["world:items"]!.status).toBe("done");
  });

  it("uses evidence_kind in reading calls and preserves stored evidence flags", async () => {
    const { task, services, submit } = setup(["reading:chapter_1"]);
    const tools = (
      Object.keys(DECOMPOSITION_ROLES) as DecompositionRole[]
    ).flatMap((id) => decompositionSubmissionTools(task, services, id));
    expect(
      tools
        .filter((tool) =>
          JSON.stringify(tool.parameters).includes('"type":"boolean"')
        )
        .map((tool) => tool.name)
    ).toEqual([]);
    const reader = toolNamed(tools, "submit_chapter_reading");
    const run = (facts: Record<string, unknown>[]) =>
      callAsModel(reader, {
        items: [
          {
            unitId: "reading:chapter_1",
            data: {
              card: {
                chunkId: "chunk_1",
                chapters: [
                  {
                    chapterId: "chapter_1",
                    order: 1,
                    title: "雨夜",
                    summary: "夜访旧宅。"
                  }
                ],
                characters: [
                  {
                    name: "来访者",
                    facts: facts.map((fact) => ({ chapterOrder: 1, ...fact }))
                  }
                ]
              }
            }
          }
        ]
      });
    expect(() => run([{ text: "原文", evidence_kind: true }])).toThrow(
      "evidence_kind"
    );
    await expect(run([{ text: "原文", inferred: true }])).rejects.toThrow(
      "evidence_kind"
    );
    expect(submit).not.toHaveBeenCalled();
    await run([
      { text: "他进了旧宅。", evidence_kind: "stated" },
      { text: "他可能在等人。", evidence_kind: "inferred" },
      { text: "天在下雨。" }
    ]);
    expect(submit.mock.calls[0]![0].data).toMatchObject({
      kind: "reading",
      card: {
        characters: [
          {
            facts: [
              { chapterOrder: 1, text: "他进了旧宅。", inferred: false },
              { chapterOrder: 1, text: "他可能在等人。", inferred: true },
              { chapterOrder: 1, text: "天在下雨。" }
            ]
          }
        ]
      }
    });
  });

  it("explains invalid chronicle fields, stages the points, then finishes with only a summary", async () => {
    const { task, services, submit } = setup(["chronicle:1"]);
    const writer = toolNamed(
      decompositionSubmissionTools(task, services, "chronicler"),
      "write_chronicle"
    );
    const item = {
      unitId: "chronicle:1",
      data: {
        asset: {
          points: [
            {
              title: "夜访",
              summary: "主角夜访旧宅。",
              startOrder: 1,
              endOrder: 2
            }
          ]
        }
      }
    };
    await expect(callAsModel(writer, { items: [item] })).rejects.toThrow(
      "格式校验失败：asset.summary：缺少必填字段，应填写字符串"
    );
    expect(submit).not.toHaveBeenCalled();
    await expect(callAsModel(writer, { items: [item] })).rejects.toThrow(
      "将 batch_mode=partial 放在 unitId、data 同级"
    );
    const staged = await callAsModel(writer, {
      items: [{ ...item, batch_mode: "partial" }]
    });
    expect(JSON.stringify(staged.content)).toContain("summary");
    expect(JSON.stringify(staged.content)).toContain("不要重交已暂存的剧情点");
    expect(task.input.units["chronicle:1"]!.status).toBe("running");
    await callAsModel(writer, {
      items: [
        {
          unitId: "chronicle:1",
          data: { asset: { summary: "旧宅夜访引出失踪案。" } }
        }
      ]
    });
    expect(submit.mock.calls.map(([input]) => input.data.kind)).toEqual([
      "asset-part",
      "asset"
    ]);
    expect(submit.mock.calls[1]![0].data).toEqual({
      kind: "asset",
      asset: { kind: "chronicle", summary: "旧宅夜访引出失踪案。", points: [] }
    });
    expect(task.input.units["chronicle:1"]!.status).toBe("done");
  });

  it("does not report an invalid chronicle as saved or discard another valid unit", async () => {
    const { task, services, submit } = setup(["chronicle:1", "chronicle:2"]);
    const writer = toolNamed(
      decompositionSubmissionTools(task, services, "chronicler"),
      "write_chronicle"
    );
    const result = await callAsModel(writer, {
      items: [
        { unitId: "chronicle:1", data: { asset: { summary: "完整编年。" } } },
        {
          unitId: "chronicle:2",
          data: {
            asset: {
              summary: "另一段编年。",
              points: [
                {
                  title: "私密条目".repeat(31),
                  summary: "剧情概述。",
                  startOrder: 1,
                  endOrder: 2
                }
              ]
            }
          }
        }
      ]
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain("chronicle:1：已保存");
    expect(text).toContain(
      "chronicle:2：未保存（格式校验失败：asset.points.0.title：当前 124 字，上限 120"
    );
    expect(text).not.toContain("私密条目");
    expect(submit.mock.calls.map(([input]) => input.unitId)).toEqual([
      "chronicle:1"
    ]);
    expect(task.input.units["chronicle:2"]!.status).toBe("running");
  });

  it("submits a registrar's numbered decisions as a plan", async () => {
    const { task, services, submit } = setup(["registry:part:2"]);
    const registrar = toolNamed(
      decompositionSubmissionTools(task, services, "registrar"),
      "submit_registry_part"
    );
    await callAsModel(registrar, {
      items: [
        {
          unitId: "registry:part:2",
          data: {
            plan: { groups: [{ refs: ["c7", "c9"], tier: "protagonist" }] }
          }
        }
      ]
    });
    expect(submit.mock.calls[0]![0].data).toEqual({
      kind: "registry-plan",
      plan: {
        groups: [{ refs: ["c7", "c9"], tier: "protagonist" }],
        ignored: []
      }
    });
  });

  it("gives each registrar child exactly one registry unit", async () => {
    const { task, services } = setup(["registry:part:1", "registry:part:2"]);
    const definition = decompositionRoleDefinitions().find(
      ({ id }) => id === "registrar"
    )!;
    await expect(
      longBookDecompositionAgent.orchestration!(task, services).prepareChild(
        definition,
        undefined,
        undefined,
        {
          index: 0,
          key: "t1",
          definition,
          task: "整理 registry:part:1、registry:part:2",
          dependsOn: []
        }
      )
    ).rejects.toThrow("每个名册子任务只能处理一个名册单元。");
  });

  it("tells each child limits that follow the phase model's configuration", async () => {
    const limits = async (model: {
      maxTokens: number;
      thinkingLevel: string;
    }) => {
      const { task, services } = setup(["world:items"], model);
      const definition = decompositionRoleDefinitions().find(
        ({ id }) => id === "world_archivist"
      )!;
      const child = await longBookDecompositionAgent.orchestration!(
        task,
        services
      ).prepareChild(definition, undefined, undefined, {
        index: 0,
        key: "t1",
        definition,
        task: "整理 world:items",
        dependsOn: []
      });
      return /【本次输出上限】(.+)/u.exec(child.task ?? "")![1]!;
    };
    const roomy = await limits({ maxTokens: 32_000, thinkingLevel: "off" });
    const tight = await limits({ maxTokens: 4096, thinkingLevel: "high" });
    expect(roomy).toContain("可见输出约 16000 token");
    expect(roomy).toContain("设定条目每批最多 34 条");
    expect(tight).toContain("可见输出约 1638 token");
    expect(tight).toContain("设定条目每批最多 3 条");
  });
});
