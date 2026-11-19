import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  committedFixtureIndex,
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  fixtureWorldFile,
  fixtureWorldbuildingIndex,
  it,
  longTools,
  resultText,
  toolByName,
  vi
} from "./long-agent-tools.test-support";
import {
  LongChapterBodyChangeSchema,
  longChapterCardFileId
} from "@deepwrite/contracts";

describe("unified long-form tools: mutations", () => {
  it("creates a list-item worldbuilding file plus a volume record", async () => {
    const index = fixtureWorldbuildingIndex();
    const tools = longTools({ executor: documentExecutor(index) });
    const create = toolByName(tools, "create");

    const item = await create.execute("create-item", {
      kind: "worldbuilding_item",
      meta: { category_id: "world_magic", title: "潮汐代价" },
      content: "每次施法都会忘记一段童年。",
      summary: "新增魔法条目"
    });
    expect(item.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      batch: {
        documentWrites: [
          expect.objectContaining({
            mode: "create",
            content: "每次施法都会忘记一段童年。"
          })
        ]
      },
      agentId: "long",
      files: [
        expect.objectContaining({
          operation: "create",
          title: "魔法体系 / 潮汐代价",
          afterText: "每次施法都会忘记一段童年。"
        })
      ]
    });
    expect(resultText(item)).toContain("已形成新建世界观条目");

    const volume = await create.execute("create-volume", {
      kind: "volume",
      meta: { title: "第二卷" },
      content: "北上之后的代价。",
      summary: "新建分卷"
    });
    expect(volume.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [expect.objectContaining({ type: "volume.create" })]
      }
    });
  });

  it("recovers a missing worldbuilding title from an unambiguous leading H1", async () => {
    const index = fixtureWorldbuildingIndex();
    const create = toolByName(
      longTools({ executor: documentExecutor(index) }),
      "create"
    );
    const content =
      "\uFEFF\n# 混沌灵根\n\n## 本源定义\n灵根可循环吸纳天地灵气。";

    const created = await create.execute("create-heading-item", {
      kind: "worldbuilding_item",
      meta: { category_id: "world_magic" },
      content
    });

    expect(created.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "worldbuildingItem.create",
            item: expect.objectContaining({ title: "混沌灵根" })
          })
        ],
        documentWrites: [expect.objectContaining({ content })]
      },
      files: [
        expect.objectContaining({
          title: "魔法体系 / 混沌灵根",
          afterText: content
        })
      ]
    });

    await expect(
      create.execute("create-ambiguous-item", {
        kind: "worldbuilding_item",
        meta: { category_id: "world_magic", title: "   " },
        content: "## 本源定义\n灵根来自天地循环。"
      })
    ).rejects.toThrow(
      "kind=worldbuilding_item 缺少 meta.title；可选字段：无。"
    );
  });

  it("carries initial content for every Markdown-backed create kind", async () => {
    const tools = longTools({ executor: documentExecutor(fixtureIndex()) });
    const create = toolByName(tools, "create");
    const cases = [
      {
        toolCallId: "create-character-with-content",
        params: {
          kind: "character",
          meta: { name: "周衡", type_id: "major_supporting" },
          content: "周衡负责保管港务档案。"
        }
      },
      {
        toolCallId: "create-chapter-card-with-content",
        params: {
          kind: "chapter_card",
          meta: {
            title: "第二章",
            volume_id: "volume_one",
            primary_arc_id: "arc_one"
          },
          content: "雨夜追踪旧信来源，结尾发现港务印章。"
        }
      },
      {
        toolCallId: "create-story-plot-with-content",
        params: {
          kind: "story_plot",
          meta: { title: "旧信追踪", arc_id: "arc_one" },
          content: "林岚沿邮戳追查到废弃港务所。"
        }
      }
    ] as const;

    for (const fixture of cases) {
      const result = await create.execute(fixture.toolCallId, fixture.params);
      expect(result.details).toMatchObject({
        batch: {
          documentWrites: [
            expect.objectContaining({
              mode: "create",
              content: fixture.params.content
            })
          ]
        }
      });
    }
  });

  it("writes empty documents directly and refuses to overwrite unread text", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const tools = longTools({
      executor: documentExecutor(index, { [worldFile.id]: "" })
    });
    const edit = toolByName(tools, "edit");

    const written = await edit.execute("write-empty", {
      id: "world_rules",
      content: "雾潮期间禁止点燃蓝焰。",
      summary: "写入世界规则"
    });
    expect(written.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal"
    });

    const chapter = await edit.execute("write-empty-chapter", {
      id: "chapter_one",
      document: "body",
      content: "雨幕吞没了最后一盏港灯。",
      summary: "写入第一章正文"
    });
    const chapterDetails = chapter.details as {
      kind?: unknown;
      file?: unknown;
    };
    expect(chapterDetails.kind).toBe("long-chapter-write-proposal");
    expect(
      LongChapterBodyChangeSchema.parse(chapterDetails.file)
    ).toMatchObject({
      chapterCardId: "chapter_one",
      chapterTitle: "第一章",
      afterText: "雨幕吞没了最后一盏港灯。"
    });

    const occupied = fixtureIndex();
    const occupiedFile = fixtureWorldFile(occupied);
    const occupiedTools = longTools({
      executor: documentExecutor(occupied, {
        [occupiedFile.id]: "已有规则。"
      })
    });
    const blocked = resultText(
      await toolByName(occupiedTools, "edit").execute("write-blocked", {
        id: "world_rules",
        content: "新规则。",
        summary: "覆盖世界规则"
      })
    );
    expect(blocked).toContain("目标已有正文");
    expect(blocked).toContain("overwrite_mode");
  });

  it("maps character state and history to committed chapter files as read-only", async () => {
    const index = committedFixtureIndex();
    const continuity = index.chapters[0]!.characterContinuity[0]!;
    const tools = longTools({
      executor: documentExecutor(index, {
        [continuity.currentState.id]: "章末最新状态",
        [continuity.history.id]: "截至本章的历史轨迹"
      }),
      activeRoot: "character_design",
      index
    });
    const read = toolByName(tools, "read");
    expect(
      resultText(
        await read.execute("read-mapped-state", {
          id: "character_alice",
          document: "current_state"
        })
      )
    ).toContain("章末最新状态");
    expect(
      resultText(
        await read.execute("read-mapped-history", {
          id: "character_alice",
          document: "history"
        })
      )
    ).toContain("截至本章的历史轨迹");
    expect(
      resultText(
        await read.execute("read-exact-state", {
          id: "character_alice",
          document: "current_state",
          chapter_id: "chapter_one"
        })
      )
    ).toContain("章末最新状态");

    await expect(
      toolByName(tools, "edit").execute("edit-mapped-state", {
        id: "character_alice",
        document: "current_state",
        content: "不允许在人物阶段覆盖",
        overwrite_mode: "replace_all",
        summary: "错误覆盖"
      })
    ).rejects.toThrow(/映射自最新已提交章节/u);

    const emptyIndex = fixtureIndex();
    const emptyTools = longTools({
      executor: documentExecutor(emptyIndex),
      activeRoot: "character_design",
      index: emptyIndex
    });
    expect(
      resultText(
        await toolByName(emptyTools, "read").execute("read-empty-state", {
          id: "character_alice",
          document: "current_state"
        })
      )
    ).toContain("（正文为空）");
  });

  it("allows overwrite only after a full read and edits index-backed fields", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const tools = longTools({
      executor: documentExecutor(index, { [worldFile.id]: "旧规则。" })
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");
    await read.execute("read-world", { id: "world_rules" });

    const overwritten = await edit.execute("overwrite", {
      id: "world_rules",
      content: "新规则。",
      overwrite_mode: "replace_all",
      summary: "覆盖世界规则"
    });
    expect(overwritten.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      files: [
        expect.objectContaining({ operation: "write", afterText: "新规则。" })
      ]
    });

    const volume = await edit.execute("edit-volume", {
      id: "volume_one",
      content: "第一卷总览。",
      summary: "写入分卷概要"
    });
    expect(volume.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "volume.update",
            id: "volume_one"
          })
        ]
      }
    });
  });

  it("deletes leaves and refuses container structure", async () => {
    const index = fixtureWorldbuildingIndex();
    const tools = longTools({ executor: documentExecutor(index) });
    const remove = toolByName(tools, "delete");

    const item = await remove.execute("delete-item", {
      id: "worlditem_memory",
      summary: "删除记忆代价"
    });
    expect(item.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "worldbuildingItem.delete",
            id: "worlditem_memory"
          })
        ]
      }
    });

    await expect(
      remove.execute("delete-category", { id: "world_magic" })
    ).rejects.toThrow(/不支持删除/);

    const committed = committedFixtureIndex();
    const removeContinuity = toolByName(
      longTools({
        executor: documentExecutor(committed),
        activeRoot: "continuity_ledger",
        index: committed
      }),
      "delete"
    );
    const continuity = await removeContinuity.execute(
      "delete-character-continuity",
      {
        id: "character_alice",
        document: "current_state",
        chapter_id: "chapter_one"
      }
    );
    expect(continuity.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          expect.objectContaining({
            type: "chapterContinuity.character.delete",
            chapterCardId: "chapter_one",
            characterId: "character_alice"
          })
        ]
      }
    });
  });

  it("creates in another stage without asking the user", async () => {
    const requestUserInput = vi.fn(async () => {
      throw new Error("a cross-stage write must not ask the user");
    });
    const create = toolByName(
      longTools({
        executor: documentExecutor(fixtureIndex()),
        activeRoot: "character_design",
        requestUserInput
      }),
      "create"
    );

    const result = await create.execute("create-auto-approved-volume", {
      kind: "volume",
      meta: { title: "自动批准卷" }
    });

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [expect.objectContaining({ type: "volume.create" })]
      }
    });
  });

  it("uses approval-canonical titles for cross-stage continuity proposals", async () => {
    const index = committedFixtureIndex();
    const edit = toolByName(
      longTools({
        executor: documentExecutor(index),
        activeRoot: "draft",
        index
      }),
      "edit"
    );

    const chapterEndState = await edit.execute("write-chapter-end-state", {
      id: "chapter_one",
      document: "character_state",
      content: "林岚在章末确认旧信来自港务所。",
      summary: "记录章末状态"
    });
    const handoff = await edit.execute("write-handoff", {
      id: "chapter_one",
      document: "handoff",
      content: "下一章追查港务所。",
      summary: "记录接续包"
    });
    const characterCurrentState = await edit.execute(
      "write-character-current-state",
      {
        id: "character_alice",
        document: "current_state",
        chapter_id: "chapter_one",
        content: "林岚确认旧信来自港务所。",
        summary: "记录人物当前状态"
      }
    );
    const characterHistory = await edit.execute("write-character-history", {
      id: "character_alice",
      document: "history",
      chapter_id: "chapter_one",
      content: "林岚在第一章追查到港务所。",
      summary: "记录人物历史轨迹"
    });

    expect(chapterEndState.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [expect.objectContaining({ title: "第一章 / 章末状态" })]
    });
    expect(handoff.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [expect.objectContaining({ title: "第一章 / 接续包" })]
    });
    expect(characterCurrentState.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        expect.objectContaining({
          characterId: "character_alice",
          title: "第一章 / 林岚 / 人物当前状态"
        })
      ]
    });
    expect(characterHistory.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        expect.objectContaining({
          characterId: "character_alice",
          title: "第一章 / 林岚 / 人物历史轨迹"
        })
      ]
    });
  });

  it("uses the same user-input channel for explicit agent questions", async () => {
    const requestUserInput = vi.fn(async (_request) => ({
      sessionId: "session_tools",
      runId: "run_tools",
      requestId: "request_tone",
      answers: [{ id: "tone", selectedOptionIds: ["restrained"] }]
    }));
    const ask = toolByName(
      longTools({
        executor: documentExecutor(fixtureIndex()),
        requestUserInput
      }),
      "ask_user_question"
    );

    const result = await ask.execute("ask-tone", {
      questions: [
        {
          id: "tone",
          header: "选择风格",
          question: "这一段采用哪种叙事语气？",
          options: [
            { id: "restrained", label: "克制" },
            { id: "intense", label: "强烈" }
          ]
        }
      ]
    });

    expect(requestUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "ask-tone",
        source: "ask_user_question"
      }),
      undefined
    );
    expect(resultText(result)).toContain('"id": "tone"');
    expect(resultText(result)).toContain('"restrained"');
  });

  it("attaches structured review metadata with real titles and text diffs for plot, chapter card, character meta, and delete proposals", async () => {
    const index = fixtureIndex();
    index.plot.arcs.push({
      id: "arc_two",
      volumeId: "volume_one",
      title: "暗夜伏击",
      order: 2,
      summary: "旧剧情点概要",
      outline: ""
    });
    index.plot.foreshadowing.push({
      id: "foreshadow_seal",
      title: "蜡封密信",
      coreQuestion: "谁伪造了蜡封",
      hiddenTruth: "港务副手",
      expectedReaderEffect: "引起怀疑",
      truthEventId: null,
      status: "planned",
      beats: []
    });
    const tools = longTools({
      executor: documentExecutor(index, {
        [longChapterCardFileId("chapter_one")]: "## 目标\n旧章卡内容"
      })
    });
    const createTool = toolByName(tools, "create");
    const readTool = toolByName(tools, "read");
    const editTool = toolByName(tools, "edit");
    const deleteTool = toolByName(tools, "delete");

    const invoke = async (
      tool: typeof editTool,
      id: string,
      args: JsonObject
    ) => {
      const validated = validateToolArguments(tool, {
        type: "toolCall",
        id,
        name: tool.name,
        arguments: args
      });
      return tool.execute(id, validated);
    };

    const createdCard = await invoke(createTool, "create-card", {
      kind: "chapter_card",
      meta: {
        title: "第二章 破局",
        volume_id: "volume_one",
        primary_arc_id: "arc_two"
      },
      content: "## 目标\n夜探码头"
    });
    expect(createdCard.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKind: "chapter_card",
        action: "create",
        title: "新建章卡 · 第二章 破局",
        content: {
          operation: "create",
          beforeText: "",
          afterText: "## 目标\n夜探码头"
        }
      }
    });

    await invoke(readTool, "read-card", {
      id: "chapter_one",
      document: "card"
    });
    const editedCard = await invoke(editTool, "edit-card", {
      id: "chapter_one",
      document: "card",
      replacements: [{ original_text: "旧章卡内容", new_text: "潜入青州驿站" }],
      summary: "细化章卡冲突"
    });
    expect(editedCard.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: `doc:${longChapterCardFileId("chapter_one")}`,
        targetKind: "chapter_card",
        targetId: "chapter_one",
        action: "edit",
        title: "第一章 / 章卡",
        content: {
          fileId: longChapterCardFileId("chapter_one"),
          filePath: "long/chapters/one/card.md",
          operation: "edit",
          beforeText: "## 目标\n旧章卡内容",
          afterText: "## 目标\n潜入青州驿站"
        }
      }
    });

    const reboundCard = await invoke(editTool, "rebind-card", {
      id: "chapter_one",
      meta: { primary_arc_id: "arc_two" }
    });
    expect(reboundCard.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: "meta:chapter_one",
        targetKind: "chapter_card",
        targetId: "chapter_one",
        action: "meta",
        title: "章卡 · 第一章"
      }
    });

    await invoke(readTool, "read-arc", { id: "arc_two" });
    const editedArc = await invoke(editTool, "edit-arc", {
      id: "arc_two",
      replacements: [
        { original_text: "旧剧情点概要", new_text: "新剧情点概要" }
      ]
    });
    expect(editedArc.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: "entity:arc_two",
        targetKind: "arc",
        targetId: "arc_two",
        action: "edit",
        title: "剧情点 · 暗夜伏击",
        content: {
          operation: "edit",
          beforeText: "旧剧情点概要",
          afterText: "新剧情点概要"
        }
      }
    });

    const createdForeshadow = await invoke(createTool, "create-foreshadow", {
      kind: "foreshadowing",
      meta: { title: "铜锁暗号" },
      content:
        "## 核心问题\n谁留下了铜锁\n\n## 隐藏真相\n守夜人\n\n## 预期读者效果\n铺垫反转"
    });
    expect(createdForeshadow.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKind: "foreshadowing",
        action: "create",
        title: "新建伏笔线 · 铜锁暗号",
        content: {
          operation: "create",
          beforeText: "",
          afterText:
            "## 核心问题\n\n谁留下了铜锁\n\n## 隐藏真相\n\n守夜人\n\n## 预期读者效果\n\n铺垫反转"
        }
      }
    });

    await invoke(readTool, "read-foreshadow", { id: "foreshadow_seal" });
    const editedForeshadow = await invoke(editTool, "edit-foreshadow", {
      id: "foreshadow_seal",
      replacements: [{ original_text: "引起怀疑", new_text: "收束反转" }]
    });
    expect(editedForeshadow.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: "entity:foreshadow_seal",
        targetKind: "foreshadowing",
        action: "edit",
        title: "伏笔线 · 蜡封密信",
        content: {
          operation: "edit",
          beforeText:
            "## 核心问题\n\n谁伪造了蜡封\n\n## 隐藏真相\n\n港务副手\n\n## 预期读者效果\n\n引起怀疑",
          afterText:
            "## 核心问题\n\n谁伪造了蜡封\n\n## 隐藏真相\n\n港务副手\n\n## 预期读者效果\n\n收束反转"
        }
      }
    });

    const movedCharacter = await invoke(editTool, "move-character", {
      id: "character_alice",
      meta: { type_id: "major_supporting", name: "林沉" }
    });
    expect(movedCharacter.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: "meta:character_alice",
        targetKind: "character",
        targetId: "character_alice",
        action: "meta",
        title: "人物信息 · 林岚"
      }
    });

    const deletedArc = await invoke(deleteTool, "delete-arc", {
      id: "arc_two"
    });
    expect(deletedArc.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKey: "delete:arc_two",
        targetKind: "arc",
        targetId: "arc_two",
        action: "delete",
        title: "删除剧情点 · 暗夜伏击"
      }
    });
  });
});
