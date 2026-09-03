import { describe, expect, it } from "vitest";
import { shortAgentDirectDocumentWrite } from "./short-direct-write";

describe("short/script agent direct document writes", () => {
  it("forces the selected full-text write without version preconditions", () => {
    const input = shortAgentDirectDocumentWrite({
      bookId: "book_direct",
      documentId: "document_direct",
      title: "正文",
      content: "后一次完整写入"
    });

    expect(input).toEqual({
      bookId: "book_direct",
      documentId: "document_direct",
      title: "正文",
      content: "后一次完整写入",
      force: true
    });
    expect(input).not.toHaveProperty("baseRevision");
    expect(input).not.toHaveProperty("baseProjectRevision");
  });
});
