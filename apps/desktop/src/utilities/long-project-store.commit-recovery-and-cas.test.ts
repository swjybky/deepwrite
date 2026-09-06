import { existsSync, unlinkSync } from "node:fs";
import {
  LongLedgerCommitRecordSchema,
  longWorldbuildingContentPath
} from "@deepwrite/contracts";
import {
  FIXED_NOW,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectStore,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longWorldbuildingFileId,
  lstat,
  projectTransactionContentSha256,
  readFile,
  writeFile,
  writeFileSync
} from "./long-project-store.test-support";

async function createTextWorldbuilding(input: {
  projectStore: LongProjectStore;
  projectDirectory: string;
  id: string;
  content: string;
}) {
  const file = createEmptyLongMarkdownFileReference(
    longWorldbuildingFileId(input.id),
    longWorldbuildingContentPath(input.id),
    FIXED_NOW
  );
  const result = await input.projectStore.applyWorkspaceOperations(
    input.projectDirectory,
    {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuilding.create",
            category: {
              id: input.id,
              title: "临时世界观",
              order: 100,
              format: "text",
              contentAuthority: "markdown",
              file
            }
          }
        ],
        documentWrites: [
          {
            proposalId: `proposal_${input.id}`,
            fileId: file.id,
            mode: "create",
            updatedAt: FIXED_NOW,
            content: input.content,
            reason: "建立删除事务测试文件"
          }
        ]
      }
    }
  );
  return {
    file,
    category: result.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === input.id
    )!
  };
}

async function deleteWorldbuilding(input: {
  projectStore: LongProjectStore;
  projectDirectory: string;
  id: string;
}) {
  const batch = {
    updatedAt: FIXED_NOW,
    operations: [{ type: "worldbuilding.delete" as const, id: input.id }],
    documentWrites: []
  };
  const preview = await input.projectStore.previewWorkspaceOperations(
    input.projectDirectory,
    batch
  );
  return await input.projectStore.applyWorkspaceOperations(
    input.projectDirectory,
    {
      batch: { ...batch, expectedImpact: preview.confirmation }
    }
  );
}

describe("LongProjectStore: commit recovery and direct writes", () => {
  it("physically deletes files transactionally and permits the same id and path to be recreated", async () => {
    const { projectStore, created } = await createFixture("delete-recreate");
    const id = "world_delete_recreate";
    const first = await createTextWorldbuilding({
      projectStore,
      projectDirectory: created.projectDirectory,
      id,
      content: "初始世界观内容"
    });

    await deleteWorldbuilding({
      projectStore,
      projectDirectory: created.projectDirectory,
      id
    });
    await expect(
      lstat(join(created.projectDirectory, first.file.path))
    ).rejects.toMatchObject({ code: "ENOENT" });

    const recreated = await createTextWorldbuilding({
      projectStore,
      projectDirectory: created.projectDirectory,
      id,
      content: "重建后的世界观内容"
    });
    expect(recreated.file).toEqual(first.file);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: recreated.file.id
      })
    ).resolves.toMatchObject({ content: "重建后的世界观内容" });
  });

  it("deletes an indexed file even when an external editor changed it", async () => {
    const { projectStore, created } = await createFixture(
      "delete-external-edit"
    );
    const id = "world_external_edit";
    const { file } = await createTextWorldbuilding({
      projectStore,
      projectDirectory: created.projectDirectory,
      id,
      content: "DeepWrite 初始内容"
    });
    await writeFile(
      join(created.projectDirectory, file.path),
      "外部编辑器刚刚写入的内容",
      "utf8"
    );

    await deleteWorldbuilding({
      projectStore,
      projectDirectory: created.projectDirectory,
      id
    });
    await expect(
      lstat(join(created.projectDirectory, file.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
    const reopened = await projectStore.openBook(created.projectDirectory);
    expect(
      reopened.book.workspaceIndex.worldbuilding.some(
        ({ id: candidateId }) => candidateId === id
      )
    ).toBe(false);
  });

  it("serializes direct writes and keeps the latest content", async () => {
    const { projectStore, created } = await createFixture("last-write-wins");
    const body = firstChapterFiles(created.book).body;

    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "第一版"
    });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "第二版"
    });

    await expect(
      projectStore.readDocument(created.projectDirectory, { fileId: body.id })
    ).resolves.toMatchObject({ content: "第二版" });
    expect(
      await readFile(
        join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH),
        "utf8"
      )
    ).not.toMatch(/"(?:revision|[^"]*Revision|[^"]*Revisions)"\s*:/u);
  });

  it("recovers an interrupted chapter commit atomically and keeps body editable and continuity protected", async () => {
    const { projectStore, created } = await createFixture("commit-recovery");
    const chapter = created.book.workspaceIndex.chapters[0]!;
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: chapter.chapterCardId,
      body: { content: "雨夜里，她收到一封信。" },
      characterState: { content: "林岚开始怀疑寄信人。" },
      handoff: { content: "下一章追查信封上的旧邮戳。" }
    });
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const beforeCommit = await Promise.all(
      [indexPath, manifestPath].map(async (path) =>
        projectTransactionContentSha256(await readFile(path))
      )
    );

    const ledgerDirectory = join(created.projectDirectory, "long", "ledger");
    let interrupted = false;
    const racingStore = new LongProjectStore({
      now: () => {
        if (!interrupted) {
          interrupted = true;
          writeFileSync(ledgerDirectory, "blocked", "utf8");
        }
        return FIXED_NOW;
      }
    });
    await expect(
      racingStore.commitChapter(created.projectDirectory, {
        mode: "text_files",
        chapterCardId: chapter.chapterCardId,
        foreshadowingBeatDecisions: {},
        commitMessage: "验证提交故障恢复"
      })
    ).rejects.toThrow();
    const afterFailure = await Promise.all(
      [indexPath, manifestPath].map(async (path) =>
        projectTransactionContentSha256(await readFile(path))
      )
    );
    expect(afterFailure).toEqual(beforeCommit);

    if (existsSync(ledgerDirectory)) unlinkSync(ledgerDirectory);
    const recovered = await projectStore.openBook(created.projectDirectory);
    expect(recovered.book.workspaceIndex.ledger.commits).toEqual([]);
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files",
        chapterCardId: chapter.chapterCardId,
        foreshadowingBeatDecisions: {},
        commitMessage: "故障清理后重新提交"
      }
    );
    const commitId = committed.record.id;

    await projectStore.writeDocument(created.projectDirectory, {
      fileId: chapter.body.id,
      content: "提交后直接精修正文。"
    });
    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: chapter.characterState.id,
        content: "提交后直接精修章末状态。"
      })
    ).rejects.toThrow("已提交的连续性文件为只读");
    const edited = await projectStore.openBook(created.projectDirectory);
    expect(edited.book.workspaceIndex.chapters[0]!.commitId).toBe(commitId);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: chapter.body.id
      })
    ).resolves.toMatchObject({ content: "提交后直接精修正文。" });
  });

  it("rewrites committed ledger decisions in the same deletion transaction", async () => {
    const { projectStore, created } = await createFixture(
      "ledger-decision-delete"
    );
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "event.create",
            event: {
              id: "event_delete_decision",
              title: "收到旧信",
              summary: "雨夜收到旧信。",
              timeMode: "sequence",
              timeLabel: "第一天",
              storyOrder: 1,
              location: "旧宅",
              arcIds: [arcId],
              characterIds: []
            }
          },
          {
            type: "placement.create",
            placement: {
              id: "placement_delete_decision",
              eventId: "event_delete_decision",
              chapterCardId: chapter.chapterCardId,
              orderInChapter: 1,
              mode: "scene",
              disclosure: "hint",
              writingPrompt: "呈现旧信。",
              status: "planned",
              commitId: null
            }
          },
          {
            type: "foreshadowing.create",
            thread: {
              id: "foreshadow_delete_decision",
              title: "寄信人身份",
              coreQuestion: "谁寄出了旧信？",
              truthEventId: "event_delete_decision",
              expectedReaderEffect: "产生怀疑。",
              status: "planned",
              beats: [
                {
                  id: "beat_delete_decision",
                  type: "plant",
                  order: 1,
                  eventId: "event_delete_decision",
                  placementId: "placement_delete_decision",
                  chapterCardId: chapter.chapterCardId,
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
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: chapter.chapterCardId,
      body: { content: "正文写出旧信。" },
      characterState: { content: "人物开始追查旧信。" },
      handoff: { content: "下一章继续追查。" }
    });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: chapter.foreshadowingChanges.id,
      content: "寄信人身份伏笔已经种下。"
    });
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files",
        chapterCardId: chapter.chapterCardId,
        foreshadowingBeatDecisions: {
          beat_delete_decision: {
            status: "committed",
            note: "正文明确出现旧信。"
          }
        },
        commitMessage: "提交待删除的语义决策"
      }
    );

    const deleteBeatBatch = {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "foreshadowingBeat.delete" as const,
          id: "beat_delete_decision"
        }
      ],
      documentWrites: []
    };
    const beatPreview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      deleteBeatBatch
    );
    expect(beatPreview.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: committed.record.id,
        removeForeshadowingBeatIds: ["beat_delete_decision"],
        reconcileForeshadowingThreadIds: ["foreshadow_delete_decision"]
      })
    ]);
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        ...deleteBeatBatch,
        expectedImpact: beatPreview.confirmation
      }
    });

    const afterBeatDelete = await projectStore.openBook(
      created.projectDirectory
    );
    const entry = afterBeatDelete.book.workspaceIndex.ledger.commits[0]!;
    let record = LongLedgerCommitRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(created.projectDirectory, entry.recordFile.path),
          "utf8"
        )
      )
    );
    expect(record.foreshadowingBeatChanges).toEqual([]);
    expect(record.foreshadowingThreadChanges).toEqual([]);
    expect(
      afterBeatDelete.book.workspaceIndex.plot.foreshadowing[0]
    ).toMatchObject({ status: "planned", beats: [] });

    const deletePlacementBatch = {
      updatedAt: FIXED_NOW,
      operations: [
        { type: "placement.delete" as const, id: "placement_delete_decision" }
      ],
      documentWrites: []
    };
    const placementPreview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      deletePlacementBatch
    );
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        ...deletePlacementBatch,
        expectedImpact: placementPreview.confirmation
      }
    });
    const afterPlacementDelete = await projectStore.openBook(
      created.projectDirectory
    );
    record = LongLedgerCommitRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(
            created.projectDirectory,
            afterPlacementDelete.book.workspaceIndex.ledger.commits[0]!
              .recordFile.path
          ),
          "utf8"
        )
      )
    );
    expect(record.placementChanges).toEqual([]);
    expect(
      afterPlacementDelete.book.workspaceIndex.ledger.commits[0]!.placementIds
    ).toEqual([]);
  });
});
