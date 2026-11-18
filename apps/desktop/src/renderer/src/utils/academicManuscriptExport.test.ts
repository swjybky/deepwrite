import { describe, expect, it } from "vitest";
import { createAcademicBookProjection } from "../data/academicBookProjection";
import type { AcademicBook } from "@deepwrite/contracts/renderer";
import {
  createAcademicManuscriptExportInput,
  listAcademicManuscriptExportTree
} from "./academicManuscriptExport";

const NOW = "2026-11-17T10:00:00.000Z";

function makeAcademicBook(): AcademicBook {
  return {
    id: "book-acad-1",
    bookType: "academic",
    title: "学位论文夹具",
    subtype: "thesis_dissertation",
    citationStyle: "gbt7714",
    status: "editing",
    linkedMaterialIds: [],
    linkedSkillIds: [],
    foundation: {
      thesisOverview: {
        id: "thesis_overview",
        title: "研究立意与核心贡献",
        content: "不可导出的立意笔记",
        createdAt: NOW,
        updatedAt: NOW
      },
      terminology: {
        id: "terminology",
        title: "术语与符号表",
        content: "不可导出的符号定义",
        createdAt: NOW,
        updatedAt: NOW
      },
      cards: []
    },
    frameworkStages: [
      {
        id: "problem_and_gap",
        title: "立题与文献脉络",
        description: "框架说明",
        enabled: true
      }
    ],
    documents: [
      {
        id: "problem_and_gap",
        title: "立题与文献脉络",
        content: "不可导出的框架文档",
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    manuscript: {
      chapters: [
        { id: "ch-1", title: "第一章 绪论", createdAt: NOW, updatedAt: NOW }
      ],
      sections: [
        {
          id: "abstract",
          title: "摘要",
          wordCountRequirement: "",
          brief: {
            id: "academic-section:abstract:brief",
            title: "摘要 · 写作指引",
            content: "摘要写作指引私有内容",
            createdAt: NOW,
            updatedAt: NOW
          },
          body: {
            id: "academic-section:abstract:body",
            title: "摘要",
            content: "这是正式摘要内容。",
            createdAt: NOW,
            updatedAt: NOW
          },
          state: {
            id: "academic-section:abstract:state",
            title: "摘要 · 节末状态",
            content: "摘要节末状态私有内容",
            createdAt: NOW,
            updatedAt: NOW
          },
          createdAt: NOW,
          updatedAt: NOW
        },
        {
          id: "sec-1",
          chapterId: "ch-1",
          title: "1.1 研究背景",
          wordCountRequirement: "2000字",
          brief: {
            id: "academic-section:sec-1:brief",
            title: "1.1 研究背景 · 写作指引",
            content: "严禁导出的指引",
            createdAt: NOW,
            updatedAt: NOW
          },
          body: {
            id: "academic-section:sec-1:body",
            title: "1.1 研究背景",
            content: "磁盘旧正文。",
            createdAt: NOW,
            updatedAt: NOW
          },
          state: {
            id: "academic-section:sec-1:state",
            title: "1.1 研究背景 · 节末状态",
            content: "严禁导出的状态",
            createdAt: NOW,
            updatedAt: NOW
          },
          createdAt: NOW,
          updatedAt: NOW
        },
        {
          id: "sec-empty",
          chapterId: "ch-1",
          title: "1.2 待写小节",
          wordCountRequirement: "",
          brief: {
            id: "academic-section:sec-empty:brief",
            title: "1.2 待写小节 · 写作指引",
            content: "只有指引没有正文",
            createdAt: NOW,
            updatedAt: NOW
          },
          body: {
            id: "academic-section:sec-empty:body",
            title: "1.2 待写小节",
            content: "   ",
            createdAt: NOW,
            updatedAt: NOW
          },
          state: {
            id: "academic-section:sec-empty:state",
            title: "1.2 待写小节 · 节末状态",
            content: "",
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
            id: "academic-section:references:brief",
            title: "参考文献 · 写作指引",
            content: "",
            createdAt: NOW,
            updatedAt: NOW
          },
          body: {
            id: "academic-section:references:body",
            title: "参考文献",
            content: "[1] Vaswani et al., 2017.",
            createdAt: NOW,
            updatedAt: NOW
          },
          state: {
            id: "academic-section:references:state",
            title: "参考文献 · 节末状态",
            content: "",
            createdAt: NOW,
            updatedAt: NOW
          },
          createdAt: NOW,
          updatedAt: NOW
        }
      ]
    },
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("academicManuscriptExport helpers", () => {
  it("checks only sections with non-empty body (including Abstract and References) and excludes brief/state", () => {
    const book = makeAcademicBook();
    const projection = createAcademicBookProjection(book);
    const sec1BodyDoc = projection.documents.find(
      (doc) => doc.catalogDocumentId === "academic-section:sec-1:body"
    )!;

    const drafts = {
      [sec1BodyDoc.id]: {
        title: "1.1 研究背景（修订）",
        content: "未保存的实时草稿正文。",
        dirty: true
      }
    };

    const tree = listAcademicManuscriptExportTree(
      book,
      projection.documents,
      drafts
    );
    expect(tree.hasChapters).toBe(true);
    expect(tree.defaultSelectedSectionIds).toEqual([
      "abstract",
      "sec-1",
      "references"
    ]);

    const input = createAcademicManuscriptExportInput(
      book,
      projection.documents,
      drafts,
      {
        sectionIds: tree.defaultSelectedSectionIds,
        includeChapterHeadings: true,
        format: "docx",
        imageMode: "assets_folder"
      }
    );

    expect(input.items).toEqual([
      {
        sectionTitle: "摘要",
        content: "这是正式摘要内容。"
      },
      {
        chapterId: "ch-1",
        chapterTitle: "第一章 绪论",
        sectionTitle: "1.1 研究背景（修订）",
        content: "未保存的实时草稿正文。"
      },
      {
        sectionTitle: "参考文献",
        content: "[1] Vaswani et al., 2017."
      }
    ]);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("严禁导出的指引");
    expect(serialized).not.toContain("严禁导出的状态");
    expect(serialized).not.toContain("不可导出的");
  });
});
