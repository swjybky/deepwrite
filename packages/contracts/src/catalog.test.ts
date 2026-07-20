import { describe, expect, it } from "vitest";
import {
  CatalogDraftRecoverySchema,
  CatalogProjectManifestSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  CreateLibraryEntryInputSchema,
  CreateShortBookInputSchema,
  MATERIAL_KINDS,
  SKILL_KINDS,
  createEnvelope
} from "./index";

const now = "2026-07-18T10:00:00.000Z";

describe("catalog contracts", () => {
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
    expect(MATERIAL_KINDS).toHaveLength(5);
    expect(SKILL_KINDS).toHaveLength(4);
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
        { domain: "material" as const, name: "人物素材" },
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
        "catalog.saveLibraryEntry",
        "catalog.createLibraryEntry",
        "catalog.removeLibraryEntry",
        "catalog.unregisterProject"
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
