import { describe, expect, it } from "vitest";
import "./academicBookProjection";
import {
  CatalogSnapshotSchema,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createDefaultAcademicFrameworkStages,
  createDefaultCreativePlotStages
} from "@deepwrite/contracts";
import {
  findProjectedDraftDirectoryForWorkspace,
  findProjectedResourceNode,
  projectCatalogWorkspace,
  resolveDraftSectionResourceId,
  resolvePreferredBookResourceId
} from "./catalogWorkspace";

const NOW = "2026-11-17T10:00:00.000Z";

function createAcademicSnapshot(options: { chaptered: boolean }) {
  const stages = createDefaultAcademicFrameworkStages();
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: createDefaultCreativePlotStages(),
    books: [
      {
        id: "acad-book-1",
        title: "多智能体协同论证框架研究",
        bookType: "academic",
        subtype: options.chaptered ? "thesis_dissertation" : "empirical_paper",
        citationStyle: options.chaptered ? "gbt7714" : "ieee",
        status: "editing",
        linkedMaterialIds: ["mat-lit"],
        linkedSkillIds: ["skill-method"],
        foundation: {
          thesisOverview: {
            id: "thesis_overview",
            title: "研究立意与核心贡献",
            content: "核心立意",
            createdAt: NOW,
            updatedAt: NOW
          },
          terminology: {
            id: "terminology",
            title: "术语与符号表",
            content: "符号表",
            createdAt: NOW,
            updatedAt: NOW
          },
          cards: [
            {
              id: "card-vaswani",
              citeKey: "vaswani2017",
              cardType: "literature",
              title: "Attention Is All You Need",
              document: {
                id: createAcademicCardDocumentId("card-vaswani"),
                title: "Attention Is All You Need",
                content: "Transformer architecture.",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            }
          ]
        },
        frameworkStages: stages.map((stage, idx) => ({
          ...stage,
          enabled: idx < 3
        })),
        documents: stages.map((stage) => ({
          id: stage.id,
          title: stage.title,
          content: `${stage.title}草稿`,
          createdAt: NOW,
          updatedAt: NOW
        })),
        manuscript: {
          id: "manuscript",
          title: "正文编写",
          chapters: options.chaptered
            ? [
                {
                  id: "ch-1",
                  title: "第一章 绪论",
                  createdAt: NOW,
                  updatedAt: NOW
                },
                {
                  id: "ch-2",
                  title: "第二章 方法",
                  createdAt: NOW,
                  updatedAt: NOW
                }
              ]
            : [],
          sections: options.chaptered
            ? [
                {
                  id: "abstract",
                  title: "中文摘要",
                  wordCountRequirement: "800 字",
                  brief: {
                    id: createAcademicSectionDocumentId("abstract", "brief"),
                    title: "中文摘要 · 写作指引",
                    content: "摘要写作指引",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  body: {
                    id: createAcademicSectionDocumentId("abstract", "body"),
                    title: "中文摘要",
                    content: "摘要正文",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  state: {
                    id: createAcademicSectionDocumentId("abstract", "state"),
                    title: "中文摘要 · 节末状态",
                    content: "摘要节末状态",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  createdAt: NOW,
                  updatedAt: NOW
                },
                {
                  id: "sec-1-1",
                  chapterId: "ch-1",
                  title: "1.1 研究背景",
                  wordCountRequirement: "2000 字",
                  brief: {
                    id: createAcademicSectionDocumentId("sec-1-1", "brief"),
                    title: "1.1 研究背景 · 写作指引",
                    content: "1.1 指引",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  body: {
                    id: createAcademicSectionDocumentId("sec-1-1", "body"),
                    title: "1.1 研究背景",
                    content: "1.1 正文",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  state: {
                    id: createAcademicSectionDocumentId("sec-1-1", "state"),
                    title: "1.1 研究背景 · 节末状态",
                    content: "1.1 状态",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  createdAt: NOW,
                  updatedAt: NOW
                },
                {
                  id: "references",
                  title: "参考文献",
                  wordCountRequirement: "",
                  brief: {
                    id: createAcademicSectionDocumentId("references", "brief"),
                    title: "参考文献 · 写作指引",
                    content: "",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  body: {
                    id: createAcademicSectionDocumentId("references", "body"),
                    title: "参考文献",
                    content: "[1] Vaswani et al.",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  state: {
                    id: createAcademicSectionDocumentId("references", "state"),
                    title: "参考文献 · 节末状态",
                    content: "",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  createdAt: NOW,
                  updatedAt: NOW
                }
              ]
            : [
                {
                  id: "sec-intro",
                  title: "1 引言",
                  wordCountRequirement: "1200 字",
                  brief: {
                    id: createAcademicSectionDocumentId("sec-intro", "brief"),
                    title: "1 引言 · 写作指引",
                    content: "引言指引",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  body: {
                    id: createAcademicSectionDocumentId("sec-intro", "body"),
                    title: "1 引言",
                    content: "引言正文",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  state: {
                    id: createAcademicSectionDocumentId("sec-intro", "state"),
                    title: "1 引言 · 节末状态",
                    content: "引言状态",
                    createdAt: NOW,
                    updatedAt: NOW
                  },
                  createdAt: NOW,
                  updatedAt: NOW
                }
              ],
          updatedAt: NOW
        },
        projectRevision: 3,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: NOW
  });
}

describe("academic workspace three-zone projection", () => {
  it("projects flat academic papers into Foundation, Framework, and flat Manuscript with 3 files per section", () => {
    const projection = projectCatalogWorkspace(
      createAcademicSnapshot({ chaptered: false })
    );
    const bookNode = projection.resourceSections[0]?.nodes[0];
    expect(bookNode).toMatchObject({
      id: "acad-book-1",
      workspaceType: "academic",
      academicSubtype: "empirical_paper",
      citationStyle: "ieee",
      boundMaterialLibraryIds: ["mat-lit"],
      boundSkillLibraryIds: ["skill-method"]
    });

    const zones = bookNode?.children ?? [];
    expect(zones.map((z) => z.academicZone)).toEqual([
      "foundation",
      "framework",
      "manuscript"
    ]);

    // Zone 1: thesis_overview, terminology, reference_cards folder
    const foundationChildren = zones[0]?.children ?? [];
    expect(foundationChildren).toHaveLength(3);
    const cardsFolder = foundationChildren[2];
    expect(cardsFolder?.academicCollection?.kind).toBe("reference-cards");
    expect(cardsFolder?.children?.[0]?.academicCardItem).toMatchObject({
      cardId: "card-vaswani",
      citeKey: "vaswani2017",
      cardType: "literature"
    });

    // Zone 2: only the 3 enabled framework stages appear in sidebar
    expect(zones[1]?.children).toHaveLength(3);

    // Zone 3: flat sections with brief/body/state projection
    const manuscriptZone = zones[2]!;
    expect(manuscriptZone.children?.map((n) => n.label)).toEqual(["1 引言"]);

    const directory = findProjectedDraftDirectoryForWorkspace(
      projection,
      "acad-book-1"
    )!;
    expect(directory.workspaceType).toBe("academic");
    const introProj = directory.sections[0]!;
    expect(introProj.briefDocumentId).toBeDefined();
    expect(introProj.bodyDocumentId).toBeDefined();
    expect(introProj.stateDocumentId).toBeDefined();

    const briefDoc = projection.index.workspaceDocumentById.get(
      introProj.briefDocumentId!
    );
    const bodyDoc = projection.index.workspaceDocumentById.get(
      introProj.bodyDocumentId
    );
    const stateDoc = projection.index.workspaceDocumentById.get(
      introProj.stateDocumentId!
    );
    expect(briefDoc?.draftFileKind).toBe("brief");
    expect(bodyDoc?.draftFileKind).toBe("body");
    expect(stateDoc?.draftFileKind).toBe("state");
    expect(
      resolvePreferredBookResourceId(projection, "acad-book-1")
    ).toBeTruthy();
  });

  it("projects chaptered dissertations with leading unchaptered sections, chapter folders, and trailing unchaptered sections", () => {
    const projection = projectCatalogWorkspace(
      createAcademicSnapshot({ chaptered: true })
    );
    const bookNode = findProjectedResourceNode(projection, "acad-book-1")!;
    const manuscriptZone = bookNode.children![2]!;
    const topLevelLabels = manuscriptZone.children?.map((n) => n.label) ?? [];

    expect(topLevelLabels).toEqual([
      "中文摘要",
      "第一章 绪论",
      "第二章 方法",
      "参考文献"
    ]);
    const chapter1 = manuscriptZone.children?.[1];
    expect(chapter1?.academicChapterItem?.chapterId).toBe("ch-1");
    expect(chapter1?.children?.map((n) => n.label)).toEqual(["1.1 研究背景"]);

    // Nested chapter section is still resolved by resolveDraftSectionResourceId!
    const nestedResourceId = resolveDraftSectionResourceId(
      manuscriptZone,
      "sec-1-1"
    );
    expect(nestedResourceId).toBe(chapter1?.children?.[0]?.id);
  });
});
