import { describe, expect, it } from "vitest";
import { PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH } from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";
import {
  createConversationTextReference,
  createEditorReferenceAttachment,
  createEditorTextReference,
  createRenderedEditorTextReference,
  resolveEditorTextReferenceRange
} from "./editorTextReferences";

const document: WorkspaceDocument = {
  id: "document-1",
  domain: "creation",
  title: "拒绝信",
  eyebrow: "短篇 · 正文",
  path: ["测试书籍", "正文", "拒绝信"],
  content: "第一行\n第二行\n第三行\n第四行"
};

describe("editor text references", () => {
  it("captures selected text with an inclusive line range", () => {
    const start = document.content.indexOf("第二行");
    const end = document.content.indexOf("第四行");
    const reference = createEditorTextReference({
      id: "selection-1",
      resourceId: "resource-1",
      document,
      start,
      end
    });

    expect(reference).toMatchObject({
      text: "第二行\n第三行\n",
      startLine: 2,
      endLine: 3,
      label: "拒绝信 (2-3)"
    });
  });

  it("relocates a reference to the closest matching text after earlier edits", () => {
    const start = document.content.indexOf("第二行");
    const reference = createEditorTextReference({
      id: "selection-2",
      resourceId: "resource-1",
      document,
      start,
      end: start + "第二行".length
    })!;
    const changed = `新增开头\n${document.content}\n第二行`;

    expect(resolveEditorTextReferenceRange(changed, reference)).toEqual({
      start: changed.indexOf("第二行"),
      end: changed.indexOf("第二行") + "第二行".length
    });
  });

  it("turns the reference into a bounded prompt attachment", () => {
    const longDocument = {
      ...document,
      content: "字".repeat(PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH + 5)
    };
    const reference = createEditorTextReference({
      id: "selection-3",
      resourceId: "resource-1",
      document: longDocument,
      start: 0,
      end: longDocument.content.length
    })!;

    const attachment = createEditorReferenceAttachment(reference);
    expect(attachment).toMatchObject({
      id: "editor_reference_selection-3",
      kind: "text",
      name: "拒绝信 (1-1)",
      truncated: true,
      originalLength: PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH + 5
    });
    expect(attachment.kind === "text" && attachment.content).toHaveLength(
      PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH
    );
  });

  it("captures an assistant response selection as a prompt reference", () => {
    const reference = createConversationTextReference({
      id: "conversation-selection-1",
      sessionId: "session-1",
      messageId: "message-1",
      messageLabel: "智能体回复 1",
      text: "第一行\n第二行"
    });

    expect(reference).toMatchObject({
      source: "conversation",
      conversationMessageId: "message-1",
      documentId: "conversation:session-1:message-1",
      documentPath: ["智能体对话", "智能体回复 1"],
      text: "第一行\n第二行",
      startLine: 1,
      endLine: 2,
      label: "智能体回复 1 (1-2)"
    });
    expect(createEditorReferenceAttachment(reference!)).toMatchObject({
      kind: "text",
      name: "智能体回复 1 (1-2)",
      content: "第一行\n第二行"
    });
  });

  it("maps rendered preview text back to its Markdown source", () => {
    const previewDocument = {
      ...document,
      content: "# 标题\n\n这是需要引用的正文。"
    };
    const reference = createRenderedEditorTextReference({
      id: "preview-selection-1",
      resourceId: "resource-1",
      document: previewDocument,
      text: "这是需要引用的正文。"
    });

    expect(reference).toMatchObject({
      source: "editor",
      text: "这是需要引用的正文。",
      start: previewDocument.content.indexOf("这是需要引用的正文。"),
      startLine: 3,
      endLine: 3
    });
  });
});
