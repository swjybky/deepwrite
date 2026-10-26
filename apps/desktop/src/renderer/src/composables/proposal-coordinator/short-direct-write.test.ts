import { describe, expect, it } from "vitest";
import {
  shortAgentCheckedDocumentWrite,
  shortAgentDirectDocumentWrite
} from "./short-direct-write";

describe("short/script agent document writes", () => {
  it("forces structure-only writes that keep the current body", () => {
    const input = shortAgentDirectDocumentWrite({
      bookId: "book_direct",
      documentId: "document_direct",
      title: "第二节",
      content: "",
      preserveCurrentContent: true
    });

    expect(input).toEqual({
      bookId: "book_direct",
      documentId: "document_direct",
      title: "第二节",
      content: "",
      preserveCurrentContent: true,
      force: true
    });
    expect(input).not.toHaveProperty("baseRevision");
    expect(input).not.toHaveProperty("baseProjectRevision");
  });

  it("checks full-text proposals against this document only", () => {
    const input = shortAgentCheckedDocumentWrite(
      {
        bookId: "book_direct",
        documentId: "document_direct",
        content: "智能体完整修改稿"
      },
      "v1:3:0123abcd"
    );

    expect(input).toEqual({
      bookId: "book_direct",
      documentId: "document_direct",
      content: "智能体完整修改稿",
      baseRevision: "v1:3:0123abcd"
    });
    expect(input).not.toHaveProperty("force");
    expect(input).not.toHaveProperty("baseProjectRevision");
  });
});
