import {
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId
} from "@deepwrite/contracts";
import {
  LongWorkspaceIndexSnapshotSchema,
  describe,
  documentExecutor,
  expect,
  file,
  fixtureStoryPlotIndex,
  fixtureWorldbuildingIndex,
  it,
  longTools,
  resultText,
  toolByName,
  type LongWorkspaceIndexSnapshot
} from "./long-agent-tools.test-support";

function detailedIndex(): LongWorkspaceIndexSnapshot {
  const index = structuredClone(fixtureStoryPlotIndex());
  index.characters[0]!.group = "minor_supporting";
  index.characters[0]!.aliases = ["小岚"];
  index.plot.storyEvents = [
    {
      id: "event_arrival",
      title: "抵达雾港",
      summary: "林岚抵达雾港。",
      timeMode: "sequence",
      timeLabel: "开篇",
      storyOrder: 1,
      location: "雾港",
      arcIds: ["arc_one"],
      characterIds: ["character_alice"]
    },
    {
      id: "event_escape",
      title: "逃离追捕",
      summary: "林岚逃离追捕。",
      timeMode: "sequence",
      timeLabel: "随后",
      storyOrder: 2,
      location: "北门",
      arcIds: ["arc_one"],
      characterIds: ["character_alice"]
    }
  ];
  index.plot.eventConnections = [
    {
      id: "connection_arrival_escape",
      sourceEventId: "event_arrival",
      targetEventId: "event_escape",
      type: "causes",
      note: "抵达引发追捕。"
    }
  ];
  index.plot.narrativePlacements = [
    {
      id: "placement_arrival",
      eventId: "event_arrival",
      chapterCardId: "chapter_one",
      orderInChapter: 1,
      mode: "scene",
      disclosure: "full",
      writingPrompt: "写出初到雾港。",
      status: "planned",
      commitId: null
    }
  ];
  index.plot.foreshadowing = [
    {
      id: "foreshadow_fog",
      title: "雾潮真相",
      coreQuestion: "雾潮从何而来？",
      hiddenTruth: "人为制造。",
      plannedSpan: "within_volume",
      truthEventId: "event_escape",
      expectedReaderEffect: "产生疑问。",
      status: "planned",
      beats: [
        {
          id: "beat_fog_plant",
          type: "plant",
          order: 1,
          volumeId: "volume_one",
          arcId: "arc_one",
          eventId: "event_arrival",
          placementId: "placement_arrival",
          chapterCardId: null,
          plannedScope: "第一章",
          note: "首次出现异常雾气。",
          status: "planned",
          commitId: null
        }
      ]
    }
  ];
  index.chapters[0]!.characterContinuity = [
    {
      characterId: "character_alice",
      currentState: file(
        longChapterCharacterCurrentStateFileId(
          "chapter_one",
          "character_alice"
        ),
        longChapterCharacterContinuityFilePath(
          "chapter_one",
          "character_alice",
          "current-state.md"
        )
      ),
      history: file(
        longChapterCharacterHistoryFileId("chapter_one", "character_alice"),
        longChapterCharacterContinuityFilePath(
          "chapter_one",
          "character_alice",
          "history.md"
        )
      )
    }
  ];
  return LongWorkspaceIndexSnapshotSchema.parse(index);
}

describe("unified long-form list scopes", () => {
  it("lists a worldbuilding category and character type without top-level spill", async () => {
    const worldIndex = fixtureWorldbuildingIndex();
    const worldList = toolByName(
      longTools({ executor: documentExecutor(worldIndex), index: worldIndex }),
      "list"
    );
    const world = resultText(
      await worldList.execute("world-scope", {
        stage: "worldbuilding",
        scope_id: "world_magic"
      })
    );
    expect(world).toContain("范围：世界观 / 魔法体系（world_magic）");
    expect(world).toContain("worlditem_memory 记忆代价");
    expect(world).not.toContain("world_rules");
    const textCategory = resultText(
      await worldList.execute("world-text-scope", {
        stage: "worldbuilding",
        scope_id: "world_rules"
      })
    );
    expect(textCategory).toContain("共 0 项");
    expect(textCategory).toContain("read(id=world_rules)");
    await expect(
      worldList.execute("world-item-leaf", {
        stage: "worldbuilding",
        scope_id: "worlditem_memory"
      })
    ).rejects.toThrow("read(id=worlditem_memory)");

    const index = detailedIndex();
    const characterList = toolByName(
      longTools({ executor: documentExecutor(index), index }),
      "list"
    );
    const characters = resultText(
      await characterList.execute("character-scope", {
        stage: "character",
        scope_id: "minor_supporting"
      })
    );
    expect(characters).toContain("character_alice 林岚（别名：小岚）");
    expect(characters).not.toContain("人物概览");
  });

  it("resolves book, volume, arc, chapter, event and foreshadowing plot scopes", async () => {
    const index = detailedIndex();
    const list = toolByName(
      longTools({ executor: documentExecutor(index), index }),
      "list"
    );
    const cases = [
      ["book_line", "event_arrival 抵达雾港"],
      ["volume_one", "arc_one 主线"],
      ["arc_one", "storyplot_one 城门初遇"],
      ["chapter_one", "placement_arrival 抵达雾港"],
      ["event_arrival", "connection_arrival_escape 出边"],
      ["foreshadow_fog", "beat_fog_plant 埋设"]
    ] as const;
    for (const [scopeId, expected] of cases) {
      const text = resultText(
        await list.execute(`plot-${scopeId}`, {
          stage: "plot",
          scope_id: scopeId
        })
      );
      expect(text).toContain(expected);
    }
    const arc = resultText(
      await list.execute("plot-arc-next", {
        stage: "plot",
        scope_id: "arc_one"
      })
    );
    expect(arc).toContain("read(id=<arc_id>)");
    expect(arc).toContain("不要把概要写成故事情节");
    expect(arc).toContain("read(id=<storyplot_id>)");
    expect(arc).toContain("list(stage=plot, scope_id=<chapter_id|event_id>)");
  });

  it("lists draft and continuity details by supported scope", async () => {
    const index = detailedIndex();
    const list = toolByName(
      longTools({ executor: documentExecutor(index), index }),
      "list"
    );
    const draft = resultText(
      await list.execute("draft-volume", {
        stage: "draft",
        scope_id: "volume_one"
      })
    );
    expect(draft).toContain("chapter_one 第一章");

    const chapter = resultText(
      await list.execute("continuity-chapter", {
        stage: "continuity",
        scope_id: "chapter_one"
      })
    );
    expect(chapter).toContain("character_alice 林岚");
    expect(chapter).toContain("beat_fog_plant 雾潮真相");

    const character = resultText(
      await list.execute("continuity-character", {
        stage: "continuity",
        scope_id: "character_alice"
      })
    );
    expect(character).toContain("chapter_one 第一章");
  });

  it("rejects leaf, unknown and cross-stage scopes with an actionable next step", async () => {
    const index = detailedIndex();
    const list = toolByName(
      longTools({ executor: documentExecutor(index), index }),
      "list"
    );
    await expect(
      list.execute("world-leaf", {
        stage: "worldbuilding",
        scope_id: "worlditem_missing"
      })
    ).rejects.toThrow("未找到范围 worlditem_missing");
    await expect(
      list.execute("plot-leaf", {
        stage: "plot",
        scope_id: "storyplot_one"
      })
    ).rejects.toThrow("请使用 read(id=storyplot_one)");
    await expect(
      list.execute("wrong-stage", {
        stage: "character",
        scope_id: "volume_one"
      })
    ).rejects.toThrow("请改用 stage=plot");
    await expect(
      list.execute("continuity-arc", {
        stage: "continuity",
        scope_id: "arc_one"
      })
    ).rejects.toThrow("连续性只接受 volume_*、chapter_* 或 character_*");
  });

  it("keeps container rules in the tool description and formats in parameters", () => {
    const list = toolByName(
      longTools({ executor: documentExecutor(detailedIndex()) }),
      "list"
    );
    expect(list.description).toContain("world_=世界观");
    expect(list.description).toContain(
      "view=continuity，book_line 返回全书连续性概览"
    );
    expect(JSON.stringify(list.parameters)).not.toContain("storyplot_");
    expect(JSON.stringify(list.parameters)).not.toContain("禁止 arc_");
  });
});
