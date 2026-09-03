import {
  CatalogSnapshotSchema,
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  assertLegacyBookMigrationSourcesUnchanged,
  catalogDraftBodyDocumentId,
  catalogFixture,
  chmod,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  readdir,
  rm,
  stat,
  tickingClock,
  timestamp,
  utimes,
  writeFile,
  writeJson
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: migration-and-projects", () => {
  it("rejects source changes detected immediately before a legacy manifest switch", () => {
    expect(() =>
      assertLegacyBookMigrationSourcesUnchanged({
        originalManifestText: "manifest-v1",
        currentManifestText: "manifest-v1",
        originalLegacyDraftContent: "旧正文",
        currentLegacyDraftContent: "旧正文"
      })
    ).not.toThrow();
    expect(() =>
      assertLegacyBookMigrationSourcesUnchanged({
        originalManifestText: "manifest-v1",
        currentManifestText: "manifest-v1-external-edit",
        originalLegacyDraftContent: "旧正文",
        currentLegacyDraftContent: "旧正文"
      })
    ).toThrow(/迁移期间被外部修改/u);
    expect(() =>
      assertLegacyBookMigrationSourcesUnchanged({
        originalManifestText: "manifest-v1",
        currentManifestText: "manifest-v1",
        originalLegacyDraftContent: "旧正文",
        currentLegacyDraftContent: "外部更新后的正文"
      })
    ).toThrow(/迁移期间被外部修改/u);
  });

  it("migrates a complete snapshot into manifests and Markdown while preserving data", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-migrate-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const source = catalogFixture();

    const migrated = await store.migrateSnapshot(source);
    expect(migrated).toMatchObject(source);

    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      revision: number;
      updatedAt: string;
      legacyImport: { fingerprint: string };
      sourceCatalogMigrated: boolean;
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    expect(registry).toMatchObject({
      revision: 17,
      updatedAt: timestamp,
      sourceCatalogMigrated: true
    });
    expect(registry.legacyImport.fingerprint).toBe("a".repeat(64));
    expect(registry.projects).toHaveLength(5);

    await Promise.all(
      registry.projects.map(async ({ projectDirectory }) => {
        await expect(access(projectDirectory)).resolves.toBeUndefined();
        await expect(
          access(join(projectDirectory, "deepwrite.json"))
        ).resolves.toBeUndefined();
      })
    );

    const bookProject = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!;
    expect(bookProject.projectDirectory).toContain("雨夜-来信");
    const bookManifestText = await readFile(
      join(bookProject.projectDirectory, "deepwrite.json"),
      "utf8"
    );
    expect(bookManifestText).not.toContain("门外一直在下雨");
    const bookManifest = JSON.parse(bookManifestText) as {
      schemaVersion: number;
      kind: string;
      documents: Array<{ path: string }>;
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
    };
    expect(bookManifest).toMatchObject({
      schemaVersion: 4,
      kind: "deepwrite.book"
    });
    expect(bookManifest.documents).toHaveLength(7);
    expect(bookManifest.draft.sections).toHaveLength(2);
    await Promise.all(
      bookManifest.draft.sections.map(async (section, index) => {
        expect(section.body.path).toMatch(
          new RegExp(`^stages/draft/${section.id}\\.body\\.md$`, "u")
        );
        expect(section.characterState.path).toMatch(
          new RegExp(`^stages/draft/${section.id}\\.state\\.md$`, "u")
        );
        await expect(
          readFile(
            join(bookProject.projectDirectory, section.body.path),
            "utf8"
          )
        ).resolves.toBe(source.books[0]!.draft.sections[index]!.body.content);
        await expect(
          readFile(
            join(bookProject.projectDirectory, section.characterState.path),
            "utf8"
          )
        ).resolves.toBe(
          source.books[0]!.draft.sections[index]!.characterState.content
        );
      })
    );

    const materialProject = registry.projects.find(
      ({ id }) => id === "material-existing"
    )!;
    const materialManifestText = await readFile(
      join(materialProject.projectDirectory, "deepwrite.json"),
      "utf8"
    );
    expect(materialManifestText).not.toContain("守夜人从不在白天出现");
    const materialManifest = JSON.parse(materialManifestText) as {
      kind: string;
      entries: Array<{ path: string }>;
    };
    expect(materialManifest).toMatchObject({
      kind: "deepwrite.material-library",
      entries: [{ path: "entries/material-entry.md" }]
    });
    expect(
      await readFile(
        join(
          materialProject.projectDirectory,
          materialManifest.entries[0]!.path
        ),
        "utf8"
      )
    ).toBe(source.materials[0]!.entries[0]!.body);

    const skillProject = registry.projects.find(
      ({ id }) => id === "skill-existing"
    )!;
    const skillManifestText = await readFile(
      join(skillProject.projectDirectory, "deepwrite.json"),
      "utf8"
    );
    expect(skillManifestText).not.toContain("保持短句和悬念");
    const skillManifest = JSON.parse(skillManifestText) as {
      kind: string;
      entries: Array<{ path: string; sourceSkillId?: string }>;
    };
    expect(skillManifest).toMatchObject({
      kind: "deepwrite.skill-library",
      entries: [
        {
          path: "entries/skill-entry.md",
          sourceSkillId: "source-skill"
        }
      ]
    });
    expect(
      await readFile(
        join(skillProject.projectDirectory, skillManifest.entries[0]!.path),
        "utf8"
      )
    ).toBe(source.skills[0]!.entries[0]!.body);

    const materialGroupProject = registry.projects.find(
      ({ id }) => id === "material-group-existing"
    )!;
    expect(
      JSON.parse(
        await readFile(
          join(materialGroupProject.projectDirectory, "deepwrite.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      kind: "deepwrite.material-group",
      members: { character: "material-existing" }
    });
    const skillGroupProject = registry.projects.find(
      ({ id }) => id === "skill-group-existing"
    )!;
    expect(
      JSON.parse(
        await readFile(
          join(skillGroupProject.projectDirectory, "deepwrite.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      kind: "deepwrite.skill-group",
      members: { general: "skill-existing" }
    });

    const reloaded = await new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    }).snapshot();
    expect(reloaded).toMatchObject(source);
  });

  it("builds a content-aware index while Markdown files are unreadable", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-index-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const source = catalogFixture();
    source.books[0]!.documents.find(
      ({ id }) => id === "worldbuilding"
    )!.content = "雾城终年没有日出。";
    source.books[0]!.draft.sections[0]!.body.content = "第一节正文";
    source.books[0]!.draft.sections[0]!.characterState.content = "主角受伤";
    source.skills[0]!.overview = "技能库介绍";
    await store.migrateSnapshot(source);

    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const markdownFiles: Array<{
      id: string;
      path: string;
      bytes: number;
    }> = [];
    for (const project of registry.projects) {
      const manifest = JSON.parse(
        await readFile(join(project.projectDirectory, "deepwrite.json"), "utf8")
      ) as {
        kind: string;
        documents?: Array<{ id: string; path: string }>;
        draft?: {
          sections: Array<{
            body: { id: string; path: string };
            characterState: { id: string; path: string };
          }>;
        };
        entries?: Array<{ id: string; path: string }>;
      };
      const items = [
        ...(manifest.documents ?? []),
        ...(manifest.draft?.sections.flatMap((section) => [
          section.body,
          section.characterState
        ]) ?? []),
        ...(manifest.entries ?? [])
      ];
      for (const item of items) {
        const path = join(project.projectDirectory, item.path);
        markdownFiles.push({
          id: item.id,
          path,
          bytes: (await stat(path)).size
        });
        await chmod(path, 0o000);
      }
    }

    await expect(
      readFile(markdownFiles[0]!.path, "utf8")
    ).rejects.toMatchObject({
      code: "EACCES"
    });
    const index = await new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    }).indexSnapshot();
    expect(() => CatalogSnapshotSchema.parse(index)).not.toThrow();
    expect(index.projectDiagnostics).toBeUndefined();
    expect(
      index.books[0]!.documents.every(({ content }) => content === "")
    ).toBe(true);
    expect(
      index.books[0]!.draft.sections.every(
        ({ body, characterState }) =>
          body.content === "" && characterState.content === ""
      )
    ).toBe(true);
    expect(index.materials[0]).toMatchObject({
      overview: "",
      overviewContentBytes: Buffer.byteLength("人物备忘", "utf8"),
      entries: [
        {
          id: "material-entry",
          body: "",
          contentBytes: Buffer.byteLength("守夜人从不在白天出现。", "utf8")
        }
      ]
    });
    expect(index.skills[0]).toMatchObject({
      overview: "",
      overviewContentBytes: Buffer.byteLength("技能库介绍", "utf8"),
      entries: [
        {
          id: "skill-entry",
          body: "",
          contentBytes: Buffer.byteLength("保持短句和悬念。", "utf8")
        }
      ]
    });
    for (const file of markdownFiles) {
      const indexedDocument = [
        ...index.books.flatMap((book) => [
          ...book.documents,
          ...book.draft.sections.flatMap((section) => [
            section.body,
            section.characterState
          ])
        ]),
        ...index.materials.flatMap((library) => library.entries),
        ...index.skills.flatMap((library) => library.entries)
      ].find(({ id }) => id === file.id);
      expect(indexedDocument?.contentBytes).toBe(file.bytes);
    }
  });

  it("reads book files, draft files, library entries, and overviews on demand", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-read-document-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const source = catalogFixture();
    const book = source.books[0]!;
    const ordinary = book.documents.find(({ id }) => id === "worldbuilding")!;
    ordinary.content = "世界观正文";
    book.draft.sections[0]!.body.content = "正文小节内容";
    book.draft.sections[0]!.characterState.content = "人物状态内容";
    source.skills[0]!.overview = "技能库介绍";
    await store.migrateSnapshot(source);

    const reads = await Promise.all([
      store.readDocument({
        projectId: book.id,
        target: "document",
        documentId: ordinary.id
      }),
      store.readDocument({
        projectId: book.id,
        target: "document",
        documentId: book.draft.sections[0]!.body.id
      }),
      store.readDocument({
        projectId: book.id,
        target: "document",
        documentId: book.draft.sections[0]!.characterState.id
      }),
      store.readDocument({
        projectId: source.materials[0]!.id,
        target: "document",
        documentId: source.materials[0]!.entries[0]!.id
      }),
      store.readDocument({
        projectId: source.skills[0]!.id,
        target: "document",
        documentId: source.skills[0]!.entries[0]!.id
      }),
      store.readDocument({
        projectId: source.materials[0]!.id,
        target: "overview"
      }),
      store.readDocument({
        projectId: source.skills[0]!.id,
        target: "overview"
      })
    ]);

    expect(reads.map(({ content }) => content)).toEqual([
      "世界观正文",
      "正文小节内容",
      "人物状态内容",
      "守夜人从不在白天出现。",
      "保持短句和悬念。",
      "人物备忘",
      "技能库介绍"
    ]);
    for (const result of reads) {
      expect(result.revision).toBe(
        createShortWorkspaceContentRevision(result.content)
      );
      expect(result.contentBytes).toBe(
        Buffer.byteLength(result.content, "utf8")
      );
      expect(result.projectRevision).toBe(0);
    }
    await expect(
      store.readDocument({
        projectId: book.id,
        target: "document",
        documentId: "missing-document"
      })
    ).rejects.toThrow(/文档不存在/u);
    await expect(
      store.readDocument({
        projectId: source.materialGroups[0]!.id,
        target: "overview"
      })
    ).rejects.toThrow(/素材库或技能库/u);
    await expect(
      new FolderCatalogStore({
        userDataPath,
        maxMarkdownBytes: 4
      }).readDocument({
        projectId: book.id,
        target: "document",
        documentId: ordinary.id
      })
    ).rejects.toThrow(/byte limit/u);
  });

  it("changes contentStamp after a same-byte external Markdown edit", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-content-stamp-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const source = catalogFixture();
    await store.migrateSnapshot(source);

    const before = await store.indexSnapshot();
    const beforeEntry = before.materials[0]!.entries[0]!;
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const project = registry.projects.find(
      ({ id }) => id === source.materials[0]!.id
    )!;
    const manifest = JSON.parse(
      await readFile(join(project.projectDirectory, "deepwrite.json"), "utf8")
    ) as { entries: Array<{ id: string; path: string }> };
    const entry = manifest.entries.find(({ id }) => id === beforeEntry.id)!;
    const entryPath = join(project.projectDirectory, entry.path);
    const original = await readFile(entryPath, "utf8");
    const externallyEdited = original.replace("守", "巡");
    expect(Buffer.byteLength(externallyEdited, "utf8")).toBe(
      Buffer.byteLength(original, "utf8")
    );
    await writeFile(entryPath, externallyEdited, "utf8");
    await utimes(
      entryPath,
      new Date("2030-01-01T00:00:00.000Z"),
      new Date("2030-01-01T00:00:00.000Z")
    );

    const after = await new FolderCatalogStore({
      userDataPath
    }).indexSnapshot();
    const afterEntry = after.materials[0]!.entries[0]!;
    expect(afterEntry.contentBytes).toBe(beforeEntry.contentBytes);
    expect(afterEntry.contentStamp).not.toBe(beforeEntry.contentStamp);
    await expect(
      store.readDocument({
        projectId: source.materials[0]!.id,
        target: "document",
        documentId: entry.id
      })
    ).resolves.toMatchObject({ content: externallyEdited });
  });

  it("creates collision-safe book folders, saves with content revisions, and only unregisters", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-create-");
    const userDataPath = join(root, "user-data");
    const parentDirectory = join(root, "写作项目");
    const store = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    const first = await store.createShortBook(
      { title: "雨夜/来信", genre: "悬疑" },
      parentDirectory
    );
    const second = await store.createShortBook({
      parentDirectory,
      input: { title: "雨夜/来信", genre: "悬疑" }
    });

    expect(first.projectDirectory).toMatch(/\/雨夜-来信$/u);
    expect(second.projectDirectory).toMatch(/\/雨夜-来信-2$/u);
    expect(first.resource.id).toMatch(/^book-[0-9a-f]{8}$/);
    expect(second.resource.id).toMatch(/^book-[0-9a-f]{8}$/);
    expect(first.resource.documents).toHaveLength(7);
    expect(first.resource.draft.sections).toHaveLength(2);

    const emptyRevision = createShortWorkspaceContentRevision("");
    const bodyDocumentId = catalogDraftBodyDocumentId("section-1");
    const saved = await store.saveDocument({
      bookId: first.resource.id,
      documentId: bodyDocumentId,
      content: "新的正文",
      baseRevision: emptyRevision,
      baseProjectRevision: 0
    });
    expect(saved.content).toBe("新的正文");
    expect(saved.projectRevision).toBe(1);
    await expect(
      store.saveDocument({
        bookId: first.resource.id,
        documentId: bodyDocumentId,
        content: "会覆盖的正文",
        baseRevision: emptyRevision,
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    const revision = await store.getProjectRevision(first.resource.id, "book");
    const updated = await store.updateBook({
      bookId: first.resource.id,
      title: "雨停之后",
      status: "completed",
      baseProjectRevision: revision
    });
    expect(updated).toMatchObject({ title: "雨停之后", status: "completed" });

    expect(await store.removeBook(first.resource.id)).toEqual({
      bookId: first.resource.id,
      deleted: true
    });
    await expect(access(first.projectDirectory)).resolves.toBeUndefined();
    expect((await store.snapshot()).books.map(({ id }) => id)).toEqual([
      second.resource.id
    ]);

    const reopened = await store.openBookProject(first.projectDirectory);
    expect(
      reopened.resource.draft.sections.find(({ id }) => id === "section-1")
        ?.body.content
    ).toBe("新的正文");
    expect((await store.snapshot()).books).toHaveLength(2);
  });

  it("atomically creates, updates, reorders, and deletes plot structure files", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-plot-structure-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "剧情结构测试", genre: "悬疑" },
      join(root, "books")
    );
    const secondBook = await store.createShortBook(
      { title: "剧情结构顺序同步", genre: "其他" },
      join(root, "books")
    );
    const created = await store.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 0,
      mutation: {
        type: "create",
        title: "反转校验",
        description: "核对反转证据链。"
      }
    });
    const stage = created.plotStages.at(-1)!;
    expect(created.projectRevision).toBe(1);
    const createdManifest = JSON.parse(
      await readFile(join(opened.projectDirectory, "deepwrite.json"), "utf8")
    ) as {
      documents: Array<{ id: string; title: string; path: string }>;
    };
    const originalFile = createdManifest.documents.find(
      ({ id }) => id === stage.id
    )!;
    await expect(
      readFile(join(opened.projectDirectory, originalFile.path), "utf8")
    ).resolves.toBe("");

    const updated = await store.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 1,
      mutation: {
        type: "update",
        stageId: stage.id,
        title: "反转与证据",
        description: "核对证据链和人物知情边界。"
      }
    });
    expect(updated.plotStages.at(-1)).toMatchObject({
      id: stage.id,
      title: "反转与证据"
    });
    const updatedManifest = JSON.parse(
      await readFile(join(opened.projectDirectory, "deepwrite.json"), "utf8")
    ) as { documents: Array<{ id: string; path: string }> };
    expect(
      updatedManifest.documents.find(({ id }) => id === stage.id)?.path
    ).toBe(originalFile.path);

    const moved = await store.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 2,
      mutation: { type: "move", stageId: stage.id, direction: "up" }
    });
    expect(moved.plotStages.at(-2)?.id).toBe(stage.id);
    expect(
      (await store.snapshot()).books
        .find(({ id }) => id === secondBook.resource.id)
        ?.plotStages.at(-2)?.id
    ).toBe(stage.id);
    const afterMove = await store.createShortBook(
      { title: "沿用剧情结构顺序", genre: "其他" },
      join(root, "books")
    );
    expect(afterMove.resource.plotStages.at(-2)?.id).toBe(stage.id);
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: stage.id,
      content: "不可静默删除的反转内容。",
      baseRevision: createShortWorkspaceContentRevision(""),
      baseProjectRevision: 3
    });
    await expect(
      store.mutatePlotStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 4,
        mutation: { type: "delete", stageId: "plot_design" }
      })
    ).rejects.toThrow(/默认剧情结构不可删除/u);

    expect(
      opened.resource.plotStages
        .filter((stage) => stage.enabled)
        .map(({ id }) => id)
    ).toEqual(["plot_design", "intro_design", "plot_refine"]);
    const enabled = await store.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 4,
      mutation: {
        type: "setEnabled",
        stageId: "outline",
        enabled: true
      }
    });
    expect(enabled.plotStages.find(({ id }) => id === "outline")?.enabled).toBe(
      true
    );

    const deleted = await store.mutatePlotStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 5,
      mutation: { type: "delete", stageId: stage.id }
    });
    expect(deleted.plotStages.some(({ id }) => id === stage.id)).toBe(false);
    expect(deleted.documents.some(({ id }) => id === stage.id)).toBe(false);
    await expect(
      access(join(opened.projectDirectory, originalFile.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      store.mutatePlotStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 5,
        mutation: {
          type: "move",
          stageId: "outline",
          direction: "up"
        }
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    const manifestPath = join(opened.projectDirectory, "deepwrite.json");
    const manifestBytes = Buffer.byteLength(
      await readFile(manifestPath, "utf8"),
      "utf8"
    );
    const stageFilesBefore = await readdir(
      join(opened.projectDirectory, "stages")
    );
    const constrained = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock(),
      maxManifestBytes: manifestBytes + 8
    });
    await expect(
      constrained.mutatePlotStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 6,
        mutation: {
          type: "create",
          title: "无法提交的结构",
          description: "这段说明会让 manifest 超过预设测试上限。"
        }
      })
    ).rejects.toThrow(/byte limit/u);
    expect(await readdir(join(opened.projectDirectory, "stages"))).toEqual(
      stageFilesBefore
    );
  });

  it("preserves character text through list CRUD and both format conversions", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-character-structure-"
    );
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "人物结构测试", genre: "悬疑" },
      join(root, "books")
    );
    expect(opened.resource.characterStructure).toEqual({ format: "text" });

    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: "character_design",
      content: "林默是守夜人。",
      baseRevision: createShortWorkspaceContentRevision(""),
      baseProjectRevision: 0
    });
    const listed = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 1,
      mutation: { type: "setFormat", format: "list" }
    });
    expect(listed.characterStructure).toMatchObject({
      format: "list",
      items: [{ title: "人物设定", order: 1 }]
    });
    const firstItem =
      listed.characterStructure.format === "list"
        ? listed.characterStructure.items[0]!
        : undefined;
    expect(firstItem).toBeDefined();
    expect(
      listed.documents.find(({ id }) => id === firstItem!.id)?.content
    ).toBe("林默是守夜人。");
    expect(
      listed.documents.find(({ id }) => id === "character_design")
    ).toMatchObject({
      title: "概览",
      content: ""
    });

    const created = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 2,
      mutation: {
        type: "createItem",
        itemId: "character-fixed-id",
        title: "苏遥"
      }
    });
    expect(created.characterStructure).toMatchObject({
      format: "list",
      items: [
        { id: firstItem!.id, order: 1 },
        { id: "character-fixed-id", title: "苏遥", order: 2 }
      ]
    });
    const replayedCreation = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 0,
      force: true,
      mutation: {
        type: "createItem",
        itemId: "character-fixed-id",
        title: "苏遥"
      }
    });
    expect(replayedCreation.characterStructure).toEqual(
      created.characterStructure
    );
    expect(await store.getProjectRevision(opened.resource.id, "book")).toBe(3);
    await expect(
      store.mutateCharacterStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 0,
        force: true,
        mutation: {
          type: "createItem",
          itemId: "character-fixed-id",
          title: "不同人物"
        }
      })
    ).rejects.toThrow(/人物条目标识已存在/u);
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: "character-fixed-id",
      content: "苏遥保管底片。",
      baseRevision: createShortWorkspaceContentRevision(""),
      baseProjectRevision: 3
    });
    const renamed = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 4,
      mutation: {
        type: "updateItem",
        itemId: "character-fixed-id",
        title: "苏遥（摄影师）"
      }
    });
    expect(
      renamed.documents.find(({ id }) => id === "character-fixed-id")?.title
    ).toBe("苏遥（摄影师）");
    const moved = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 5,
      mutation: {
        type: "moveItem",
        itemId: "character-fixed-id",
        direction: "up"
      }
    });
    expect(
      moved.characterStructure.format === "list"
        ? moved.characterStructure.items.map(({ id }) => id)
        : []
    ).toEqual(["character-fixed-id", firstItem!.id]);

    const merged = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 6,
      mutation: { type: "setFormat", format: "text" }
    });
    expect(merged.characterStructure).toEqual({ format: "text" });
    const mergedText = merged.documents.find(
      ({ id }) => id === "character_design"
    )?.content;
    expect(mergedText).toContain("# 苏遥（摄影师）\n\n苏遥保管底片。");
    expect(mergedText).toContain("# 人物设定\n\n林默是守夜人。");
    expect(merged.documents.some(({ id }) => id === "character-fixed-id")).toBe(
      false
    );
    await expect(
      store.mutateCharacterStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 6,
        mutation: { type: "setFormat", format: "list" }
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    const relisted = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 7,
      mutation: { type: "setFormat", format: "list" }
    });
    expect(
      relisted.characterStructure.format === "list"
        ? relisted.characterStructure.items.map(({ title }) => title)
        : []
    ).toEqual(["人物设定"]);
  });

  it("keeps list character files intact when merged text exceeds the limit", async () => {
    const root = await makeTemporaryRoot("deepwrite-character-rollback-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      maxMarkdownBytes: 24,
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "人物回滚测试", genre: "悬疑" },
      join(root, "books")
    );
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: "character_design",
      content: "alpha",
      baseRevision: createShortWorkspaceContentRevision(""),
      baseProjectRevision: 0
    });
    const listed = await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 1,
      mutation: { type: "setFormat", format: "list" }
    });
    const firstId =
      listed.characterStructure.format === "list"
        ? listed.characterStructure.items[0]!.id
        : "";
    await store.mutateCharacterStructure({
      bookId: opened.resource.id,
      baseProjectRevision: 2,
      mutation: { type: "createItem", itemId: "character-beta", title: "B" }
    });
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: "character-beta",
      content: "beta",
      baseRevision: createShortWorkspaceContentRevision(""),
      baseProjectRevision: 3
    });

    await expect(
      store.mutateCharacterStructure({
        bookId: opened.resource.id,
        baseProjectRevision: 4,
        mutation: { type: "setFormat", format: "text" }
      })
    ).rejects.toThrow(/byte limit|大小|上限/u);
    const unchanged = (await store.snapshot()).books.find(
      ({ id }) => id === opened.resource.id
    )!;
    expect(unchanged.characterStructure.format).toBe("list");
    expect(unchanged.documents.find(({ id }) => id === firstId)?.content).toBe(
      "alpha"
    );
    expect(
      unchanged.documents.find(({ id }) => id === "character-beta")?.content
    ).toBe("beta");
  });

  it("migrates v2 short and script manifests to the shared default plot stages without changing existing content or revisions", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-v2-plot-migration-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    const projects = [
      await store.createShortBook(
        { title: "v2 短篇", genre: "悬疑" },
        join(root, "books")
      ),
      await store.createScriptBook(
        { title: "v2 剧本", genre: "悬疑" },
        join(root, "books")
      )
    ];

    for (const project of projects) {
      await store.saveDocument({
        bookId: project.resource.id,
        documentId: "plot_design",
        content: `${project.resource.bookType} 原剧情`,
        baseRevision: createShortWorkspaceContentRevision(""),
        baseProjectRevision: 0
      });
      const manifestPath = join(project.projectDirectory, "deepwrite.json");
      const current = JSON.parse(await readFile(manifestPath, "utf8")) as {
        schemaVersion: number;
        revision: number;
        createdAt: string;
        updatedAt: string;
        plotStages?: unknown;
        documents: Array<{ id: string; path: string }>;
        [key: string]: unknown;
      };
      const missingIds = new Set(
        project.resource.bookType === "script"
          ? ["intro_design", "narrative_perspective"]
          : ["narrative_perspective"]
      );
      for (const document of current.documents) {
        if (missingIds.has(document.id)) {
          await rm(join(project.projectDirectory, document.path));
        }
      }
      const {
        plotStages: _plotStages,
        characterStructure: _characterStructure,
        ...withoutPlotStages
      } = current;
      await writeJson(manifestPath, {
        ...withoutPlotStages,
        schemaVersion: 2,
        documents: current.documents.filter(({ id }) => !missingIds.has(id))
      });
    }

    const restarted = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    const snapshot = await restarted.snapshot();
    expect(snapshot.books).toHaveLength(2);
    for (const book of snapshot.books) {
      expect(book.projectRevision).toBe(1);
      expect(book.plotStages.map(({ id }) => id)).toEqual([
        "worldbuilding",
        "plot_design",
        "intro_design",
        "plot_refine",
        "narrative_perspective",
        "outline"
      ]);
      expect(
        book.documents.find(({ id }) => id === "plot_design")?.content
      ).toBe(`${book.bookType} 原剧情`);
      expect(
        book.documents.find(({ id }) => id === "narrative_perspective")?.content
      ).toBe("");
      expect(
        book.documents.find(({ id }) => id === "worldbuilding")?.content
      ).toBe("");
      expect(book.draft.sections.length).toBeGreaterThan(0);
      const migratedManifest = JSON.parse(
        await readFile(
          join(
            projects.find(({ resource }) => resource.id === book.id)!
              .projectDirectory,
            "deepwrite.json"
          ),
          "utf8"
        )
      ) as { schemaVersion: number; revision: number };
      expect(migratedManifest).toMatchObject({ schemaVersion: 4, revision: 1 });
    }
  });

  it("migrates early v3 books whose plot stages predate the enabled flag", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-v3-enabled-migration-"
    );
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath, now: tickingClock() });
    const opened = await store.createShortBook(
      { title: "旧版 v3 书籍", genre: "悬疑" },
      join(root, "books")
    );
    const manifestPath = join(opened.projectDirectory, "deepwrite.json");
    const current = JSON.parse(await readFile(manifestPath, "utf8")) as {
      characterStructure: unknown;
      plotStages: Array<{
        id: string;
        title: string;
        description: string;
        enabled?: boolean;
      }>;
      [key: string]: unknown;
    };
    const { characterStructure: _characterStructure, ...withoutCharacters } =
      current;
    await writeJson(manifestPath, {
      ...withoutCharacters,
      schemaVersion: 3,
      plotStages: current.plotStages.map(
        ({ enabled: _enabled, ...stage }) => stage
      )
    });

    const restarted = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    const snapshot = await restarted.snapshot();
    expect(snapshot.projectDiagnostics ?? []).toEqual([]);
    expect(snapshot.books).toMatchObject([
      {
        id: opened.resource.id,
        characterStructure: { format: "text" },
        plotStages: [
          { id: "worldbuilding", enabled: true },
          { id: "plot_design", enabled: true },
          { id: "intro_design", enabled: true },
          { id: "plot_refine", enabled: true },
          { id: "narrative_perspective", enabled: true },
          { id: "outline", enabled: true }
        ]
      }
    ]);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      schemaVersion: 4,
      characterStructure: { format: "text" }
    });
  });

  it("creates screenplay projects with the shared default plot structure and numbered episodes", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-script-create-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const created = await store.createScriptBook(
      { title: "雨夜剧本", genre: "悬疑" },
      join(root, "books")
    );

    expect(created.resource).toMatchObject({
      bookType: "script",
      documents: [
        { id: "character_design", title: "人物设计" },
        { id: "worldbuilding", title: "世界观" },
        { id: "plot_design", title: "剧情设计" },
        { id: "intro_design", title: "导语设计" },
        { id: "plot_refine", title: "剧情细化" },
        { id: "narrative_perspective", title: "叙事视角" },
        { id: "outline", title: "大纲" }
      ],
      draft: {
        sections: [{ id: "episode-1", title: "第一集" }]
      }
    });
    expect(
      created.resource.plotStages.find(({ id }) => id === "worldbuilding")
    ).toMatchObject({ enabled: false });
    expect(
      created.resource.documents.some(({ id }) => id === "intro_design")
    ).toBe(true);
    expect(
      created.resource.draft.sections.some(({ title }) => title === "导语")
    ).toBe(false);

    const secondEpisode = await store.createDraftSection({
      bookId: created.resource.id,
      baseProjectRevision: 0
    });
    expect(secondEpisode).toMatchObject({
      id: "episode-2",
      title: "第二集"
    });

    const reopened = await store.openBookProject(
      created.projectDirectory,
      false
    );
    expect(reopened.resource.bookType).toBe("script");
    expect(reopened.resource.draft.sections.map(({ title }) => title)).toEqual([
      "第一集",
      "第二集"
    ]);
    const manifest = JSON.parse(
      await readFile(join(created.projectDirectory, "deepwrite.json"), "utf8")
    ) as {
      bookType: string;
      documents: Array<{ id: string }>;
      draft: { sections: Array<{ id: string }> };
    };
    expect(manifest.bookType).toBe("script");
    expect(manifest.documents.map(({ id }) => id)).toEqual([
      "character_design",
      "worldbuilding",
      "plot_design",
      "intro_design",
      "plot_refine",
      "narrative_perspective",
      "outline"
    ]);
    expect(manifest.draft.sections.map(({ id }) => id)).toEqual([
      "episode-1",
      "episode-2"
    ]);
  });
});
