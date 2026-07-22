import {
  access,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogSnapshotSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import {
  assertLegacyBookMigrationSourcesUnchanged,
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";

const temporaryRoots = new Set<string>();
const timestamp = "2026-07-19T01:02:03.000Z";

async function makeTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 19, 10, 0, tick++)).toISOString();
}

function catalogFixture(): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 17,
    updatedAt: timestamp,
    legacyImport: {
      sourceRoot: "/legacy/source",
      fingerprint: "a".repeat(64),
      importedAt: timestamp,
      materials: 1,
      skills: 1,
      materialGroups: 1,
      skillGroups: 1
    },
    books: [
      {
        id: "book-existing",
        title: "雨夜/来信",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: ["material-existing"],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: ["skill-existing"],
          plot: [],
          style: [],
          other: []
        },
        documents: [
          {
            id: "draft",
            title: "正文编写",
            content: "# 第一章\n\n门外一直在下雨。",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    materials: [
      {
        id: "material-existing",
        title: "人物素材",
        materialType: "short",
        materialKind: "character",
        parentGenre: "悬疑",
        subGenre: "",
        overview: "人物备忘",
        entries: [
          {
            id: "material-entry",
            stageId: "character",
            title: "守夜人",
            body: "守夜人从不在白天出现。",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    materialGroups: [
      {
        id: "material-group-existing",
        title: "悬疑素材组",
        members: { character: "material-existing" },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    skills: [
      {
        id: "skill-existing",
        title: "通用写作技能",
        skillType: "short",
        skillKind: "general",
        overview: "",
        isBuiltin: false,
        entries: [
          {
            id: "skill-entry",
            stageId: "draft",
            title: "正文技能",
            body: "保持短句和悬念。",
            createdAt: timestamp,
            updatedAt: timestamp,
            sourceSkillId: "source-skill"
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    skillGroups: [
      {
        id: "skill-group-existing",
        title: "悬疑技能组",
        members: { general: "skill-existing" },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  });
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("FolderCatalogStore", () => {
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
    const store = new FolderCatalogStore({ userDataPath: join(root, "user-data") });
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

    const bookProject = registry.projects.find(({ id }) => id === "book-existing")!;
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
      schemaVersion: 2,
      kind: "deepwrite.book",
      documents: []
    });
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
          readFile(join(bookProject.projectDirectory, section.body.path), "utf8")
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
        join(materialProject.projectDirectory, materialManifest.entries[0]!.path),
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
    expect(first.resource.documents).toHaveLength(5);
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
      reopened.resource.draft.sections.find(({ id }) => id === "section-1")?.body
        .content
    ).toBe("新的正文");
    expect((await store.snapshot()).books).toHaveLength(2);
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

    await store.saveDocument({
      bookId: opened.resource.id,
      documentId: bodyId,
      content: "第一节正文",
      baseRevision: emptyRevision,
      baseProjectRevision: 0
    });
    await expect(
      store.saveDocument({
        bookId: opened.resource.id,
        documentId: stateId,
        content: "林舟：仍在门外",
        baseRevision: emptyRevision,
        // A content-only save uses the target file revision, so an unrelated
        // body save must not make this independent file stale.
        baseProjectRevision: 0
      })
    ).resolves.toMatchObject({ content: "林舟：仍在门外" });

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
    const afterStaleSave = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as {
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
      { domain: "book" as const, id: book.resource.id, path: book.projectDirectory },
      { domain: "material" as const, id: material.resource.id, path: material.projectDirectory },
      { domain: "skill" as const, id: skill.resource.id, path: skill.projectDirectory }
    ]) {
      await expect(
        store.deleteProject({ domain: project.domain, projectId: project.id })
      ).resolves.toEqual({
        domain: project.domain,
        projectId: project.id,
        deleted: true
      });
      await expect(access(project.path)).rejects.toMatchObject({ code: "ENOENT" });
    }

    await expect(store.snapshot()).resolves.toMatchObject({
      books: [],
      materials: [],
      skills: []
    });
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
          character: [], gimmick: [], plot: [], draft: [], other: []
        },
        linkedSkillIdsByKind: {
          general: [], plot: [], style: [], other: []
        },
        documents: [
          { id: "character_design", title: "人物设计", content: "旧人物" },
          { id: "plot_design", title: "剧情设计", content: "" },
          { id: "intro_design", title: "导语设计", content: "" },
          { id: "plot_refine", title: "剧情细化", content: "" },
          { id: "outline", title: "大纲", content: "旧大纲" },
          { id: "draft", title: "正文编写", content: "旧正文" },
          { id: "legacy-7-review", title: "正文审阅（旧版）", content: "旧审阅" }
        ]
      },
      parentDirectory
    );

    expect(imported.projectDirectory).toBe(
      join(await realpath(parentDirectory), "旧版雨夜来信")
    );
    expect(imported.resource.documents).toHaveLength(6);
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
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.kind).toBe("deepwrite.book");
    expect(manifest.documents.some(({ id }) => id === "draft")).toBe(false);
    const firstSection = manifest.draft.sections.find(({ id }) => id === "section-1")!;
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

  it("creates a new folder-backed library from legacy library data", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-import-library-");
    const parentDirectory = join(root, "工作目录", "materials");
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data"),
      now: tickingClock()
    });
    const imported = await store.importLegacyLibrary(
      {
        domain: "material",
        library: {
          id: "legacy-material-id",
          title: "旧版人物素材库",
          materialType: "short",
          materialKind: "character",
          parentGenre: "追妻",
          subGenre: "剧情流",
          overview: "旧素材说明",
          entries: [
            {
              id: "legacy-entry-id",
              stageId: "character",
              title: "旧版女主",
              body: "她记得每一场雨。",
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ],
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      parentDirectory
    );

    expect(imported.resource.id).not.toBe("legacy-material-id");
    expect(imported.resource.entries[0]?.id).not.toBe("legacy-entry-id");
    expect(imported.resource).toMatchObject({
      title: "旧版人物素材库",
      materialKind: "character",
      overview: "旧素材说明",
      entries: [
        {
          stageId: "character",
          title: "旧版女主",
          body: "她记得每一场雨。"
        }
      ]
    });
    const manifest = JSON.parse(
      await readFile(join(imported.projectDirectory, "deepwrite.json"), "utf8")
    ) as { kind: string; entries: Array<{ path: string }> };
    expect(manifest.kind).toBe("deepwrite.material-library");
    await expect(
      readFile(join(imported.projectDirectory, manifest.entries[0]!.path), "utf8")
    ).resolves.toBe("她记得每一场雨。");
  });

  it("does not resurrect an unregistered legacy book when the app restarts", async () => {
    const root = await makeTemporaryRoot("deepwrite-folder-unregister-restart-");
    const userDataPath = join(root, "user-data");
    const source = catalogFixture();
    const store = new FolderCatalogStore({ userDataPath, initialSnapshot: source });
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
      registry.projects.filter(({ id }) => id === "shared-id").map(({ domain }) => domain)
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
      baseRevision: createShortWorkspaceContentRevision("守夜人从不在白天出现。"),
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
    expect(skillEntry).toMatchObject({
      stageId: "draft",
      title: "结尾留钩",
      body: "每一节结尾保留未回答的问题。"
    });

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
        baseRevision: createShortWorkspaceContentRevision(
          "守夜人只在雨夜出现。"
        ),
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
        await readFile(join(material.projectDirectory, "deepwrite.json"), "utf8")
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
    expect(skillGroup.resource.members).toEqual({ general: skill.resource.id });
    expect(materialGroup.resource.members).toEqual({ plot: material.resource.id });
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
      members: { plot: replacementMaterial.resource.id },
      baseProjectRevision: 0
    });
    expect(updatedMaterialGroup).toMatchObject({
      id: materialGroup.resource.id,
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

    await expect(
      store.openBookProject(bookDirectory, false)
    ).rejects.toThrow(/distinct files/u);
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
    expect(await readFile(manifestPath, "utf8")).toBe(changedLegacyManifestText);
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
      (await store.snapshot()).books[0]?.draft.sections.find(
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
        documents: [{ id: "notes", content: "同名普通文档" }],
        draft: { id: "draft", title: "正文" }
      }
    });
    const openedSection = opened.resource.draft.sections.find(
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
    expect(migratedManifest).toMatchObject({ schemaVersion: 2, revision: 4 });
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
      readFile(join(projectDirectory, migratedSection.characterState.path), "utf8")
    ).resolves.toBe("");

    const restartedStore = new FolderCatalogStore({
      userDataPath,
      now: tickingClock()
    });
    expect((await restartedStore.snapshot()).books[0]).toMatchObject({
      id: "book-external",
      title: "潮汐来信"
    });

    const originalContentRevision = createShortWorkspaceContentRevision(
      "最初由 Cursor 写下的正文"
    );
    await writeFile(migratedBodyPath, "Cursor 在应用外更新的正文", "utf8");
    expect(
      (await restartedStore.snapshot()).books[0]?.draft.sections.find(
        ({ id }) => id === "section-1"
      )?.body.content
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
      (JSON.parse(await readFile(manifestPath, "utf8")) as { title: string }).title
    ).toBe("潮汐来信（外部改名）");
    await expect(
      restartedStore.saveDocument({
        bookId: "book-external",
        documentId: catalogDraftBodyDocumentId("section-1"),
        title: "应用内旧文档标题",
        content: "不会覆盖的内容",
        baseRevision: createShortWorkspaceContentRevision(
          "Cursor 在应用外更新的正文"
        ),
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
    const body = original.draft.sections.find(({ id }) => id === "section-1")!.body;
    const originalBodyPath = body.path;
    const absoluteBodyPath = join(projectDirectory, originalBodyPath);

    body.path = "../outside.md";
    await writeJson(manifestPath, original);
    await expect(store.openBookProject(projectDirectory, false)).rejects.toThrow(
      /relative Markdown paths/u
    );

    body.path = originalBodyPath;
    await writeJson(manifestPath, original);
    await rm(absoluteBodyPath);
    const outside = join(root, "outside.md");
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, absoluteBodyPath);
    await expect(store.openBookProject(projectDirectory, false)).rejects.toThrow(
      /symbolic links/u
    );

    await rm(absoluteBodyPath);
    await writeFile(absoluteBodyPath, Buffer.from([0xc3, 0x28]));
    await expect(store.openBookProject(projectDirectory, false)).rejects.toThrow(
      /valid UTF-8/u
    );

    await writeFile(absoluteBodyPath, "x".repeat(17));
    const limitedStore = new FolderCatalogStore({
      userDataPath,
      maxMarkdownBytes: 16
    });
    await expect(limitedStore.openBookProject(projectDirectory, false)).rejects.toThrow(
      /16 byte limit/u
    );
  });
});
