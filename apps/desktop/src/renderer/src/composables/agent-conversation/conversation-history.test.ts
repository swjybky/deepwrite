import { describe, expect, it } from "vitest";
import { compactConversationText } from "./conversation-history";

describe("conversation history preview", () => {
  it("preserves normalization, truncation and UTF-16 display semantics", () => {
    const texts = [
      "",
      " \t\n\u00a0\uFEFF ",
      "\n leading \t words \r\n trailing \n",
      "正文😀 \u2028\u2003 多段文字 😀末尾",
      "a".repeat(76),
      `${"a".repeat(76)} \n\t`,
      `${"a".repeat(76)} \n\t b`,
      "word ".repeat(400)
    ];
    for (const text of texts) {
      for (const limit of [1, 2, 3, 42, 76]) {
        const normalized = text.replace(/\s+/g, " ").trim();
        expect(compactConversationText(text, limit)).toBe(
          normalized.length > limit
            ? `${normalized.slice(0, limit - 1)}…`
            : normalized
        );
      }
    }
  });

  it("produces a bounded preview for a reply above the former item limit", () => {
    const value = `正文 ${"detail ".repeat(10 * 1024 * 1024)}`;
    expect(compactConversationText(value, 76)).toBe(`${value.slice(0, 75)}…`);
  });
});
