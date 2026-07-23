import { describe, expect, it } from "vitest";
import { createCatalogDraftDirectory, type ShortBook } from "@deepwrite/contracts";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { createShortManuscriptExportInput } from "./shortManuscriptExport";

const NOW = "2026-07-23T00:00:00.000Z";

function fixtureBook(): ShortBook {
  const draft = createCatalogDraftDirectory(NOW);
  draft.sections[0]!.body.content = "磁盘导语";
  draft.sections[0]!.characterState.content = "不应导出的人物状态";
  draft.sections[1]!.body.content = "磁盘第一节";
  return {
    id: "book-1",
    title: "雨夜来信",
    bookType: "short",
    genre: "悬疑",
    status: "editing",
    linkedMaterialIdsByKind: { character: [], gimmick: [], plot: [], draft: [], other: [] },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
    documents: [],
    draft,
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("short manuscript export projection", () => {
  it("keeps intro and section order, uses live body drafts, and excludes character state", () => {
    const book = fixtureBook();
    const documents: WorkspaceDocument[] = book.draft.sections.flatMap(
      (section, order) => [
        {
          id: `body-${order}`,
          domain: "creation",
          title: section.title,
          eyebrow: "短篇 · 小节正文",
          path: [book.title, "正文", section.title],
          content: section.body.content,
          workspaceId: book.id,
          workspaceType: "short",
          stageId: "draft",
          expertSectionId: section.id,
          expertSectionOrder: order,
          draftFileKind: "body",
          catalogDocumentId: section.body.id
        },
        {
          id: `state-${order}`,
          domain: "creation",
          title: section.characterState.title,
          eyebrow: "短篇 · 人物状态",
          path: [book.title, "正文", section.title, "人物状态"],
          content: section.characterState.content,
          workspaceId: book.id,
          workspaceType: "short",
          stageId: "draft",
          draftFileKind: "character-state",
          catalogDocumentId: section.characterState.id
        }
      ]
    );
    const editorDrafts: Record<string, EditorDraftState> = {
      "body-1": {
        title: "第一节 · 新标题",
        content: "编辑器中的最新第一节",
        dirty: true
      }
    };

    const result = createShortManuscriptExportInput(
      book,
      documents,
      editorDrafts,
      "docx"
    );

    expect(result).toEqual({
      title: "雨夜来信",
      format: "docx",
      sections: [
        { title: "导语", content: "磁盘导语" },
        { title: "第一节 · 新标题", content: "编辑器中的最新第一节" }
      ]
    });
    expect(JSON.stringify(result)).not.toContain("不应导出的人物状态");
  });
});
