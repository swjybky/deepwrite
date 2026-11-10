import { describe, expect, it } from "vitest";
import {
  CatalogIndexSnapshotSchema,
  CatalogSnapshotSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import {
  findProjectedDraftDirectoryForWorkspace,
  findProjectedResourceNode,
  findProjectedWorkspaceDocument,
  projectCatalogWorkspace,
  resolveBookWorkspaceId,
  resolveDraftSectionResourceId,
  resolvePreferredBookResourceId,
  resolveDraftSectionProjection,
  resolveProjectedResourceIdForDocumentId,
  resolveProjectedResourceTargetDocumentId
} from "./catalogWorkspace";

const NOW = "2026-07-18T08:00:00.000Z";

function fixture(): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 7,
    updatedAt: NOW,
    books: [
      {
        id: "book-short",
        title: "迁移短篇",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: ["material-mixed"],
          gimmick: [],
          plot: ["material-plot"],
          draft: ["material-mixed"],
          other: []
        },
        linkedSkillIdsByKind: {
          general: ["skill-general"],
          plot: [],
          style: [],
          other: []
        },
        documents: [
          {
            id: "character_design",
            title: "人物设计",
            content: "人物",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "plot_design",
            title: "剧情设计",
            content: "剧情",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "intro_design",
            title: "导语设计",
            content: "导语",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "plot_refine",
            title: "剧情细化",
            content: "细化",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "outline",
            title: "大纲",
            content: "大纲",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "notes",
            title: "迁移备注",
            content: "备注",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        draft: {
          id: "draft",
          title: "正文",
          sections: [
            {
              id: "intro",
              title: "导语",
              wordCountRequirement: "300 字",
              body: {
                id: catalogDraftBodyDocumentId("intro"),
                title: "导语",
                content: "导语正文",
                createdAt: NOW,
                updatedAt: NOW
              },
              characterState: {
                id: catalogDraftCharacterStateDocumentId("intro"),
                title: "导语 · 人物状态",
                content: "导语状态",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            },
            {
              id: "section-1",
              title: "第一节",
              wordCountRequirement: "1000 字",
              body: {
                id: catalogDraftBodyDocumentId("section-1"),
                title: "第一节",
                content: "正文",
                createdAt: NOW,
                updatedAt: NOW
              },
              characterState: {
                id: catalogDraftCharacterStateDocumentId("section-1"),
                title: "第一节 · 人物状态",
                content: "人物状态",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            }
          ],
          createdAt: NOW,
          updatedAt: NOW
        },
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materials: [
      {
        id: "material-plot",
        title: "世情剧情素材",
        materialType: "short",
        materialKind: "plot",
        parentGenre: "世情",
        subGenre: "家庭",
        overview: "剧情素材说明",
        entries: [
          {
            id: "material-pacing",
            stageId: "pacing",
            title: "剧情节拍",
            body: "节拍正文",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "material-intro",
            stageId: "intro",
            title: "导语钩子",
            body: "钩子正文",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "material-mixed",
        title: "综合素材",
        materialType: "short",
        materialKind: "mixed",
        parentGenre: "追妻",
        subGenre: "重生",
        overview: "综合素材说明",
        entries: [
          {
            id: "material-character",
            stageId: "character",
            title: "人物反差",
            body: "人物正文",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "material-draft",
            stageId: "draft_excerpt",
            title: "正文片段",
            body: "片段正文",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materialGroups: [
      {
        id: "material-group",
        title: "追妻素材套装",
        members: {
          character: "material-mixed",
          plot: "material-plot",
          draft: "missing-material"
        },
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    skills: [
      {
        id: "skill-general",
        title: "通用短篇技能",
        skillType: "short",
        skillKind: "general",
        overview: "技能说明",
        isBuiltin: false,
        entries: [
          {
            id: "skill-character",
            stageId: "character_design",
            title: "人物方法",
            body: "人物技能正文",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "skill-draft",
            stageId: "draft",
            title: "正文方法",
            body: "正文技能正文",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "skill-plot",
        title: "剧情设计方法",
        skillType: "short",
        skillKind: "plot",
        overview: "剧情技能说明",
        isBuiltin: false,
        entries: [],
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    skillGroups: [
      {
        id: "skill-group",
        title: "短篇技能套装",
        members: { general: "skill-general", style: "missing-skill" },
        createdAt: NOW,
        updatedAt: NOW
      }
    ]
  });
}

function flattenNodes(nodes: readonly ResourceTreeNode[]): ResourceTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}

describe("catalog workspace projection", () => {
  it("projects a metadata-only index without treating unloaded bodies as empty", () => {
    const source = fixture();
    const byteLength = (value: string): number =>
      new TextEncoder().encode(value).byteLength;
    const fileStamp = (value: string): string =>
      `fs-v1:${byteLength(value)}:1:1`;
    const manifestStamp = (value: string): string =>
      `manifest-v1:${byteLength(value)}:${NOW}`;
    const index = CatalogIndexSnapshotSchema.parse({
      ...source,
      books: source.books.map((book) => ({
        ...book,
        documents: book.documents.map((document) => ({
          ...document,
          content: "",
          contentBytes: byteLength(document.content),
          contentStamp: fileStamp(document.content)
        })),
        draft: {
          ...book.draft,
          sections: book.draft.sections.map((section) => ({
            ...section,
            body: {
              ...section.body,
              content: "",
              contentBytes: byteLength(section.body.content),
              contentStamp: fileStamp(section.body.content)
            },
            characterState: {
              ...section.characterState,
              content: "",
              contentBytes: byteLength(section.characterState.content),
              contentStamp: fileStamp(section.characterState.content)
            }
          }))
        }
      })),
      materials: source.materials.map((library) => ({
        ...library,
        overview: "",
        overviewContentBytes: byteLength(library.overview),
        overviewContentStamp: manifestStamp(library.overview),
        entries: library.entries.map((entry) => ({
          ...entry,
          body: "",
          contentBytes: byteLength(entry.body),
          contentStamp: fileStamp(entry.body)
        }))
      })),
      skills: source.skills.map((library) => ({
        ...library,
        overview: "",
        overviewContentBytes: byteLength(library.overview),
        overviewContentStamp: manifestStamp(library.overview),
        entries: library.entries.map((entry) => ({
          ...entry,
          body: "",
          contentBytes: byteLength(entry.body),
          contentStamp: fileStamp(entry.body)
        }))
      }))
    });

    const projection = projectCatalogWorkspace(index);
    const bookDocument = projection.workspaceDocuments.find(
      (document) => document.catalogDocumentId === "character_design"
    )!;
    const materialOverview = projection.workspaceDocuments.find(
      (document) =>
        document.libraryId === "material-plot" &&
        document.catalogLibraryField === "overview"
    )!;
    const overviewResourceId = projection.index.resourceIdByDocumentId.get(
      materialOverview.id
    )!;

    expect(bookDocument).toMatchObject({
      content: "",
      catalogContentBytes: byteLength("人物"),
      catalogContentLoaded: false
    });
    expect(materialOverview).toMatchObject({
      content: "",
      catalogContentBytes: byteLength("剧情素材说明"),
      catalogContentLoaded: false
    });
    expect(
      projection.index.resourceNodeById.get(overviewResourceId)?.muted
    ).toBe(false);
  });

  it("prefers the virtual draft directory for a newly selected book", () => {
    const projection = projectCatalogWorkspace(fixture());
    const directory = projection.draftDirectories[0]!;

    expect(resolvePreferredBookResourceId(projection, "book-short")).toBe(
      directory.id
    );
    expect(
      resolvePreferredBookResourceId(projection, "missing-book")
    ).toBeUndefined();
  });

  it("resolves a draft child back to its book and sibling section resource", () => {
    const source = fixture();
    source.books.push({
      ...structuredClone(source.books[0]!),
      id: "book-second",
      title: "第二本书"
    });
    const projection = projectCatalogWorkspace(source);
    const directory = projection.draftDirectories.find(
      (candidate) => candidate.workspaceId === "book-second"
    )!;
    const book = projection.resourceSections[0]!.nodes.find(
      (node) => node.id === "book-second"
    )!;
    const directoryNode = book.children!.find(
      (node) => node.id === directory.id
    )!;
    const secondChild = directoryNode.children![1]!;

    expect(resolveBookWorkspaceId(projection, secondChild.id)).toBe(
      "book-second"
    );
    expect(resolvePreferredBookResourceId(projection, "book-second")).toBe(
      directory.id
    );
    expect(resolveDraftSectionResourceId(directoryNode, "section-1")).toBe(
      secondChild.id
    );
  });

  it("builds reusable lookup indexes while projecting the catalog", () => {
    const projection = projectCatalogWorkspace(fixture());
    const directory = projection.draftDirectories[0]!;
    const bookNode = projection.resourceSections[0]!.nodes[0]!;
    const directoryNode = bookNode.children!.find(
      (node) => node.id === directory.id
    )!;
    const sectionNode = directoryNode.children![1]!;
    const section = directory.sections[1]!;
    const bodyDocument = projection.workspaceDocuments.find(
      (document) => document.id === section.bodyDocumentId
    )!;

    expect(findProjectedResourceNode(projection, sectionNode.id)).toBe(
      sectionNode
    );
    expect(findProjectedWorkspaceDocument(projection, bodyDocument.id)).toBe(
      bodyDocument
    );
    expect(
      findProjectedDraftDirectoryForWorkspace(projection, "book-short")
    ).toBe(directory);
    expect(
      resolveProjectedResourceIdForDocumentId(
        projection,
        section.bodyDocumentId
      )
    ).toBe(sectionNode.id);
    expect(
      resolveProjectedResourceIdForDocumentId(
        projection,
        section.characterStateDocumentId
      )
    ).toBe(sectionNode.id);
    expect(
      resolveProjectedResourceTargetDocumentId(projection, directory.id)
    ).toBe(directory.sections[0]!.bodyDocumentId);
    expect(
      resolveProjectedResourceTargetDocumentId(projection, "missing-resource")
    ).toBe("missing-resource");
    expect(
      resolveProjectedResourceIdForDocumentId(projection, "missing-document")
    ).toBeUndefined();
    expect(
      findProjectedResourceNode(projection, "missing-resource")
    ).toBeUndefined();
    expect(
      findProjectedWorkspaceDocument(projection, "missing-document")
    ).toBeUndefined();
    expect(
      findProjectedDraftDirectoryForWorkspace(projection, "missing-book")
    ).toBeUndefined();
    expect(
      resolveBookWorkspaceId(projection, "missing-resource")
    ).toBeUndefined();
  });

  it("uses the projection index without rescanning projection arrays", () => {
    const projection = projectCatalogWorkspace(fixture());
    const directory = projection.draftDirectories[0]!;
    const sectionNode =
      projection.resourceSections[0]!.nodes[0]!.children!.find(
        (node) => node.id === directory.id
      )!.children![0]!;

    projection.resourceSections = [];
    projection.workspaceDocuments = [];
    projection.draftDirectories = [];

    expect(resolvePreferredBookResourceId(projection, "book-short")).toBe(
      directory.id
    );
    expect(resolveBookWorkspaceId(projection, sectionNode.id)).toBe(
      "book-short"
    );
    expect(findProjectedResourceNode(projection, sectionNode.id)).toBe(
      sectionNode
    );
  });

  it("prefers the section selected from editor tabs over the tree node section", () => {
    const source = projectCatalogWorkspace(fixture()).draftDirectories[0]!;
    const directory = {
      ...source,
      sections: [
        { ...source.sections[0]!, id: "section-1", bodyDocumentId: "body-1" },
        { ...source.sections[1]!, id: "section-2", bodyDocumentId: "body-2" }
      ]
    };

    expect(
      resolveDraftSectionProjection(directory, "section-2", "section-1")
    ).toMatchObject({
      id: "section-2",
      bodyDocumentId: "body-2"
    });
  });

  it("projects short books and keeps every migrated document", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);

    expect(projection.resourceSections.map((section) => section.label)).toEqual(
      ["创作空间", "技能库", "素材库"]
    );
    const book = projection.resourceSections[0]?.nodes[0];
    expect(book).toMatchObject({
      id: "book-short",
      label: "迁移短篇",
      badge: "短篇",
      catalogNodeType: "book",
      boundMaterialLibraryIds: ["material-mixed", "material-plot"],
      boundSkillLibraryIds: ["skill-general"]
    });
    expect(book?.boundMaterialLibraryIdsByKind?.plot).toEqual([
      "material-plot"
    ]);
    expect(book?.children?.map((node) => node.label)).toEqual([
      "人物",
      "剧情",
      "正文"
    ]);
    expect(book?.children?.[1]?.children?.map((node) => node.label)).toEqual([
      "世界观",
      "剧情设计",
      "导语设计",
      "剧情细化",
      "叙事视角",
      "大纲",
      "迁移备注"
    ]);

    const bookDocuments = projection.workspaceDocuments.filter(
      (document) => document.workspaceId === "book-short"
    );
    expect(bookDocuments).toHaveLength(
      source.books[0]!.documents.length +
        source.books[0]!.draft.sections.length * 2
    );
    const draftDocuments = bookDocuments.filter(
      (document) => document.stageId === "draft"
    );
    expect(draftDocuments).toHaveLength(4);
    expect(
      draftDocuments.find((document) => document.draftFileKind === "body")
    ).toMatchObject({
      title: "导语",
      content: "导语正文",
      format: "正文",
      expertSectionId: "intro",
      catalogDocumentId: catalogDraftBodyDocumentId("intro")
    });
    const draftNode = book?.children?.find(
      (node) => node.stageCategoryId === "draft"
    );
    expect(draftNode).toMatchObject({
      label: "正文",
      catalogNodeType: "category",
      selectableBranch: true,
      shortAgentId: "short"
    });
    expect(draftNode?.id).not.toBe(draftDocuments[0]?.id);
    expect(draftNode?.children?.map((node) => node.label)).toEqual([
      "导语",
      "第一节"
    ]);
    expect(draftNode?.children?.[1]).toMatchObject({
      targetDocumentId: expect.any(String),
      characterStateDocumentId: expect.any(String),
      shortAgentId: "short",
      expertSectionId: "section-1"
    });
    expect(draftNode?.children?.[1]?.targetDocumentId).not.toBe(
      draftNode?.children?.[1]?.characterStateDocumentId
    );
    expect(
      bookDocuments.find((document) => document.catalogDocumentId === "notes")
        ?.path
    ).toEqual(["迁移短篇", "剧情", "迁移备注"]);
  });

  it("projects scripts with the shared plot structure and episode terminology", () => {
    const source = fixture();
    const base = structuredClone(source.books[0]!);
    source.books = [
      {
        ...base,
        id: "book-script",
        title: "雨夜剧本",
        bookType: "script",
        documents: base.documents,
        draft: {
          ...base.draft,
          sections: [
            {
              ...base.draft.sections[1]!,
              id: "episode-1",
              title: "第一集",
              body: {
                ...base.draft.sections[1]!.body,
                id: catalogDraftBodyDocumentId("episode-1"),
                title: "第一集"
              },
              characterState: {
                ...base.draft.sections[1]!.characterState,
                id: catalogDraftCharacterStateDocumentId("episode-1"),
                title: "第一集 · 人物状态"
              }
            }
          ]
        }
      }
    ];

    const projection = projectCatalogWorkspace(
      CatalogSnapshotSchema.parse(source)
    );
    const book = projection.resourceSections[0]!.nodes[0]!;
    const draft = book.children!.find(
      (node) => node.stageCategoryId === "draft"
    )!;

    expect(book).toMatchObject({
      id: "book-script",
      badge: "剧本",
      workspaceType: "script"
    });
    expect(book.children?.[1]?.children?.map((node) => node.label)).toEqual([
      "世界观",
      "剧情设计",
      "导语设计",
      "剧情细化",
      "叙事视角",
      "大纲",
      "迁移备注"
    ]);
    expect(flattenNodes([book]).some((node) => node.label === "导语设计")).toBe(
      true
    );
    expect(draft.children).toMatchObject([
      {
        label: "第一集",
        workspaceType: "script",
        shortAgentId: "script"
      }
    ]);
    const body = projection.workspaceDocuments.find(
      (document) =>
        document.expertSectionId === "episode-1" &&
        document.draftFileKind === "body"
    );
    expect(body).toMatchObject({
      workspaceType: "script",
      eyebrow: "剧本 · 剧集正文",
      shortAgentId: "script"
    });
  });

  it("projects list-style characters as an overview followed by ordered files", () => {
    const source = fixture();
    const book = source.books[0]!;
    book.characterStructure = {
      format: "list",
      items: [
        { id: "character-suyao", title: "苏遥", order: 2 },
        { id: "character-linmo", title: "林默", order: 1 }
      ]
    };
    book.documents.push(
      {
        id: "character-suyao",
        title: "苏遥",
        content: "苏遥保管底片。",
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "character-linmo",
        title: "林默",
        content: "林默是守夜人。",
        createdAt: NOW,
        updatedAt: NOW
      }
    );

    const projection = projectCatalogWorkspace(source);
    const characterNode =
      projection.resourceSections[0]?.nodes[0]?.children?.[0];
    expect(characterNode).toMatchObject({
      label: "人物",
      selectableBranch: true,
      characterDirectory: true,
      shortAgentId: "short"
    });
    expect(characterNode?.children?.map(({ label }) => label)).toEqual([
      "概览",
      "林默",
      "苏遥"
    ]);
    expect(characterNode?.children?.[1]).toMatchObject({
      characterItemId: "character-linmo"
    });
    expect(
      projection.workspaceDocuments.find(
        ({ catalogDocumentId }) => catalogDocumentId === "character-linmo"
      )
    ).toMatchObject({
      stageId: "character_design",
      characterFileKind: "item",
      characterItemId: "character-linmo",
      characterItemOrder: 1
    });
  });

  it("projects catalog draft sections as unique physical file pairs", () => {
    const source = fixture();
    source.books[0]!.draft.sections = [
      {
        ...source.books[0]!.draft.sections[0]!,
        id: "rainy-guest",
        title: "雨夜来客",
        body: {
          ...source.books[0]!.draft.sections[0]!.body,
          id: "rainy-guest-body",
          title: "雨夜来客",
          content: "林默在灯塔听见脚步。"
        },
        characterState: {
          ...source.books[0]!.draft.sections[0]!.characterState,
          id: "rainy-guest-state",
          title: "雨夜来客 · 人物状态"
        }
      },
      {
        ...source.books[0]!.draft.sections[1]!,
        id: "missing-list",
        title: "失踪名单",
        body: {
          ...source.books[0]!.draft.sections[1]!.body,
          id: "missing-list-body",
          title: "失踪名单",
          content: "名单最后一行写着他的名字。"
        },
        characterState: {
          ...source.books[0]!.draft.sections[1]!.characterState,
          id: "missing-list-state",
          title: "失踪名单 · 人物状态"
        }
      }
    ];

    const projection = projectCatalogWorkspace(source);
    const book = projection.resourceSections[0]!.nodes[0]!;
    const draftNode = book.children!.find(
      (node) => node.stageCategoryId === "draft"
    )!;
    const draftDocuments = projection.workspaceDocuments.filter(
      (document) =>
        document.workspaceId === book.id && document.stageId === "draft"
    );

    expect(draftDocuments).toHaveLength(4);
    expect(
      draftDocuments.every((document) => document.content.length > 0)
    ).toBe(true);
    expect(draftNode.children?.map((node) => node.label)).toEqual([
      "雨夜来客",
      "失踪名单"
    ]);
    expect(new Set(draftNode.children?.map((node) => node.id)).size).toBe(2);
    expect(draftNode.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetDocumentId: expect.any(String),
          characterStateDocumentId: expect.any(String),
          shortAgentId: "short",
          expertSectionId: expect.any(String)
        })
      ])
    );
    expect(projection.draftDirectories[0]?.sections).toHaveLength(2);
  });

  it("keeps an empty section as two independently addressable files", () => {
    const source = fixture();
    source.books[0]!.draft.sections = [
      {
        ...source.books[0]!.draft.sections[0]!,
        body: { ...source.books[0]!.draft.sections[0]!.body, content: "" },
        characterState: {
          ...source.books[0]!.draft.sections[0]!.characterState,
          content: ""
        }
      }
    ];

    const projection = projectCatalogWorkspace(source);
    const book = projection.resourceSections[0]!.nodes[0]!;
    const draftNode = book.children!.find(
      (node) => node.stageCategoryId === "draft"
    )!;
    const draftDocuments = projection.workspaceDocuments.filter(
      (document) =>
        document.workspaceId === book.id && document.stageId === "draft"
    );

    expect(draftNode).toMatchObject({
      selectableBranch: true,
      shortAgentId: "short"
    });
    expect(draftNode.children).toMatchObject([
      {
        label: "导语",
        shortAgentId: "short",
        expertSectionId: "intro"
      }
    ]);
    expect(draftDocuments).toHaveLength(2);
    expect(draftDocuments.map((document) => document.draftFileKind)).toEqual([
      "body",
      "character-state"
    ]);
  });

  it("moves grouped material libraries out of their purpose categories", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);
    const materialSection = projection.resourceSections.find(
      (section) => section.id === "material"
    )!;
    const nodes = flattenNodes(materialSection.nodes);

    expect(materialSection.nodes.map((node) => node.label)).toEqual([
      "追妻素材套装"
    ]);

    const materialGroup = materialSection.nodes[0];
    expect(materialGroup).toMatchObject({
      label: "追妻素材套装",
      catalogNodeType: "group"
    });
    expect(materialGroup?.badge).toBeUndefined();
    expect(materialGroup?.children?.map((node) => node.label)).toEqual([
      "综合素材",
      "世情剧情素材",
      "已丢失的素材库（missing-material）"
    ]);
    expect(materialGroup?.children?.map((node) => node.categoryTag)).toEqual([
      "人设",
      "剧情",
      "正文"
    ]);

    const plotCategory = materialSection.nodes.find(
      (node) => node.label === "剧情"
    );
    const otherCategory = materialSection.nodes.find(
      (node) => node.label === "其他"
    );
    expect(plotCategory).toBeUndefined();
    expect(otherCategory).toBeUndefined();
    expect(nodes.filter((node) => node.id === "material-plot")).toHaveLength(1);
    expect(nodes.filter((node) => node.id === "material-mixed")).toHaveLength(
      1
    );
    expect(nodes.some((node) => node.label === "世情")).toBe(false);
    expect(nodes.some((node) => node.label === "家庭")).toBe(false);
    expect(nodes.some((node) => node.label === "综合素材库")).toBe(false);
    expect(
      nodes.some(
        (node) => node.catalogNodeType === "category" && node.stageCategoryId
      )
    ).toBe(false);
    expect(
      nodes.some(
        (node) => node.label === "剧情节拍" && node.stageCategoryId === "pacing"
      )
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.label.includes("missing-material") && node.muted
      )
    ).toBe(true);

    const entryDocuments = projection.workspaceDocuments.filter(
      (document) => document.domain === "material" && document.catalogEntryId
    );
    expect(entryDocuments).toHaveLength(
      source.materials.reduce(
        (count, library) => count + library.entries.length,
        0
      )
    );
    expect(
      entryDocuments.find(
        (document) => document.catalogEntryId === "material-pacing"
      )
    ).toMatchObject({
      libraryId: "material-plot",
      materialKind: "plot",
      stageCategoryId: "pacing",
      parentGenre: "世情",
      subGenre: "家庭",
      content: "节拍正文"
    });
    expect(
      entryDocuments.find(
        (document) => document.catalogEntryId === "material-pacing"
      )?.path
    ).toContain("家庭");
    const materialOverview = projection.workspaceDocuments.find(
      (document) =>
        document.domain === "material" &&
        document.libraryId === "material-plot" &&
        document.catalogLibraryField === "overview"
    );
    expect(materialOverview).toMatchObject({
      content: "剧情素材说明",
      catalogLibraryField: "overview"
    });
    expect(materialOverview?.readOnly).toBeUndefined();
  });

  it("shows skill groups directly and moves their libraries out of kind categories", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);
    const skillSection = projection.resourceSections.find(
      (section) => section.id === "skill"
    )!;
    const nodes = flattenNodes(skillSection.nodes);

    expect(skillSection.nodes.map((node) => node.label)).toEqual([
      "短篇技能套装",
      "剧情设计方法"
    ]);
    expect(nodes.some((node) => node.label === "技能库分组")).toBe(false);
    expect(
      nodes.some(
        (node) =>
          node.label === "短篇技能套装" && node.catalogNodeType === "group"
      )
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.label === "通用技能库" && node.skillKind === "general"
      )
    ).toBe(false);
    expect(
      nodes.some(
        (node) =>
          node.label === "人物方法" &&
          node.stageCategoryId === "character_design"
      )
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.label === "正文方法" && node.stageCategoryId === "draft"
      )
    ).toBe(true);
    expect(
      nodes.some((node) => node.label.includes("missing-skill") && node.muted)
    ).toBe(true);

    const skillGroup = nodes.find(
      (node) =>
        node.label === "短篇技能套装" && node.catalogNodeType === "group"
    );
    expect(skillGroup?.badge).toBeUndefined();
    expect(skillGroup?.children?.map((node) => node.label)).toEqual([
      "通用短篇技能",
      "已丢失的技能库（missing-skill）"
    ]);
    expect(skillGroup?.children?.map((node) => node.categoryTag)).toEqual([
      "通用",
      "文风"
    ]);

    const generalKind = skillSection.nodes.find(
      (node) => node.skillKind === "general"
    );
    const plotKind = skillSection.nodes.find(
      (node) => node.skillKind === "plot"
    );
    const generalLibrary = skillGroup?.children?.find(
      (node) => node.id === "skill-general"
    );
    expect(generalKind).toBeUndefined();
    expect(plotKind).toMatchObject({
      id: "skill-plot",
      catalogNodeType: "library",
      categoryTag: "剧情"
    });
    expect(nodes.filter((node) => node.id === "skill-general")).toHaveLength(1);
    expect(generalLibrary?.categoryTag).toBe("通用");
    expect(generalLibrary?.badge).toBeUndefined();
    expect(generalLibrary?.children?.map((node) => node.label)).toEqual([
      "库说明",
      "人物方法",
      "正文方法"
    ]);
    expect(
      generalLibrary?.children?.some(
        (node) => node.catalogNodeType === "category"
      )
    ).toBe(false);

    const skillDocuments = projection.workspaceDocuments.filter(
      (document) => document.domain === "skill" && document.catalogEntryId
    );
    expect(skillDocuments).toHaveLength(
      source.skills.reduce(
        (count, library) => count + library.entries.length,
        0
      )
    );
    expect(skillDocuments[0]).toMatchObject({
      libraryId: "skill-general",
      skillKind: "general",
      stageCategoryId: "character_design",
      content: "人物技能正文"
    });
    const skillOverview = projection.workspaceDocuments.find(
      (document) =>
        document.domain === "skill" &&
        document.libraryId === "skill-general" &&
        document.catalogLibraryField === "overview"
    );
    expect(skillOverview).toMatchObject({
      content: "技能说明",
      catalogLibraryField: "overview"
    });
    expect(skillOverview?.readOnly).toBeUndefined();
  });

  it("keeps builtin skill-library overviews read-only", () => {
    const source = fixture();
    source.skills[0] = { ...source.skills[0]!, isBuiltin: true };
    const overview = projectCatalogWorkspace(source).workspaceDocuments.find(
      (document) =>
        document.domain === "skill" &&
        document.libraryId === "skill-general" &&
        document.catalogLibraryField === "overview"
    );
    expect(overview?.readOnly).toBe(true);
  });

  it("generates collision-free editor ids across books and libraries", () => {
    const projection = projectCatalogWorkspace(fixture());
    const ids = projection.workspaceDocuments.map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

it("projects ungrouped libraries at the root in catalog order with kind tags", () => {
  const snapshot = fixture();
  snapshot.materialGroups = [];
  snapshot.skillGroups = [];
  const projection = projectCatalogWorkspace(snapshot);
  const materials = projection.resourceSections.find(
    (section) => section.id === "material"
  )!.nodes;
  const skills = projection.resourceSections.find(
    (section) => section.id === "skill"
  )!.nodes;
  expect(materials.map((node) => node.id)).toEqual(
    snapshot.materials.map((library) => library.id)
  );
  expect(skills.map((node) => node.id)).toEqual(
    snapshot.skills.map((library) => library.id)
  );
  expect(
    [...materials, ...skills].every(
      (node) => node.catalogNodeType === "library" && Boolean(node.categoryTag)
    )
  ).toBe(true);
  expect(
    materials.find((node) => node.materialKind === "mixed")?.categoryTag
  ).toBe("综合");
});
