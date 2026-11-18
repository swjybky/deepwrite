import { describe, expect, it } from "vitest";
import {
  ACADEMIC_BOOK_SUBTYPES,
  ACADEMIC_CITATION_STYLES,
  CurrentAcademicBookProjectManifestSchema,
  AcademicBookSchema,
  AcademicBookTemplateDraftSchema,
  AcademicCiteKeySchema,
  BookTemplateDraftSchema,
  CatalogIndexSnapshotSchema,
  CatalogSnapshotSchema,
  academicCitationStyleRequirements,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createDefaultAcademicFrameworkStages,
  createDefaultCreativePlotStages,
  getAcademicSubtypePreset,
  parseAcademicCardDocumentId,
  parseAcademicSectionDocumentId
} from "./index";

const NOW = "2026-11-17T10:00:00.000Z";

describe("academic book contracts & citation style rules", () => {
  it("builds non-editable citation & bibliography rules for all styles in zh-CN and en-US", () => {
    for (const style of ACADEMIC_CITATION_STYLES) {
      const zh = academicCitationStyleRequirements(style, "zh-CN");
      const en = academicCitationStyleRequirements(style, "en-US");
      expect(zh.length).toBeGreaterThan(20);
      expect(en.length).toBeGreaterThan(20);
    }
    expect(academicCitationStyleRequirements("gbt7714", "zh-CN")).toContain(
      "GB/T 7714"
    );
    expect(academicCitationStyleRequirements("apa", "en-US")).toContain("APA");
    expect(academicCitationStyleRequirements("latex", "zh-CN")).toContain(
      "\\cite{citeKey}"
    );
  });

  it("provides subtype presets covering flat papers and chaptered dissertations", () => {
    for (const subtype of ACADEMIC_BOOK_SUBTYPES) {
      const preset = getAcademicSubtypePreset(subtype);
      expect(preset.subtype).toBe(subtype);
      expect(preset.enabledStageIds.length).toBeGreaterThanOrEqual(1);
      expect(preset.sections.length).toBeGreaterThanOrEqual(1);
    }

    const empirical = getAcademicSubtypePreset("empirical_paper");
    expect(empirical.chaptered).toBe(false);
    expect(empirical.chapters).toEqual([]);
    expect(empirical.defaultCitationStyle).toBe("ieee");
    expect(empirical.sections.at(-1)?.title).toBe("参考文献");

    const thesis = getAcademicSubtypePreset("thesis_dissertation");
    expect(thesis.chaptered).toBe(true);
    expect(thesis.chapters.length).toBeGreaterThanOrEqual(3);
    expect(thesis.sections.some((section) => Boolean(section.chapterId))).toBe(
      true
    );
    expect(thesis.sections.at(-1)?.title).toBe("参考文献");

    const report = getAcademicSubtypePreset("tech_report_article");
    expect(report.defaultCitationStyle).toBe("none");
    expect(
      report.sections.some((section) => section.title === "参考文献")
    ).toBe(false);
  });

  it("validates citeKey format and round-trips document ID helpers", () => {
    expect(
      AcademicCiteKeySchema.safeParse("vaswani2017_attn-1:v2").success
    ).toBe(true);
    expect(AcademicCiteKeySchema.safeParse("bad space").success).toBe(false);
    expect(AcademicCiteKeySchema.safeParse("中文键").success).toBe(false);

    const cardDocId = createAcademicCardDocumentId("card-1");
    expect(parseAcademicCardDocumentId(cardDocId)).toEqual({
      cardId: "card-1"
    });
    expect(parseAcademicSectionDocumentId(cardDocId)).toBeUndefined();

    for (const fileKind of ["brief", "body", "state"] as const) {
      const docId = createAcademicSectionDocumentId("sec-intro", fileKind);
      expect(parseAcademicSectionDocumentId(docId)).toEqual({
        sectionId: "sec-intro",
        fileKind
      });
    }
  });

  it("enforces unique citeKeys, matching stage documents, and valid chapter references on AcademicBookSchema", () => {
    const stages = createDefaultAcademicFrameworkStages();
    const validBook = AcademicBookSchema.parse({
      id: "book-acad-1",
      title: "端到端长上下文推理研究",
      bookType: "academic",
      subtype: "empirical_paper",
      citationStyle: "ieee",
      status: "editing",
      linkedMaterialIds: ["mat-1"],
      linkedSkillIds: ["skill-1"],
      foundation: {
        thesisOverview: {
          id: "thesis_overview",
          title: "研究立意与核心贡献",
          content: "核心假设",
          createdAt: NOW,
          updatedAt: NOW
        },
        terminology: {
          id: "terminology",
          title: "术语与符号表",
          content: "| 符号 | 含义 |",
          createdAt: NOW,
          updatedAt: NOW
        },
        cards: [
          {
            id: "card-1",
            citeKey: "vaswani2017",
            cardType: "literature",
            title: "Attention Is All You Need",
            document: {
              id: createAcademicCardDocumentId("card-1"),
              title: "Attention Is All You Need",
              content: "Verified Transformer paper.",
              createdAt: NOW,
              updatedAt: NOW
            },
            createdAt: NOW,
            updatedAt: NOW
          }
        ]
      },
      frameworkStages: stages,
      documents: stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        content: "",
        createdAt: NOW,
        updatedAt: NOW
      })),
      manuscript: {
        id: "manuscript",
        title: "正文编写",
        chapters: [
          { id: "ch-1", title: "第一章 绪论", createdAt: NOW, updatedAt: NOW }
        ],
        sections: [
          {
            id: "sec-1",
            chapterId: "ch-1",
            title: "1.1 研究背景",
            wordCountRequirement: "1500 字",
            brief: {
              id: createAcademicSectionDocumentId("sec-1", "brief"),
              title: "1.1 研究背景 · 写作指引",
              content: "必引 [vaswani2017]",
              createdAt: NOW,
              updatedAt: NOW
            },
            body: {
              id: createAcademicSectionDocumentId("sec-1", "body"),
              title: "1.1 研究背景",
              content: "正文内容",
              createdAt: NOW,
              updatedAt: NOW
            },
            state: {
              id: createAcademicSectionDocumentId("sec-1", "state"),
              title: "1.1 研究背景 · 节末状态",
              content: "已定义符号",
              createdAt: NOW,
              updatedAt: NOW
            },
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        updatedAt: NOW
      },
      projectRevision: 1,
      createdAt: NOW,
      updatedAt: NOW
    });

    expect(validBook.bookType).toBe("academic");

    // Duplicate citeKey (case-insensitive) must fail validation
    const duplicateKeyResult = AcademicBookSchema.safeParse({
      ...validBook,
      foundation: {
        ...validBook.foundation,
        cards: [
          ...validBook.foundation.cards,
          {
            id: "card-2",
            citeKey: "VASWANI2017",
            cardType: "evidence",
            title: "Duplicate Key",
            document: {
              id: createAcademicCardDocumentId("card-2"),
              title: "Duplicate Key",
              content: "",
              createdAt: NOW,
              updatedAt: NOW
            },
            createdAt: NOW,
            updatedAt: NOW
          }
        ]
      }
    });
    expect(duplicateKeyResult.success).toBe(false);

    // Coexists cleanly inside CatalogSnapshotSchema & CatalogIndexSnapshotSchema without touching creativePlotStages
    const snapshot = CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      creativePlotStages: createDefaultCreativePlotStages(),
      books: [validBook],
      materials: [],
      materialGroups: [],
      skills: [],
      skillGroups: [],
      updatedAt: NOW
    });
    expect(snapshot.books[0]?.bookType).toBe("academic");

    const stamp = "fs-v1:12:1:1";
    const indexSnapshot = CatalogIndexSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      creativePlotStages: createDefaultCreativePlotStages(),
      books: [
        {
          ...validBook,
          foundation: {
            thesisOverview: {
              id: "thesis_overview",
              title: "研究立意与核心贡献",
              content: "",
              contentBytes: 12,
              contentStamp: stamp,
              createdAt: NOW,
              updatedAt: NOW
            },
            terminology: {
              id: "terminology",
              title: "术语与符号表",
              content: "",
              contentBytes: 16,
              contentStamp: stamp,
              createdAt: NOW,
              updatedAt: NOW
            },
            cards: validBook.foundation.cards.map((card) => ({
              ...card,
              document: {
                ...card.document,
                content: "",
                contentBytes: 28,
                contentStamp: stamp
              }
            }))
          },
          documents: validBook.documents.map((doc) => ({
            ...doc,
            content: "",
            contentBytes: 0,
            contentStamp: stamp
          })),
          manuscript: {
            ...validBook.manuscript,
            sections: validBook.manuscript.sections.map((section) => ({
              ...section,
              brief: {
                ...section.brief,
                content: "",
                contentBytes: 20,
                contentStamp: stamp
              },
              body: {
                ...section.body,
                content: "",
                contentBytes: 12,
                contentStamp: stamp
              },
              state: {
                ...section.state,
                content: "",
                contentBytes: 15,
                contentStamp: stamp
              }
            }))
          }
        }
      ],
      materials: [],
      materialGroups: [],
      skills: [],
      skillGroups: [],
      updatedAt: NOW
    });
    expect(indexSnapshot.books[0]?.bookType).toBe("academic");
  });

  it("parses schemaVersion 4 academic manifest and academic book template draft", () => {
    const stages = createDefaultAcademicFrameworkStages();
    const manifest = CurrentAcademicBookProjectManifestSchema.parse({
      kind: "deepwrite.book",
      schemaVersion: 4,
      revision: 1,
      id: "book-manifest-acad",
      title: "学位论文项目",
      bookType: "academic",
      subtype: "thesis_dissertation",
      citationStyle: "gbt7714",
      status: "editing",
      linkedMaterialIds: [],
      linkedSkillIds: [],
      foundation: {
        thesisOverview: {
          id: "thesis_overview",
          title: "研究立意与核心贡献",
          path: "foundation/thesis-overview.md",
          createdAt: NOW,
          updatedAt: NOW
        },
        terminology: {
          id: "terminology",
          title: "术语与符号表",
          path: "foundation/terminology.md",
          createdAt: NOW,
          updatedAt: NOW
        },
        cards: []
      },
      frameworkStages: stages,
      documents: stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        path: `framework/${stage.id}.md`,
        createdAt: NOW,
        updatedAt: NOW
      })),
      manuscript: {
        chapters: [
          { id: "ch-1", title: "第一章 绪论", createdAt: NOW, updatedAt: NOW }
        ],
        sections: [
          {
            id: "sec-1",
            chapterId: "ch-1",
            title: "1.1 引言",
            wordCountRequirement: "",
            brief: {
              id: createAcademicSectionDocumentId("sec-1", "brief"),
              title: "1.1 引言 · 写作指引",
              path: "manuscript/sections/sec-1-brief.md",
              createdAt: NOW,
              updatedAt: NOW
            },
            body: {
              id: createAcademicSectionDocumentId("sec-1", "body"),
              title: "1.1 引言",
              path: "manuscript/sections/sec-1-body.md",
              createdAt: NOW,
              updatedAt: NOW
            },
            state: {
              id: createAcademicSectionDocumentId("sec-1", "state"),
              title: "1.1 引言 · 节末状态",
              path: "manuscript/sections/sec-1-state.md",
              createdAt: NOW,
              updatedAt: NOW
            },
            createdAt: NOW,
            updatedAt: NOW
          }
        ]
      },
      writeReceipts: [],
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(manifest.schemaVersion).toBe(4);

    const template = BookTemplateDraftSchema.parse(
      AcademicBookTemplateDraftSchema.parse({
        name: "CCF-A 实证论文模板",
        workspaceType: "academic",
        subtype: "empirical_paper",
        citationStyle: "ieee",
        defaultFrameworkStageIds: ["problem_and_gap", "method_framework"],
        linkedMaterialIds: ["mat-papers"],
        linkedSkillIds: ["skill-academic"]
      })
    );
    expect(template.workspaceType).toBe("academic");
  });
});
