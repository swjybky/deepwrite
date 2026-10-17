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
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  lstat,
  mkdir,
  projectTransactionContentSha256,
  readFile,
  symlink,
  unlink,
  writeFile
} from "./long-project-store.test-support";

describe("LongProjectStore: path-safety-and-compatibility", () => {
  it("reads and directly overwrites the latest external edit", async () => {
    const { projectStore, created } = await createFixture("external");
    const initialBody = firstChapterFiles(created.book).body;
    await writeFile(
      join(created.projectDirectory, initialBody.path),
      "外部编辑器写入的正文",
      "utf8"
    );

    await projectStore.openBook(created.projectDirectory);
    const read = await projectStore.readDocument(created.projectDirectory, {
      fileId: initialBody.id
    });
    expect(read.content).toBe("外部编辑器写入的正文");

    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: initialBody.id,
        content: "基于最新内容继续写"
      })
    ).resolves.toMatchObject({ fileId: initialBody.id });
    await expect(
      readFile(join(created.projectDirectory, initialBody.path), "utf8")
    ).resolves.toBe("基于最新内容继续写");
  });

  it("recovers an interrupted project transaction before opening", async () => {
    const { projectStore, created } = await createFixture("recovery");
    const body = firstChapterFiles(created.book).body;
    const transactionId = "txn-2000-a1b2c3d4";
    const transactionRoot = join(
      created.projectDirectory,
      ".deepwrite",
      "transactions",
      transactionId
    );
    await mkdir(join(transactionRoot, "stage"), { recursive: true });
    await writeFile(
      join(transactionRoot, "stage", "0.next"),
      "恢复后的正文",
      "utf8"
    );
    await writeFile(
      join(created.projectDirectory, ".deepwrite", "transaction.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          transactionId,
          phase: "prepared",
          appliedCount: 0,
          operations: [
            {
              path: body.path,
              stagePath: `.deepwrite/transactions/${transactionId}/stage/0.next`,
              backupPath: `.deepwrite/transactions/${transactionId}/backup/0.previous`,
              beforeSha256: projectTransactionContentSha256(""),
              afterSha256: projectTransactionContentSha256("恢复后的正文")
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: body.id
      })
    ).resolves.toMatchObject({ content: "恢复后的正文" });
    await expect(
      lstat(join(created.projectDirectory, ".deepwrite", "transaction.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("opens a migrated copy whose prepared transaction already applied the manifest", async () => {
    const { projectStore, created } = await createFixture(
      "migrated-prepared-recovery"
    );
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const previousManifestContent = await readFile(manifestPath, "utf8");
    const previousIndexContent = await readFile(indexPath, "utf8");
    const previousManifest = JSON.parse(previousManifestContent) as {
      workspaceIndexFile: { updatedAt: string };
      updatedAt: string;
      [key: string]: unknown;
    };
    const previousIndex = JSON.parse(previousIndexContent) as {
      updatedAt: string;
      [key: string]: unknown;
    };
    const migratedAt = "2026-07-26T12:01:00.000Z";
    const nextIndexContent = `${JSON.stringify(
      {
        ...previousIndex,
        revision: 41,
        chapterFileRevisions: { body: "v1:legacy" },
        updatedAt: migratedAt
      },
      null,
      2
    )}\n`;
    const nextManifestContent = `${JSON.stringify(
      {
        ...previousManifest,
        revision: 42,
        updatedAt: migratedAt,
        workspaceIndexFile: {
          ...previousManifest.workspaceIndexFile,
          revision: "v1:legacy",
          updatedAt: migratedAt
        }
      },
      null,
      2
    )}\n`;
    const transactionId = "txn-2001-b2c3d4e5";
    const transactionRoot = join(
      created.projectDirectory,
      ".deepwrite",
      "transactions",
      transactionId
    );
    await mkdir(join(transactionRoot, "stage"), { recursive: true });
    await mkdir(join(transactionRoot, "backup"), { recursive: true });
    await writeFile(
      join(transactionRoot, "stage", "0.next"),
      nextIndexContent,
      "utf8"
    );
    await writeFile(
      join(transactionRoot, "stage", "1.next"),
      nextManifestContent,
      "utf8"
    );
    await writeFile(
      join(transactionRoot, "backup", "0.previous"),
      previousIndexContent,
      "utf8"
    );
    await writeFile(
      join(transactionRoot, "backup", "1.previous"),
      previousManifestContent,
      "utf8"
    );

    // A directory migration can observe the manifest replacement before it
    // observes the journal phase update or the index replacement.
    await writeFile(manifestPath, nextManifestContent, "utf8");
    await writeFile(
      join(created.projectDirectory, ".deepwrite", "transaction.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          transactionId,
          phase: "prepared",
          appliedCount: 0,
          operations: [
            {
              action: "write",
              path: LONG_WORKSPACE_INDEX_PATH,
              stagePath: `.deepwrite/transactions/${transactionId}/stage/0.next`,
              backupPath: `.deepwrite/transactions/${transactionId}/backup/0.previous`,
              beforeSha256:
                projectTransactionContentSha256(previousIndexContent),
              afterSha256: projectTransactionContentSha256(nextIndexContent)
            },
            {
              action: "write",
              path: "deepwrite.json",
              stagePath: `.deepwrite/transactions/${transactionId}/stage/1.next`,
              backupPath: `.deepwrite/transactions/${transactionId}/backup/1.previous`,
              beforeSha256: projectTransactionContentSha256(
                previousManifestContent
              ),
              afterSha256: projectTransactionContentSha256(nextManifestContent)
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(opened.book.workspaceIndex.updatedAt).toBe(migratedAt);
    expect(await readFile(indexPath, "utf8")).not.toMatch(
      /"(?:revision|[^"]*Revisions)"\s*:/u
    );
    expect(await readFile(manifestPath, "utf8")).not.toMatch(/"revision"\s*:/u);
    await expect(
      lstat(join(created.projectDirectory, ".deepwrite", "transaction.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe indexed paths eagerly and validates document bytes lazily", async () => {
    const unsafe = await createFixture("unsafe-path");
    const unsafeIndexPath = join(
      unsafe.created.projectDirectory,
      LONG_WORKSPACE_INDEX_PATH
    );
    const unsafeIndex = JSON.parse(await readFile(unsafeIndexPath, "utf8")) as {
      chapters: Array<{ body: { path: string } }>;
    };
    unsafeIndex.chapters[0]!.body.path = "../outside.md";
    await writeFile(
      unsafeIndexPath,
      `${JSON.stringify(unsafeIndex, null, 2)}\n`,
      "utf8"
    );
    await expect(
      unsafe.projectStore.openBook(unsafe.created.projectDirectory)
    ).rejects.toThrow();

    const linked = await createFixture("symlink");
    const linkedBody = firstChapterFiles(linked.created.book).body;
    const linkedBodyPath = join(
      linked.created.projectDirectory,
      linkedBody.path
    );
    const outsidePath = join(linked.parent, "outside.md");
    await writeFile(outsidePath, "项目外正文", "utf8");
    await unlink(linkedBodyPath);
    await symlink(outsidePath, linkedBodyPath);
    await expect(
      linked.projectStore.openBook(linked.created.projectDirectory)
    ).resolves.toMatchObject({ book: { id: linked.created.book.id } });
    await expect(
      linked.projectStore.readDocument(linked.created.projectDirectory, {
        fileId: linkedBody.id
      })
      // Windows resolves the outside link through the escape guard instead
      // of the file-kind guard; both rebuttals are fail-safe.
    ).rejects.toThrow(/普通文件|符号链接|越过/u);

    const invalidUtf8 = await createFixture("utf8");
    const utf8Body = firstChapterFiles(invalidUtf8.created.book).body;
    await writeFile(
      join(invalidUtf8.created.projectDirectory, utf8Body.path),
      Buffer.from([0xff, 0xfe, 0xfd])
    );
    await expect(
      invalidUtf8.projectStore.openBook(invalidUtf8.created.projectDirectory)
    ).resolves.toMatchObject({ book: { id: invalidUtf8.created.book.id } });
    await expect(
      invalidUtf8.projectStore.readDocument(
        invalidUtf8.created.projectDirectory,
        { fileId: utf8Body.id }
      )
    ).rejects.toThrow(/UTF-8/u);
  });

  it("rejects worldbuilding files placed outside the worldbuilding role directory", async () => {
    const { projectStore, created } = await createFixture("world-role-path");
    const category = created.book.workspaceIndex.worldbuilding[0]!;
    if (category.format !== "list") throw new Error("expected list category");
    const itemId = "worlditem_wrong_role_path";
    const itemFile = createEmptyLongMarkdownFileReference(
      longWorldbuildingItemFileId(itemId),
      longWorldbuildingItemContentPath(category.id, itemId),
      FIXED_NOW
    );
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuildingItem.create",
            categoryId: category.id,
            item: {
              id: itemId,
              title: "错误目录测试",
              order: 1,
              file: itemFile
            }
          }
        ],
        documentWrites: []
      }
    });

    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      worldbuilding: Array<{
        items: Array<{ file: { path: string } }>;
      }>;
    };
    index.worldbuilding[0]!.items[0]!.file.path =
      "long/chapters/rogue-worldbuilding.md";
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");

    await expect(
      projectStore.openBook(created.projectDirectory)
    ).rejects.toThrow(/文件路径不符合其文件角色/u);
  });

  it("continues to open legacy hashed worldbuilding paths", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-world-role-path"
    );
    const categoryId = "world_legacy_hashed_path";
    const legacyPath = `long/worldbuilding/${projectTransactionContentSha256(
      categoryId
    ).slice(0, 32)}/content.md`;
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuilding.create",
            category: {
              id: categoryId,
              title: "旧版哈希路径",
              order: created.book.workspaceIndex.worldbuilding.length + 1,
              format: "text",
              contentAuthority: "markdown",
              file: createEmptyLongMarkdownFileReference(
                longWorldbuildingFileId(categoryId),
                legacyPath,
                FIXED_NOW
              )
            }
          }
        ],
        documentWrites: []
      }
    });

    await expect(
      projectStore.openBook(created.projectDirectory)
    ).resolves.toMatchObject({
      book: {
        workspaceIndex: {
          worldbuilding: expect.arrayContaining([
            expect.objectContaining({ id: categoryId })
          ])
        }
      }
    });
  });
});
