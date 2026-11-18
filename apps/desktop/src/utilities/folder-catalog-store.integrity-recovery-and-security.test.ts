import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  asCreativeBook,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  catalogFixture,
  createShortWorkspaceContentRevision,
  describe,
  dirname,
  expect,
  it,
  join,
  link,
  makeTemporaryRoot,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  tickingClock,
  timestamp,
  writeFile,
  writeJson
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: integrity-recovery-and-security", () => {
  it("cleans a newly created project when registry registration cannot commit", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-create-rollback-");
    const longParentName = Array.from(
      // Keep the registry entry larger than the manifest without exhausting
      // macOS's path limit once the implementation appends its staging name.
      { length: 40 },
      (_, index) => `父目录-${index}`
    ).join("/");
    const probeParent = join(root, longParentName, "probe");
    const probeStore = new FolderCatalogStore({
      userDataPath: join(root, "probe-user-data"),
      now: () => timestamp
    });
    const probe = await probeStore.createLibrary({
      domain: "skill",
      name: "注册回滚",
      skillKind: "general",
      parentDirectory: probeParent
    });
    const manifestBytes = Buffer.byteLength(
      await readFile(join(probe.projectDirectory, "deepwrite.json"), "utf8")
    );
    const registryBytes = Buffer.byteLength(
      await readFile(probeStore.registryPath, "utf8")
    );
    expect(registryBytes).toBeGreaterThan(manifestBytes + 8);

    const limitedParent = join(root, longParentName, "limited");
    const limitedStore = new FolderCatalogStore({
      userDataPath: join(root, "limited-user-data"),
      now: () => timestamp,
      maxManifestBytes: Math.floor((manifestBytes + registryBytes) / 2)
    });
    await expect(
      limitedStore.createLibrary({
        domain: "skill",
        name: "注册回滚",
        skillKind: "general",
        parentDirectory: limitedParent
      })
    ).rejects.toThrow(/JSON content exceeds/u);
    expect(await readdir(limitedParent)).toEqual([]);
  });

  it("keeps Markdown unchanged when its manifest update cannot commit", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-save-rollback-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const created = await store.createShortBook(
      { title: "回滚测试书籍", genre: "悬疑" },
      join(root, "books")
    );
    const registryText = await readFile(store.registryPath, "utf8");
    const bookDirectory = created.projectDirectory;
    const manifestPath = join(bookDirectory, "deepwrite.json");
    const manifestText = await readFile(manifestPath, "utf8");
    const nextManifest = JSON.parse(manifestText) as {
      documents: Array<{ title: string }>;
      draft: {
        sections: Array<{
          id: string;
          title: string;
          body: { path: string };
        }>;
      };
    };
    const firstSection = nextManifest.draft.sections.find(
      ({ id }) => id === "section-1"
    )!;
    const documentPath = join(bookDirectory, firstSection.body.path);
    firstSection.title = "长".repeat(240);
    const readableBytes = Math.max(
      Buffer.byteLength(registryText),
      Buffer.byteLength(manifestText)
    );
    expect(
      Buffer.byteLength(`${JSON.stringify(nextManifest, null, 2)}\n`)
    ).toBeGreaterThan(readableBytes + 1);

    const limitedStore = new FolderCatalogStore({
      userDataPath,
      maxManifestBytes: readableBytes + 1,
      now: tickingClock()
    });
    const originalContent = await readFile(documentPath, "utf8");
    await expect(
      limitedStore.saveDocument({
        bookId: created.resource.id,
        documentId: catalogDraftBodyDocumentId("section-1"),
        title: "长".repeat(240),
        content: "不应半提交的新内容",
        baseRevision: createShortWorkspaceContentRevision(originalContent),
        baseProjectRevision: 0
      })
    ).rejects.toThrow(/JSON content exceeds/u);
    expect(await readFile(documentPath, "utf8")).toBe(originalContent);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestText);
  });

  it("rejects manifest entries that alias the same Markdown inode", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-inode-alias-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const bookDirectory = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!.projectDirectory;
    const manifestPath = join(bookDirectory, "deepwrite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
    };
    const firstSection = manifest.draft.sections.find(
      ({ id }) => id === "section-1"
    )!;
    await link(
      join(bookDirectory, firstSection.body.path),
      join(bookDirectory, "stages", "draft", "alias.state.md")
    );
    firstSection.characterState.path = "stages/draft/alias.state.md";
    await writeJson(manifestPath, manifest);

    await expect(store.openBookProject(bookDirectory, false)).rejects.toThrow(
      /distinct files/u
    );
  });

  it("rejects non-canonical v2 draft file ids before a stale save can recreate them", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-file-id-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const created = await store.createShortBook(
      { title: "正文文件标识", genre: "其他" },
      join(root, "books")
    );
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      draft: {
        sections: Array<{ body: { id: string } }>;
      };
    };
    manifest.draft.sections[0]!.body.id = "custom-body";
    await writeJson(manifestPath, manifest);

    await expect(
      store.openBookProject(created.projectDirectory, false)
    ).rejects.toThrow(/canonical section id/u);
  });

  it("rejects a changed registered id before a v1 manifest can migrate", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-id-change-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const bookDirectory = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!.projectDirectory;
    const manifestPath = join(bookDirectory, "deepwrite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: number;
      kind: "deepwrite.book";
      id: string;
      title: string;
      bookType: "short";
      genre: string;
      status: "editing" | "completed";
      linkedMaterialIdsByKind: unknown;
      linkedSkillIdsByKind: unknown;
      createdAt: string;
      updatedAt: string;
      draft: {
        sections: Array<{ id: string; body: { path: string } }>;
      };
    };
    const documentPath = join(
      bookDirectory,
      manifest.draft.sections.find(({ id }) => id === "section-1")!.body.path
    );
    const originalContent = await readFile(documentPath, "utf8");
    await rm(join(bookDirectory, "stages", "draft"), {
      recursive: true,
      force: true
    });
    const legacyDraftPath = join(bookDirectory, "stages", "draft.md");
    await writeFile(legacyDraftPath, originalContent, "utf8");
    const changedLegacyManifest = {
      schemaVersion: 1,
      revision: manifest.revision,
      kind: manifest.kind,
      id: "book-renamed-outside",
      title: manifest.title,
      bookType: manifest.bookType,
      genre: manifest.genre,
      status: manifest.status,
      linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
      documents: [
        {
          id: "draft",
          title: "正文编写",
          path: "stages/draft.md",
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt
        }
      ],
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt
    };
    await writeJson(manifestPath, changedLegacyManifest);
    const changedLegacyManifestText = await readFile(manifestPath, "utf8");

    await expect(
      store.saveDocument({
        bookId: "book-existing",
        documentId: catalogDraftBodyDocumentId("section-1"),
        content: "不应写入另一个 UUID 项目",
        force: true
      })
    ).rejects.toThrow(/标识与注册信息不一致/u);
    expect(await readFile(manifestPath, "utf8")).toBe(
      changedLegacyManifestText
    );
    expect(await readFile(legacyDraftPath, "utf8")).toBe(originalContent);
    await expect(
      access(join(bookDirectory, "stages", "draft"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allocates portable-unique paths for case-colliding migrated entry ids", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-portable-paths-");
    const source = catalogFixture();
    source.materials[0]!.entries = [
      {
        id: "Entry",
        stageId: "character",
        title: "大写条目",
        body: "FIRST",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "entry",
        stageId: "character",
        title: "小写条目",
        body: "SECOND",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ];
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const migrated = await store.migrateSnapshot(source);
    expect(migrated.materials[0]?.entries.map(({ body }) => body)).toEqual([
      "FIRST",
      "SECOND"
    ]);
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const materialDirectory = registry.projects.find(
      ({ id }) => id === "material-existing"
    )!.projectDirectory;
    const manifest = JSON.parse(
      await readFile(join(materialDirectory, "deepwrite.json"), "utf8")
    ) as { entries: Array<{ path: string }> };
    expect(manifest.entries[0]!.path.toLowerCase()).not.toBe(
      manifest.entries[1]!.path.toLowerCase()
    );
  });

  it("does not overwrite untracked Markdown when allocating a new document path", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-untracked-path-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const created = await store.createShortBook(
      { title: "未跟踪文件测试", genre: "其他" },
      join(root, "books")
    );
    const untrackedPath = join(created.projectDirectory, "stages", "orphan.md");
    await writeFile(untrackedPath, "用户在 Cursor 中创建的未跟踪正文", "utf8");

    await store.saveDocument({
      bookId: created.resource.id,
      documentId: "ORPHAN",
      title: "新阶段",
      content: "DeepWrite 新阶段内容",
      baseProjectRevision: 0
    });
    expect(await readFile(untrackedPath, "utf8")).toBe(
      "用户在 Cursor 中创建的未跟踪正文"
    );
    const manifest = JSON.parse(
      await readFile(join(created.projectDirectory, "deepwrite.json"), "utf8")
    ) as { documents: Array<{ id: string; path: string }> };
    const added = manifest.documents.find(({ id }) => id === "ORPHAN")!;
    expect(added.path.toLowerCase()).not.toBe("stages/orphan.md");
    expect(
      await readFile(join(created.projectDirectory, added.path), "utf8")
    ).toBe("DeepWrite 新阶段内容");
  });

  it("restores a corrupt registry from its last known-good backup", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-registry-backup-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    await store.migrateSnapshot(catalogFixture());
    await writeFile(store.registryPath, "{broken", "utf8");

    const restarted = new FolderCatalogStore({ userDataPath });
    const snapshot = await restarted.snapshot();
    expect(snapshot.books.map(({ id }) => id)).toEqual(["book-existing"]);
    expect(snapshot.materials.map(({ id }) => id)).toEqual([
      "material-existing"
    ]);
    expect(
      JSON.parse(await readFile(restarted.registryPath, "utf8"))
    ).toMatchObject({ schemaVersion: 1, sourceCatalogMigrated: true });
  });

  it("preserves an unrecoverable registry and lets open-existing rebuild the index", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-registry-rebuild-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const bookDirectory = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!.projectDirectory;
    await writeFile(store.registryPath, "{broken-primary", "utf8");
    await writeFile(store.registryBackupPath, "{broken-backup", "utf8");

    const restarted = new FolderCatalogStore({ userDataPath });
    const opened = await restarted.openBookProject(bookDirectory);
    expect(opened.resource.id).toBe("book-existing");
    expect((await restarted.snapshot()).books.map(({ id }) => id)).toEqual([
      "book-existing"
    ]);
    expect(
      (await readdir(userDataPath)).some((name) =>
        name.startsWith("catalog-registry.json.corrupt-")
      )
    ).toBe(true);
  });

  it("unregisters group projects without deleting their folders", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-group-unregister-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{
        id: string;
        domain: string;
        projectDirectory: string;
      }>;
    };
    const group = registry.projects.find(
      ({ id }) => id === "material-group-existing"
    )!;

    expect(
      await store.unregisterProject({
        domain: "material-group",
        projectId: group.id
      })
    ).toEqual({
      domain: "material-group",
      projectId: group.id,
      unregistered: true
    });
    await expect(access(group.projectDirectory)).resolves.toBeUndefined();
    expect((await store.snapshot()).materialGroups).toEqual([]);
  });

  it("persists large draft recovery files across restarts and can clear them", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-recovery-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const recovery = {
      "book-large\u0000draft": {
        title: "大正文草稿",
        content: "字".repeat(2_100_000),
        dirty: true as const,
        baseRevision: "original-revision",
        baseProjectRevision: 7
      }
    };

    await store.saveDraftRecovery(recovery);
    expect((await stat(store.draftRecoveryPath)).size).toBeGreaterThan(
      5 * 1024 * 1024
    );
    expect(
      await new FolderCatalogStore({ userDataPath }).loadDraftRecovery()
    ).toEqual(recovery);

    await store.saveDraftRecovery({});
    expect(
      await new FolderCatalogStore({ userDataPath }).loadDraftRecovery()
    ).toEqual({});
    expect(await readFile(store.draftRecoveryPath, "utf8")).toBe("{}\n");
  });

  it("rejects oversized draft recovery writes without replacing the last good file", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-limit-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({
      userDataPath,
      maxDraftRecoveryBytes: 512
    });
    const saved = {
      draft: {
        title: "可恢复草稿",
        content: "仍然保留",
        dirty: true as const
      }
    };
    await store.saveDraftRecovery(saved);

    await expect(
      store.saveDraftRecovery({
        oversized: {
          title: "过大草稿",
          content: "x".repeat(1_024),
          dirty: true
        }
      })
    ).rejects.toThrow(/512 byte limit/u);
    expect(await store.loadDraftRecovery()).toEqual(saved);
  });

  it("requires an explicit force flag to overwrite stale book content", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-force-save-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "冲突测试", genre: "其他" },
      join(root, "projects")
    );
    const emptyRevision = createShortWorkspaceContentRevision("");
    const bodyDocumentId = catalogDraftBodyDocumentId("section-1");
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: bodyDocumentId,
      content: "磁盘上的新内容",
      baseRevision: emptyRevision,
      baseProjectRevision: 0
    });

    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: bodyDocumentId,
        content: "未明确覆盖的旧草稿",
        baseRevision: emptyRevision,
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(
      asCreativeBook((await store.snapshot()).books[0]).draft.sections.find(
        ({ id }) => id === "section-1"
      )?.body.content
    ).toBe("磁盘上的新内容");

    const forced = await store.saveDocument({
      bookId: opened.resource.id,
      documentId: bodyDocumentId,
      content: "用户明确覆盖后的内容",
      baseRevision: emptyRevision,
      baseProjectRevision: 0,
      force: true
    });
    expect(forced.content).toBe("用户明确覆盖后的内容");
    expect(
      JSON.parse(
        await readFile(join(opened.projectDirectory, "deepwrite.json"), "utf8")
      )
    ).toMatchObject({ revision: 2 });
  });

  it("opens a hand-authored external book, follows disk edits across restarts, and rejects stale writes", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-external-");
    const userDataPath = join(root, "user-data");
    const projectDirectory = join(root, "外部项目", "潮汐来信");
    const manifestPath = join(projectDirectory, "deepwrite.json");
    const draftPath = join(projectDirectory, "stages", "draft.md");
    const externalManifest = {
      schemaVersion: 1,
      revision: 4,
      kind: "deepwrite.book",
      id: "book-external",
      title: "潮汐来信",
      bookType: "short",
      genre: "科幻",
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
        {
          id: "notes",
          title: "正文编写",
          path: "stages/notes.md",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: "draft",
          title: "正文编写",
          path: "stages/draft.md",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await writeJson(manifestPath, externalManifest);
    await mkdir(dirname(draftPath), { recursive: true });
    await writeFile(
      join(projectDirectory, "stages", "notes.md"),
      "同名普通文档",
      "utf8"
    );
    await writeFile(draftPath, "最初由 Cursor 写下的正文", "utf8");

    const store = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    const opened = await store.openBookProject(projectDirectory);
    expect(opened).toMatchObject({
      domain: "book",
      projectDirectory: await realpath(projectDirectory),
      revision: 4,
      resource: {
        id: "book-external",
        title: "潮汐来信",
        projectRevision: 4,
        draft: { id: "draft", title: "正文" }
      }
    });
    expect(
      opened.resource.documents.find(({ id }) => id === "notes")
    ).toMatchObject({ id: "notes", content: "同名普通文档" });
    const openedBook = asCreativeBook(opened.resource);
    expect(openedBook.plotStages).toHaveLength(6);
    const openedSection = openedBook.draft.sections.find(
      ({ id }) => id === "section-1"
    );
    expect(openedSection).toMatchObject({
      body: {
        id: catalogDraftBodyDocumentId("section-1"),
        content: "最初由 Cursor 写下的正文"
      },
      characterState: {
        id: catalogDraftCharacterStateDocumentId("section-1"),
        content: ""
      }
    });
    const migratedManifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as {
      schemaVersion: number;
      revision: number;
      title: string;
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
    };
    expect(migratedManifest).toMatchObject({ schemaVersion: 4, revision: 4 });
    const migratedSection = migratedManifest.draft.sections.find(
      ({ id }) => id === "section-1"
    )!;
    const migratedBodyPath = join(projectDirectory, migratedSection.body.path);
    await expect(readFile(draftPath, "utf8")).resolves.toBe(
      "最初由 Cursor 写下的正文"
    );
    await expect(readFile(migratedBodyPath, "utf8")).resolves.toBe(
      "最初由 Cursor 写下的正文"
    );
    await expect(
      readFile(
        join(projectDirectory, migratedSection.characterState.path),
        "utf8"
      )
    ).resolves.toBe("");

    const restartedStore = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    expect((await restartedStore.snapshot()).books[0]).toMatchObject({
      id: "book-external",
      title: "潮汐来信"
    });

    const originalContentRevision =
      createShortWorkspaceContentRevision("最初由 Cursor 写下的正文");
    await writeFile(migratedBodyPath, "Cursor 在应用外更新的正文", "utf8");
    expect(
      asCreativeBook(
        (await restartedStore.snapshot()).books[0]
      ).draft.sections.find(({ id }) => id === "section-1")?.body.content
    ).toBe("Cursor 在应用外更新的正文");
    await expect(
      restartedStore.saveDocument({
        bookId: "book-external",
        documentId: catalogDraftBodyDocumentId("section-1"),
        content: "应用内仍未保存的旧草稿",
        baseRevision: originalContentRevision,
        baseProjectRevision: 4
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(await readFile(migratedBodyPath, "utf8")).toBe(
      "Cursor 在应用外更新的正文"
    );
    expect(
      (JSON.parse(await readFile(manifestPath, "utf8")) as { revision: number })
        .revision
    ).toBe(4);

    await writeJson(manifestPath, {
      ...migratedManifest,
      revision: 5,
      title: "潮汐来信（外部改名）",
      updatedAt: "2026-07-19T02:03:04.000Z"
    });
    expect((await restartedStore.snapshot()).books[0]?.title).toBe(
      "潮汐来信（外部改名）"
    );
    await expect(
      restartedStore.updateBook({
        bookId: "book-external",
        title: "应用内旧标题",
        baseProjectRevision: 4
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(
      (JSON.parse(await readFile(manifestPath, "utf8")) as { title: string })
        .title
    ).toBe("潮汐来信（外部改名）");
    await expect(
      restartedStore.saveDocument({
        bookId: "book-external",
        documentId: catalogDraftBodyDocumentId("section-1"),
        title: "应用内旧文档标题",
        content: "不会覆盖的内容",
        baseRevision:
          createShortWorkspaceContentRevision("Cursor 在应用外更新的正文"),
        baseProjectRevision: 4
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    expect(await readFile(migratedBodyPath, "utf8")).toBe(
      "Cursor 在应用外更新的正文"
    );
  });

  it("rejects escaping paths, symbolic-link content, invalid UTF-8, and oversized files", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-security-");
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    await store.migrateSnapshot(catalogFixture());
    const registry = JSON.parse(await readFile(store.registryPath, "utf8")) as {
      projects: Array<{ id: string; projectDirectory: string }>;
    };
    const projectDirectory = registry.projects.find(
      ({ id }) => id === "book-existing"
    )!.projectDirectory;
    const manifestPath = join(projectDirectory, "deepwrite.json");
    const original = JSON.parse(await readFile(manifestPath, "utf8")) as {
      draft: {
        sections: Array<{ id: string; body: { path: string } }>;
      };
    };
    const body = original.draft.sections.find(
      ({ id }) => id === "section-1"
    )!.body;
    const originalBodyPath = body.path;
    const absoluteBodyPath = join(projectDirectory, originalBodyPath);

    body.path = "../outside.md";
    await writeJson(manifestPath, original);
    await expect(
      store.openBookProject(projectDirectory, false)
    ).rejects.toThrow(/relative Markdown paths/u);

    body.path = originalBodyPath;
    await writeJson(manifestPath, original);
    await rm(absoluteBodyPath);
    const outside = join(root, "outside.md");
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, absoluteBodyPath);
    await expect(
      store.openBookProject(projectDirectory, false)
    ).rejects.toThrow(/symbolic links/u);

    await rm(absoluteBodyPath);
    await writeFile(absoluteBodyPath, Buffer.from([0xc3, 0x28]));
    await expect(
      store.openBookProject(projectDirectory, false)
    ).rejects.toThrow(/valid UTF-8/u);

    await writeFile(absoluteBodyPath, "x".repeat(17));
    const limitedStore = new FolderCatalogStore({
      userDataPath,
      maxMarkdownBytes: 16
    });
    await expect(
      limitedStore.openBookProject(projectDirectory, false)
    ).rejects.toThrow(/16 byte limit/u);
  });

  it("renames libraries and persistently reorders or moves library entries", async () => {
    const root = await makeTemporaryRoot("deepwrite-library-move-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const source = await store.createLibrary({
      domain: "material",
      name: "人物素材",
      materialKind: "character"
    });
    const target = await store.createLibrary({
      domain: "material",
      name: "剧情素材",
      materialKind: "plot"
    });
    const moving = await store.createLibraryEntry({
      domain: "material",
      libraryId: source.resource.id,
      title: "主角",
      content: "主角设定",
      stageId: "character"
    });
    const existing = await store.createLibraryEntry({
      domain: "material",
      libraryId: target.resource.id,
      title: "已有剧情",
      content: "已有内容",
      stageId: "pacing"
    });

    await expect(
      store.moveLibraryEntry({
        domain: "material",
        sourceLibraryId: source.resource.id,
        targetLibraryId: target.resource.id,
        entryId: moving.id,
        beforeEntryId: existing.id,
        sourceBaseProjectRevision: 0,
        targetBaseProjectRevision: 1,
        targetStageId: "plot_refine"
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    await store.moveLibraryEntry({
      domain: "material",
      sourceLibraryId: source.resource.id,
      targetLibraryId: target.resource.id,
      entryId: moving.id,
      beforeEntryId: existing.id,
      sourceBaseProjectRevision: 1,
      targetBaseProjectRevision: 1,
      targetStageId: "plot_refine"
    });
    let snapshot = await store.snapshot();
    expect(
      snapshot.materials.find(({ id }) => id === source.resource.id)?.entries
    ).toEqual([]);
    expect(
      snapshot.materials
        .find(({ id }) => id === target.resource.id)
        ?.entries.map(({ id }) => id)
    ).toEqual([moving.id, existing.id]);
    expect(
      snapshot.materials.find(({ id }) => id === target.resource.id)?.entries[0]
    ).toMatchObject({ stageId: "plot_refine", body: "主角设定" });

    await store.moveLibraryEntry({
      domain: "material",
      sourceLibraryId: target.resource.id,
      targetLibraryId: target.resource.id,
      entryId: existing.id,
      beforeEntryId: moving.id,
      sourceBaseProjectRevision: 2
    });
    await store.updateLibrary({
      domain: "material",
      libraryId: target.resource.id,
      title: "剧情灵感",
      overview: "用于沉淀剧情灵感。",
      baseProjectRevision: 3
    });
    await store.updateLibrary({
      domain: "material",
      libraryId: target.resource.id,
      overview: "用于沉淀可复用的剧情灵感。",
      baseProjectRevision: 4
    });
    snapshot = await store.snapshot();
    const renamed = snapshot.materials.find(
      ({ id }) => id === target.resource.id
    )!;
    expect(renamed.title).toBe("剧情灵感");
    expect(renamed.overview).toBe("用于沉淀可复用的剧情灵感。");
    expect(renamed.projectRevision).toBe(5);
    expect(renamed.entries.map(({ id }) => id)).toEqual([
      existing.id,
      moving.id
    ]);
    expect(renamed.entries[1]).toMatchObject({
      body: "主角设定",
      stageId: "plot_refine"
    });

    await expect(
      store.updateLibrary({
        domain: "material",
        libraryId: target.resource.id,
        overview: "过期版本不应覆盖",
        baseProjectRevision: 4
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);
    const forced = await store.updateLibrary({
      domain: "material",
      libraryId: target.resource.id,
      overview: "确认强制覆盖后的介绍",
      baseProjectRevision: 4,
      force: true
    });
    expect(forced).toMatchObject({
      title: "剧情灵感",
      overview: "确认强制覆盖后的介绍",
      projectRevision: 6
    });
  });
});
