import { describe, expect, it } from "vitest";
import { PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH } from "@deepwrite/contracts";
import { readPromptAttachment } from "./promptAttachments";

describe("prompt attachments", () => {
  it("reads markdown as user-message text context", async () => {
    const result = await readPromptAttachment(
      new File(["# 场景笔记\n雨夜需要更压抑。"], "notes.md", { type: "text/markdown" })
    );

    expect(result.attachment).toMatchObject({
      kind: "text",
      name: "notes.md",
      mediaType: "text/markdown",
      content: "# 场景笔记\n雨夜需要更压抑。"
    });
  });

  it("encodes supported images for multimodal model input", async () => {
    const result = await readPromptAttachment(
      new File([new Uint8Array([1, 2, 3])], "reference.png", { type: "image/png" })
    );

    expect(result.attachment).toMatchObject({
      kind: "image",
      name: "reference.png",
      mediaType: "image/png",
      data: "AQID"
    });
  });

  it("marks extracted text that exceeds the per-file context limit", async () => {
    const result = await readPromptAttachment(
      new File(["字".repeat(PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH + 1)], "long.txt", {
        type: "text/plain"
      })
    );

    expect(result.attachment).toMatchObject({
      kind: "text",
      truncated: true,
      originalLength: PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH + 1
    });
    expect(result.warning).toContain("仅携带前");
  });

  it("rejects unsupported files with an actionable message", async () => {
    await expect(
      readPromptAttachment(new File(["{}"], "data.json", { type: "application/json" }))
    ).rejects.toThrow("TXT、MD、PDF 或常见图片");
  });
});
