import { describe, expect, it, vi } from "vitest";
import {
  ExtrasAgentResolvedTaskSchema,
  LongBookSummarySchema,
  type BookIdentitySubmitInput,
  type ExtrasAgentResolvedTask
} from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "../../../adapter";
import { shortProjectRuntime, longProjectRuntime } from "../chat.test-support";
import { resolveExtrasAgent } from "../../run-plan";
import { toolNamed } from "../../extras.test-support";
import { assertProviderToolParameterSchema } from "../../../provider-tool-schema-compat";
import {
  fixtureIndex,
  documentExecutor,
  createLongWorkspaceNavigationSnapshot
} from "../../../long-agent-tools.test-support";

function task(
  agentId: "book-title-design" | "book-synopsis-design" | "book-cover-design",
  long = false
): ExtrasAgentResolvedTask {
  const raw = structuredClone(
    (long ? longProjectRuntime() : shortProjectRuntime()).projectBook
  );
  if (raw.bookType === "academic") {
    throw new Error("Unexpected academic fixture");
  }
  raw.linkedMaterialIdsByKind = {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  };
  raw.linkedSkillIdsByKind = { general: [], plot: [], style: [], other: [] };
  if (raw.bookType === "long") {
    raw.id = "longbook_test";
    raw.navigation.bookId = raw.id;
    raw.navigation.volumes = [{ id: "volume_test", title: "第一卷", order: 1 }];
    raw.navigation.counts = {
      ...raw.navigation.counts,
      storyEvents: 0,
      storyPlots: 0,
      foreshadowingThreads: 0
    };
  } else {
    raw.documents.push({
      ...raw.documents[0]!,
      id: "character_design",
      title: "概览",
      content: "调查员林岚追查雨夜的线索。"
    });
    raw.plotStages = [
      { id: "outline", title: "大纲", description: "主线", enabled: true }
    ];
    for (const section of raw.draft.sections) {
      section.body.id = `draft-section:${section.id}:body`;
      section.characterState.id = `draft-section:${section.id}:character-state`;
    }
  }
  const bookSnapshot = raw;
  return ExtrasAgentResolvedTaskSchema.parse({
    agentId,
    profile: {
      id: "default",
      name: "通用",
      description: "测试",
      systemPrompt: "测试设计方法。"
    },
    input: {
      jobId: "job_test",
      book: { projectType: bookSnapshot.bookType, projectId: bookSnapshot.id },
      candidateCount: 3,
      roundId: "round_test",
      bookSnapshot,
      designContext: {
        adopted: {},
        recentTitles: [],
        recentSynopsisHooks: [],
        recentCoverConcepts: [],
        seedCandidates: []
      },
      ...(agentId === "book-cover-design"
        ? {
            imagesPerCandidate: 1,
            aspectRatio: "3:4",
            titleRendering: "overlay",
            imageCapability: {
              aspectRatios: ["3:4"],
              promptLanguage: "en",
              rendersCjkText: false
            }
          }
        : {})
    }
  });
}
describe("book identity agents", () => {
  it.each([
    "book-title-design",
    "book-synopsis-design",
    "book-cover-design"
  ] as const)(
    "%s saves exactly N candidates before publishing output",
    async (agentId) => {
      const submit = vi.fn(async (input) => ({
        roundId: input.roundId,
        revision: 7
      }));
      const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
      const events = [];
      for await (const event of runtime.startExtras({
        runId: `run_${agentId}`,
        spec: { sessionId: "session_test", task: task(agentId) },
        bookIdentitySubmit: submit
      }))
        events.push(event);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]?.[0].candidates).toHaveLength(3);
      const output = events.find(
        (event) => event.type === "extras_agent.output_updated"
      );
      expect(output).toMatchObject({
        payload: {
          agentId,
          jobId: "job_test",
          output: {
            kind: "book-identity-round",
            roundId: "round_test",
            candidateCount: 3,
            revision: 7
          }
        }
      });
      expect(events.some((event) => event.type === "agent.error")).toBe(false);
    }
  );
  it("keeps developer boundaries and only read and submission tools", () => {
    const definition = resolveExtrasAgent(task("book-cover-design", true));
    expect(definition.systemPrompt.startsWith("测试设计方法。")).toBe(true);
    expect(definition.systemPrompt).toContain("【封面设计运行边界】");
    expect(definition.systemPrompt).toContain("不得出现任何文字");
    const tools = definition.tools({
      runId: "run_test",
      sessionId: "session_test"
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "list",
      "read",
      "submit_book_identity_candidates"
    ]);
    for (const tool of tools)
      assertProviderToolParameterSchema(tool.name, tool.parameters);
  });
  it("reserves room for lettering when the selected image service limits prompt characters", () => {
    const resolved = task("book-cover-design");
    if (resolved.agentId !== "book-cover-design") throw new Error("wrong task");
    resolved.input.imageCapability.maxPromptCharacters = 1500;
    const definition = resolveExtrasAgent(resolved);
    expect(definition.systemPrompt).toContain("最终提示词上限为 1500 字符");
    expect(definition.systemPrompt).toContain("prompt 不超过 650 字符");
    expect(definition.systemPrompt).toContain("typography 不超过 120 字符");
  });
  it("designs a finished cover with the authoritative title when model lettering is selected", async () => {
    const resolved = task("book-cover-design");
    if (resolved.agentId !== "book-cover-design") throw new Error("wrong task");
    resolved.input.titleRendering = "model";
    resolved.input.bookSnapshot.title = "雨夜来信";
    const definition = resolveExtrasAgent(resolved);
    expect(definition.systemPrompt).toContain("完整成品封面");
    expect(definition.systemPrompt).toContain('当前作品书名为 "雨夜来信"');
    expect(definition.systemPrompt).toContain("字体、字重、颜色与文字质感");
    expect(definition.systemPrompt).toContain("titlePlacement");
    expect(definition.systemPrompt).toContain("5500 字符");
    const submit = vi.fn(async (_input: BookIdentitySubmitInput) => ({
      roundId: "round_test",
      revision: 1
    }));
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events = [];
    for await (const event of runtime.startExtras({
      runId: "run_model_cover",
      spec: { sessionId: "session_test", task: resolved },
      bookIdentitySubmit: submit
    }))
      events.push(event);
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    for (const candidate of submit.mock.calls[0]![0].candidates) {
      expect(candidate).toMatchObject({
        typography: "宋体",
        titlePlacement: "top"
      });
      if (!("prompt" in candidate)) throw new Error("wrong candidate");
      expect(candidate.prompt).toContain('"雨夜来信"');
      expect(candidate.prompt).toContain("Song typeface");
      expect(candidate.prompt).not.toMatch(/no text|text-free/u);
      expect(candidate.negativePrompt).not.toContain("文字");
    }
  });
  it("reads a long book through only Main-authorized commands for that book", async () => {
    const index = fixtureIndex();
    const resolved = task("book-title-design", true);
    if (resolved.agentId !== "book-title-design") throw new Error("wrong task");
    resolved.input.book = { projectType: "long", projectId: index.bookId };
    resolved.input.bookSnapshot = LongBookSummarySchema.parse({
      ...resolved.input.bookSnapshot,
      id: index.bookId,
      navigation: createLongWorkspaceNavigationSnapshot(index),
      updatedAt: index.updatedAt
    });
    const executor = documentExecutor(index);
    const submit = vi.fn(async () => ({ roundId: "round_test", revision: 1 }));
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events = [];
    for await (const event of runtime.startExtras({
      runId: "run_long",
      spec: { sessionId: "session_long", task: resolved },
      longCommandExecutor: executor,
      bookIdentitySubmit: submit
    }))
      events.push(event);
    expect(executor).toHaveBeenCalled();
    for (const [command] of executor.mock.calls) {
      expect(["long.getWorkspaceIndex", "long.readDocument"]).toContain(
        command.type
      );
      expect(command.context).toMatchObject({
        runId: "run_long",
        sessionId: "session_long",
        resourceId: index.bookId
      });
      expect(command.payload.bookId).toBe(index.bookId);
    }
    expect(submit).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
  });
  it("rejects wrong counts and duplicate submissions, and leaves failed writes retryable", async () => {
    const definition = resolveExtrasAgent(task("book-title-design"));
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("测试保存失败"))
      .mockResolvedValue({ roundId: "round_test", revision: 1 });
    const tool = toolNamed(
      definition.tools({
        runId: "run_test",
        sessionId: "session_test",
        bookIdentitySubmit: submit
      }),
      "submit_book_identity_candidates"
    );
    const candidate = {
      title: "长夜将明",
      angle: "悬念",
      rationale: "事实依据",
      keywords: ["希望"]
    };
    await expect(
      tool.execute("count_bad", { candidates: [candidate] })
    ).rejects.toThrow("数量");
    expect(submit).not.toHaveBeenCalled();
    const params = {
      candidates: [
        candidate,
        { ...candidate, title: "旧城新雨" },
        { ...candidate, title: "无声回响" }
      ]
    };
    await expect(tool.execute("write_bad", params)).rejects.toThrow(
      "测试保存失败"
    );
    await expect(tool.execute("write_ok", params)).resolves.toMatchObject({
      details: { kind: "extras-agent-output", output: { revision: 1 } }
    });
    await expect(tool.execute("duplicate", params)).rejects.toThrow(
      "只能提交一次"
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
