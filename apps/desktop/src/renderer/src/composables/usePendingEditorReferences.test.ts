import { describe, expect, it, vi } from "vitest";
import { PROMPT_ATTACHMENT_MAX_ITEMS } from "@deepwrite/contracts";
import type { EditorTextReference } from "../types/conversation";
import { usePendingEditorReferences } from "./usePendingEditorReferences";

function reference(id: string, start = 0): EditorTextReference {
  return {
    id,
    resourceId: "long-book:chapter",
    documentId: "chapter-file",
    documentTitle: "第一章",
    documentPath: ["章节", "第一章"],
    text: `选区 ${id}`,
    start,
    end: start + id.length,
    startLine: 1,
    endLine: 1,
    label: "第一章 (1-1)"
  };
}

describe("pending editor references", () => {
  it("deduplicates the same range while allowing distinct selections", () => {
    const notifications = { info: vi.fn(), warning: vi.fn() };
    const collection = usePendingEditorReferences(notifications);
    const first = reference("one");

    collection.insertEditorReference(first);
    collection.insertEditorReference({ ...first, id: "duplicate" });
    collection.insertEditorReference(reference("two", 10));

    expect(collection.editorReferences.value).toHaveLength(2);
    expect(notifications.info).toHaveBeenCalledWith("这段正文已经插入输入框");
  });

  it("honors the shared per-message attachment limit", () => {
    const notifications = { info: vi.fn(), warning: vi.fn() };
    const collection = usePendingEditorReferences(notifications);
    for (let index = 0; index < PROMPT_ATTACHMENT_MAX_ITEMS + 1; index += 1) {
      collection.insertEditorReference(reference(String(index), index * 10));
    }

    expect(collection.editorReferences.value).toHaveLength(
      PROMPT_ATTACHMENT_MAX_ITEMS
    );
    expect(notifications.warning).toHaveBeenCalledOnce();
  });

  it("counts references already supplied by another selection source", () => {
    const notifications = { info: vi.fn(), warning: vi.fn() };
    const existing = Array.from(
      { length: PROMPT_ATTACHMENT_MAX_ITEMS },
      (_, index) => reference(`existing-${index}`, index * 10)
    );
    const collection = usePendingEditorReferences(notifications, {
      existingReferences: () => existing
    });

    collection.insertEditorReference(reference("conversation", 200));

    expect(collection.editorReferences.value).toHaveLength(0);
    expect(notifications.warning).toHaveBeenCalledOnce();
  });
});
