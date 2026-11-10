import { readdir } from "node:fs/promises";
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
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  projectTransactionContentSha256,
  readFile
} from "./long-project-store.test-support";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createItem(
  { projectStore, created }: Fixture,
  categoryId: string,
  itemId: string,
  title: string,
  content: string
) {
  const file = createEmptyLongMarkdownFileReference(
    longWorldbuildingItemFileId(itemId),
    longWorldbuildingItemContentPath(categoryId, itemId),
    FIXED_NOW
  );
  await projectStore.applyWorkspaceOperations(created.projectDirectory, {
    batch: {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "worldbuildingItem.create",
          categoryId,
          item: { id: itemId, title, order: 1, file }
        }
      ],
      documentWrites: []
    }
  });
  await projectStore.writeDocument(created.projectDirectory, {
    fileId: file.id,
    content
  });
  return file;
}

async function deleteItem(
  fixture: Fixture,
  categoryId: string,
  itemId: string
) {
  const { projectStore, created } = fixture;
  const batch = {
    updatedAt: FIXED_NOW,
    operations: [
      { type: "worldbuildingItem.delete" as const, categoryId, id: itemId }
    ],
    documentWrites: []
  };
  const preview = await projectStore.previewWorkspaceOperations(
    created.projectDirectory,
    batch
  );
  return await projectStore.applyWorkspaceOperations(created.projectDirectory, {
    batch: { ...batch, expectedImpact: preview.confirmation },
    captureRestorePoint: true
  });
}

async function listItems(fixture: Fixture, categoryId: string) {
  const opened = await fixture.projectStore.openBook(
    fixture.created.projectDirectory
  );
  const category = opened.book.workspaceIndex.worldbuilding.find(
    ({ id }) => id === categoryId
  );
  if (category?.format !== "list") throw new Error("expected list category");
  return category.items.map(({ id, title }) => ({ id, title }));
}

async function setup(name: string) {
  const fixture = await createFixture(name);
  const category = fixture.created.book.workspaceIndex.worldbuilding[0]!;
  if (category.format !== "list") throw new Error("expected list category");
  return { fixture, categoryId: category.id };
}

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

async function addChapter(fixture: Fixture, chapterCardId: string) {
  const { projectStore, created } = fixture;
  const opened = await projectStore.openBook(created.projectDirectory);
  const plot = opened.book.workspaceIndex.plot;
  await projectStore.applyWorkspaceOperations(created.projectDirectory, {
    batch: {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "chapter.create",
          chapterCard: {
            id: chapterCardId,
            volumeId: plot.volumes[0]!.id,
            primaryArcId: plot.arcs[0]!.id,
            title: chapterCardId,
            narrativeOrder: plot.chapterCards.length + 1
          },
          files: chapterFiles(chapterCardId)
        }
      ],
      documentWrites: []
    }
  });
}

async function chapterOrder(fixture: Fixture) {
  const opened = await fixture.projectStore.openBook(
    fixture.created.projectDirectory
  );
  return [...opened.book.workspaceIndex.plot.chapterCards]
    .sort((left, right) => left.narrativeOrder - right.narrativeOrder)
    .map(({ id }) => id);
}

describe("LongProjectStore: restore points", () => {
  it("restores a deleted chapter, its prose and its narrative slot", async () => {
    const fixture = await createFixture("restore-chapter");
    const { projectStore, created } = fixture;
    await addChapter(fixture, "chapter_restore_b");
    await addChapter(fixture, "chapter_restore_c");
    const body = chapterFiles("chapter_restore_b").body;
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "雨夜，他推开了旧书铺的门。"
    });
    const before = await chapterOrder(fixture);

    const batch = {
      updatedAt: FIXED_NOW,
      operations: [
        { type: "chapter.delete" as const, id: "chapter_restore_b" }
      ],
      documentWrites: []
    };
    const preview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      batch
    );
    const deleted = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: { ...batch, expectedImpact: preview.confirmation },
        captureRestorePoint: true
      }
    );
    expect(await chapterOrder(fixture)).not.toContain("chapter_restore_b");

    await projectStore.restoreWorkspaceOperations(
      created.projectDirectory,
      deleted.restorePoint!.id
    );
    expect(await chapterOrder(fixture)).toEqual(before);
    await expect(
      readFile(join(created.projectDirectory, body.path), "utf8")
    ).resolves.toBe("雨夜，他推开了旧书铺的门。");
  });

  it("undoes an accepted deletion while keeping later unrelated edits", async () => {
    const { fixture, categoryId } = await setup("restore-delete");
    const { projectStore, created } = fixture;
    const kept = await createItem(
      fixture,
      categoryId,
      "worlditem_tide",
      "潮汐历法",
      "双月之夜海岸慢一刻。"
    );
    const removed = await createItem(
      fixture,
      categoryId,
      "worlditem_memory",
      "记忆代价",
      "每次施法都会遗忘一段记忆。"
    );

    const deleted = await deleteItem(fixture, categoryId, "worlditem_memory");
    expect(deleted.restorePoint?.id).toMatch(/^restore_[0-9a-z]+$/u);
    await expect(
      readFile(join(created.projectDirectory, removed.path), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    // Later work on another item must survive the undo.
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: kept.id,
      content: "双月之夜海岸慢两刻。"
    });
    await createItem(
      fixture,
      categoryId,
      "worlditem_salt",
      "盐税",
      "盐铁由港务司专营。"
    );

    const restored = await projectStore.restoreWorkspaceOperations(
      created.projectDirectory,
      deleted.restorePoint!.id
    );
    expect(restored.restoredFileCount).toBeGreaterThan(0);
    expect((await listItems(fixture, categoryId)).map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "worlditem_tide",
        "worlditem_memory",
        "worlditem_salt"
      ])
    );
    await expect(
      readFile(join(created.projectDirectory, removed.path), "utf8")
    ).resolves.toBe("每次施法都会遗忘一段记忆。");
    await expect(
      readFile(join(created.projectDirectory, kept.path), "utf8")
    ).resolves.toBe("双月之夜海岸慢两刻。");

    // The undo is spent: replaying it must not touch newer work.
    await expect(
      projectStore.restoreWorkspaceOperations(
        created.projectDirectory,
        deleted.restorePoint!.id
      )
    ).rejects.toMatchObject({ code: "restore_unavailable" });
  });

  it("refuses to undo when the restored path was reused afterwards", async () => {
    const { fixture, categoryId } = await setup("restore-conflict");
    const { projectStore, created } = fixture;
    await createItem(
      fixture,
      categoryId,
      "worlditem_memory",
      "记忆代价",
      "原始设定。"
    );
    const deleted = await deleteItem(fixture, categoryId, "worlditem_memory");
    const recreated = await createItem(
      fixture,
      categoryId,
      "worlditem_memory",
      "记忆代价（新）",
      "重新写的设定。"
    );

    await expect(
      projectStore.restoreWorkspaceOperations(
        created.projectDirectory,
        deleted.restorePoint!.id
      )
    ).rejects.toMatchObject({ code: "restore_conflict" });
    await expect(
      readFile(join(created.projectDirectory, recreated.path), "utf8")
    ).resolves.toBe("重新写的设定。");
    expect(await listItems(fixture, categoryId)).toEqual([
      { id: "worlditem_memory", title: "记忆代价（新）" }
    ]);
  });

  it("keeps restore points only for requested destructive batches", async () => {
    const { fixture, categoryId } = await setup("restore-scope");
    const { projectStore, created } = fixture;
    await createItem(fixture, categoryId, "worlditem_a", "甲", "甲。");
    const renamed = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "worldbuildingItem.update",
              categoryId,
              id: "worlditem_a",
              patch: { title: "甲（改）" }
            }
          ],
          documentWrites: []
        },
        captureRestorePoint: true
      }
    );
    expect(renamed.restorePoint).toBeUndefined();

    const batch = {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "worldbuildingItem.delete" as const,
          categoryId,
          id: "worlditem_a"
        }
      ],
      documentWrites: []
    };
    const preview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      batch
    );
    const unrequested = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      { batch: { ...batch, expectedImpact: preview.confirmation } }
    );
    expect(unrequested.restorePoint).toBeUndefined();
    await expect(
      readdir(join(created.projectDirectory, ".deepwrite", "restore-points"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
