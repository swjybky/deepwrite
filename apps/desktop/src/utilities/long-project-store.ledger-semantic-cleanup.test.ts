import { LongLedgerCommitRecordSchema } from "@deepwrite/contracts";
import {
  FIXED_NOW,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId,
  sha256Hex,
  readFile,
  writeFile
} from "./long-project-store.test-support";

const chapterSummary = {
  timeline: "时间线已经核验。",
  characterStates: "人物状态已经核验。",
  factionStates: "阵营状态已经核验。",
  realmStates: "境界状态已经核验。",
  foreshadowingStates: "伏笔状态已经核验。",
  continuityNotes: "连续性已经核验。"
};

const coverage = {
  character: { status: "unchanged" as const, note: "人物状态已核验。" },
  plot: { status: "changed" as const, note: "剧情事实已更新。" },
  foreshadowing: { status: "unchanged" as const, note: "伏笔已核验。" },
  world: { status: "unchanged" as const, note: "世界状态已核验。" },
  knowledge: { status: "changed" as const, note: "认知边界已更新。" },
  openLoops: { status: "changed" as const, note: "开放事项已更新。" }
};

function chapterFiles(chapterCardId: string) {
  const storage = sha256Hex(chapterCardId).slice(0, 32);
  const file = (id: string, path: string) =>
    createEmptyLongMarkdownFileReference(id, path, FIXED_NOW);
  return {
    chapterCardId,
    bodyStatus: "empty" as const,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${storage}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${storage}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${storage}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${storage}/handoff.md`
    ),
    foreshadowingChanges: file(
      longChapterForeshadowingChangesFileId(chapterCardId),
      longChapterContinuityFilePath(chapterCardId, "foreshadowing-changes.md")
    ),
    worldReveals: null,
    characterContinuity: [],
    commitId: null
  };
}

async function addChapter(
  projectStore: Awaited<ReturnType<typeof createFixture>>["projectStore"],
  projectDirectory: string,
  chapterCardId: string,
  narrativeOrder: number
) {
  const opened = await projectStore.openBook(projectDirectory);
  await projectStore.applyWorkspaceOperations(projectDirectory, {
    batch: {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "chapter.create",
          chapterCard: {
            id: chapterCardId,
            volumeId: opened.book.workspaceIndex.plot.volumes[0]!.id,
            primaryArcId: opened.book.workspaceIndex.plot.arcs[0]!.id,
            title: `第${narrativeOrder}章`,
            narrativeOrder
          },
          files: chapterFiles(chapterCardId)
        }
      ],
      documentWrites: []
    }
  });
}

async function commitV2(
  projectStore: Awaited<ReturnType<typeof createFixture>>["projectStore"],
  projectDirectory: string,
  chapterCardId: string
) {
  await projectStore.writeChapter(projectDirectory, {
    chapterCardId,
    body: { content: `${chapterCardId} 正文。` },
    characterState: { content: `${chapterCardId} 章末状态。` },
    handoff: { content: `${chapterCardId} 文本交接。` }
  });
  return await projectStore.commitChapter(projectDirectory, {
    mode: "structured",
    chapterCardId,
    commitMessage: `提交 ${chapterCardId} 的 v2 记录`,
    chapterSummary,
    placementDecisions: {},
    foreshadowingBeatDecisions: {},
    fileUpdates: []
  });
}

async function commitV3(
  projectStore: Awaited<ReturnType<typeof createFixture>>["projectStore"],
  projectDirectory: string,
  chapterCardId: string,
  options: {
    factId: string;
    subjectId: string;
    value: string;
    audienceId?: string;
    loopSubjectId?: string;
  }
) {
  const loopId = `loop_${options.factId}`;
  await projectStore.writeChapter(projectDirectory, {
    chapterCardId,
    body: { content: `${chapterCardId} 类型化正文。` },
    characterState: { content: "" },
    handoff: { content: "" }
  });
  return await projectStore.commitChapter(projectDirectory, {
    mode: "structured",
    chapterCardId,
    commitMessage: `提交 ${chapterCardId} 的 v3 记录`,
    chapterSummary,
    placementDecisions: {},
    foreshadowingBeatDecisions: {},
    fileUpdates: [],
    coverage,
    factMutations: [
      {
        factId: options.factId,
        domain: "plot",
        subjectId: options.subjectId,
        field: "state",
        value: options.value,
        evidence: `${chapterCardId} 正文证据。`
      }
    ],
    knowledgeMutations: [
      {
        factId: options.factId,
        audienceType: options.audienceId === undefined ? "reader" : "character",
        audienceId: options.audienceId ?? null,
        level: "knows",
        evidence: `${chapterCardId} 认知证据。`
      }
    ],
    openLoopMutations: [
      {
        loopId,
        kind: options.loopSubjectId?.startsWith("character_")
          ? "character"
          : "plot",
        status: "open",
        detail: `${chapterCardId} 尚未解决。`,
        subjectId: options.loopSubjectId ?? options.subjectId,
        factId: options.factId,
        evidence: `${chapterCardId} 开放事项证据。`
      }
    ],
    chapterOutputs: {
      characterState: `${chapterCardId} 类型化章末状态。`,
      handoff: {
        summary: `${chapterCardId} 类型化交接。`,
        mustCarry: [],
        nextChapterConstraints: [],
        openLoops: [loopId]
      }
    }
  });
}

async function deleteEntity(
  projectStore: Awaited<ReturnType<typeof createFixture>>["projectStore"],
  projectDirectory: string,
  operation: {
    type: "chapter.delete" | "character.delete" | "arc.delete";
    id: string;
  }
) {
  const batch = {
    updatedAt: FIXED_NOW,
    operations: [operation],
    documentWrites: []
  };
  const preview = await projectStore.previewWorkspaceOperations(
    projectDirectory,
    batch
  );
  return await projectStore.applyWorkspaceOperations(projectDirectory, {
    batch: { ...batch, expectedImpact: preview.confirmation }
  });
}

async function readRecord(
  projectDirectory: string,
  entry: {
    recordFile: { path: string };
  }
) {
  return LongLedgerCommitRecordSchema.parse(
    JSON.parse(
      await readFile(join(projectDirectory, entry.recordFile.path), "utf8")
    )
  );
}

describe("LongProjectStore: ledger semantic cleanup", () => {
  it("uses a remaining v2 record as the replay watermark after deleting a later v3 commit", async () => {
    const { projectStore, created } = await createFixture("cleanup-v2-v3");
    const firstChapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const first = await commitV2(
      projectStore,
      created.projectDirectory,
      firstChapterId
    );
    await addChapter(
      projectStore,
      created.projectDirectory,
      "chapter_second",
      2
    );
    await commitV3(projectStore, created.projectDirectory, "chapter_second", {
      factId: "fact_second",
      subjectId: "chapter_second",
      value: "第二章状态。"
    });

    const result = await deleteEntity(projectStore, created.projectDirectory, {
      type: "chapter.delete",
      id: "chapter_second"
    });
    expect(result.book.workspaceIndex.ledger.projection).toMatchObject({
      throughCommitId: first.record.id,
      facts: [],
      knowledge: [],
      openLoops: [],
      latestHandoff: {
        commitId: first.record.id,
        chapterCardId: firstChapterId,
        summary: "最近一次连续性归档已删除，请依据当前剩余记录继续创作。"
      }
    });
    const remaining = await readRecord(
      created.projectDirectory,
      result.book.workspaceIndex.ledger.commits[0]!
    );
    expect(remaining).toMatchObject({
      schemaVersion: 2,
      chapterOutputs: {
        handoff: {
          summary: "最近一次连续性归档已删除，请依据当前剩余记录继续创作。",
          openLoops: []
        }
      }
    });
  });

  it("uses a later v2 record as the replay watermark after deleting the preceding v3 commit", async () => {
    const { projectStore, created } = await createFixture("cleanup-v3-v2");
    const firstChapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    await commitV3(projectStore, created.projectDirectory, firstChapterId, {
      factId: "fact_first",
      subjectId: firstChapterId,
      value: "第一章状态。"
    });
    await addChapter(
      projectStore,
      created.projectDirectory,
      "chapter_second",
      2
    );
    const second = await commitV2(
      projectStore,
      created.projectDirectory,
      "chapter_second"
    );

    const result = await deleteEntity(projectStore, created.projectDirectory, {
      type: "chapter.delete",
      id: firstChapterId
    });
    expect(result.book.workspaceIndex.ledger.projection).toMatchObject({
      throughCommitId: second.record.id,
      facts: [],
      latestHandoff: {
        commitId: second.record.id,
        chapterCardId: "chapter_second"
      }
    });
    const remaining = await readRecord(
      created.projectDirectory,
      result.book.workspaceIndex.ledger.commits[0]!
    );
    expect(remaining.schemaVersion).toBe(2);
    expect(remaining.chapterOutputs.handoff.summary).toBe(
      "最近一次连续性归档已删除，请依据当前剩余记录继续创作。"
    );
  });

  it("removes orphaned semantic history while preserving later unrelated outcomes", async () => {
    const { projectStore, created } = await createFixture(
      "cleanup-semantic-history"
    );
    const chapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const characterId = "character_cleanup";
    const eventId = "event_cleanup";
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "character.create",
            character: {
              id: characterId,
              name: "待删除人物",
              group: "protagonist",
              order: 1,
              aliases: []
            },
            files: {
              characterId,
              coreProfile: createEmptyLongMarkdownFileReference(
                longCharacterCoreProfileFileId(characterId),
                longCharacterFilePath(characterId, "core-profile.md"),
                FIXED_NOW
              ),
              relationships: createEmptyLongMarkdownFileReference(
                longCharacterRelationshipsFileId(characterId),
                longCharacterFilePath(characterId, "relationships.md"),
                FIXED_NOW
              )
            }
          },
          {
            type: "event.create",
            event: {
              id: eventId,
              title: "持续事件",
              summary: "事件与人物曾经有关。",
              timeMode: "sequence",
              timeLabel: "第一天",
              storyOrder: 1,
              location: "旧宅",
              arcIds: [arcId],
              characterIds: [characterId]
            }
          }
        ],
        documentWrites: []
      }
    });
    const first = await commitV3(
      projectStore,
      created.projectDirectory,
      chapterId,
      {
        factId: "fact_event_state",
        subjectId: eventId,
        value: "事件首次发生。",
        audienceId: characterId,
        loopSubjectId: characterId
      }
    );
    await addChapter(
      projectStore,
      created.projectDirectory,
      "chapter_second",
      2
    );
    const second = await commitV3(
      projectStore,
      created.projectDirectory,
      "chapter_second",
      {
        factId: "fact_event_state",
        subjectId: eventId,
        value: "事件仍在继续。",
        audienceId: characterId,
        loopSubjectId: eventId
      }
    );

    const result = await deleteEntity(projectStore, created.projectDirectory, {
      type: "character.delete",
      id: characterId
    });
    expect(result.book.workspaceIndex.ledger.projection).toMatchObject({
      facts: [
        expect.objectContaining({
          factId: "fact_event_state",
          value: "事件仍在继续。"
        })
      ],
      knowledge: [],
      openLoops: [
        expect.objectContaining({
          loopId: "loop_fact_event_state",
          subjectId: eventId
        })
      ],
      latestHandoff: expect.objectContaining({
        commitId: second.record.id,
        openLoops: ["loop_fact_event_state"]
      })
    });
    const records = await Promise.all(
      result.book.workspaceIndex.ledger.commits.map(
        async (entry) => await readRecord(created.projectDirectory, entry)
      )
    );
    expect(records[0]).toMatchObject({
      id: first.record.id,
      factChanges: [
        expect.objectContaining({
          after: expect.objectContaining({ factId: "fact_event_state" })
        })
      ],
      knowledgeChanges: [],
      openLoopChanges: []
    });
    expect(records[1]).toMatchObject({
      id: second.record.id,
      factChanges: [
        expect.objectContaining({
          after: expect.objectContaining({ value: "事件仍在继续。" })
        })
      ],
      knowledgeChanges: [],
      openLoopChanges: [
        expect.objectContaining({
          after: expect.objectContaining({ subjectId: eventId })
        })
      ]
    });
    expect(JSON.stringify(records)).not.toContain(characterId);
  });

  it("removes dependent knowledge and loops for a historical fact absent from the projection", async () => {
    const { projectStore, created } = await createFixture(
      "cleanup-hidden-historical-fact"
    );
    const chapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    const volumeId = created.book.workspaceIndex.plot.volumes[0]!.id;
    const committed = await commitV2(
      projectStore,
      created.projectDirectory,
      chapterId
    );
    const entry = (await projectStore.openBook(created.projectDirectory)).book
      .workspaceIndex.ledger.commits[0]!;
    const recordPath = join(created.projectDirectory, entry.recordFile.path);
    const hiddenFactRecord = LongLedgerCommitRecordSchema.parse({
      ...committed.record,
      factChanges: [
        {
          after: {
            factId: "fact_hidden_arc",
            domain: "plot",
            subjectId: arcId,
            field: "state",
            value: "旧弧线曾有隐藏状态。",
            sourceCommitId: committed.record.id,
            sourceChapterCardId: chapterId,
            evidence: "旧记录证据。"
          }
        }
      ],
      knowledgeChanges: [
        {
          after: {
            factId: "fact_hidden_arc",
            audienceType: "reader",
            audienceId: null,
            level: "knows",
            sourceCommitId: committed.record.id,
            sourceChapterCardId: chapterId,
            evidence: "读者已知证据。"
          }
        }
      ],
      openLoopChanges: [
        {
          after: {
            loopId: "loop_hidden_arc",
            kind: "plot",
            status: "open",
            detail: "隐藏状态仍待处理。",
            subjectId: volumeId,
            factId: "fact_hidden_arc",
            sourceCommitId: committed.record.id,
            sourceChapterCardId: chapterId,
            evidence: "隐藏开放事项证据。"
          }
        }
      ],
      chapterOutputs: {
        ...committed.record.chapterOutputs,
        handoff: {
          ...committed.record.chapterOutputs.handoff,
          summary: "旧记录曾引用隐藏开放事项。",
          openLoops: ["loop_hidden_arc"]
        }
      }
    });
    await writeFile(
      recordPath,
      `${JSON.stringify(
        {
          ...hiddenFactRecord,
          reversible: true,
          sourceProjectRevision: 1,
          committedWorkspaceRevision: 2,
          previousChapterCommitId: null,
          fileChanges: [],
          before: { revision: "v1:legacy" }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await deleteEntity(projectStore, created.projectDirectory, {
      type: "arc.delete",
      id: arcId
    });
    const cleaned = await readRecord(
      created.projectDirectory,
      result.book.workspaceIndex.ledger.commits[0]!
    );
    expect(cleaned.factChanges).toEqual([]);
    expect(cleaned.knowledgeChanges).toEqual([]);
    expect(cleaned.openLoopChanges).toEqual([]);
    expect(cleaned.chapterOutputs.handoff.openLoops).toEqual([]);
    expect(result.book.workspaceIndex.ledger.projection).toEqual({
      throughCommitId: null,
      facts: [],
      knowledge: [],
      openLoops: [],
      latestHandoff: null
    });
  });
});
