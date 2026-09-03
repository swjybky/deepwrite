import {
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile,
  tickingClock
} from "./folder-catalog-store.test-support";

describe("FolderCatalogStore: drafts-and-imports", () => {
  it("persists legacy library types while allowing shared cross-type bindings", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-library-type-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const parentDirectory = join(root, "projects");
    const shortMaterial = await store.createLibrary({
      domain: "material",
      name: "短篇剧情素材",
      libraryType: "short",
      materialKind: "plot",
      parentDirectory
    });
    const scriptMaterial = await store.createLibrary({
      domain: "material",
      name: "剧本剧情素材",
      libraryType: "script",
      materialKind: "plot",
      parentDirectory
    });
    const scriptSkill = await store.createLibrary({
      domain: "skill",
      name: "剧本通用技能",
      libraryType: "script",
      skillKind: "general",
      parentDirectory
    });

    expect(scriptMaterial.resource.materialType).toBe("script");
    expect(scriptSkill.resource.skillType).toBe("script");
    const correctlyBound = await store.createScriptBook(
      {
        title: "正确绑定",
        genre: "其他",
        linkedMaterialIdsByKind: { plot: [scriptMaterial.resource.id] },
        linkedSkillIdsByKind: { general: [scriptSkill.resource.id] }
      },
      parentDirectory
    );
    expect(correctlyBound.resource.bookType).toBe("script");
    const crossTypeUpdate = await store.updateBook({
      bookId: correctlyBound.resource.id,
      linkedMaterialIdsByKind: { plot: [shortMaterial.resource.id] },
      baseProjectRevision: 0
    });
    expect(crossTypeUpdate.linkedMaterialIdsByKind.plot).toEqual([
      shortMaterial.resource.id
    ]);
    expect(
      await store.getProjectRevision(correctlyBound.resource.id, "book")
    ).toBe(1);
    const scriptWithShortMaterial = await store.createScriptBook(
      {
        title: "剧本绑定短篇来源素材",
        genre: "其他",
        linkedMaterialIdsByKind: { plot: [shortMaterial.resource.id] }
      },
      parentDirectory
    );
    const shortWithScriptMaterial = await store.createShortBook(
      {
        title: "短篇绑定剧本来源素材",
        genre: "其他",
        linkedMaterialIdsByKind: { plot: [scriptMaterial.resource.id] }
      },
      parentDirectory
    );
    expect(
      scriptWithShortMaterial.resource.linkedMaterialIdsByKind.plot
    ).toEqual([shortMaterial.resource.id]);
    expect(
      shortWithScriptMaterial.resource.linkedMaterialIdsByKind.plot
    ).toEqual([scriptMaterial.resource.id]);
  });

  it("saves draft body and character-state files independently while guarding title metadata", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-independent-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "双文件正文", genre: "悬疑" },
      join(root, "books")
    );
    const bodyId = catalogDraftBodyDocumentId("section-1");
    const stateId = catalogDraftCharacterStateDocumentId("section-1");
    const emptyRevision = createShortWorkspaceContentRevision("");

    const savedBody = await store.saveDocument({
      bookId: opened.resource.id,
      documentId: bodyId,
      content: "第一节正文",
      baseRevision: emptyRevision,
      baseProjectRevision: 0
    });
    expect(savedBody.projectRevision).toBe(1);
    const savedState = await store.saveDocument({
      bookId: opened.resource.id,
      documentId: stateId,
      content: "林舟：仍在门外",
      baseRevision: emptyRevision,
      // A content-only save uses the target file revision, so an unrelated
      // body save must not make this independent file stale.
      baseProjectRevision: 0
    });
    expect(savedState).toMatchObject({
      content: "林舟：仍在门外",
      projectRevision: 2
    });

    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: bodyId,
        title: "雨中的门",
        content: "第一节正文",
        baseRevision: createShortWorkspaceContentRevision("第一节正文"),
        baseProjectRevision: 0
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: bodyId,
        title: "雨中的门",
        content: "第一节正文",
        baseRevision: createShortWorkspaceContentRevision("第一节正文"),
        baseProjectRevision: 2
      })
    ).resolves.toMatchObject({ title: "雨中的门" });

    const snapshot = await store.snapshot();
    const section = snapshot.books[0]?.draft.sections.find(
      ({ id }) => id === "section-1"
    );
    expect(section).toMatchObject({
      title: "雨中的门",
      body: { content: "第一节正文", title: "雨中的门" },
      characterState: {
        content: "林舟：仍在门外",
        title: "雨中的门 · 人物状态"
      }
    });
    expect(await store.getProjectRevision(opened.resource.id, "book")).toBe(3);
  });

  it("renames a draft section from the latest Core state without rewriting stale body content", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-rename-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createScriptBook(
      { title: "安全改名", genre: "其他" },
      join(root, "books")
    );
    const firstSection = opened.resource.draft.sections[0]!;

    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: firstSection.body.id,
      content: "磁盘上的最新正文",
      force: true
    });
    const renamed = await store.saveDocument({
      bookId: opened.resource.id,
      documentId: firstSection.body.id,
      title: "新的剧集名",
      content: "渲染进程里的陈旧正文",
      preserveCurrentContent: true,
      force: true
    });

    expect(renamed).toMatchObject({
      title: "新的剧集名",
      content: "磁盘上的最新正文"
    });
    const snapshot = await store.snapshot();
    expect(snapshot.books[0]?.draft.sections[0]).toMatchObject({
      title: "新的剧集名",
      body: { title: "新的剧集名", content: "磁盘上的最新正文" },
      characterState: { title: "新的剧集名 · 人物状态" }
    });
  });

  it("rejects draft renames against duplicate titles in the latest Core directory", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-draft-rename-duplicate-"
    );
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "改名同名校验", genre: "其他" },
      join(root, "books")
    );
    const firstSection = opened.resource.draft.sections[0]!;
    const secondSection = await store.createDraftSection({
      bookId: opened.resource.id,
      title: "已经存在的章节",
      force: true
    });

    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: firstSection.body.id,
        title: secondSection.title,
        content: "",
        preserveCurrentContent: true,
        force: true
      })
    ).rejects.toThrow(/正文目录已存在同名/u);
  });

  it("creates and deletes mapped draft section file pairs", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-draft-sections-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "小节管理", genre: "其他" },
      join(root, "books")
    );
    const created = await store.createDraftSection({
      bookId: opened.resource.id,
      afterSectionId: "intro",
      title: "插入的小节",
      wordCountRequirement: "约 1500 字",
      baseProjectRevision: 0
    });
    expect(created).toMatchObject({
      id: "section-2",
      title: "插入的小节",
      body: { id: catalogDraftBodyDocumentId("section-2"), content: "" },
      characterState: {
        id: catalogDraftCharacterStateDocumentId("section-2"),
        content: ""
      }
    });

    const manifestPath = join(opened.projectDirectory, "deepwrite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: number;
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
    };
    expect(manifest.revision).toBe(1);
    expect(manifest.draft.sections.map(({ id }) => id)).toEqual([
      "intro",
      "section-2",
      "section-1"
    ]);
    const mappedSection = manifest.draft.sections.find(
      ({ id }) => id === "section-2"
    )!;
    await expect(
      readFile(join(opened.projectDirectory, mappedSection.body.path), "utf8")
    ).resolves.toBe("");
    await expect(
      readFile(
        join(opened.projectDirectory, mappedSection.characterState.path),
        "utf8"
      )
    ).resolves.toBe("");

    await expect(
      store.deleteDraftSection({
        bookId: opened.resource.id,
        sectionId: "section-2",
        baseProjectRevision: 1
      })
    ).resolves.toEqual({
      bookId: opened.resource.id,
      sectionId: "section-2",
      deleted: true
    });
    const afterDelete = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: number;
      draft: { sections: Array<{ id: string }> };
    };
    expect(afterDelete.revision).toBe(2);
    expect(afterDelete.draft.sections.map(({ id }) => id)).toEqual([
      "intro",
      "section-1"
    ]);
    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: created.body.id,
        content: "迟到的旧编辑请求不应复活正文",
        force: true
      })
    ).rejects.toThrow(/该正文小节已删除或不存在/u);
    const afterStaleSave = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: number;
      documents: Array<{ id: string }>;
      draft: { sections: Array<{ id: string }> };
    };
    expect(afterStaleSave).toMatchObject({ revision: 2 });
    expect(
      afterStaleSave.documents.some(({ id }) => id === created.body.id)
    ).toBe(false);
    expect(
      afterStaleSave.draft.sections.some(({ id }) => id === created.id)
    ).toBe(false);
    await expect(
      access(join(opened.projectDirectory, mappedSection.body.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(join(opened.projectDirectory, mappedSection.characterState.path))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("moves the complete draft section entry and preserves its paired files", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-move-draft-section-"
    );
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createScriptBook(
      { title: "剧集排序", genre: "其他" },
      join(root, "books")
    );
    const firstSection = opened.resource.draft.sections[0]!;
    const secondSection = await store.createDraftSection({
      bookId: opened.resource.id,
      afterSectionId: firstSection.id,
      title: "第二集",
      baseProjectRevision: 0
    });
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: secondSection.body.id,
      content: "第二集正文",
      baseProjectRevision: 1
    });
    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: secondSection.characterState.id,
      content: "第二集人物状态",
      baseProjectRevision: 1
    });

    await expect(
      store.moveDraftSection({
        bookId: opened.resource.id,
        sectionId: secondSection.id,
        direction: "up",
        baseProjectRevision: 3
      })
    ).resolves.toMatchObject({
      sectionId: secondSection.id,
      direction: "up",
      moved: true,
      projectRevision: 4
    });

    const snapshot = await store.snapshot();
    expect(snapshot.books[0]?.draft.sections.map(({ id }) => id)).toEqual([
      secondSection.id,
      firstSection.id
    ]);
    expect(snapshot.books[0]?.draft.sections[0]).toMatchObject({
      id: secondSection.id,
      body: { content: "第二集正文" },
      characterState: { content: "第二集人物状态" }
    });
    await expect(
      store.moveDraftSection({
        bookId: opened.resource.id,
        sectionId: secondSection.id,
        direction: "up",
        baseProjectRevision: 4
      })
    ).resolves.toMatchObject({ moved: false, projectRevision: 4 });
  });

  it("creates a draft section batch in one revision and replays it idempotently", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-folder-draft-section-batch-"
    );
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createShortBook(
      { title: "批量小节", genre: "其他" },
      join(root, "books")
    );
    const request = {
      operationId: "run-1:proposal-create:revision-1",
      bookId: opened.resource.id,
      afterSectionId: "intro",
      baseProjectRevision: 0,
      sections: [
        {
          clientSectionId: "provisional:section:alpha",
          title: "相遇",
          wordCountRequirement: "约 1200 字"
        },
        {
          clientSectionId: "provisional:section:beta",
          title: "追逐",
          wordCountRequirement: "约 1800 字"
        }
      ]
    };

    const created = await store.createDraftSections(request);
    expect(created).toMatchObject({
      operationId: request.operationId,
      bookId: opened.resource.id,
      projectRevision: 1,
      sections: [
        {
          clientSectionId: "provisional:section:alpha",
          section: {
            id: "section-2",
            title: "相遇",
            body: {
              id: catalogDraftBodyDocumentId("section-2"),
              content: ""
            },
            characterState: {
              id: catalogDraftCharacterStateDocumentId("section-2"),
              content: ""
            }
          }
        },
        {
          clientSectionId: "provisional:section:beta",
          section: {
            id: "section-3",
            title: "追逐",
            body: {
              id: catalogDraftBodyDocumentId("section-3"),
              content: ""
            },
            characterState: {
              id: catalogDraftCharacterStateDocumentId("section-3"),
              content: ""
            }
          }
        }
      ]
    });

    const manifestPath = join(opened.projectDirectory, "deepwrite.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: number;
      draft: {
        sections: Array<{
          id: string;
          body: { path: string };
          characterState: { path: string };
        }>;
      };
      draftSectionCreationOperations: Array<{
        operationId: string;
        sections: Array<{ clientSectionId: string; sectionId: string }>;
      }>;
    };
    expect(manifest.revision).toBe(1);
    expect(manifest.draft.sections.map(({ id }) => id)).toEqual([
      "intro",
      "section-2",
      "section-3",
      "section-1"
    ]);
    expect(manifest.draftSectionCreationOperations).toMatchObject([
      {
        operationId: request.operationId,
        sections: [
          {
            clientSectionId: "provisional:section:alpha",
            sectionId: "section-2"
          },
          {
            clientSectionId: "provisional:section:beta",
            sectionId: "section-3"
          }
        ]
      }
    ]);
    for (const sectionId of ["section-2", "section-3"]) {
      const section = manifest.draft.sections.find(
        ({ id }) => id === sectionId
      )!;
      await expect(
        readFile(join(opened.projectDirectory, section.body.path), "utf8")
      ).resolves.toBe("");
      await expect(
        readFile(
          join(opened.projectDirectory, section.characterState.path),
          "utf8"
        )
      ).resolves.toBe("");
    }

    const replayed = await store.createDraftSections(request);
    expect(replayed).toEqual(created);
    expect(await store.getProjectRevision(opened.resource.id, "book")).toBe(1);
    const replayedManifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as typeof manifest;
    expect(replayedManifest.draft.sections).toHaveLength(4);
    expect(replayedManifest.draftSectionCreationOperations).toHaveLength(1);

    await expect(
      store.createDraftSections({
        ...request,
        sections: [
          {
            clientSectionId: "provisional:section:alpha",
            title: "被篡改的请求"
          }
        ]
      })
    ).rejects.toThrow(/请求内容与首次提交不一致/u);
    expect(await store.getProjectRevision(opened.resource.id, "book")).toBe(1);
  });

  it("uses screenplay episode ids for a batch created through the shared path", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-episode-batch-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const opened = await store.createScriptBook(
      { title: "批量剧集", genre: "悬疑" },
      join(root, "books")
    );

    await expect(
      store.createDraftSections({
        operationId: "script-run-1:create-episodes:revision-1",
        bookId: opened.resource.id,
        baseProjectRevision: 0,
        sections: [
          { clientSectionId: "provisional:episode:2" },
          { clientSectionId: "provisional:episode:3" }
        ]
      })
    ).resolves.toMatchObject({
      projectRevision: 1,
      sections: [
        {
          clientSectionId: "provisional:episode:2",
          section: { id: "episode-2", title: "第二集" }
        },
        {
          clientSectionId: "provisional:episode:3",
          section: { id: "episode-3", title: "第三集" }
        }
      ]
    });
  });

  it("rejects duplicate draft titles against the latest serialized directory", async () => {
    for (const bookType of ["short", "script"] as const) {
      const root = await makeTemporaryRoot(
        `deepwrite-folder-${bookType}-duplicate-draft-title-`
      );
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data"),
        now: tickingClock()
      });
      const opened =
        bookType === "short"
          ? await store.createShortBook(
              { title: "短篇同名目录", genre: "其他" },
              join(root, "books")
            )
          : await store.createScriptBook(
              { title: "剧本同名目录", genre: "其他" },
              join(root, "books")
            );
      const existingTitle = opened.resource.draft.sections[0]!.title;

      await expect(
        store.createDraftSections({
          operationId: `${bookType}-duplicate-existing-title`,
          bookId: opened.resource.id,
          force: true,
          sections: [
            {
              clientSectionId: `pending:${bookType}:existing`,
              title: existingTitle
            }
          ]
        })
      ).rejects.toThrow(/正文目录已存在同名/u);

      await expect(
        store.createDraftSections({
          operationId: `${bookType}-duplicate-batch-title`,
          bookId: opened.resource.id,
          force: true,
          sections: [
            { clientSectionId: `pending:${bookType}:one`, title: "重复标题" },
            { clientSectionId: `pending:${bookType}:two`, title: "重复标题" }
          ]
        })
      ).rejects.toThrow(/正文目录已存在同名/u);
      expect(await store.getProjectRevision(opened.resource.id, "book")).toBe(
        0
      );
    }
  });

  it("deletes registered book, material, and skill project folders", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-delete-projects-");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const parentDirectory = join(root, "projects");
    const book = await store.createShortBook(
      { title: "待删除书籍", genre: "悬疑" },
      parentDirectory
    );
    const material = await store.createLibrary({
      domain: "material",
      name: "待删除素材库",
      materialKind: "plot",
      parentDirectory
    });
    const skill = await store.createLibrary({
      domain: "skill",
      name: "待删除技能库",
      skillKind: "plot",
      parentDirectory
    });

    for (const project of [
      {
        domain: "book" as const,
        id: book.resource.id,
        path: book.projectDirectory
      },
      {
        domain: "material" as const,
        id: material.resource.id,
        path: material.projectDirectory
      },
      {
        domain: "skill" as const,
        id: skill.resource.id,
        path: skill.projectDirectory
      }
    ]) {
      await expect(
        store.deleteProject({ domain: project.domain, projectId: project.id })
      ).resolves.toEqual({
        domain: project.domain,
        projectId: project.id,
        deleted: true
      });
      await expect(access(project.path)).rejects.toMatchObject({
        code: "ENOENT"
      });
    }

    await expect(store.snapshot()).resolves.toMatchObject({
      books: [],
      materials: [],
      skills: []
    });
  });
});
