import { LongLedgerCommitRecordSchema } from "@deepwrite/contracts";
import {
  FIXED_NOW,
  LONG_WORKSPACE_INDEX_PATH,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  sha256Hex,
  readFile,
  writeFile
} from "./long-project-store.test-support";

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function secondChapterFiles(chapterCardId: string) {
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

describe("LongProjectStore: legacy ledger metadata compatibility", () => {
  it("strips retired version and rollback fields before continuing the ledger", async () => {
    const { projectStore, created } = await createFixture(
      "ledger-version-metadata"
    );
    const firstChapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const firstFiles = firstChapterFiles(created.book);
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: firstChapterId,
      body: { content: "第一章正文" },
      characterState: { content: "第一章章末状态" },
      handoff: { content: "下一章继续调查。" }
    });
    const firstCommit = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files",
        chapterCardId: firstChapterId,
        foreshadowingBeatDecisions: {},
        commitMessage: "提交第一章账本"
      }
    );

    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as Record<
      string,
      unknown
    >;
    index.revision = 3;
    index.chapterFileRevisions = { body: "v1:legacy" };
    const ledger = index.ledger as {
      commits: Array<{ recordFile: Record<string, unknown> }>;
    };
    ledger.commits[0]!.recordFile.revision = "v1:legacy";
    await writeFile(indexPath, serializeJson(index), "utf8");

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.revision = 4;
    (manifest.workspaceIndexFile as Record<string, unknown>).revision =
      "v1:legacy";
    await writeFile(manifestPath, serializeJson(manifest), "utf8");

    const recordPath = join(
      created.projectDirectory,
      ledger.commits[0]!.recordFile.path as string
    );
    const legacyRecord = JSON.parse(
      await readFile(recordPath, "utf8")
    ) as Record<string, unknown>;
    legacyRecord.reversible = true;
    legacyRecord.sourceProjectRevision = 2;
    legacyRecord.chapterFileRevisions = { body: "v1:legacy" };
    legacyRecord.continuityFileRevisions = [
      { fileId: firstFiles.characterState.id, revision: "v1:legacy" }
    ];
    legacyRecord.previousChapterCommitId = null;
    legacyRecord.fileChanges = [];
    legacyRecord.before = { revision: "v1:legacy" };
    const continuityFiles = legacyRecord.continuityFiles as Array<
      Record<string, unknown>
    >;
    continuityFiles.forEach((file) => {
      file.revision = "v1:legacy";
    });
    await writeFile(recordPath, serializeJson(legacyRecord), "utf8");

    const reopened = await projectStore.openBook(created.projectDirectory);
    expect(reopened.book.workspaceIndex.ledger.commits[0]!.id).toBe(
      firstCommit.record.id
    );
    for (const path of [manifestPath, indexPath, recordPath]) {
      expect(await readFile(path, "utf8")).not.toMatch(
        /"(?:revision|[^"]*Revision|[^"]*Revisions|reversible|fileChanges|before)"\s*:/u
      );
    }
    const normalizedRecord = LongLedgerCommitRecordSchema.parse(
      JSON.parse(await readFile(recordPath, "utf8"))
    );
    expect(normalizedRecord.schemaVersion).toBe(4);
    expect(normalizedRecord.continuityFiles).toEqual([
      {
        fileId: firstFiles.characterState.id,
        path: firstFiles.characterState.path
      },
      { fileId: firstFiles.handoff.id, path: firstFiles.handoff.path }
    ]);

    const secondChapterId = "chapter_later";
    const laterFiles = secondChapterFiles(secondChapterId);
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "chapter.create",
            chapterCard: {
              id: secondChapterId,
              volumeId: reopened.book.workspaceIndex.plot.volumes[0]!.id,
              primaryArcId: reopened.book.workspaceIndex.plot.arcs[0]!.id,
              title: "第二章",
              narrativeOrder: 2
            },
            files: laterFiles
          }
        ],
        documentWrites: []
      }
    });
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: secondChapterId,
      body: { content: "第二章正文" },
      characterState: { content: "第二章章末状态" },
      handoff: { content: "下一章承接第二章。" }
    });
    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        mode: "text_files",
        chapterCardId: secondChapterId,
        foreshadowingBeatDecisions: {},
        commitMessage: "提交第二章账本"
      })
    ).resolves.toMatchObject({
      record: { sequence: 2, chapterCardId: secondChapterId }
    });
  });

  it("sanitizes ledger-only legacy metadata in public reads and search", async () => {
    const { projectStore, created } = await createFixture(
      "ledger-public-read-version-metadata"
    );
    const chapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: chapterId,
      body: { content: "第一章正文" },
      characterState: { content: "第一章章末状态" },
      handoff: { content: "下一章继续调查。" }
    });
    await projectStore.commitChapter(created.projectDirectory, {
      mode: "text_files",
      chapterCardId: chapterId,
      foreshadowingBeatDecisions: {},
      commitMessage: "公开读取兼容测试"
    });

    const opened = await projectStore.openBook(created.projectDirectory);
    const entry = opened.book.workspaceIndex.ledger.commits[0]!;
    const recordPath = join(created.projectDirectory, entry.recordFile.path);
    const injectRetiredMetadata = async (): Promise<void> => {
      const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<
        string,
        unknown
      >;
      record.reversible = true;
      record.sourceProjectRevision = 41;
      record.rollbackSnapshot = { revision: "v1:legacy" };
      record.fileChanges = [];
      record.before = { revision: "v1:legacy" };
      await writeFile(recordPath, serializeJson(record), "utf8");
    };

    await injectRetiredMetadata();
    const read = await projectStore.readDocument(created.projectDirectory, {
      fileId: entry.recordFile.id,
      offset: 0,
      limit: 256 * 1024
    });
    expect(read.nextOffset).toBeNull();
    expect(read.content).not.toMatch(
      /"(?:revision|[^"\n]*Revision|[^"\n]*Revisions|reversible|rollbackSnapshot|fileChanges|before)"\s*:/u
    );
    expect(
      LongLedgerCommitRecordSchema.parse(JSON.parse(read.content)).id
    ).toBe(entry.id);
    expect(await readFile(recordPath, "utf8")).toBe(read.content);

    await injectRetiredMetadata();
    const retiredSearch = await projectStore.search(created.projectDirectory, {
      query: "sourceProjectRevision",
      fileIds: [entry.recordFile.id],
      maxResults: 10
    });
    expect(retiredSearch.matches).toEqual([]);
    const currentSearch = await projectStore.search(created.projectDirectory, {
      query: "公开读取兼容测试",
      fileIds: [entry.recordFile.id],
      maxResults: 10
    });
    expect(currentSearch.matches).toHaveLength(1);
    expect(await readFile(recordPath, "utf8")).not.toMatch(
      /"(?:revision|[^"\n]*Revision|[^"\n]*Revisions|reversible|rollbackSnapshot|fileChanges|before)"\s*:/u
    );
  });
});
