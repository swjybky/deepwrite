import { describe, expect, it } from "vitest";
import {
  BookProjectDraftSectionManifestSchema,
  CatalogDocumentSchema,
  CatalogDraftSectionSchema,
  CatalogDraftRecoverySchema,
  CatalogProjectManifestSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  CreateDraftSectionInputSchema,
  CreateLibraryInputSchema,
  CreateLibraryEntryInputSchema,
  CreateLibraryGroupInputSchema,
  ImportLegacyLibraryResultSchema,
  CreateShortBookInputSchema,
  MATERIAL_KINDS,
  SKILL_KINDS,
  UpdateLibraryGroupInputSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createEnvelope
} from "./index";

const now = "2026-07-18T10:00:00.000Z";

describe("catalog contracts", () => {
  it("keeps draft section ids and titles within the Agent snapshot boundary", () => {
    const sectionId = "s".repeat(120);
    const sectionTitle = "节".repeat(240);
    const catalogDocument = (id: string, title: string) => ({
      id,
      title,
      content: "",
      createdAt: now,
      updatedAt: now
    });
    const manifestDocument = (id: string, title: string, path: string) => ({
      id,
      title,
      path,
      createdAt: now,
      updatedAt: now
    });
    const catalogSection = {
      id: sectionId,
      title: sectionTitle,
      wordCountRequirement: "",
      body: catalogDocument(catalogDraftBodyDocumentId(sectionId), "正文"),
      characterState: catalogDocument(
        catalogDraftCharacterStateDocumentId(sectionId),
        "人物状态"
      ),
      createdAt: now,
      updatedAt: now
    };
    const manifestSection = {
      ...catalogSection,
      body: manifestDocument(
        catalogDraftBodyDocumentId(sectionId),
        "正文",
        "stages/draft/body.md"
      ),
      characterState: manifestDocument(
        catalogDraftCharacterStateDocumentId(sectionId),
        "人物状态",
        "stages/draft/state.md"
      )
    };

    expect(CatalogDraftSectionSchema.safeParse(catalogSection).success).toBe(true);
    expect(BookProjectDraftSectionManifestSchema.safeParse(manifestSection).success).toBe(
      true
    );
    expect(
      CatalogDraftSectionSchema.safeParse({
        ...catalogSection,
        body: { ...catalogSection.body, id: "custom-body" }
      }).success
    ).toBe(false);
    expect(
      BookProjectDraftSectionManifestSchema.safeParse({
        ...manifestSection,
        characterState: {
          ...manifestSection.characterState,
          id: "custom-character-state"
        }
      }).success
    ).toBe(false);
    expect(
      CreateDraftSectionInputSchema.safeParse({
        bookId: "book-1",
        afterSectionId: sectionId,
        title: sectionTitle
      }).success
    ).toBe(true);

    expect(
      CatalogDraftSectionSchema.safeParse({
        ...catalogSection,
        id: `${sectionId}x`
      }).success
    ).toBe(false);
    expect(
      BookProjectDraftSectionManifestSchema.safeParse({
        ...manifestSection,
        title: `${sectionTitle}节`
      }).success
    ).toBe(false);
    expect(
      CreateDraftSectionInputSchema.safeParse({
        bookId: "book-1",
        title: `${sectionTitle}节`
      }).success
    ).toBe(false);

    expect(
      CatalogDocumentSchema.safeParse(
        catalogDocument("i".repeat(512), "项目标题".repeat(64))
      ).success
    ).toBe(true);
  });

  it("requires a classification when creating material and skill libraries", () => {
    expect(
      CreateLibraryInputSchema.parse({
        domain: "material",
        name: "人物素材",
        materialKind: "character"
      })
    ).toMatchObject({ materialKind: "character" });
    expect(
      CreateLibraryInputSchema.parse({
        domain: "skill",
        name: "剧情技能",
        skillKind: "plot"
      })
    ).toMatchObject({ skillKind: "plot" });
    expect(() =>
      CreateLibraryInputSchema.parse({ domain: "material", name: "未分类素材" })
    ).toThrow();
    expect(() =>
      CreateLibraryInputSchema.parse({
        domain: "material",
        name: "综合素材",
        materialKind: "mixed"
      })
    ).toThrow();
  });

  it("validates multi-archive legacy library import results", () => {
    const result = ImportLegacyLibraryResultSchema.parse({
      imported: [],
      failures: [
        { fileName: "损坏素材库.zip", message: "缺少 metadata.json。" }
      ]
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.fileName).toBe("损坏素材库.zip");
  });

  it("accepts optional library selections when creating groups", () => {
    expect(
      CreateLibraryGroupInputSchema.parse({
        domain: "material",
        name: "空素材分组",
        members: {}
      }).members
    ).toEqual({});
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "catalog.createLibraryGroup",
          {
            domain: "skill",
            name: "写作技能组",
            members: { general: "skill-general" }
          },
          { id: "catalog-create-library-group" }
        )
      ).type
    ).toBe("catalog.createLibraryGroup");
    expect(
      UpdateLibraryGroupInputSchema.parse({
        domain: "skill",
        groupId: "skill-group",
        members: { plot: "skill-plot" },
        baseProjectRevision: 2
      })
    ).toMatchObject({ groupId: "skill-group", baseProjectRevision: 2 });
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "catalog.updateLibraryGroup",
          {
            domain: "material",
            groupId: "material-group",
            members: {}
          },
          { id: "catalog-update-library-group" }
        )
      ).type
    ).toBe("catalog.updateLibraryGroup");
  });

  it("validates a normalized catalog snapshot", () => {
    const snapshot = CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 3,
      books: [
        {
          id: "book-1",
          title: "雨夜来信",
          bookType: "short",
          genre: "悬疑",
          status: "editing",
          linkedMaterialIdsByKind: {
            character: ["material-1"],
            gimmick: [],
            plot: [],
            draft: [],
            other: []
          },
          linkedSkillIdsByKind: {
            general: ["skill-1"],
            plot: [],
            style: [],
            other: []
          },
          documents: [
            {
              id: "draft",
              title: "正文编写",
              content: "窗外正在下雨。",
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      materials: [
        {
          id: "material-1",
          title: "人物素材",
          materialType: "short",
          materialKind: "character",
          parentGenre: "悬疑",
          subGenre: "",
          overview: "",
          entries: [
            {
              id: "material-entry-1",
              stageId: "character",
              title: "守夜人",
              body: "沉默寡言。",
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      materialGroups: [],
      skills: [
        {
          id: "skill-1",
          title: "通用技能",
          skillType: "short",
          skillKind: "general",
          overview: "",
          isBuiltin: false,
          entries: [],
          createdAt: now,
          updatedAt: now
        }
      ],
      skillGroups: [],
      updatedAt: now
    });

    expect(snapshot.books[0]?.linkedMaterialIdsByKind.character).toEqual([
      "material-1"
    ]);
    expect(snapshot.books[0]?.documents).toEqual([]);
    expect(
      snapshot.books[0]?.draft.sections.find((section) => section.body.content)?.body
        .content
    ).toBe("窗外正在下雨。");
    expect(snapshot.books[0]?.draft.sections[0]?.characterState.content).toBe("");
    expect(MATERIAL_KINDS).toHaveLength(5);
    expect(SKILL_KINDS).toHaveLength(4);
  });

  it("prefers the legacy draft document id over an earlier title-only match", () => {
    const snapshot = CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      books: [
        {
          id: "book-draft-priority",
          title: "正文识别优先级",
          bookType: "short",
          genre: "其他",
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
              content: "同名普通文档",
              createdAt: now,
              updatedAt: now
            },
            {
              id: "draft",
              title: "真正正文",
              content: "必须迁移的正文",
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      materials: [],
      materialGroups: [],
      skills: [],
      skillGroups: [],
      updatedAt: now
    });

    expect(snapshot.books[0]?.documents).toMatchObject([
      { id: "notes", content: "同名普通文档" }
    ]);
    expect(
      snapshot.books[0]?.draft.sections.find(({ id }) => id === "section-1")?.body
        .content
    ).toBe("必须迁移的正文");
  });

  it("accepts semantic catalog command envelopes", () => {
    const commands = [
      createEnvelope("catalog.snapshot", {}, { id: "catalog-snapshot" }),
      createEnvelope(
        "catalog.createShortBook",
        {
          title: "新短篇",
          genre: "追妻" as const,
          linkedMaterialIdsByKind: { plot: ["material-plot"] },
          linkedSkillIdsByKind: { style: ["skill-style"] }
        },
        { id: "catalog-create" }
      ),
      createEnvelope(
        "catalog.createLibrary",
        {
          domain: "material" as const,
          name: "人物素材",
          materialKind: "character" as const
        },
        { id: "catalog-create-library" }
      ),
      createEnvelope(
        "catalog.openProject",
        { domain: "book" as const },
        { id: "catalog-open" }
      ),
      createEnvelope(
        "catalog.importLegacyLibrary",
        { domain: "material" as const },
        { id: "catalog-import-legacy-library" }
      ),
      createEnvelope(
        "catalog.createShortBookAtPath",
        {
          parentDirectory: "/Users/writer/Books",
          input: { title: "本地短篇", genre: "科幻" as const }
        },
        { id: "catalog-create-at-path" }
      ),
      createEnvelope(
        "catalog.createLibraryAtPath",
        {
          domain: "skill" as const,
          name: "剧情技能",
          skillKind: "plot" as const,
          parentDirectory: "/Users/writer/Skills"
        },
        { id: "catalog-create-library-at-path" }
      ),
      createEnvelope(
        "catalog.openProjectAtPath",
        {
          projectDirectory: "/Users/writer/Books/本地短篇",
          domain: "book" as const
        },
        { id: "catalog-open-at-path" }
      ),
      createEnvelope(
        "catalog.importLegacyLibraryAtPath",
        {
          domain: "skill" as const,
          archivePath: "/Users/writer/Exports/旧技能.zip",
          parentDirectory: "/Users/writer/Skills"
        },
        { id: "catalog-import-legacy-library-at-path" }
      ),
      createEnvelope(
        "catalog.updateBook",
        { bookId: "book-1", status: "completed" as const, baseProjectRevision: 2 },
        { id: "catalog-update" }
      ),
      createEnvelope(
        "catalog.deleteBook",
        { bookId: "book-1" },
        { id: "catalog-delete" }
      ),
      createEnvelope(
        "catalog.saveDocument",
        {
          bookId: "book-1",
          documentId: "draft",
          content: "新正文",
          baseRevision: "revision-3",
          baseProjectRevision: 2
        },
        { id: "catalog-save-document" }
      ),
      createEnvelope(
        "catalog.createDraftSection",
        {
          bookId: "book-1",
          afterSectionId: "section-1",
          baseProjectRevision: 2
        },
        { id: "catalog-create-draft-section" }
      ),
      createEnvelope(
        "catalog.deleteDraftSection",
        {
          bookId: "book-1",
          sectionId: "section-2",
          baseProjectRevision: 3
        },
        { id: "catalog-delete-draft-section" }
      ),
      createEnvelope(
        "catalog.saveLibraryEntry",
        {
          domain: "material" as const,
          libraryId: "material-1",
          entryId: "entry-1",
          content: "更新后的素材",
          baseRevision: "revision-2",
          baseProjectRevision: 4
        },
        { id: "catalog-save-library-entry" }
      ),
      createEnvelope(
        "catalog.createLibraryEntry",
        {
          domain: "material" as const,
          libraryId: "material-1",
          title: "新人物",
          content: "人物设定",
          stageId: "character" as const
        },
        { id: "catalog-create-library-entry" }
      ),
      createEnvelope(
        "catalog.removeLibraryEntry",
        {
          domain: "skill" as const,
          libraryId: "skill-1",
          entryId: "entry-1",
          baseProjectRevision: 5
        },
        { id: "catalog-remove-library-entry" }
      ),
      createEnvelope(
        "catalog.unregisterProject",
        { domain: "material" as const, projectId: "material-1" },
        { id: "catalog-unregister-project" }
      ),
      createEnvelope(
        "catalog.deleteProject",
        { domain: "skill" as const, projectId: "skill-1" },
        { id: "catalog-delete-project" }
      )
    ];

    expect(commands.map((command) => CommandEnvelopeSchema.parse(command).type)).toEqual(
      [
        "catalog.snapshot",
        "catalog.createShortBook",
        "catalog.createLibrary",
        "catalog.openProject",
        "catalog.importLegacyLibrary",
        "catalog.createShortBookAtPath",
        "catalog.createLibraryAtPath",
        "catalog.openProjectAtPath",
        "catalog.importLegacyLibraryAtPath",
        "catalog.updateBook",
        "catalog.deleteBook",
        "catalog.saveDocument",
        "catalog.createDraftSection",
        "catalog.deleteDraftSection",
        "catalog.saveLibraryEntry",
        "catalog.createLibraryEntry",
        "catalog.removeLibraryEntry",
        "catalog.unregisterProject",
        "catalog.deleteProject"
      ]
    );
  });

  it("constrains new entry stages to the selected library domain", () => {
    expect(
      CreateLibraryEntryInputSchema.parse({
        domain: "skill",
        libraryId: "skill-1",
        title: "正文写作",
        content: "技能正文",
        stageId: "draft"
      }).stageId
    ).toBe("draft");

    expect(() =>
      CreateLibraryEntryInputSchema.parse({
        domain: "skill",
        libraryId: "skill-1",
        title: "错误阶段",
        content: "技能正文",
        stageId: "character"
      })
    ).toThrow();
  });

  it("accepts opaque recovery document keys larger than one catalog id", () => {
    const compositeKey = `catalog:material-entry:${"书".repeat(4_000)}`;
    expect(
      CatalogDraftRecoverySchema.parse({
        [compositeKey]: {
          title: "长标识草稿",
          content: "未保存内容",
          dirty: true
        }
      })[compositeKey]?.content
    ).toBe("未保存内容");
  });

  it("validates folder manifests that reference external Markdown content", () => {
    const common = {
      schemaVersion: 1 as const,
      revision: 2,
      id: "project-1",
      title: "雨夜来信",
      createdAt: now,
      updatedAt: now
    };
    const manifests = [
      {
        ...common,
        kind: "deepwrite.book" as const,
        bookType: "short" as const,
        genre: "悬疑" as const,
        status: "editing" as const,
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
            id: "draft",
            title: "正文编写",
            path: "stages/draft.md",
            createdAt: now,
            updatedAt: now
          }
        ]
      },
      {
        ...common,
        kind: "deepwrite.material-library" as const,
        materialType: "short" as const,
        materialKind: "character" as const,
        parentGenre: "悬疑",
        subGenre: "",
        overview: "",
        entries: [
          {
            id: "material-entry-1",
            stageId: "character" as const,
            title: "守夜人",
            path: "entries/守夜人.md",
            createdAt: now,
            updatedAt: now
          }
        ]
      },
      {
        ...common,
        kind: "deepwrite.skill-library" as const,
        skillType: "short" as const,
        skillKind: "general" as const,
        overview: "",
        isBuiltin: false,
        entries: [
          {
            id: "skill-entry-1",
            stageId: "draft" as const,
            title: "正文技能",
            path: "entries/正文技能.md",
            createdAt: now,
            updatedAt: now
          }
        ]
      },
      {
        ...common,
        kind: "deepwrite.material-group" as const,
        members: { character: "material-1" }
      },
      {
        ...common,
        kind: "deepwrite.skill-group" as const,
        members: { general: "skill-1" }
      }
    ];

    expect(
      manifests.map((manifest) => CatalogProjectManifestSchema.parse(manifest).kind)
    ).toEqual([
      "deepwrite.book",
      "deepwrite.material-library",
      "deepwrite.skill-library",
      "deepwrite.material-group",
      "deepwrite.skill-group"
    ]);
  });

  it("validates the v2 draft directory as paired physical files", () => {
    const manifest = CatalogProjectManifestSchema.parse({
      schemaVersion: 2,
      revision: 4,
      kind: "deepwrite.book",
      id: "book-v2",
      title: "分文件正文",
      bookType: "short",
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
      documents: [],
      draft: {
        id: "draft",
        title: "正文",
        sections: [
          {
            id: "section-1",
            title: "第一节",
            wordCountRequirement: "1200字",
            body: {
              id: "draft-section:section-1:body",
              title: "第一节",
              path: "stages/draft/section-1.body.md",
              createdAt: now,
              updatedAt: now
            },
            characterState: {
              id: "draft-section:section-1:character-state",
              title: "第一节 · 人物状态",
              path: "stages/draft/section-1.state.md",
              createdAt: now,
              updatedAt: now
            },
            createdAt: now,
            updatedAt: now
          }
        ],
        createdAt: now,
        updatedAt: now
      },
      createdAt: now,
      updatedAt: now
    });

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.kind).toBe("deepwrite.book");
    if (manifest.kind !== "deepwrite.book" || manifest.schemaVersion !== 2) {
      throw new Error("Expected a v2 book manifest.");
    }
    expect(manifest.draft.sections[0]?.body.path).toBe(
      "stages/draft/section-1.body.md"
    );
    expect(() =>
      CatalogProjectManifestSchema.parse({
        ...manifest,
        draft: {
          ...manifest.draft,
          sections: manifest.draft.sections.map((section) => ({
            ...section,
            characterState: { ...section.characterState, path: section.body.path }
          }))
        }
      })
    ).toThrow();
  });

  it("rejects unsafe project paths and inline project content", () => {
    const bookManifest = {
      schemaVersion: 1,
      revision: 0,
      kind: "deepwrite.book",
      id: "book-1",
      title: "越界测试",
      bookType: "short",
      genre: "其他",
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
          id: "draft",
          title: "正文编写",
          path: "../draft.md",
          content: "不应写进清单",
          createdAt: now,
          updatedAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    };

    expect(() => CatalogProjectManifestSchema.parse(bookManifest)).toThrow();
    expect(() =>
      CatalogProjectManifestSchema.parse({
        ...bookManifest,
        documents: [{ ...bookManifest.documents[0], path: "stages/draft.md" }]
      })
    ).toThrow();
  });

  it("rejects blank titles and duplicate binding ids", () => {
    expect(() =>
      CreateShortBookInputSchema.parse({ title: "  ", genre: "其他" })
    ).toThrow();
    expect(() =>
      CreateShortBookInputSchema.parse({
        title: "重复绑定",
        genre: "其他",
        linkedMaterialIdsByKind: {
          plot: ["material-1", "material-1"]
        }
      })
    ).toThrow();
  });
});
