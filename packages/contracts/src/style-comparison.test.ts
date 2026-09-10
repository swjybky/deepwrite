import { describe, expect, it } from "vitest";
import {
  SessionPromptCommandPayloadSchema,
  AgentPromptCommandPayloadSchema
} from "./session/commands";
import { WorkspaceRuntimeContextSchema } from "./session/runtime";
import {
  StyleComparisonInputSchema,
  StyleComparisonResultSchema
} from "./style-comparison";

const styleComparison = {
  referenceText: "雨停了。街上很静。",
  comparisonText: "风停了。屋里没有声音。",
  method: "重点比较节奏。"
};
describe("文风比对契约", () => {
  it("preserves both complete samples and instructions across the session and agent commands", () => {
    const request = {
      sessionId: "comparison-session",
      message: "比对文风",
      workspaceContext: { styleComparison }
    };
    expect(
      SessionPromptCommandPayloadSchema.parse(request).workspaceContext
        ?.styleComparison
    ).toEqual(styleComparison);
    expect(
      AgentPromptCommandPayloadSchema.parse(request).workspaceContext
        ?.styleComparison
    ).toEqual(styleComparison);
  });
  it("rejects missing, blank and oversized samples", () => {
    for (const referenceText of ["", "  ", "文".repeat(30_001)])
      expect(
        StyleComparisonInputSchema.safeParse({
          ...styleComparison,
          referenceText
        }).success
      ).toBe(false);
    expect(
      StyleComparisonInputSchema.safeParse({
        ...styleComparison,
        method: "文".repeat(8001)
      }).success
    ).toBe(false);
  });
  it("cannot combine comparison with a managed writing context", () => {
    expect(
      WorkspaceRuntimeContextSchema.safeParse({
        styleComparison,
        subagentAuthoring: {
          parentAgentId: "short",
          parentAgentLabel: "短篇",
          outputMode: "handoff",
          skills: [
            { id: "s", title: "节奏", libraryTitle: "写作", body: "短句" }
          ],
          existingSubagentNames: []
        }
      }).success
    ).toBe(false);
  });
  it("requires an actual bounded score and nonempty findings", () => {
    const result = {
      score: 70,
      summary: "节奏相近。",
      dimensions: ["措辞", "节奏", "语气"].map((name) => ({
        name,
        score: 70,
        reason: "都采用简短陈述句。"
      })),
      similarities: ["短句。"],
      differences: ["意象不同。"]
    };
    expect(StyleComparisonResultSchema.safeParse(result).success).toBe(true);
    for (const score of [undefined, "70", -1, 101, 70.5])
      expect(
        StyleComparisonResultSchema.safeParse({ ...result, score }).success
      ).toBe(false);
  });
});
