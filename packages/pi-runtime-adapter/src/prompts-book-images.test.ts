import { describe, expect, it } from "vitest";
import { buildEffectiveSystemPrompt } from "./prompts-system";
import { bookImagePreservationRule } from "./prompts-book-images";
import { composeExtrasSystemPrompt } from "./extras/definition";

describe("immutable illustration rules", () => {
  it("appends preservation after a custom main role in both languages", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const prompt = buildEffectiveSystemPrompt("Custom role", {
        runId: "run_image_boundary",
        sessionId: "session_image_boundary",
        prompt: "Edit this document",
        thinkingLevel: "off",
        promptLocale: locale
      });
      expect(prompt).toContain(bookImagePreservationRule(locale));
      expect(prompt.indexOf(bookImagePreservationRule(locale))).toBeGreaterThan(
        prompt.indexOf("Custom role")
      );
    }
  });

  it("keeps the rule after configurable extras role prompts", () => {
    const prompt = composeExtrasSystemPrompt("Custom extras role", "项目聊天", [
      "Read only"
    ]);
    expect(prompt.endsWith(bookImagePreservationRule())).toBe(true);
  });
});
