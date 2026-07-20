import { describe, expect, it } from "vitest";
import { CatalogSnapshotSchema, type CatalogSnapshot } from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import { projectCatalogWorkspace } from "./catalogWorkspace";

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
          { id: "character_design", title: "人物设计", content: "人物", createdAt: NOW, updatedAt: NOW },
          { id: "plot_design", title: "剧情设计", content: "剧情", createdAt: NOW, updatedAt: NOW },
          { id: "intro_design", title: "导语设计", content: "导语", createdAt: NOW, updatedAt: NOW },
          { id: "plot_refine", title: "剧情细化", content: "细化", createdAt: NOW, updatedAt: NOW },
          { id: "outline", title: "大纲", content: "大纲", createdAt: NOW, updatedAt: NOW },
          { id: "draft", title: "正文", content: "正文", createdAt: NOW, updatedAt: NOW },
          { id: "notes", title: "迁移备注", content: "备注", createdAt: NOW, updatedAt: NOW }
        ],
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
          { id: "material-pacing", stageId: "pacing", title: "剧情节拍", body: "节拍正文", createdAt: NOW, updatedAt: NOW },
          { id: "material-intro", stageId: "intro", title: "导语钩子", body: "钩子正文", createdAt: NOW, updatedAt: NOW }
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
          { id: "material-character", stageId: "character", title: "人物反差", body: "人物正文", createdAt: NOW, updatedAt: NOW },
          { id: "material-draft", stageId: "draft_excerpt", title: "正文片段", body: "片段正文", createdAt: NOW, updatedAt: NOW }
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
          { id: "skill-character", stageId: "character_design", title: "人物方法", body: "人物技能正文", createdAt: NOW, updatedAt: NOW },
          { id: "skill-draft", stageId: "draft", title: "正文方法", body: "正文技能正文", createdAt: NOW, updatedAt: NOW }
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
  it("projects short books and keeps every migrated document", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);

    expect(projection.resourceSections.map((section) => section.label)).toEqual([
      "创作空间",
      "技能库",
      "素材库"
    ]);
    const book = projection.resourceSections[0]?.nodes[0];
    expect(book).toMatchObject({
      id: "book-short",
      label: "迁移短篇",
      badge: "短篇",
      catalogNodeType: "book",
      boundMaterialLibraryIds: ["material-mixed", "material-plot"],
      boundSkillLibraryIds: ["skill-general"]
    });
    expect(book?.boundMaterialLibraryIdsByKind?.plot).toEqual(["material-plot"]);
    expect(book?.children?.map((node) => node.label)).toEqual([
      "人物设计",
      "剧情",
      "大纲",
      "正文",
      "其他文稿"
    ]);
    expect(book?.children?.[1]?.children?.map((node) => node.label)).toEqual([
      "剧情设计",
      "导语设计",
      "剧情细化"
    ]);

    const bookDocuments = projection.workspaceDocuments.filter(
      (document) => document.workspaceId === "book-short"
    );
    expect(bookDocuments).toHaveLength(source.books[0]!.documents.length);
    const draftDocuments = bookDocuments.filter((document) => document.stageId === "draft");
    expect(draftDocuments).toHaveLength(1);
    expect(draftDocuments[0]).toMatchObject({
      content: "正文",
      format: "正文",
      catalogDocumentId: "draft"
    });
    const draftNode = book?.children?.find((node) => node.stageCategoryId === "draft");
    expect(draftNode).toMatchObject({
      id: draftDocuments[0]?.id,
      label: "正文",
      catalogNodeType: "document",
      selectableBranch: true,
      shortAgentId: "expert_draft_coordinator"
    });
    expect(draftNode?.children?.map((node) => node.label)).toEqual(["导语", "第一节"]);
    expect(draftNode?.children?.[1]).toMatchObject({
      targetDocumentId: draftDocuments[0]?.id,
      shortAgentId: "expert_section_writer",
      expertSectionId: "section-1"
    });
    expect(bookDocuments.find((document) => document.catalogDocumentId === "notes")?.path).toEqual([
      "迁移短篇",
      "其他文稿",
      "迁移备注"
    ]);
  });

  it("projects expert draft headings as unique section-writer navigation nodes", () => {
    const source = fixture();
    const draft = source.books[0]!.documents.find((document) => document.id === "draft")!;
    draft.content = [
      "## 雨夜来客",
      "",
      "林默在灯塔听见脚步。",
      "",
      "## 失踪名单",
      "",
      "名单最后一行写着他的名字。"
    ].join("\n");

    const projection = projectCatalogWorkspace(source);
    const book = projection.resourceSections[0]!.nodes[0]!;
    const draftNode = book.children!.find((node) => node.stageCategoryId === "draft")!;
    const draftDocument = projection.workspaceDocuments.find(
      (document) => document.workspaceId === book.id && document.stageId === "draft"
    )!;

    expect(draftNode.id).toBe(draftDocument.id);
    expect(draftNode.children?.map((node) => node.label)).toEqual([
      "雨夜来客",
      "失踪名单"
    ]);
    expect(new Set(draftNode.children?.map((node) => node.id)).size).toBe(2);
    expect(draftNode.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetDocumentId: draftDocument.id,
          shortAgentId: "expert_section_writer",
          expertSectionId: expect.any(String)
        })
      ])
    );
    expect(
      projection.workspaceDocuments.filter(
        (document) => document.workspaceId === book.id && document.stageId === "draft"
      )
    ).toHaveLength(1);
  });

  it("uses intro and first-section navigation defaults for an empty expert draft", () => {
    const source = fixture();
    const draft = source.books[0]!.documents.find((document) => document.id === "draft")!;
    draft.content = "  \n\n";

    const projection = projectCatalogWorkspace(source);
    const book = projection.resourceSections[0]!.nodes[0]!;
    const draftNode = book.children!.find((node) => node.stageCategoryId === "draft")!;
    const draftDocument = projection.workspaceDocuments.find(
      (document) => document.workspaceId === book.id && document.stageId === "draft"
    )!;

    expect(draftNode).toMatchObject({
      id: draftDocument.id,
      selectableBranch: true,
      shortAgentId: "expert_draft_coordinator"
    });
    expect(draftNode.children).toMatchObject([
      {
        label: "导语",
        targetDocumentId: draftDocument.id,
        shortAgentId: "expert_section_writer",
        expertSectionId: "intro"
      },
      {
        label: "第一节",
        targetDocumentId: draftDocument.id,
        shortAgentId: "expert_section_writer",
        expertSectionId: "section-1"
      }
    ]);
  });

  it("moves grouped material libraries out of their purpose categories", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);
    const materialSection = projection.resourceSections.find(
      (section) => section.id === "material"
    )!;
    const nodes = flattenNodes(materialSection.nodes);

    expect(materialSection.nodes.map((node) => node.label)).toEqual(["追妻素材套装"]);

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

    const plotCategory = materialSection.nodes.find((node) => node.label === "剧情");
    const otherCategory = materialSection.nodes.find((node) => node.label === "其他");
    expect(plotCategory).toBeUndefined();
    expect(otherCategory).toBeUndefined();
    expect(nodes.filter((node) => node.id === "material-plot")).toHaveLength(1);
    expect(nodes.filter((node) => node.id === "material-mixed")).toHaveLength(1);
    expect(nodes.some((node) => node.label === "世情")).toBe(false);
    expect(nodes.some((node) => node.label === "家庭")).toBe(false);
    expect(nodes.some((node) => node.label === "综合素材库")).toBe(false);
    expect(nodes.some((node) => node.catalogNodeType === "category" && node.stageCategoryId)).toBe(false);
    expect(nodes.some((node) => node.label === "剧情节拍" && node.stageCategoryId === "pacing")).toBe(true);
    expect(nodes.some((node) => node.label.includes("missing-material") && node.muted)).toBe(true);

    const entryDocuments = projection.workspaceDocuments.filter(
      (document) => document.domain === "material" && document.catalogEntryId
    );
    expect(entryDocuments).toHaveLength(
      source.materials.reduce((count, library) => count + library.entries.length, 0)
    );
    expect(entryDocuments.find((document) => document.catalogEntryId === "material-pacing")).toMatchObject({
      libraryId: "material-plot",
      materialKind: "plot",
      stageCategoryId: "pacing",
      parentGenre: "世情",
      subGenre: "家庭",
      content: "节拍正文"
    });
    expect(
      entryDocuments.find((document) => document.catalogEntryId === "material-pacing")?.path
    ).toContain("家庭");
  });

  it("shows skill groups directly and moves their libraries out of kind categories", () => {
    const source = fixture();
    const projection = projectCatalogWorkspace(source);
    const skillSection = projection.resourceSections.find((section) => section.id === "skill")!;
    const nodes = flattenNodes(skillSection.nodes);

    expect(skillSection.nodes.map((node) => node.label)).toEqual([
      "短篇技能套装",
      "剧情设计技能库"
    ]);
    expect(nodes.some((node) => node.label === "技能库分组")).toBe(false);
    expect(nodes.some((node) => node.label === "短篇技能套装" && node.catalogNodeType === "group")).toBe(true);
    expect(nodes.some((node) => node.label === "通用技能库" && node.skillKind === "general")).toBe(false);
    expect(nodes.some((node) => node.label === "人物方法" && node.stageCategoryId === "character_design")).toBe(true);
    expect(nodes.some((node) => node.label === "正文方法" && node.stageCategoryId === "draft")).toBe(true);
    expect(nodes.some((node) => node.label.includes("missing-skill") && node.muted)).toBe(true);

    const skillGroup = nodes.find(
      (node) => node.label === "短篇技能套装" && node.catalogNodeType === "group"
    );
    expect(skillGroup?.badge).toBeUndefined();
    expect(skillGroup?.children?.map((node) => node.label)).toEqual([
      "通用短篇技能",
      "已丢失的技能库（missing-skill）"
    ]);
    expect(skillGroup?.children?.map((node) => node.categoryTag)).toEqual(["通用", "文风"]);

    const generalKind = skillSection.nodes.find((node) => node.skillKind === "general");
    const plotKind = skillSection.nodes.find((node) => node.skillKind === "plot");
    const generalLibrary = skillGroup?.children?.find((node) => node.id === "skill-general");
    expect(generalKind).toBeUndefined();
    expect(plotKind?.children?.map((node) => node.id)).toEqual(["skill-plot"]);
    expect(nodes.filter((node) => node.id === "skill-general")).toHaveLength(1);
    expect(generalLibrary?.categoryTag).toBe("通用");
    expect(generalLibrary?.badge).toBeUndefined();
    expect(generalLibrary?.children?.map((node) => node.label)).toEqual([
      "库说明",
      "人物方法",
      "正文方法"
    ]);
    expect(generalLibrary?.children?.some((node) => node.catalogNodeType === "category")).toBe(false);

    const skillDocuments = projection.workspaceDocuments.filter(
      (document) => document.domain === "skill" && document.catalogEntryId
    );
    expect(skillDocuments).toHaveLength(
      source.skills.reduce((count, library) => count + library.entries.length, 0)
    );
    expect(skillDocuments[0]).toMatchObject({
      libraryId: "skill-general",
      skillKind: "general",
      stageCategoryId: "character_design",
      content: "人物技能正文"
    });
  });

  it("generates collision-free editor ids across books and libraries", () => {
    const projection = projectCatalogWorkspace(fixture());
    const ids = projection.workspaceDocuments.map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
