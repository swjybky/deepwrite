import type { LongForeshadowing } from "./long-project-store.test-support";
import {
  DEFAULT_LONG_AGENTS_MD,
  FIXED_NOW,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  createEmptyLongMarkdownFileReference,
  createFixture,
  createLongFileRevision,
  deriveLongForeshadowingStatus,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longWorldbuildingFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  lstat,
  mkdir,
  projectTransactionContentSha256,
  readFile,
  readdir,
  realpath,
  serializeLongWorldbuildingMarkdownList,
  store,
  temporaryParent,
  unlink,
  writeFile
} from "./long-project-store.test-support";

describe("LongProjectStore: creation-and-migration", () => {
  it("initializes AGENTS.md, lazily restores missing files, and copies it on duplicate", async () => {
    const { parent, projectStore, created } = await createFixture("agents-md");
    const agentsPath = join(created.projectDirectory, LONG_AGENTS_MD_PATH);
    await expect(readFile(agentsPath, "utf8")).resolves.toBe(
      DEFAULT_LONG_AGENTS_MD
    );
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({
      content: DEFAULT_LONG_AGENTS_MD,
      truncated: false
    });

    const custom = "# 长篇上下文\n\n自定义说明";
    await projectStore.writeAgentsMd(created.projectDirectory, custom);
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({ content: custom, truncated: false });

    await unlink(agentsPath);
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({
      content: DEFAULT_LONG_AGENTS_MD,
      truncated: false
    });
    await expect(readFile(agentsPath, "utf8")).resolves.toBe(
      DEFAULT_LONG_AGENTS_MD
    );

    await projectStore.writeAgentsMd(created.projectDirectory, custom);
    const duplicated = await projectStore.duplicateBook(
      parent,
      created.projectDirectory,
      "副本"
    );
    await expect(
      projectStore.readAgentsMd(duplicated.projectDirectory)
    ).resolves.toEqual({ content: custom, truncated: false });
  });

  it("defaults new long books to right-side item layouts and persists changes", async () => {
    const { projectStore, created } = await createFixture(
      "worldbuilding-item-layout"
    );
    expect(
      created.book.workspaceIndex.featureSettings.worldbuildingItemLayout
    ).toBe("right-list");
    expect(
      created.book.workspaceIndex.featureSettings
        .characterAndContinuityItemLayout
    ).toBe("right-list");
    expect(created.book.workspaceIndex.featureSettings.plotItemLayout).toBe(
      "right-list"
    );

    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "featureSettings.update",
            patch: {
              worldbuildingItemLayout: "left-tree",
              characterAndContinuityItemLayout: "left-tree",
              plotItemLayout: "left-tree"
            }
          }
        ],
        documentWrites: []
      }
    });

    const reopened = await store().openBook(created.projectDirectory);
    expect(
      reopened.book.workspaceIndex.featureSettings.worldbuildingItemLayout
    ).toBe("left-tree");
    expect(
      reopened.book.workspaceIndex.featureSettings
        .characterAndContinuityItemLayout
    ).toBe("left-tree");
    expect(reopened.book.workspaceIndex.featureSettings.plotItemLayout).toBe(
      "left-tree"
    );
  });

  it("removes legacy character state files and keeps chapter continuity as the only source", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-character-state-files"
    );
    const characterId = "character_legacy";
    const coreProfile = createEmptyLongMarkdownFileReference(
      longCharacterCoreProfileFileId(characterId),
      longCharacterFilePath(characterId, "core-profile.md"),
      FIXED_NOW
    );
    const relationships = createEmptyLongMarkdownFileReference(
      longCharacterRelationshipsFileId(characterId),
      longCharacterFilePath(characterId, "relationships.md"),
      FIXED_NOW
    );
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "character.create",
            character: {
              id: characterId,
              name: "旧人物",
              group: "protagonist",
              order: 1,
              aliases: []
            },
            files: { characterId, coreProfile, relationships }
          }
        ],
        documentWrites: []
      }
    });

    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      characterFiles: Array<Record<string, unknown>>;
    };
    const currentStateContent = "不应继续作为人物阶段状态。";
    const historyContent = "不应继续作为人物阶段历史。";
    const currentState = {
      id: longCharacterCurrentStateFileId(characterId),
      path: longCharacterFilePath(characterId, "current-state.md"),
      revision: createLongFileRevision(currentStateContent),
      updatedAt: FIXED_NOW
    };
    const history = {
      id: longCharacterHistoryFileId(characterId),
      path: longCharacterFilePath(characterId, "history.md"),
      revision: createLongFileRevision(historyContent),
      updatedAt: FIXED_NOW
    };
    Object.assign(index.characterFiles[0]!, { currentState, history });
    await writeFile(
      join(created.projectDirectory, currentState.path),
      currentStateContent,
      "utf8"
    );
    await writeFile(
      join(created.projectDirectory, history.path),
      historyContent,
      "utf8"
    );
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(opened.book.workspaceIndex.characterFiles[0]).toEqual({
      characterId,
      coreProfile,
      relationships
    });
    await expect(
      lstat(join(created.projectDirectory, currentState.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(join(created.projectDirectory, history.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a missing nested parent directory for a new long book", async () => {
    const root = await temporaryParent();
    const parent = join(root, "小说", "Deepwrite", "books");

    const created = await store().createBook(parent, {
      id: "longbook_missing-parent",
      title: "首次创建长篇",
      genre: "悬疑"
    });

    expect(created.projectDirectory).toBe(
      join(await realpath(parent), "longbook_missing-parent")
    );
    expect((await lstat(parent)).isDirectory()).toBe(true);
    expect((await lstat(created.projectDirectory)).isDirectory()).toBe(true);
  });

  it("reads legacy revision metadata and strips it from hydrated files", async () => {
    const { projectStore, created } = await createFixture("legacy-revision");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      chapters: Array<{ body: { revision: string } }>;
      chapterFileRevisions?: Record<string, string>;
    };
    index.chapters[0]!.body.revision = `v1:0:${projectTransactionContentSha256(
      ""
    ).slice(0, 8)}`;
    index.chapterFileRevisions = { body: "v1:legacy" };
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = `v1:${Buffer.byteLength(
      indexContent,
      "utf8"
    )}:${projectTransactionContentSha256(indexContent).slice(0, 8)}`;
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    const body = firstChapterFiles(opened.book).body;
    expect(body).not.toHaveProperty("revision");
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: body.id
      })
    ).resolves.toMatchObject({
      content: ""
    });
    expect(await readFile(indexPath, "utf8")).not.toMatch(
      /"(?:revision|[^"]*Revision|[^"]*Revisions)"\s*:/u
    );
    expect(await readFile(manifestPath, "utf8")).not.toMatch(
      /"(?:revision|[^"]*Revision|[^"]*Revisions)"\s*:/u
    );
  });

  it("migrates legacy aggregate worldbuilding Markdown into independent item files on open", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-worldbuilding-storage"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const legacyPath = "long/worldbuilding/legacy-rules/content.md";
    const legacyContent = serializeLongWorldbuildingMarkdownList([
      {
        id: "worlditem_legacy_rule",
        title: "旧规则",
        content: "旧项目中的独立规则正文。"
      }
    ]);
    await mkdir(
      join(created.projectDirectory, "long/worldbuilding/legacy-rules"),
      {
        recursive: true
      }
    );
    await writeFile(
      join(created.projectDirectory, legacyPath),
      legacyContent,
      "utf8"
    );
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      worldbuilding: Array<Record<string, unknown>>;
    };
    const category = index.worldbuilding[0]!;
    const overview = category.overview as { path: string };
    await unlink(join(created.projectDirectory, overview.path));
    index.worldbuilding[0] = {
      id: category.id,
      title: category.title,
      order: category.order,
      format: "list",
      contentAuthority: "markdown",
      file: {
        id: longWorldbuildingFileId(String(category.id)),
        path: legacyPath,
        revision: createLongFileRevision(legacyContent),
        updatedAt: FIXED_NOW
      }
    };
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    const migrated = opened.book.workspaceIndex.worldbuilding[0]!;
    if (migrated.format !== "list") throw new Error("expected list category");
    expect(migrated.contentAuthority).toBe("files");
    expect(migrated.overview).toMatchObject({
      id: longWorldbuildingOverviewFileId(migrated.id),
      path: longWorldbuildingOverviewContentPath(migrated.id)
    });
    expect(migrated.items).toHaveLength(1);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: migrated.items[0]!.file.id
      })
    ).resolves.toMatchObject({
      content: "旧项目中的独立规则正文。"
    });
    await expect(
      lstat(join(created.projectDirectory, legacyPath))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an existing chapter-card file while migrating legacy structured fields", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-chapter-card-content"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      plot: { chapterCards: Array<Record<string, unknown>> };
      chapters: Array<{
        card: { id: string; path: string; revision?: string };
      }>;
    };
    const chapterCard = index.plot.chapterCards[0]!;
    const cardFile = index.chapters[0]!.card;
    const existingContent = "## 已有章卡内容\n\n保留这段人工编辑。";
    await writeFile(
      join(created.projectDirectory, cardFile.path),
      existingContent,
      "utf8"
    );
    cardFile.revision = createLongFileRevision(existingContent);
    chapterCard.outline = "旧版章节规划";
    chapterCard.worldConstraints = "旧版世界约束";
    chapterCard.characterIds = [];
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    const migratedCard = opened.book.workspaceIndex.plot.chapterCards[0]!;
    expect(migratedCard).not.toHaveProperty("outline");
    expect(migratedCard).not.toHaveProperty("worldConstraints");
    expect(migratedCard).not.toHaveProperty("characterIds");
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: cardFile.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining(existingContent)
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: cardFile.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("旧版章节规划")
    });
  });

  it("recreates a missing chapter-card file from legacy structured content", async () => {
    const { created } = await createFixture("missing-legacy-chapter-card");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      plot: { chapterCards: Array<Record<string, unknown>> };
      chapters: Array<{ card: { id: string; path: string } }>;
    };
    const chapterCard = index.plot.chapterCards[0]!;
    const cardFile = index.chapters[0]!.card;
    chapterCard.outline = "重启后应恢复的章节规划";
    chapterCard.worldConstraints = "重启后应恢复的世界约束";
    chapterCard.characterIds = [];
    await unlink(join(created.projectDirectory, cardFile.path));
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const restartedStore = store();
    const reopened = await restartedStore.openBook(created.projectDirectory);
    const recoveredCard = reopened.book.workspaceIndex.chapters[0]!.card;
    await expect(
      restartedStore.readDocument(created.projectDirectory, {
        fileId: recoveredCard.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("重启后应恢复的章节规划")
    });
    await expect(
      lstat(join(created.projectDirectory, recoveredCard.path))
    ).resolves.toBeDefined();
  });

  it("repairs missing overview files for existing list worldbuilding categories", async () => {
    const { projectStore, created } = await createFixture(
      "missing-worldbuilding-overview"
    );
    const categories = created.book.workspaceIndex.worldbuilding.filter(
      (category) => category.format === "list"
    );
    expect(categories.length).toBeGreaterThan(1);
    for (const category of categories) {
      expect(category.overview).toBeDefined();
      await expect(
        lstat(join(created.projectDirectory, category.overview!.path))
      ).resolves.toBeDefined();
    }

    const target = categories[0]!;
    await unlink(join(created.projectDirectory, target.overview!.path));

    const opened = await projectStore.openBook(created.projectDirectory);
    const repaired = opened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === target.id
    );
    if (!repaired || repaired.format !== "list" || !repaired.overview) {
      throw new Error("expected repaired list worldbuilding category");
    }
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: repaired.overview.id
      })
    ).resolves.toMatchObject({ content: "" });
  });

  it("derives every foreshadowing lifecycle status from committed beat types", () => {
    const thread = (
      status: LongForeshadowing["status"],
      types: LongForeshadowing["beats"][number]["type"][]
    ): LongForeshadowing =>
      ({
        id: "foreshadow_status",
        title: "状态推导",
        coreQuestion: "",
        truthEventId: null,
        expectedReaderEffect: "",
        status,
        beats: types.map((type, index) => ({
          id: `beat_status-${index}`,
          type,
          order: index + 1,
          eventId: null,
          placementId: null,
          chapterCardId: null,
          plannedScope: "测试",
          note: "",
          status: "committed",
          commitId: "commit_status"
        }))
      }) as LongForeshadowing;

    expect(deriveLongForeshadowingStatus(thread("planned", ["source"]))).toBe(
      "planned"
    );
    expect(deriveLongForeshadowingStatus(thread("planned", ["plant"]))).toBe(
      "open"
    );
    for (const type of ["reinforce", "misdirect", "partial_reveal"] as const) {
      expect(deriveLongForeshadowingStatus(thread("open", [type]))).toBe(
        "progressing"
      );
    }
    for (const type of ["reveal", "payoff"] as const) {
      expect(deriveLongForeshadowingStatus(thread("progressing", [type]))).toBe(
        "resolved"
      );
    }
    expect(deriveLongForeshadowingStatus(thread("abandoned", ["payoff"]))).toBe(
      "abandoned"
    );
  });

  it("creates through staging and opens the independent default project", async () => {
    const { parent, projectStore, created } = await createFixture("create");

    expect(created.book.bookType).toBe("long");
    expect(created.book.workspaceIndex.worldbuilding).toHaveLength(7);
    expect(
      created.book.workspaceIndex.characterTypes.map(({ id }) => id)
    ).toEqual([
      "protagonist",
      "major_supporting",
      "minor_supporting",
      "passerby"
    ]);
    expect(created.book.workspaceIndex.plot.volumes).toHaveLength(1);
    expect(created.book.workspaceIndex.plot.arcs).toHaveLength(1);
    expect(created.book.workspaceIndex.plot.arcs[0]?.title).toBe("第一剧情点");
    expect(created.book.workspaceIndex.plot.chapterCards).toHaveLength(1);
    expect(created.book.workspaceIndex.chapters).toHaveLength(1);
    expect(
      created.book.workspaceIndex.chapters[0]!.foreshadowingChanges
    ).toMatchObject({
      id: longChapterForeshadowingChangesFileId(
        created.book.workspaceIndex.chapters[0]!.chapterCardId
      ),
      path: longChapterContinuityFilePath(
        created.book.workspaceIndex.chapters[0]!.chapterCardId,
        "foreshadowing-changes.md"
      )
    });
    expect(created.summary.navigation.counts).toMatchObject({
      worldbuildingCategories: 7,
      volumes: 1,
      arcs: 1,
      chapterCards: 1
    });

    const files = [
      created.book.workspaceIndex.bookLine,
      ...Object.values(firstChapterFiles(created.book)),
      created.book.workspaceIndex.chapters[0]!.foreshadowingChanges
    ];
    for (const file of files) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: file.id
        })
      ).resolves.toMatchObject({ content: "", totalCharacters: 0 });
    }

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(opened.book.id).toBe(created.book.id);
    expect(JSON.stringify(opened.summary)).not.toContain("workspaceIndex");
    expect(JSON.stringify(opened.summary)).not.toContain("body.md");
    expect(await readdir(parent)).toEqual(["longbook_create"]);
    await expect(
      lstat(join(created.projectDirectory, "deepwrite.json"))
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(
      lstat(join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH))
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("persists chapter-card text across a complete store restart", async () => {
    const { created } = await createFixture("chapter-card-restart");
    const card = firstChapterFiles(created.book).card;
    const content = "## 第一章\n\n这是重启后仍需读取的章卡内容。";
    const initialStore = store();
    await initialStore.writeDocument(created.projectDirectory, {
      fileId: card.id,
      content
    });

    const restartedStore = store();
    const reopened = await restartedStore.openBook(created.projectDirectory);
    const reopenedCard = firstChapterFiles(reopened.book).card;
    await expect(
      restartedStore.readDocument(created.projectDirectory, {
        fileId: reopenedCard.id
      })
    ).resolves.toMatchObject({ content });
  });
});
