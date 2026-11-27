import {
  FIXED_NOW,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  MAX_MARKDOWN_BYTES,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  lstat,
  sha256Hex,
  readFile,
  unlink,
  writeFile
} from "./long-project-store.test-support";

describe("LongProjectStore: documents-and-structure", () => {
  it("updates only long-book bindings and lets the latest edit win", async () => {
    const { projectStore, created } = await createFixture("bindings");
    const updated = await projectStore.updateBindings(
      created.projectDirectory,
      {
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: ["material-long-plot", "missing-material"],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: [],
          plot: [],
          style: ["skill-long-style"],
          other: []
        },
        linkedResourceStageScopes: {
          materials: {
            "material-long-plot": ["plot_design"],
            "missing-material": ["worldbuilding", "plot_design"]
          },
          skills: { "skill-long-style": ["draft"] }
        }
      }
    );

    expect(updated.book.linkedMaterialIdsByKind.plot).toEqual([
      "material-long-plot",
      "missing-material"
    ]);
    expect(updated.book.linkedSkillIdsByKind.style).toEqual([
      "skill-long-style"
    ]);
    expect(updated.book.linkedResourceStageScopes).toEqual({
      materials: {
        "material-long-plot": ["plot_design"],
        "missing-material": ["worldbuilding", "plot_design"]
      },
      skills: { "skill-long-style": ["draft"] }
    });
    const latest = await projectStore.updateBindings(created.projectDirectory, {
      linkedMaterialIdsByKind: {
        ...updated.book.linkedMaterialIdsByKind,
        plot: ["material-latest"]
      },
      linkedSkillIdsByKind: updated.book.linkedSkillIdsByKind
    });
    expect(latest.book.linkedMaterialIdsByKind.plot).toEqual([
      "material-latest"
    ]);
  });

  it("renames a long book without renaming its project directory", async () => {
    const { projectStore, created } = await createFixture("rename-book");
    const updated = await projectStore.renameBook(created.projectDirectory, {
      title: "新的长篇名称"
    });

    expect(updated.summary.title).toBe("新的长篇名称");
    await expect(
      projectStore.openBook(created.projectDirectory)
    ).resolves.toMatchObject({ summary: { title: "新的长篇名称" } });
    await expect(
      projectStore.renameBook(created.projectDirectory, {
        title: "最终名称"
      })
    ).resolves.toMatchObject({ summary: { title: "最终名称" } });
  });

  it("rejects an oversized chapter before mutating manifest, index, or files", async () => {
    const { projectStore, created } = await createFixture("chapter-byte-limit");
    const files = firstChapterFiles(created.book);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const before = await Promise.all(
      [
        manifestPath,
        indexPath,
        join(created.projectDirectory, files.body.path)
      ].map(async (path) => sha256Hex(await readFile(path)))
    );
    const oversizedBody = "界".repeat(Math.floor(MAX_MARKDOWN_BYTES / 3) + 1);

    await expect(
      projectStore.writeChapter(created.projectDirectory, {
        chapterCardId: created.book.workspaceIndex.plot.chapterCards[0]!.id,
        body: {
          content: oversizedBody
        },
        characterState: {
          content: "角色状态"
        },
        handoff: {
          content: "交接摘要"
        }
      })
    ).rejects.toThrow(/UTF-8 字节限制/u);

    const after = await Promise.all(
      [
        manifestPath,
        indexPath,
        join(created.projectDirectory, files.body.path)
      ].map(async (path) => sha256Hex(await readFile(path)))
    );
    expect(after).toEqual(before);
  }, 30_000);

  it("rejects an append crossing the Markdown byte limit without publishing its index change", async () => {
    const { projectStore, created } = await createFixture("append-byte-limit");
    const body = firstChapterFiles(created.book).body;
    const bodyPath = join(created.projectDirectory, body.path);
    const nearLimit = "界".repeat(Math.floor((MAX_MARKDOWN_BYTES - 3) / 3));
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: nearLimit
    });
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const before = await Promise.all(
      [manifestPath, indexPath, bodyPath].map(async (path) =>
        sha256Hex(await readFile(path))
      )
    );
    await expect(
      projectStore.applyWorkspaceOperations(created.projectDirectory, {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "chapter.update",
              id: created.book.workspaceIndex.plot.chapterCards[0]!.id,
              patch: { title: "验证越界 append 不落盘" }
            }
          ],
          documentWrites: [
            {
              proposalId: "proposal_oversized_append",
              fileId: body.id,
              mode: "append",
              updatedAt: FIXED_NOW,
              content: "界界",
              reason: "验证最终 UTF-8 字节边界"
            }
          ]
        }
      })
    ).rejects.toThrow(/UTF-8 字节限制/u);

    const after = await Promise.all(
      [manifestPath, indexPath, bodyPath].map(async (path) =>
        sha256Hex(await readFile(path))
      )
    );
    expect(after).toEqual(before);
  }, 30_000);

  it("rejects a manifest-sized binding update before either file changes", async () => {
    const { projectStore, created } = await createFixture("binding-byte-limit");
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const before = await Promise.all(
      [manifestPath, indexPath].map(async (path) =>
        sha256Hex(await readFile(path))
      )
    );
    const oversizedIds = Array.from(
      { length: 2_200 },
      (_, index) => `material-${index}-${"x".repeat(470)}`
    );

    await expect(
      projectStore.updateBindings(created.projectDirectory, {
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: oversizedIds,
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: [],
          plot: [],
          style: [],
          other: []
        }
      })
    ).rejects.toThrow(/UTF-8 字节限制/u);

    const after = await Promise.all(
      [manifestPath, indexPath].map(async (path) =>
        sha256Hex(await readFile(path))
      )
    );
    expect(after).toEqual(before);
  });

  it("writes atomically, reads by character page and searches only explicit file scopes", async () => {
    const { projectStore, created } = await createFixture("read-search");
    const body = firstChapterFiles(created.book).body;
    const written = await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "甲乙关键词丙丁\n第二行关键词"
    });

    expect(written.fileId).toBe(body.id);
    const page = await projectStore.readDocument(created.projectDirectory, {
      fileId: body.id,
      offset: 2,
      limit: 3
    });
    expect(page.content).toBe("关键词");
    expect(page.nextOffset).toBe(5);

    await writeFile(
      join(created.projectDirectory, "orphan.md"),
      "关键词不应被搜索",
      "utf8"
    );
    const scoped = await projectStore.search(created.projectDirectory, {
      query: "关键词",
      fileIds: [body.id],
      maxResults: 10
    });
    expect(scoped.matches).toHaveLength(2);
    expect(scoped.matches.every((match) => match.fileId === body.id)).toBe(
      true
    );

    const excluded = await projectStore.search(created.projectDirectory, {
      query: "关键词",
      fileIds: [LONG_BOOK_LINE_FILE_ID]
    });
    expect(excluded.matches).toEqual([]);
    await expect(
      lstat(join(created.projectDirectory, ".deepwrite", "transaction.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports the public 256K Unicode-character page limit", async () => {
    const { projectStore, created } = await createFixture("large-page");
    const body = firstChapterFiles(created.book).body;
    const content = "😀".repeat(70_000);
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content
    });

    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: body.id,
        limit: 256 * 1024
      })
    ).resolves.toMatchObject({
      content,
      totalCharacters: 70_000,
      nextOffset: null
    });

    await projectStore.writeDocument(created.projectDirectory, {
      fileId: body.id,
      content: "甲😀乙😀丙"
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: body.id,
        offset: 1,
        limit: 3
      })
    ).resolves.toMatchObject({
      content: "😀乙😀",
      totalCharacters: 5,
      nextOffset: 4
    });
  });

  it("creates a stage-level character overview file for new books", async () => {
    const { projectStore, created } = await createFixture("character-overview");
    expect(created.book.workspaceIndex.characterOverview).toMatchObject({
      id: LONG_CHARACTER_OVERVIEW_FILE_ID,
      path: LONG_CHARACTER_OVERVIEW_PATH
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: LONG_CHARACTER_OVERVIEW_FILE_ID
      })
    ).resolves.toMatchObject({ content: "" });
  });

  it("migrates missing character overview onto existing projects", async () => {
    const { projectStore, created } = await createFixture(
      "missing-character-overview"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      characterOverview?: unknown;
    };
    expect(index.characterOverview).toBeDefined();
    await unlink(join(created.projectDirectory, LONG_CHARACTER_OVERVIEW_PATH));
    delete index.characterOverview;
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(opened.book.workspaceIndex.characterOverview).toMatchObject({
      id: LONG_CHARACTER_OVERVIEW_FILE_ID,
      path: LONG_CHARACTER_OVERVIEW_PATH
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: LONG_CHARACTER_OVERVIEW_FILE_ID
      })
    ).resolves.toMatchObject({ content: "" });
  });

  it("migrates and writes back the default character type directory", async () => {
    const { projectStore, created } = await createFixture(
      "missing-character-types"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      characterTypes?: unknown;
    };
    delete index.characterTypes;
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(
      opened.book.workspaceIndex.characterTypes.map(({ id }) => id)
    ).toEqual([
      "protagonist",
      "major_supporting",
      "minor_supporting",
      "passerby"
    ]);
    const writtenBack = JSON.parse(await readFile(indexPath, "utf8")) as {
      characterTypes?: unknown[];
    };
    expect(writtenBack.characterTypes).toHaveLength(4);
  });

  it("stores list items separately and cascades every file on category deletion", async () => {
    const { projectStore, created } = await createFixture("world-list");
    const category = created.book.workspaceIndex.worldbuilding[0]!;
    expect(category.format).toBe("list");
    if (category.format !== "list") throw new Error("expected list category");
    expect(category.overview).toMatchObject({
      id: longWorldbuildingOverviewFileId(category.id),
      path: longWorldbuildingOverviewContentPath(category.id)
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: category.overview!.id
      })
    ).resolves.toMatchObject({ content: "" });
    const itemId = "worlditem_memory_cost";
    const updatedAt = FIXED_NOW;
    const file = createEmptyLongMarkdownFileReference(
      longWorldbuildingItemFileId(itemId),
      longWorldbuildingItemContentPath(category.id, itemId),
      updatedAt
    );
    const createdItem = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          updatedAt,
          operations: [
            {
              type: "worldbuildingItem.create",
              categoryId: category.id,
              item: {
                id: itemId,
                title: "记忆代价",
                order: 1,
                file
              }
            }
          ],
          documentWrites: []
        }
      }
    );
    const item = createdItem.book.workspaceIndex.worldbuilding[0]!;
    if (item.format !== "list") throw new Error("expected list category");
    expect(item.items).toHaveLength(1);
    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: item.items[0]!.file.id,
        content: "每次施法都会遗忘一段记忆。"
      })
    ).resolves.toMatchObject({ fileId: item.items[0]!.file.id });

    const overview = category.overview!;
    const deleteBatch = {
      updatedAt: FIXED_NOW,
      operations: [{ type: "worldbuilding.delete" as const, id: category.id }],
      documentWrites: []
    };
    const preview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      deleteBatch
    );
    expect(preview.confirmation.impact.deletedFileIds).toEqual(
      expect.arrayContaining([overview.id, file.id])
    );
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: { ...deleteBatch, expectedImpact: preview.confirmation }
    });

    const reopened = await projectStore.openBook(created.projectDirectory);
    expect(
      reopened.book.workspaceIndex.worldbuilding.some(
        ({ id }) => id === category.id
      )
    ).toBe(false);
    await expect(
      lstat(join(created.projectDirectory, overview.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(join(created.projectDirectory, file.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("converts worldbuilding list/text formats transactionally without dropping existing content", async () => {
    const { projectStore, created } = await createFixture(
      "world-format-conversion"
    );
    const category = created.book.workspaceIndex.worldbuilding[0]!;
    if (category.format !== "list") throw new Error("expected list category");
    const itemId = "worlditem_conversion_source";
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
              title: "潮汐历法",
              order: 1,
              file: itemFile
            }
          }
        ],
        documentWrites: []
      }
    });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: itemFile.id,
      content: "每逢双月，海岸时间会比内陆慢一刻。"
    });

    const conversionBatch = {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "worldbuilding.update" as const,
          id: category.id,
          patch: { format: "text" as const }
        }
      ],
      documentWrites: []
    };
    const conversionPreview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      conversionBatch
    );
    expect(conversionPreview.documentWrites).toHaveLength(1);
    expect(conversionPreview.documentWrites[0]).toMatchObject({
      mode: "create",
      content: expect.stringContaining("每逢双月，海岸时间会比内陆慢一刻。")
    });
    expect(
      conversionPreview.entityChanges.find(({ id }) => id === category.id)
        ?.after
    ).toEqual(
      expect.objectContaining({
        format: "text",
        file: expect.objectContaining({
          id: conversionPreview.documentWrites[0]!.fileId
        })
      })
    );

    const convertedToText = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          ...conversionBatch,
          expectedImpact: conversionPreview.confirmation
        }
      }
    );
    const textCategory = convertedToText.book.workspaceIndex.worldbuilding[0]!;
    if (textCategory.format !== "text")
      throw new Error("expected text category");
    const textDocument = await projectStore.readDocument(
      created.projectDirectory,
      { fileId: textCategory.file.id }
    );
    expect(textDocument.content).not.toContain(
      "deepwrite-worldbuilding-list:v1"
    );
    expect(textDocument.content).toContain("## 潮汐历法");
    expect(textDocument.content).toContain(
      "每逢双月，海岸时间会比内陆慢一刻。"
    );
    expect(convertedToText.book.workspaceIndex.worldbuilding[0]!.format).toBe(
      "text"
    );

    const backBatch = {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "worldbuilding.update" as const,
          id: category.id,
          patch: { format: "list" as const }
        }
      ],
      documentWrites: []
    };
    const backPreview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      backBatch
    );
    const convertedBack = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          ...backBatch,
          expectedImpact: backPreview.confirmation
        }
      }
    );
    const listCategory = convertedBack.book.workspaceIndex.worldbuilding[0]!;
    if (listCategory.format !== "list")
      throw new Error("expected list category");
    const listDocument = await projectStore.readDocument(
      created.projectDirectory,
      { fileId: listCategory.items[0]!.file.id }
    );
    expect(listCategory.items).toHaveLength(1);
    expect(listDocument.content).toContain("## 潮汐历法");
    expect(listDocument.content).toContain(
      "每逢双月，海岸时间会比内陆慢一刻。"
    );
    expect(convertedBack.book.workspaceIndex.worldbuilding[0]!.format).toBe(
      "list"
    );
  });
});
