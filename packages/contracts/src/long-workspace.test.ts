import { describe, expect, it } from "vitest";
import {
  BookSchema,
  CatalogProjectManifestSchema,
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  LONG_BOOK_LINE_FILE_ID,
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongAgentProfileSchema,
  LongBookSchema,
  LongBookSummarySchema,
  LongContinuityProjectionSchema,
  LongEventConnectionSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceSchemaVersionSchema,
  WorkspaceTypeSchema,
  createLongBookSummary,
  createLongWorkspaceNavigationSnapshot,
  longAgentsMdCharacterCount,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longLinkedResourceIsEnabledForStage,
  longWorldbuildingFileId,
  resolveLongAgentIdForRoot
} from "./index";
import { resolveLongAgentIdForRoot as rendererResolveLongAgentIdForRoot } from "./renderer";

const now = "2026-07-26T10:00:00.000Z";

function file(id: string, path: string) {
  return { id, path, updatedAt: now };
}

function chapterFiles(chapterCardId: string, order: number) {
  return {
    chapterCardId,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${order}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${order}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${order}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${order}/handoff.md`
    ),
    commitId: null as string | null
  };
}

function workspaceIndex() {
  return {
    schemaVersion: 1 as const,
    bookId: "longbook_alpha",
    updatedAt: now,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    worldbuilding: [
      {
        id: "world_rules",
        title: "世界规则",
        order: 1,
        format: "text" as const,
        contentAuthority: "markdown" as const,
        file: file(
          longWorldbuildingFileId("world_rules"),
          "long/worldbuilding/rules.md"
        )
      }
    ],
    characters: [
      {
        id: "character_alice",
        name: "林岚",
        group: "protagonist" as const,
        order: 1,
        aliases: ["阿岚"]
      }
    ],
    characterFiles: [
      {
        characterId: "character_alice",
        coreProfile: file(
          longCharacterCoreProfileFileId("character_alice"),
          "long/characters/alice/core-profile.md"
        ),
        relationships: file(
          longCharacterRelationshipsFileId("character_alice"),
          "long/characters/alice/relationships.md"
        ),
        currentState: file(
          longCharacterCurrentStateFileId("character_alice"),
          "long/characters/alice/current-state.md"
        ),
        history: file(
          longCharacterHistoryFileId("character_alice"),
          "long/characters/alice/history.md"
        )
      }
    ],
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷",
          order: 1,
          summary: "林岚找到被隐藏的来信。"
        }
      ],
      arcs: [
        {
          id: "arc_letter",
          volumeId: "volume_one",
          title: "来信之谜",
          order: 1,
          outline: "追查来信来源。"
        }
      ],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: "arc_letter",
          title: "雨夜来信",
          narrativeOrder: 1
        },
        {
          id: "chapter_two",
          volumeId: "volume_one",
          primaryArcId: "arc_letter",
          title: "旧钟楼",
          narrativeOrder: 2
        }
      ],
      storyEvents: [
        {
          id: "event_letter_sent",
          title: "寄出来信",
          summary: "匿名人寄出了来信。",
          timeMode: "sequence" as const,
          timeLabel: "故事开始前",
          storyOrder: 1,
          location: "未知",
          arcIds: ["arc_letter"],
          characterIds: []
        },
        {
          id: "event_letter_received",
          title: "收到来信",
          summary: "林岚在雨夜收到来信。",
          timeMode: "sequence" as const,
          timeLabel: "第一天",
          storyOrder: 2,
          location: "林岚家",
          arcIds: ["arc_letter"],
          characterIds: ["character_alice"]
        }
      ],
      eventConnections: [
        {
          id: "connection_sent_before_received",
          sourceEventId: "event_letter_sent",
          targetEventId: "event_letter_received",
          type: "before" as const,
          note: ""
        }
      ],
      narrativePlacements: [
        {
          id: "placement_receive_letter",
          eventId: "event_letter_received",
          chapterCardId: "chapter_one",
          orderInChapter: 1,
          mode: "scene" as const,
          disclosure: "full" as const,
          writingPrompt: "现场呈现来信出现。",
          status: "planned" as "planned" | "written" | "committed" | "missed",
          commitId: null as string | null
        }
      ],
      foreshadowing: [
        {
          id: "foreshadow_sender",
          title: "寄信人身份",
          coreQuestion: "是谁寄出了来信？",
          truthEventId: "event_letter_sent",
          expectedReaderEffect: "让读者持续怀疑寄信人的身份。",
          status: "planned" as const,
          beats: [
            {
              id: "beat_first_clue",
              type: "plant" as const,
              order: 1,
              eventId: "event_letter_received",
              placementId: "placement_receive_letter",
              chapterCardId: "chapter_one",
              plannedScope: "",
              note: "信封上的蜡封是第一条线索。",
              status: "planned" as
                "planned" | "written" | "committed" | "missed",
              commitId: null as string | null
            }
          ]
        }
      ]
    },
    chapters: [chapterFiles("chapter_one", 1), chapterFiles("chapter_two", 2)],
    ledger: {
      committedThroughChapterId: null as string | null,
      commits: [] as Array<{
        id: string;
        sequence: number;
        chapterCardId: string;
        committedAt: string;
        placementIds: string[];
        foreshadowingBeatIds: string[];
        recordFile: ReturnType<typeof file>;
      }>
    }
  };
}

function commitFirstChapter(workspace: ReturnType<typeof workspaceIndex>) {
  const commitId = "commit_first";
  workspace.chapters[0]!.commitId = commitId;
  workspace.plot.narrativePlacements[0]!.status = "committed";
  workspace.plot.narrativePlacements[0]!.commitId = commitId;
  workspace.plot.foreshadowing[0]!.beats[0]!.status = "committed";
  workspace.plot.foreshadowing[0]!.beats[0]!.commitId = commitId;
  (
    workspace.plot.foreshadowing[0]! as {
      status: "planned" | "open" | "progressing" | "resolved" | "abandoned";
    }
  ).status = "open";
  workspace.ledger.committedThroughChapterId = "chapter_one";
  workspace.ledger.commits.push({
    id: commitId,
    sequence: 1,
    chapterCardId: "chapter_one",
    committedAt: now,
    placementIds: ["placement_receive_letter"],
    foreshadowingBeatIds: ["beat_first_clue"],
    recordFile: file(
      longLedgerCommitFileId(commitId),
      "long/ledger/commit-first.json"
    )
  });
  return workspace;
}

function longBook() {
  return {
    schemaVersion: 1 as const,
    id: "longbook_alpha",
    title: "雨夜来信",
    bookType: "long" as const,
    genre: "悬疑",
    status: "editing" as const,
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    createdAt: now,
    updatedAt: now,
    workspaceIndex: workspaceIndex()
  };
}

describe("independent long-form workspace contracts", () => {
  it("treats missing resource scopes as all stages and honors configured overrides", () => {
    expect(
      longLinkedResourceIsEnabledForStage(
        undefined,
        "skill",
        "skill-style",
        "worldbuilding"
      )
    ).toBe(true);
    const scopes = {
      materials: { "material-plot": ["plot_design" as const] },
      skills: { "skill-style": ["draft" as const] }
    };
    expect(
      longLinkedResourceIsEnabledForStage(
        scopes,
        "skill",
        "skill-style",
        "draft"
      )
    ).toBe(true);
    expect(
      longLinkedResourceIsEnabledForStage(
        scopes,
        "skill",
        "skill-style",
        "plot_design"
      )
    ).toBe(false);
  });

  it("ships a default AGENTS.md that explains the five long-form stages", () => {
    expect(LONG_AGENTS_MD_PATH).toBe("AGENTS.md");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("# 长篇上下文");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 写作思路");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 世界观阶段");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 人物阶段");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 剧情点阶段");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 正文阶段");
    expect(DEFAULT_LONG_AGENTS_MD).toContain("## 持续性账本阶段");
    expect(DEFAULT_LONG_AGENTS_MD).toContain(
      "多章批次必须属于同一本书、按叙事顺序连续"
    );
    expect(DEFAULT_LONG_AGENTS_MD).toContain(
      "只在批次最后一章生成一次汇总连续性文件"
    );
    expect(DEFAULT_LONG_AGENTS_MD).toContain(
      "未读取的正文、剧情或设定不得当成事实"
    );
    expect(DEFAULT_LONG_AGENTS_MD).toContain("账本不能新增伏笔线和触点");
    expect(DEFAULT_LONG_AGENTS_MD).toContain(
      "除非用户要求，不要直接把章节账本记录完成"
    );
    expect(
      longAgentsMdCharacterCount(DEFAULT_LONG_AGENTS_MD)
    ).toBeLessThanOrEqual(LONG_AGENTS_MD_MAX_CHARACTERS);
  });

  it("parses a full index, lightweight navigation, book and manifest without joining existing unions", () => {
    const book = LongBookSchema.parse(longBook());
    const navigation = createLongWorkspaceNavigationSnapshot(
      book.workspaceIndex
    );
    const summary = createLongBookSummary(book);
    const manifest = {
      schemaVersion: 1,
      kind: "deepwrite.long-book",
      id: "longbook_alpha",
      title: "雨夜来信",
      bookType: "long",
      genre: "悬疑",
      status: "editing",
      linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: book.linkedSkillIdsByKind,
      createdAt: now,
      updatedAt: now,
      workspaceIndexFile: file(
        LONG_WORKSPACE_INDEX_FILE_ID,
        LONG_WORKSPACE_INDEX_PATH
      )
    };

    expect(navigation.counts.chapterCards).toBe(2);
    expect(book.workspaceIndex.characterTypes.map(({ id }) => id)).toEqual([
      "protagonist",
      "major_supporting",
      "minor_supporting",
      "passerby"
    ]);
    expect(navigation.characterTypes).toEqual(
      book.workspaceIndex.characterTypes
    );
    expect(book.workspaceIndex.ledger.projection).toEqual({
      throughCommitId: null,
      facts: [],
      knowledge: [],
      openLoops: [],
      latestHandoff: null
    });
    expect(book.workspaceIndex.chapters[0]?.foreshadowingChanges).toMatchObject(
      {
        id: longChapterForeshadowingChangesFileId("chapter_one"),
        path: longChapterContinuityFilePath(
          "chapter_one",
          "foreshadowing-changes.md"
        )
      }
    );
    expect(book.workspaceIndex.chapters[0]?.worldReveals).toBeNull();
    expect(book.workspaceIndex.chapters[0]?.characterContinuity).toEqual([]);
    expect(navigation.chapterCards[0]).toEqual({
      id: "chapter_one",
      volumeId: "volume_one",
      primaryArcId: "arc_letter",
      title: "雨夜来信",
      narrativeOrder: 1,
      bodyStatus: "empty"
    });
    expect(navigation).not.toHaveProperty("chapters");
    expect(navigation.chapterCards[0]).not.toHaveProperty("outline");
    expect(summary.navigation.bookId).toBe(book.id);
    expect(LongProjectManifestSchema.parse(manifest).kind).toBe(
      "deepwrite.long-book"
    );

    expect(BookSchema.safeParse(book).success).toBe(false);
    expect(WorkspaceTypeSchema.safeParse("long").success).toBe(false);
    expect(CatalogProjectManifestSchema.safeParse(manifest).success).toBe(
      false
    );
  });

  it("validates structured continuity projection keys and provenance", () => {
    const fact = {
      factId: "fact_alice-location",
      domain: "character" as const,
      subjectId: "character_alice",
      field: "location",
      value: "林岚家",
      sourceCommitId: "commit_first",
      sourceChapterCardId: "chapter_one",
      evidence: "正文写明林岚在家中。"
    };
    const projection = {
      throughCommitId: "commit_first",
      facts: [fact],
      knowledge: [
        {
          factId: fact.factId,
          audienceType: "reader" as const,
          audienceId: null,
          level: "knows" as const,
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "读者直接读到地点。"
        }
      ],
      openLoops: [
        {
          loopId: "loop_sender",
          kind: "foreshadowing" as const,
          status: "open" as const,
          detail: "寄信人身份尚未揭晓。",
          subjectId: "foreshadow_sender",
          factId: null,
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "正文只给出蜡封线索。"
        }
      ],
      latestHandoff: {
        chapterCardId: "chapter_one",
        commitId: "commit_first",
        summary: "下一章追查旧邮戳。",
        mustCarry: ["林岚持有旧信。"],
        nextChapterConstraints: ["不能提前揭晓寄信人。"],
        openLoops: ["loop_sender"]
      }
    };
    expect(LongContinuityProjectionSchema.safeParse(projection).success).toBe(
      true
    );
    expect(
      LongContinuityProjectionSchema.safeParse({
        ...projection,
        facts: [
          fact,
          {
            ...fact,
            factId: "fact_duplicate-location"
          }
        ]
      }).success
    ).toBe(false);
    expect(
      LongContinuityProjectionSchema.safeParse({
        ...projection,
        knowledge: [
          {
            ...projection.knowledge[0],
            factId: "fact_missing"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("anchors workspace continuity projections to indexed commits and domain objects", () => {
    const committed = commitFirstChapter(workspaceIndex());
    Object.assign(committed.ledger, {
      projection: {
        throughCommitId: "commit_first",
        facts: [
          {
            factId: "fact_alice-location",
            domain: "character",
            subjectId: "character_alice",
            field: "location",
            value: "林岚家",
            sourceCommitId: "commit_first",
            sourceChapterCardId: "chapter_one",
            evidence: "正文写明林岚仍在家中。"
          }
        ],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      }
    });
    const parsedCommitted = LongWorkspaceIndexSnapshotSchema.parse(committed);
    expect(parsedCommitted.ledger.commits[0]?.mode).toBe("structured");

    const orphanSubject = structuredClone(parsedCommitted);
    orphanSubject.ledger.projection.facts[0]!.subjectId = "character_missing";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(orphanSubject).success
    ).toBe(false);

    const unknownSource = structuredClone(parsedCommitted);
    unknownSource.ledger.projection.facts[0]!.sourceCommitId = "commit_missing";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(unknownSource).success
    ).toBe(false);

    const wrongSourceChapter = structuredClone(parsedCommitted);
    wrongSourceChapter.ledger.projection.facts[0]!.sourceChapterCardId =
      "chapter_two";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(wrongSourceChapter).success
    ).toBe(false);
  });

  it("enforces versioned opaque ids and canonical three-file indexes", () => {
    expect(LongWorkspaceSchemaVersionSchema.safeParse(1).success).toBe(true);
    expect(LongWorkspaceSchemaVersionSchema.safeParse(2).success).toBe(false);
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse({
        ...workspaceIndex(),
        bookId: "第一部长篇"
      }).success
    ).toBe(false);

    const wrongFile = workspaceIndex();
    wrongFile.chapters[0]!.handoff.id = "file_custom:handoff";
    expect(LongWorkspaceIndexSnapshotSchema.safeParse(wrongFile).success).toBe(
      false
    );

    const duplicatePath = workspaceIndex();
    duplicatePath.chapters[1]!.body.path = duplicatePath.chapters[0]!.body.path;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(duplicatePath).success
    ).toBe(false);

    const portableDuplicatePath = workspaceIndex();
    portableDuplicatePath.chapters[1]!.body.path =
      portableDuplicatePath.chapters[0]!.body.path.replace(
        "body.md",
        "BODY.md"
      );
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(portableDuplicatePath).success
    ).toBe(false);
  });

  it("rejects duplicate and unresolved entity references", () => {
    const duplicateIds = workspaceIndex();
    duplicateIds.plot.chapterCards[1]!.id = "chapter_one";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(duplicateIds).success
    ).toBe(false);

    const duplicateReferences = workspaceIndex();
    duplicateReferences.plot.storyEvents[0]!.characterIds = [
      "character_alice",
      "character_alice"
    ];
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(duplicateReferences).success
    ).toBe(false);

    const missingReference = workspaceIndex();
    missingReference.plot.arcs[0]!.volumeId = "volume_missing";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(missingReference).success
    ).toBe(false);

    const unassociatedChapter =
      LongWorkspaceIndexSnapshotSchema.parse(workspaceIndex());
    unassociatedChapter.plot.chapterCards[0]!.primaryArcId = null;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(unassociatedChapter).success
    ).toBe(true);

    const missingChapterArc =
      LongWorkspaceIndexSnapshotSchema.parse(workspaceIndex());
    missingChapterArc.plot.chapterCards[0]!.primaryArcId = "arc_missing";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(missingChapterArc).success
    ).toBe(false);
  });

  it("accepts custom character type ids and rejects unresolved character types", () => {
    const source = workspaceIndex();
    const custom = {
      ...source,
      characterTypes: [
        { id: "chartype_viewpoint", title: "视角人物", order: 1 }
      ],
      characters: source.characters.map((character) => ({
        ...character,
        group: "chartype_viewpoint"
      }))
    };
    expect(
      LongWorkspaceIndexSnapshotSchema.parse(custom).characters[0]?.group
    ).toBe("chartype_viewpoint");

    expect(() =>
      LongWorkspaceIndexSnapshotSchema.parse({
        ...custom,
        characters: custom.characters.map((character) => ({
          ...character,
          group: "chartype_missing"
        }))
      })
    ).toThrow(/existing character type/u);
  });

  it("requires contiguous volume, arc, chapter, event and placement order", () => {
    const volumeOrder = workspaceIndex();
    volumeOrder.plot.volumes[0]!.order = 2;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(volumeOrder).success
    ).toBe(false);

    const chapterOrder = workspaceIndex();
    chapterOrder.plot.chapterCards[1]!.narrativeOrder = 1;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(chapterOrder).success
    ).toBe(false);

    const eventOrder = workspaceIndex();
    eventOrder.plot.storyEvents[1]!.storyOrder = 1;
    expect(LongWorkspaceIndexSnapshotSchema.safeParse(eventOrder).success).toBe(
      false
    );

    const placementOrder = workspaceIndex();
    placementOrder.plot.narrativePlacements[0]!.orderInChapter = 2;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(placementOrder).success
    ).toBe(false);
  });

  it("keeps full books and lightweight summaries on one update time", () => {
    const mismatchedBookTime = longBook();
    mismatchedBookTime.updatedAt = "2026-07-26T11:00:00.000Z";
    expect(LongBookSchema.safeParse(mismatchedBookTime).success).toBe(false);

    const summary = createLongBookSummary(LongBookSchema.parse(longBook()));
    expect(summary).not.toHaveProperty("projectRevision");
    expect(summary.navigation).not.toHaveProperty("revision");
    expect(
      LongBookSummarySchema.safeParse({
        ...summary,
        updatedAt: "2026-07-26T11:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects event self-references and before cycles", () => {
    expect(
      LongEventConnectionSchema.safeParse({
        id: "connection_self",
        sourceEventId: "event_letter_sent",
        targetEventId: "event_letter_sent",
        type: "before",
        note: ""
      }).success
    ).toBe(false);

    const cycle = workspaceIndex();
    cycle.plot.eventConnections.push({
      id: "connection_received_before_sent",
      sourceEventId: "event_letter_received",
      targetEventId: "event_letter_sent",
      type: "before",
      note: ""
    });
    expect(LongWorkspaceIndexSnapshotSchema.safeParse(cycle).success).toBe(
      false
    );
  });

  it("accepts coherent sparse records and rejects mismatched record state", () => {
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(
        commitFirstChapter(workspaceIndex())
      ).success
    ).toBe(true);

    const skippedFirst = workspaceIndex();
    skippedFirst.chapters[1]!.commitId = "commit_second";
    skippedFirst.ledger.committedThroughChapterId = null;
    skippedFirst.ledger.commits.push({
      id: "commit_second",
      sequence: 1,
      chapterCardId: "chapter_two",
      committedAt: now,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_second"),
        "long/ledger/commit-second.json"
      )
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(skippedFirst).success
    ).toBe(true);

    const undecidedPlacement = commitFirstChapter(workspaceIndex());
    undecidedPlacement.plot.narrativePlacements[0]!.status = "planned";
    undecidedPlacement.plot.narrativePlacements[0]!.commitId = null;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(undecidedPlacement).success
    ).toBe(false);

    const wrongCommittedThrough = commitFirstChapter(workspaceIndex());
    wrongCommittedThrough.ledger.committedThroughChapterId = "chapter_two";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(wrongCommittedThrough).success
    ).toBe(false);
  });

  it("requires a committed beat's bound placement and event to agree", () => {
    const missedPlacement = commitFirstChapter(workspaceIndex());
    missedPlacement.plot.narrativePlacements[0]!.status = "missed";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(missedPlacement).success
    ).toBe(false);

    const missingBeatEvent = commitFirstChapter(workspaceIndex());
    (
      missingBeatEvent.plot.foreshadowing[0]!.beats[0]! as {
        eventId: string | null;
      }
    ).eventId = null;
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(missingBeatEvent).success
    ).toBe(false);
  });

  it("keeps legacy foreshadowing records compatible while validating planning anchors", () => {
    const legacy = LongWorkspaceIndexSnapshotSchema.parse(workspaceIndex());
    const legacyThread = legacy.plot.foreshadowing[0]!;
    const legacyBeat = legacyThread.beats[0]!;
    expect("hiddenTruth" in legacyThread).toBe(false);
    expect("plannedSpan" in legacyThread).toBe(false);
    expect("volumeId" in legacyBeat).toBe(false);
    expect("arcId" in legacyBeat).toBe(false);

    const volumePlanned = workspaceIndex();
    const volumeThread = volumePlanned.plot.foreshadowing[0]!;
    Object.assign(volumeThread, {
      hiddenTruth: "寄信人正是失踪多年的兄长。",
      plannedSpan: "cross_volume"
    });
    Object.assign(volumeThread.beats[0]!, {
      volumeId: "volume_one",
      eventId: null,
      placementId: null,
      chapterCardId: null
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(volumePlanned).success
    ).toBe(true);

    const arcPlanned = workspaceIndex();
    Object.assign(arcPlanned.plot.foreshadowing[0]!.beats[0]!, {
      arcId: "arc_letter"
    });
    expect(LongWorkspaceIndexSnapshotSchema.safeParse(arcPlanned).success).toBe(
      true
    );

    const missingAnchor = workspaceIndex();
    Object.assign(missingAnchor.plot.foreshadowing[0]!.beats[0]!, {
      volumeId: "volume_missing"
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(missingAnchor).success
    ).toBe(false);

    const conflictingAnchors = workspaceIndex();
    conflictingAnchors.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    Object.assign(conflictingAnchors.plot.foreshadowing[0]!.beats[0]!, {
      volumeId: "volume_two",
      arcId: "arc_letter"
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(conflictingAnchors).success
    ).toBe(false);

    const conflictingEventVolume = workspaceIndex();
    conflictingEventVolume.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    conflictingEventVolume.plot.arcs.push({
      id: "arc_second",
      volumeId: "volume_two",
      title: "第二卷主线",
      order: 1,
      outline: ""
    });
    Object.assign(conflictingEventVolume.plot.foreshadowing[0]!.beats[0]!, {
      volumeId: "volume_two",
      arcId: null,
      placementId: null,
      chapterCardId: null
    });
    const conflictingEventVolumeResult =
      LongWorkspaceIndexSnapshotSchema.safeParse(conflictingEventVolume);
    expect(conflictingEventVolumeResult.success).toBe(false);
    if (!conflictingEventVolumeResult.success) {
      expect(
        conflictingEventVolumeResult.error.issues.some(({ message }) =>
          message.includes("planning volume must match its concrete event")
        )
      ).toBe(true);
    }
  });

  it("derives non-abandoned foreshadowing status from committed beats", () => {
    const inconsistent = commitFirstChapter(workspaceIndex());
    (
      inconsistent.plot.foreshadowing[0]! as {
        status: "planned" | "open" | "progressing" | "resolved" | "abandoned";
      }
    ).status = "planned";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(inconsistent).success
    ).toBe(false);

    const explicitlyAbandoned = commitFirstChapter(workspaceIndex());
    (
      explicitlyAbandoned.plot.foreshadowing[0]! as {
        status: "planned" | "open" | "progressing" | "resolved" | "abandoned";
      }
    ).status = "abandoned";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(explicitlyAbandoned).success
    ).toBe(true);

    const uncommittedButOpen = workspaceIndex();
    (
      uncommittedButOpen.plot.foreshadowing[0]! as {
        status: "planned" | "open" | "progressing" | "resolved" | "abandoned";
      }
    ).status = "open";
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(uncommittedButOpen).success
    ).toBe(false);
  });

  it("validates a long before-chain iteratively without overflowing the stack", () => {
    const large = workspaceIndex();
    const eventCount = 2_500;
    large.plot.storyEvents = Array.from({ length: eventCount }, (_, index) => ({
      id: `event_e${index}`,
      title: `事件 ${index + 1}`,
      summary: "",
      timeMode: "sequence" as const,
      timeLabel: "",
      storyOrder: index + 1,
      location: "",
      arcIds: [],
      characterIds: []
    }));
    large.plot.eventConnections = Array.from(
      { length: eventCount - 1 },
      (_, index) => ({
        id: `connection_c${index}`,
        sourceEventId: `event_e${index}`,
        targetEventId: `event_e${index + 1}`,
        type: "before" as const,
        note: ""
      })
    );
    large.plot.narrativePlacements = [];
    large.plot.foreshadowing = [];

    expect(LongWorkspaceIndexSnapshotSchema.safeParse(large).success).toBe(
      true
    );
  });

  it("defines a long-only agent profile without widening shared agent schemas", () => {
    const profile = LongAgentProfileSchema.parse({
      workspaceType: "long",
      id: "long",
      label: "长篇",
      description: "维护全书设定、剧情、正文与连续性记录。",
      systemPrompt: "根据章卡规划并编写当前章小说正文。",
      welcomeShortcuts: ["写当前章", "续写当前章", "规划下一章"],
      readAccess: {
        workspaceRoots: ["plot_design", "draft", "continuity_ledger"],
        materialKinds: ["draft"],
        skillKinds: ["general", "style"]
      },
      writeAccess: {
        workspaceRoots: ["draft"],
        capabilities: ["write_chapter_files"]
      }
    });

    expect(profile.id).toBe("long");
    expect(WorkspaceTypeSchema.safeParse(profile.workspaceType).success).toBe(
      false
    );
  });

  it("provides a single unified long agent covering every workspace root", () => {
    expect(DEFAULT_LONG_AGENT_PROFILES.map(({ id }) => id)).toEqual(["long"]);
    expect(resolveLongAgentIdForRoot("worldbuilding")).toBe("long");
    expect(resolveLongAgentIdForRoot("character_design")).toBe("long");
    expect(resolveLongAgentIdForRoot("plot_design")).toBe("long");
    expect(resolveLongAgentIdForRoot("draft")).toBe("long");
    expect(resolveLongAgentIdForRoot("continuity_ledger")).toBe("long");
    expect(rendererResolveLongAgentIdForRoot).toBe(resolveLongAgentIdForRoot);

    const profile = DEFAULT_LONG_AGENT_PROFILES[0]!;
    expect(profile.label).toBe("长篇智能体");
    expect(profile.readAccess.workspaceRoots).toEqual([
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]);
    expect(profile.writeAccess.workspaceRoots).toEqual(
      profile.readAccess.workspaceRoots
    );
    expect(profile.writeAccess.capabilities).toEqual([
      "query_structure",
      "mutate_structure",
      "write_chapter_files",
      "commit_ledger"
    ]);
  });

  it("provides the unified English eight-tool default prompt", () => {
    const { systemPrompt } = DEFAULT_LONG_AGENT_PROFILES[0]!;
    for (const tool of [
      "list",
      "read",
      "create",
      "edit",
      "delete",
      "query_linked_material_entries",
      "load_skill",
      "propose_continuity_commit"
    ]) {
      expect(systemPrompt).toContain(tool);
    }
    expect(systemPrompt).toContain("worlditem_");
    expect(systemPrompt).toContain("character_overview");
    expect(systemPrompt).toContain("storyplot_");
    expect(systemPrompt).toContain("foreshadow_");
    expect(systemPrompt).toContain(
      "current_state or history read without chapter_id"
    );
    expect(systemPrompt).toContain("may be written at create time");
    expect(systemPrompt).toContain(
      "meta.category_id and a non-empty meta.title are both mandatory"
    );
    expect(systemPrompt).toContain("plot-point summary");
    expect(systemPrompt).toContain(
      "do not create a story plot to hold that summary"
    );
    expect(systemPrompt).toContain("meta.document=current_state or history");
    expect(systemPrompt).not.toContain("continuity_character_current_state");
    expect(systemPrompt).toContain(
      "You are DeepWrite's local creative collaboration agent"
    );
    expect(systemPrompt).toContain("list requires both stage and scope_id");
    expect(systemPrompt).toContain("Do not list leaf objects");
    expect(systemPrompt).toContain("Continuity does not accept arc_");
    expect(systemPrompt).toContain(
      "An id returned by list is not automatically a valid next scope_id"
    );
    expect(systemPrompt).not.toContain(
      "A single list call returns all entries for the requested stage without pagination."
    );
  });

  it("keeps retired long tools and storage details out of the default prompt", () => {
    const { systemPrompt } = DEFAULT_LONG_AGENT_PROFILES[0]!;
    for (const retired of [
      "list_setting",
      "search_setting",
      "read_setting",
      "create_setting",
      "write_setting",
      "edit_setting",
      "list_plot_design",
      "search_plot_design",
      "read_plot_design",
      "create_plot_design",
      "write_plot_design",
      "edit_plot_design",
      "write_chapter_draft",
      "edit_chapter_draft",
      "list_continuity_files",
      "read_continuity_file",
      "create_continuity_file",
      "write_continuity_file",
      "edit_continuity_file",
      "propose_long_mutation",
      "get_long_chapter_readiness",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace"
    ]) {
      expect(systemPrompt).not.toContain(retired);
    }
    expect(systemPrompt).not.toContain("bookId");
    expect(systemPrompt).toContain(
      "Do not request, infer, or repeat implementation details such as file paths or file_id."
    );
  });
});
