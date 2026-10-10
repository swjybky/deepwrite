import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  catalogFixture,
  cp,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  realpath,
  rm,
  tickingClock,
  writeFile
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: libraries-and-registration", () => {
  it("uses the configured default plot stages when creating a short book", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-default-stages-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const seed = await store.createShortBook(
      { title: "默认阶段模板", genre: "其他" },
      join(root, "projects")
    );
    const customized = await store.mutatePlotStructure({
      bookId: seed.resource.id,
      baseProjectRevision: 0,
      mutation: {
        type: "create",
        title: "自定义剧情阶段",
        description: "验证设置可以引用结构管理中的动态阶段。"
      }
    });
    const customStageId = customized.plotStages.at(-1)!.id;

    const opened = await store.createShortBook(
      {
        title: "自定义默认阶段",
        genre: "其他",
        defaultPlotStageIds: [customStageId]
      },
      join(root, "projects")
    );

    expect(
      opened.resource.plotStages
        .filter((stage) => stage.enabled)
        .map(({ id }) => id)
    ).toEqual([customStageId]);
  });

  it("initializes an imported legacy book as a current manifest and Markdown project", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-import-legacy-");
    const parentDirectory = join(root, "工作目录", "books");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const imported = await store.importLegacyBook(
      {
        title: "旧版雨夜来信",
        genre: "悬疑",
        status: "editing",
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
        documents: [
          { id: "character_design", title: "人物设计", content: "旧人物" },
          { id: "plot_design", title: "剧情设计", content: "" },
          { id: "intro_design", title: "导语设计", content: "" },
          { id: "plot_refine", title: "剧情细化", content: "" },
          { id: "outline", title: "大纲", content: "旧大纲" },
          { id: "draft", title: "正文编写", content: "旧正文" },
          {
            id: "legacy-7-review",
            title: "正文审阅（旧版）",
            content: "旧审阅"
          }
        ]
      },
      parentDirectory
    );

    expect(imported.projectDirectory).toBe(
      join(await realpath(parentDirectory), "旧版雨夜来信")
    );
    expect(imported.resource.documents).toHaveLength(8);
    expect(
      imported.resource.draft.sections.find(({ id }) => id === "section-1")
        ?.body.content
    ).toBe("旧正文");
    const manifest = JSON.parse(
      await readFile(join(imported.projectDirectory, "deepwrite.json"), "utf8")
    ) as {
      schemaVersion: number;
      kind: string;
      documents: Array<{ id: string; path: string }>;
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
    };
    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.kind).toBe("deepwrite.book");
    expect(manifest.documents.some(({ id }) => id === "draft")).toBe(false);
    const firstSection = manifest.draft.sections.find(
      ({ id }) => id === "section-1"
    )!;
    expect(firstSection.body.path).toBe("stages/draft/section-1.body.md");
    expect(firstSection.characterState.path).toBe(
      "stages/draft/section-1.state.md"
    );
    await expect(
      readFile(join(imported.projectDirectory, firstSection.body.path), "utf8")
    ).resolves.toBe("旧正文");
    await expect(
      readFile(
        join(imported.projectDirectory, firstSection.characterState.path),
        "utf8"
      )
    ).resolves.toBe("");
  });

  it("imports a library package as new libraries and a group, or nothing", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-library-package-");
    const parents = {
      library: join(root, "工作目录", "materials"),
      group: join(root, "工作目录", "material-groups")
    };
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    await store.createLibrary({
      domain: "material",
      name: "都市人设",
      materialKind: "character",
      parentDirectory: parents.library
    });
    const resolved = {
      domain: "material" as const,
      group: { title: "都市素材组", slots: ["character", "other"] },
      libraries: [
        {
          title: "都市人设",
          kind: "character",
          libraryType: "long" as const,
          parentGenre: "都市",
          subGenre: "追妻",
          overview: "人设说明",
          entries: [
            { title: "霸总", stageId: "character", content: "冷面护短" },
            { title: "空条目", stageId: "character", content: "" }
          ]
        },
        {
          title: "杂项",
          kind: "mixed",
          libraryType: "short" as const,
          parentGenre: "",
          subGenre: "",
          overview: "",
          entries: [{ title: "灵感", stageId: "gimmick", content: "雨夜" }]
        }
      ]
    };

    const imported = await store.importLibraryPackage(resolved, parents);
    expect(imported).toMatchObject({ domain: "material", entryCount: 3 });
    const snapshot = await store.snapshot();
    const libraries = imported.libraryIds.map((id) =>
      snapshot.materials.find((library) => library.id === id)!
    );
    expect(libraries.map(({ title }) => title)).toEqual([
      "都市人设 (2)",
      "杂项"
    ]);
    expect(libraries[0]).toMatchObject({
      materialType: "long",
      parentGenre: "都市",
      overview: "人设说明",
      entries: [
        { title: "霸总", stageId: "character", body: "冷面护短" },
        { title: "空条目", stageId: "character", body: "" }
      ]
    });
    expect(snapshot.materialGroups).toEqual([
      expect.objectContaining({
        id: imported.groupId,
        title: "都市素材组",
        members: { character: libraries[0]!.id, other: libraries[1]!.id }
      })
    ]);

    const source = await store.readLibraryPackageSource({
      domain: "material",
      target: { type: "group", id: imported.groupId! }
    });
    expect(source.groupTitle).toBe("都市素材组");
    expect(
      source.members.map(({ slot, library }) => [slot, library?.title])
    ).toEqual([
      ["character", "都市人设 (2)"],
      ["other", "杂项"]
    ]);

    // A group parent that is a file fails after the libraries were written.
    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a folder");
    await expect(
      store.importLibraryPackage(resolved, { ...parents, group: blocked })
    ).rejects.toThrow();
    const after = await store.snapshot();
    expect(after.materials).toHaveLength(snapshot.materials.length);
    expect(after.materialGroups).toHaveLength(1);
  });

  it("does not resurrect an unregistered legacy book when the app restarts", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-unregister-restart-"
    );
    const userDataPath = join(root, "user-data");
    const source = catalogFixture();
    const store = new FolderCatalogStore({
      userDataPath,
      initialSnapshot: source
    });
    expect((await store.snapshot()).books.map(({ id }) => id)).toEqual([
      "book-existing"
    ]);

    await store.removeBook("book-existing");
    const restarted = new FolderCatalogStore({
      userDataPath,
      initialSnapshot: source
    });
    expect((await restarted.snapshot()).books).toEqual([]);
  });

  it("rejects a copied project with the same UUID while the original still exists", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-duplicate-project-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const opened = await store.createShortBook(
      { title: "原始项目", genre: "其他" },
      join(root, "projects")
    );
    const copiedDirectory = join(root, "projects", "项目副本");
    await cp(opened.projectDirectory, copiedDirectory, { recursive: true });

    await expect(store.openBookProject(copiedDirectory)).rejects.toThrow(
      /相同项目 ID/u
    );
    expect((await store.snapshot()).books).toHaveLength(1);
  });

  it("preserves ids that are equal in different catalog domains", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-cross-domain-id-");
    const source = catalogFixture();
    source.books[0]!.id = "shared-id";
    source.materials[0]!.id = "shared-id";
    source.books[0]!.linkedMaterialIdsByKind.character = ["shared-id"];
    source.materialGroups[0]!.members.character = "shared-id";
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });

    const migrated = await store.migrateSnapshot(source);
    expect(migrated.books[0]?.id).toBe("shared-id");
    expect(migrated.materials[0]?.id).toBe("shared-id");
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; domain: string }>;
    };
    expect(
      registry.projects
        .filter(({ id }) => id === "shared-id")
        .map(({ domain }) => domain)
    ).toEqual(["material-library", "book"]);
  });

  it("keeps available projects usable when a registered folder was moved", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-missing-project-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const missing = registry.projects.find(
      ({ id }) => id === "material-existing"
    )!;
    await rm(missing.projectDirectory, { recursive: true, force: true });

    const snapshot = await store.snapshot();
    expect(snapshot.materials).toEqual([]);
    expect(snapshot.books.map(({ id }) => id)).toEqual(["book-existing"]);
    expect(snapshot.skills.map(({ id }) => id)).toEqual(["skill-existing"]);
    expect(snapshot.projectDiagnostics).toEqual([
      expect.objectContaining({
        projectId: "material-existing",
        kind: "deepwrite.material-library",
        code: "unavailable"
      })
    ]);
  });

  it("re-reads external Markdown edits and saves material and skill entry files", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-library-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const bookDirectory = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!.projectDirectory;
    const materialDirectory = registry.projects.find(
      ({ id }) => id === "material-existing"
    )!.projectDirectory;
    const skillDirectory = registry.projects.find(
      ({ id }) => id === "skill-existing"
    )!.projectDirectory;
    const bookManifest = JSON.parse(
      await readFile(join(bookDirectory, "deepwrite.json"), "utf8")
    ) as {
      draft: { sections: Array<{ id: string; body: { path: string } }> };
    };
    const bodyPath = bookManifest.draft.sections.find(
      ({ id }) => id === "section-1"
    )!.body.path;
    await writeFile(join(bookDirectory, bodyPath), "Cursor 外部修改", "utf8");
    expect(
      (await store.snapshot()).books[0]?.draft.sections.find(
        ({ id }) => id === "section-1"
      )?.body.content
    ).toBe("Cursor 外部修改");

    const material = await store.saveLibraryEntry({
      domain: "material",
      libraryId: "material-existing",
      entryId: "material-entry",
      title: "新守夜人",
      content: "素材的新正文",
      baseRevision:
        createShortWorkspaceContentRevision("守夜人从不在白天出现。"),
      baseProjectRevision: 0
    });
    expect(material).toMatchObject({ title: "新守夜人", body: "素材的新正文" });

    const skill = await store.saveLibraryEntry({
      domain: "skill",
      libraryId: "skill-existing",
      entryId: "skill-entry",
      content: "技能的新正文",
      baseRevision: createShortWorkspaceContentRevision("保持短句和悬念。"),
      baseProjectRevision: 0
    });
    expect(skill).toMatchObject({
      body: "技能的新正文",
      sourceSkillId: "source-skill"
    });

    const savedMaterialManifestText = await readFile(
      join(materialDirectory, "deepwrite.json"),
      "utf8"
    );
    expect(savedMaterialManifestText).not.toContain("素材的新正文");
    const savedMaterialManifest = JSON.parse(savedMaterialManifestText) as {
      revision: number;
      entries: Array<{ title: string; path: string }>;
    };
    expect(savedMaterialManifest).toMatchObject({
      revision: 1,
      entries: [{ title: "新守夜人", path: "entries/material-entry.md" }]
    });
    expect(
      await readFile(
        join(materialDirectory, savedMaterialManifest.entries[0]!.path),
        "utf8"
      )
    ).toBe("素材的新正文");

    const savedSkillManifestText = await readFile(
      join(skillDirectory, "deepwrite.json"),
      "utf8"
    );
    expect(savedSkillManifestText).not.toContain("技能的新正文");
    const savedSkillManifest = JSON.parse(savedSkillManifestText) as {
      revision: number;
      entries: Array<{ path: string; sourceSkillId?: string }>;
    };
    expect(savedSkillManifest).toMatchObject({
      revision: 1,
      entries: [
        {
          path: "entries/skill-entry.md",
          sourceSkillId: "source-skill"
        }
      ]
    });
    expect(
      await readFile(
        join(skillDirectory, savedSkillManifest.entries[0]!.path),
        "utf8"
      )
    ).toBe("技能的新正文");

    await expect(
      store.saveLibraryEntry({
        domain: "skill",
        libraryId: "skill-existing",
        entryId: "skill-entry",
        content: "冲突内容",
        baseRevision: createShortWorkspaceContentRevision("保持短句和悬念。"),
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    const restarted = await new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    }).snapshot();
    expect(restarted.materials[0]?.entries[0]).toMatchObject({
      title: "新守夜人",
      body: "素材的新正文"
    });
    expect(restarted.skills[0]?.entries[0]).toMatchObject({
      body: "技能的新正文",
      sourceSkillId: "source-skill"
    });
  });

  it("creates folder-backed material and skill libraries and maintains entry files", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-library-crud-");
    const userDataPath = join(root, "user-data");
    const parentDirectory = join(root, "本地资源库");
    const store = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });

    const material = await store.createLibrary({
      domain: "material",
      name: "人物/素材",
      materialKind: "character",
      parentDirectory
    });
    const skill = await store.createLibrary({
      domain: "skill",
      name: "悬念技能",
      skillKind: "plot",
      parentDirectory
    });

    expect(material).toMatchObject({
      domain: "material-library",
      revision: 0,
      resource: {
        title: "人物/素材",
        materialType: "short",
        materialKind: "character",
        parentGenre: "",
        subGenre: "",
        overview: "",
        entries: [],
        projectRevision: 0
      }
    });
    expect(material.resource.id).toMatch(/^material-[0-9a-f]{8}$/);
    expect(skill).toMatchObject({
      domain: "skill-library",
      revision: 0,
      resource: {
        title: "悬念技能",
        skillType: "short",
        skillKind: "plot",
        overview: "",
        isBuiltin: false,
        entries: [],
        projectRevision: 0
      }
    });
    expect(skill.resource.id).toMatch(/^skill-[0-9a-f]{8}$/);
    expect(material.projectDirectory).toMatch(/\/人物-素材$/u);
    expect(skill.projectDirectory).toMatch(/\/悬念技能$/u);
    await expect(
      access(join(material.projectDirectory, "entries"))
    ).resolves.toBeUndefined();
    await expect(
      access(join(skill.projectDirectory, "entries"))
    ).resolves.toBeUndefined();

    const materialEntry = await store.createLibraryEntry({
      domain: "material",
      libraryId: material.resource.id,
      title: "守夜人",
      content: "守夜人只在雨夜出现。"
    });
    const skillEntry = await store.createLibraryEntry({
      domain: "skill",
      libraryId: skill.resource.id,
      title: "结尾留钩",
      content: "每一节结尾保留未回答的问题。"
    });
    expect(materialEntry).toMatchObject({
      stageId: "other",
      title: "守夜人",
      body: "守夜人只在雨夜出现。"
    });
    expect(materialEntry.id).toMatch(/^material-entry-[0-9a-f]{8}$/);
    expect(skillEntry).toMatchObject({
      stageId: "draft",
      title: "结尾留钩",
      body: "每一节结尾保留未回答的问题。"
    });
    expect(skillEntry.id).toMatch(/^skill-entry-[0-9a-f]{8}$/);

    const materialManifest = JSON.parse(
      await readFile(join(material.projectDirectory, "deepwrite.json"), "utf8")
    ) as {
      revision: number;
      materialKind: string;
      entries: Array<{ id: string; stageId: string; path: string }>;
    };
    const skillManifest = JSON.parse(
      await readFile(join(skill.projectDirectory, "deepwrite.json"), "utf8")
    ) as {
      revision: number;
      skillKind: string;
      entries: Array<{ id: string; stageId: string; path: string }>;
    };
    expect(materialManifest).toMatchObject({
      revision: 1,
      materialKind: "character",
      entries: [
        {
          id: materialEntry.id,
          stageId: "other"
        }
      ]
    });
    expect(skillManifest).toMatchObject({
      revision: 1,
      skillKind: "plot",
      entries: [
        {
          id: skillEntry.id,
          stageId: "draft"
        }
      ]
    });
    const materialEntryPath = join(
      material.projectDirectory,
      materialManifest.entries[0]!.path
    );
    const skillEntryPath = join(
      skill.projectDirectory,
      skillManifest.entries[0]!.path
    );
    expect(await readFile(materialEntryPath, "utf8")).toBe(
      "守夜人只在雨夜出现。"
    );
    expect(await readFile(skillEntryPath, "utf8")).toBe(
      "每一节结尾保留未回答的问题。"
    );

    await expect(
      store.removeLibraryEntry({
        domain: "material",
        libraryId: material.resource.id,
        entryId: materialEntry.id,
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    await expect(access(materialEntryPath)).resolves.toBeUndefined();

    await writeFile(materialEntryPath, "Cursor 刚补充的守夜人设定", "utf8");
    await expect(
      store.removeLibraryEntry({
        domain: "material",
        libraryId: material.resource.id,
        entryId: materialEntry.id,
        baseRevision:
          createShortWorkspaceContentRevision("守夜人只在雨夜出现。"),
        baseProjectRevision: 1
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(await readFile(materialEntryPath, "utf8")).toBe(
      "Cursor 刚补充的守夜人设定"
    );

    expect(
      await store.removeLibraryEntry({
        domain: "material",
        libraryId: material.resource.id,
        entryId: materialEntry.id,
        baseProjectRevision: 0,
        force: true
      })
    ).toEqual({
      libraryId: material.resource.id,
      entryId: materialEntry.id,
      deleted: true
    });
    await expect(access(materialEntryPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(
      JSON.parse(
        await readFile(
          join(material.projectDirectory, "deepwrite.json"),
          "utf8"
        )
      )
    ).toMatchObject({ revision: 2, entries: [] });
    expect(
      await store.removeLibraryEntry({
        domain: "material",
        libraryId: material.resource.id,
        entryId: materialEntry.id,
        baseProjectRevision: 2
      })
    ).toEqual({
      libraryId: material.resource.id,
      entryId: materialEntry.id,
      deleted: false
    });

    expect(
      await store.unregisterProject({
        domain: "skill",
        projectId: skill.resource.id
      })
    ).toEqual({
      domain: "skill",
      projectId: skill.resource.id,
      unregistered: true
    });
    await expect(access(skill.projectDirectory)).resolves.toBeUndefined();
    expect((await store.snapshot()).skills).toEqual([]);
    expect((await store.snapshot()).materials).toHaveLength(1);

    await store.openSkillProject(skill.projectDirectory);
    const restarted = await new FolderCatalogStore({ userDataPath }).snapshot();
    expect(restarted.skills[0]?.entries[0]).toMatchObject({
      id: skillEntry.id,
      body: "每一节结尾保留未回答的问题。"
    });
    expect(await readFile(skillEntryPath, "utf8")).toBe(
      "每一节结尾保留未回答的问题。"
    );
  });

  it("creates persistent material and skill groups with optional members", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-library-groups-");
    const userDataPath = join(root, "user-data");
    const libraryParent = join(root, "libraries");
    const groupParent = join(root, "groups");
    const store = new FolderCatalogStore({ userDataPath, now: tickingClock() });
    const material = await store.createLibrary({
      domain: "material",
      name: "剧情素材库",
      materialKind: "plot",
      parentDirectory: libraryParent
    });
    const replacementMaterial = await store.createLibrary({
      domain: "material",
      name: "替换剧情素材库",
      materialKind: "plot",
      parentDirectory: libraryParent
    });
    const skill = await store.createLibrary({
      domain: "skill",
      name: "通用技能库",
      skillKind: "general",
      parentDirectory: libraryParent
    });

    const emptyMaterialGroup = await store.createLibraryGroup({
      domain: "material",
      name: "待整理素材",
      members: {},
      parentDirectory: groupParent
    });
    const skillGroup = await store.createLibraryGroup({
      domain: "skill",
      name: "短篇技能组",
      members: { general: skill.resource.id },
      parentDirectory: groupParent
    });
    const materialGroup = await store.createLibraryGroup({
      domain: "material",
      name: "短篇素材组",
      members: { plot: material.resource.id },
      parentDirectory: groupParent
    });

    expect(emptyMaterialGroup).toMatchObject({
      domain: "material-group",
      resource: { title: "待整理素材", members: {}, projectRevision: 0 }
    });
    expect(emptyMaterialGroup.resource.id).toMatch(
      /^material-group-[0-9a-f]{8}$/
    );
    expect(skillGroup.resource.id).toMatch(/^skill-group-[0-9a-f]{8}$/);
    expect(materialGroup.resource.id).toMatch(/^material-group-[0-9a-f]{8}$/);
    expect(skillGroup.resource.members).toEqual({ general: skill.resource.id });
    expect(materialGroup.resource.members).toEqual({
      plot: material.resource.id
    });
    await expect(
      access(join(skillGroup.projectDirectory, "deepwrite.json"))
    ).resolves.toBeUndefined();

    const restarted = await new FolderCatalogStore({ userDataPath }).snapshot();
    expect(restarted.materialGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "待整理素材", members: {} }),
        expect.objectContaining({
          title: "短篇素材组",
          members: { plot: material.resource.id }
        })
      ])
    );
    expect(restarted.skillGroups).toEqual([
      expect.objectContaining({
        title: "短篇技能组",
        members: { general: skill.resource.id }
      })
    ]);
    const updatedMaterialGroup = await store.updateLibraryGroup({
      domain: "material",
      groupId: materialGroup.resource.id,
      title: "已重命名素材组",
      members: { plot: replacementMaterial.resource.id },
      baseProjectRevision: 0
    });
    expect(updatedMaterialGroup).toMatchObject({
      id: materialGroup.resource.id,
      title: "已重命名素材组",
      members: { plot: replacementMaterial.resource.id },
      projectRevision: 1
    });
    await expect(
      store.updateLibraryGroup({
        domain: "material",
        groupId: materialGroup.resource.id,
        members: { plot: material.resource.id },
        baseProjectRevision: 0
      })
    ).rejects.toThrow(/当前版本 1/u);
    await expect(
      store.createLibraryGroup({
        domain: "skill",
        name: "重复技能组",
        members: { general: skill.resource.id },
        parentDirectory: groupParent
      })
    ).rejects.toThrow(/已经属于分组/u);
    await expect(
      store.createLibraryGroup({
        domain: "skill",
        name: "无效分组",
        members: { plot: skill.resource.id },
        parentDirectory: groupParent
      })
    ).rejects.toThrow(/不能放入plot分类/u);
  });
});
