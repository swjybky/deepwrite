import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  captureWorkspaceDocumentBaselines,
  rebaseDraftsForMatchingDocuments
} from "./catalogSaveReconciliation";

function document(id: string, title: string, content: string): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title,
    eyebrow: "短篇 · 小节正文",
    path: ["书", "正文", title, "正文"],
    content,
    workspaceId: "book-1",
    workspaceType: "short",
    workspaceTitle: "书",
    stageId: "draft",
    draftFileKind: "body"
  };
}

function draft(content: string): EditorDraftState {
  return {
    title: "第一节",
    content,
    dirty: true,
    baseRevision: "old-base",
    baseProjectRevision: 3
  };
}

describe("catalog save reconciliation", () => {
  it("adopts the real project revision when the refreshed file matches the saved baseline", () => {
    const persisted = document("body-1", "第一节", "已保存正文");
    const expected = captureWorkspaceDocumentBaselines([persisted], "book-1");
    const result = rebaseDraftsForMatchingDocuments(
      { "body-1": draft("保存期间继续输入") },
      [persisted],
      "book-1",
      expected,
      11,
      "2026-07-22T10:00:00.000Z"
    );

    expect(result["body-1"]).toMatchObject({
      content: "保存期间继续输入",
      baseRevision: createShortWorkspaceContentRevision("已保存正文"),
      baseProjectRevision: 11
    });
  });

  it("retains the old base when another writer changed the file before refresh", () => {
    const saved = document("body-1", "第一节", "本次保存正文");
    const externallyChanged = document("body-1", "第一节", "外部更新正文");
    const originalDraft = draft("保存期间继续输入");
    const result = rebaseDraftsForMatchingDocuments(
      { "body-1": originalDraft },
      [externallyChanged],
      "book-1",
      captureWorkspaceDocumentBaselines([saved], "book-1"),
      12,
      "2026-07-22T10:00:00.000Z"
    );

    expect(result["body-1"]).toEqual(originalDraft);
  });
});
