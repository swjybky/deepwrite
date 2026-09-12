import { applyLongWorkspaceOperations } from "@deepwrite/contracts";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceNavigationSnapshot,
  describe,
  documentExecutor,
  expect,
  fixtureStoryPlotIndex,
  fixtureWorldbuildingIndex,
  it,
  longTools,
  profile,
  resultText,
  toolByName,
  workspace,
  type LongAgentToolDetails
} from "./long-agent-tools.test-support";

const countLabel = "目标内容字数（本次提案）：";
const body = "# 甲 A，\n\t乙\u3000🙂";
const foreshadowingBody =
  "忽略这段前言\n# 核心问题\n谁？\n# 隐藏真相\n甲\n# 预期读者效果\n惊讶";

function contentIndex() {
  const index = fixtureWorldbuildingIndex();
  index.plot.storyPlots = fixtureStoryPlotIndex().plot.storyPlots;
  index.plot.storyEvents = ["event_one", "event_two"].map((id, i) => ({
    id,
    title: `事件${i + 1}`,
    summary: "",
    timeMode: "unknown" as const,
    timeLabel: "",
    storyOrder: i + 1,
    location: "",
    arcIds: [],
    characterIds: []
  }));
  index.plot.foreshadowing.push({
    id: "foreshadow_one",
    title: "旧伏笔",
    coreQuestion: "谁？",
    hiddenTruth: "甲",
    truthEventId: null,
    expectedReaderEffect: "惊讶",
    status: "planned",
    beats: []
  });
  return index;
}

function toolsFor(index = contentIndex(), auto = false) {
  const context = workspace("long", "plot_design", "chapter_one");
  context.navigation = createLongWorkspaceNavigationSnapshot(index);
  return buildLongWorkspaceTools({
    workspace: context,
    profile: profile("long"),
    sessionId: "session_counts",
    runId: "run_counts",
    executor: documentExecutor(index),
    autoApproveCrossStageOperations: true,
    writeApprovalMode: auto ? "auto-approve" : "request-approval"
  });
}

function batchOf(value: unknown) {
  const details = value as LongAgentToolDetails;
  if (!("batch" in details)) throw new Error("Expected a mutation proposal");
  return details.batch;
}

function counts(text: string) {
  return [...text.matchAll(/目标内容字数（本次提案）：(\d+) 字/gu)].map(
    (match) => Number(match[1])
  );
}

const recordCreations = [
  { kind: "volume", meta: { title: "第二卷" } },
  { kind: "arc", meta: { title: "新剧情点", volume_id: "volume_one" } },
  { kind: "story_event", meta: { title: "新事件" } },
  {
    kind: "event_connection",
    meta: {
      source_event_id: "event_one",
      target_event_id: "event_two",
      type: "causes"
    }
  },
  {
    kind: "narrative_placement",
    meta: {
      event_id: "event_one",
      chapter_card_id: "chapter_one",
      mode: "scene",
      disclosure: "hint"
    }
  },
  { kind: "foreshadowing", meta: { title: "新伏笔" } },
  {
    kind: "foreshadowing_beat",
    meta: {
      foreshadowing_id: "foreshadow_one",
      type: "plant",
      chapter_card_id: "chapter_one"
    }
  }
];

describe("long tool creation content counts", () => {
  it.each([
    {
      kind: "worldbuilding_item",
      meta: { category_id: "world_magic", title: "新设定" },
      expected: [7]
    },
    {
      kind: "character",
      meta: { type_id: "protagonist", name: "新人物" },
      expected: [7, 0]
    },
    {
      kind: "story_plot",
      meta: { arc_id: "arc_one", title: "新情节" },
      expected: [7]
    },
    {
      kind: "chapter_card",
      meta: { volume_id: "volume_one", title: "第二章" },
      expected: [7, 0, 0, 0, 0]
    },
    {
      kind: "continuity_world_reveals",
      meta: { chapter_card_id: "chapter_one" },
      expected: [7]
    },
    {
      kind: "continuity_character",
      meta: {
        chapter_card_id: "chapter_one",
        character_id: "character_alice",
        document: "current_state"
      },
      expected: [7, 0]
    },
    {
      kind: "continuity_character",
      meta: {
        chapter_card_id: "chapter_one",
        character_id: "character_alice",
        document: "history"
      },
      expected: [0, 7]
    }
  ])(
    "reports each document for $kind $meta.document",
    async ({ expected, ...args }) => {
      const create = toolByName(toolsFor(), "create");
      expect(create.description).toContain("完整内容的字数");
      const result = await create.execute("create", { ...args, content: body });
      const text = resultText(result);
      expect(counts(text)).toEqual(expected);
      expect(text).toContain("等待客户端审阅");
      for (const write of batchOf(result.details).documentWrites) {
        expect(text).toContain(`文档标识=${write.fileId}`);
        expect(write.content === body || write.content === "").toBe(true);
      }
    }
  );

  it.each(recordCreations)(
    "counts canonical $kind body on create and replace",
    async (args) => {
      const index = contentIndex();
      const isForeshadowing = args.kind === "foreshadowing";
      const create = toolByName(toolsFor(index), "create");
      const result = await create.execute("create", {
        ...args,
        content: isForeshadowing ? foreshadowingBody : body
      });
      // Canonical foreshadowing includes three ## headings but discards the preface.
      expect(counts(resultText(result))).toEqual([isForeshadowing ? 25 : 7]);
      const applied = applyLongWorkspaceOperations(
        index,
        batchOf(result.details)
      );
      const id = applied.impact.createdEntityIds[0]!;
      expect(resultText(result)).toContain(`文档标识=${id}`);
      const tools = toolsFor(applied.snapshot);
      await toolByName(tools, "read").execute("read", { id });
      const edited = await toolByName(tools, "edit").execute("replace", {
        id,
        replacements: [{ original_text: "甲", new_text: "甲乙丙" }],
        summary: "扩写"
      });
      expect(counts(resultText(edited))).toEqual([isForeshadowing ? 27 : 9]);
      expect(batchOf(edited.details).documentWrites).toEqual([]);
    }
  );

  it("counts empty record and file creations as zero", async () => {
    const create = toolByName(toolsFor(), "create");
    for (const args of [
      { kind: "volume", meta: { title: "空卷" } },
      { kind: "story_plot", meta: { arc_id: "arc_one", title: "空情节" } }
    ]) {
      expect(counts(resultText(await create.execute(args.kind, args)))).toEqual(
        [0]
      );
    }
  });

  it("preserves auto-save status on create and subsequent content edits", async () => {
    const tools = toolsFor(contentIndex(), true);
    const created = await toolByName(tools, "create").execute("create", {
      kind: "continuity_character",
      meta: { character_id: "character_alice", document: "current_state" },
      content: body
    });
    const edited = await toolByName(tools, "edit").execute("write-sibling", {
      id: "character_alice",
      chapter_id: "chapter_one",
      document: "history",
      content: "历史。",
      summary: "写入历史"
    });
    for (const result of [created, edited]) {
      expect(resultText(result)).toContain("以审批卡的落盘状态为准");
      expect(resultText(result)).not.toContain("等待客户端审阅");
    }
    expect(counts(resultText(created))).toEqual([7, 0]);
    expect(counts(resultText(edited))).toEqual([3]);
  });
});

describe("long tool editing content counts", () => {
  it.each([
    { id: "world_rules" },
    { id: "worlditem_memory" },
    { id: "world_magic" },
    { id: "character_overview" },
    { id: "character_alice", document: "core_profile" },
    { id: "character_alice", document: "relationships" },
    { id: "book_line" },
    { id: "storyplot_one" },
    ...[
      "card",
      "body",
      "character_state",
      "handoff",
      "foreshadowing_changes"
    ].map((document) => ({ id: "chapter_one", document }))
  ])(
    "counts consecutive full writes, replacements and clears of $id $document",
    async (target) => {
      const tools = toolsFor();
      const edit = toolByName(tools, "edit");
      expect(edit.description).toContain("完整内容的字数");
      const written = await edit.execute("write", {
        ...target,
        content: body,
        summary: "写入"
      });
      expect(counts(resultText(written))).toEqual([7]);
      expect(batchOf(written.details).documentWrites[0]?.content).toBe(body);

      const replaced = await edit.execute("replace", {
        ...target,
        replacements: [{ original_text: "甲", new_text: "甲乙丙" }],
        summary: "扩写"
      });
      expect(counts(resultText(replaced))).toEqual([9]);
      expect(batchOf(replaced.details).documentWrites[0]?.content).toBe(
        body.replace("甲", "甲乙丙")
      );
      expect(
        counts(
          resultText(
            await edit.execute("clear", {
              ...target,
              content: "",
              allow_overwrite_existing: true,
              summary: "清空"
            })
          )
        )
      ).toEqual([0]);
      expect(
        counts(
          resultText(
            await edit.execute("rewrite", {
              ...target,
              content: "新 正文。",
              summary: "重新写入"
            })
          )
        )
      ).toEqual([4]);
    }
  );

  it("normalizes foreshadowing full writes before counting", async () => {
    const tools = toolsFor();
    await toolByName(tools, "read").execute("read", { id: "foreshadow_one" });
    const result = await toolByName(tools, "edit").execute("write", {
      id: "foreshadow_one",
      content: foreshadowingBody,
      allow_overwrite_existing: true,
      summary: "改写伏笔"
    });
    expect(counts(resultText(result))).toEqual([25]);
    expect(batchOf(result.details).operations[0]).toMatchObject({
      patch: {
        coreQuestion: "谁？",
        hiddenTruth: "甲",
        expectedReaderEffect: "惊讶"
      }
    });
  });

  it("omits counts for metadata-only, cancelled and failed proposals", async () => {
    const index = contentIndex();
    const tools = toolsFor(index);
    const edit = toolByName(tools, "edit");
    const target = { id: "chapter_one", document: "body" };
    const written = await edit.execute("write", {
      ...target,
      content: body,
      summary: "写入"
    });
    expect(counts(resultText(written))).toEqual([7]);
    const unsuccessful = [
      await edit.execute("unconfirmed", {
        ...target,
        content: "新内容",
        summary: "覆盖"
      }),
      await edit.execute("no-match", {
        ...target,
        replacements: [{ original_text: "不存在", new_text: "替换" }],
        summary: "替换"
      }),
      await edit.execute("meta", {
        id: "volume_one",
        meta: { title: "改名" },
        summary: "改名"
      }),
      await edit.execute("file-meta", {
        ...target,
        meta: { title: "改名" },
        summary: "改名"
      }),
      await toolByName(tools, "create").execute("invalid", {
        kind: "chapter_card",
        meta: { volume_id: "volume_missing", title: "新章" },
        content: body
      })
    ];
    const cancelledTools = longTools({
      index,
      executor: documentExecutor(index),
      requestUserInput: async () => ({
        sessionId: "session_counts",
        runId: "run_counts",
        requestId: "cancel",
        answers: []
      })
    });
    unsuccessful.push(
      await toolByName(cancelledTools, "edit").execute("cancel", {
        id: "world_rules",
        content: body,
        summary: "取消"
      })
    );
    for (const result of unsuccessful)
      expect(resultText(result)).not.toContain(countLabel);
  });
});
