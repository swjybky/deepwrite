import { relative } from "node:path";
import type { Dirent } from "node:fs";
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
  projectTransactionContentSha256,
  readFile,
  readdir
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
  const storage = projectTransactionContentSha256(chapterCardId).slice(0, 32);
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

async function snapshotMarkdown(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, {
      withFileTypes: true
    })) as Dirent[];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        snapshot[relative(root, path)] = (await readFile(path)).toString(
          "base64"
        );
      }
    }
  }
  await visit(root);
  return snapshot;
}

async function commitTypedChapter(
  projectStore: Awaited<ReturnType<typeof createFixture>>["projectStore"],
  projectDirectory: string,
  chapterCardId: string,
  bookId: string,
  value: string,
  handoff: string
) {
  await projectStore.writeChapter(projectDirectory, {
    chapterCardId,
    body: { content: `${chapterCardId} 的正文。` },
    characterState: { content: "" },
    handoff: { content: "" }
  });
  return await projectStore.commitChapter(projectDirectory, {
    mode: "structured",
    chapterCardId,
    commitMessage: `提交 ${chapterCardId} 的结构化连续性`,
    chapterSummary,
    placementDecisions: {},
    foreshadowingBeatDecisions: {},
    fileUpdates: [],
    coverage,
    factMutations: [
      {
        factId: "fact_shared_state",
        domain: "plot",
        subjectId: bookId,
        field: "state",
        value,
        evidence: `${chapterCardId} 的正文证据。`
      }
    ],
    knowledgeMutations: [
      {
        factId: "fact_shared_state",
        audienceType: "reader",
        audienceId: null,
        level: value.includes("后") ? "misled" : "knows",
        evidence: `${chapterCardId} 的认知证据。`
      }
    ],
    openLoopMutations: [
      {
        loopId: "loop_shared_state",
        kind: "plot",
        status: value.includes("后") ? "resolved" : "open",
        detail: value,
        subjectId: bookId,
        factId: "fact_shared_state",
        evidence: `${chapterCardId} 的开放事项证据。`
      }
    ],
    chapterOutputs: {
      characterState: `${chapterCardId} 的章末状态。`,
      handoff: {
        summary: handoff,
        mustCarry: [value],
        nextChapterConstraints: [`承接 ${chapterCardId}`],
        openLoops: ["loop_shared_state"]
      }
    }
  });
}

describe("LongProjectStore: delete last ledger commit", () => {
  it("rejects an older record and rolls the latest semantic commit back without touching Markdown", async () => {
    const { projectStore, created } = await createFixture("delete-ledger-last");
    const firstChapterId =
      created.book.workspaceIndex.chapters[0]!.chapterCardId;
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: firstChapterId,
      body: { content: "第一章正文。" },
      characterState: { content: "第一章人物状态。" },
      handoff: { content: "第一章交接。" }
    });
    const first = await projectStore.commitChapter(created.projectDirectory, {
      mode: "text_files",
      chapterCardId: firstChapterId,
      foreshadowingBeatDecisions: {},
      commitMessage: "提交第一章"
    });

    const secondChapterId = "chapter_delete_latest";
    await addChapter(
      projectStore,
      created.projectDirectory,
      secondChapterId,
      2
    );
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "event.create",
            event: {
              id: "event_delete_latest",
              title: "雨夜来信",
              summary: "第二章收到来信。",
              timeMode: "sequence",
              timeLabel: "第二天",
              storyOrder: 2,
              location: "旧宅",
              arcIds: [arcId],
              characterIds: []
            }
          },
          {
            type: "placement.create",
            placement: {
              id: "placement_delete_latest",
              eventId: "event_delete_latest",
              chapterCardId: secondChapterId,
              orderInChapter: 1,
              mode: "scene",
              disclosure: "hint",
              writingPrompt: "呈现来信。",
              status: "planned",
              commitId: null
            }
          },
          {
            type: "foreshadowing.create",
            thread: {
              id: "foreshadow_delete_latest",
              title: "寄信人",
              coreQuestion: "谁寄出了信？",
              truthEventId: "event_delete_latest",
              expectedReaderEffect: "产生怀疑。",
              status: "planned",
              beats: [
                {
                  id: "beat_delete_latest",
                  type: "plant",
                  order: 1,
                  eventId: "event_delete_latest",
                  placementId: "placement_delete_latest",
                  chapterCardId: secondChapterId,
                  plannedScope: "",
                  note: "首次出现。",
                  status: "planned",
                  commitId: null
                }
              ]
            }
          }
        ],
        documentWrites: []
      }
    });
    const opened = await projectStore.openBook(created.projectDirectory);
    const second = opened.book.workspaceIndex.chapters.find(
      ({ chapterCardId }) => chapterCardId === secondChapterId
    )!;
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: secondChapterId,
      body: { content: "第二章正文写出旧信。" },
      characterState: { content: "第二章人物状态。" },
      handoff: { content: "第二章交接。" }
    });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: second.foreshadowingChanges.id,
      content: "寄信人伏笔已经种下。"
    });
    const latest = await projectStore.commitChapter(created.projectDirectory, {
      mode: "text_files",
      chapterCardId: secondChapterId,
      foreshadowingBeatDecisions: {
        beat_delete_latest: {
          status: "committed",
          note: "正文明确出现旧信。"
        }
      },
      commitMessage: "提交第二章"
    });
    const beforeMarkdown = await snapshotMarkdown(created.projectDirectory);
    const latestEntry = (
      await projectStore.openBook(created.projectDirectory)
    ).book.workspaceIndex.ledger.commits.at(-1)!;
    const latestRecordPath = join(
      created.projectDirectory,
      latestEntry.recordFile.path
    );

    await expect(
      projectStore.deleteLedgerCommit(created.projectDirectory, {
        commitId: first.record.id
      })
    ).rejects.toThrow("最后一条");
    await expect(readFile(latestRecordPath, "utf8")).resolves.toContain(
      latest.record.id
    );

    await expect(
      projectStore.deleteLedgerCommit(created.projectDirectory, {
        commitId: latest.record.id
      })
    ).resolves.toEqual({
      bookId: created.book.workspaceIndex.bookId,
      deletedCommitId: latest.record.id,
      chapterCardIds: [secondChapterId]
    });
    const rolledBack = await projectStore.openBook(created.projectDirectory);
    expect(rolledBack.book.workspaceIndex.ledger.commits).toHaveLength(1);
    expect(
      rolledBack.book.workspaceIndex.ledger.committedThroughChapterId
    ).toBe(firstChapterId);
    expect(
      rolledBack.book.workspaceIndex.chapters.find(
        ({ chapterCardId }) => chapterCardId === secondChapterId
      )?.commitId
    ).toBeNull();
    expect(
      rolledBack.book.workspaceIndex.plot.narrativePlacements[0]
    ).toMatchObject({ status: "planned", commitId: null });
    expect(rolledBack.book.workspaceIndex.plot.foreshadowing[0]).toMatchObject({
      status: "planned",
      beats: [expect.objectContaining({ status: "planned", commitId: null })]
    });
    await expect(readFile(latestRecordPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(await snapshotMarkdown(created.projectDirectory)).toEqual(
      beforeMarkdown
    );
  }, 15_000);

  it("replays surviving typed records to restore facts, knowledge, loops and handoff", async () => {
    const { projectStore, created } = await createFixture(
      "delete-ledger-projection"
    );
    const firstChapterId =
      created.book.workspaceIndex.chapters[0]!.chapterCardId;
    const first = await commitTypedChapter(
      projectStore,
      created.projectDirectory,
      firstChapterId,
      created.book.workspaceIndex.bookId,
      "前一条状态",
      "前一条交接"
    );
    const secondChapterId = "chapter_projection_second";
    await addChapter(
      projectStore,
      created.projectDirectory,
      secondChapterId,
      2
    );
    const second = await commitTypedChapter(
      projectStore,
      created.projectDirectory,
      secondChapterId,
      created.book.workspaceIndex.bookId,
      "后一条状态",
      "后一条交接"
    );

    await projectStore.deleteLedgerCommit(created.projectDirectory, {
      commitId: second.record.id
    });
    const projection = (await projectStore.openBook(created.projectDirectory))
      .book.workspaceIndex.ledger.projection;
    expect(projection).toMatchObject({
      throughCommitId: first.record.id,
      facts: [
        expect.objectContaining({
          factId: "fact_shared_state",
          value: "前一条状态",
          sourceCommitId: first.record.id
        })
      ],
      knowledge: [
        expect.objectContaining({
          factId: "fact_shared_state",
          level: "knows",
          sourceCommitId: first.record.id
        })
      ],
      openLoops: [
        expect.objectContaining({
          loopId: "loop_shared_state",
          status: "open",
          detail: "前一条状态",
          sourceCommitId: first.record.id
        })
      ],
      latestHandoff: expect.objectContaining({
        summary: "前一条交接",
        commitId: first.record.id,
        chapterCardId: firstChapterId
      })
    });
  }, 15_000);

  it("returns every batch member to pending and leaves the checkpoint files unchanged", async () => {
    const { projectStore, created } = await createFixture(
      "delete-ledger-batch"
    );
    const firstChapter = created.book.workspaceIndex.chapters[0]!;
    const secondChapterId = "chapter_delete_batch_second";
    await addChapter(
      projectStore,
      created.projectDirectory,
      secondChapterId,
      2
    );
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: firstChapter.body.id,
      content: "批量第一章正文。"
    });
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: secondChapterId,
      body: { content: "批量第二章正文。" },
      characterState: { content: "批量章末状态。" },
      handoff: { content: "批量交接。" }
    });
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files_batch",
        chapterCardIds: [firstChapter.chapterCardId, secondChapterId],
        checkpointChapterCardId: secondChapterId,
        foreshadowingBeatDecisions: {},
        commitMessage: "批量提交两章"
      }
    );
    const beforeMarkdown = await snapshotMarkdown(created.projectDirectory);

    const result = await projectStore.deleteLedgerCommit(
      created.projectDirectory,
      { commitId: committed.record.id }
    );
    expect(result.chapterCardIds).toEqual([
      firstChapter.chapterCardId,
      secondChapterId
    ]);
    const rolledBack = await projectStore.openBook(created.projectDirectory);
    expect(
      rolledBack.book.workspaceIndex.chapters.map(
        ({ chapterCardId, commitId }) => ({ chapterCardId, commitId })
      )
    ).toEqual([
      { chapterCardId: firstChapter.chapterCardId, commitId: null },
      { chapterCardId: secondChapterId, commitId: null }
    ]);
    expect(rolledBack.book.workspaceIndex.ledger.commits).toEqual([]);
    expect(
      rolledBack.book.workspaceIndex.ledger.committedThroughChapterId
    ).toBeNull();
    expect(await snapshotMarkdown(created.projectDirectory)).toEqual(
      beforeMarkdown
    );
  }, 15_000);
});
