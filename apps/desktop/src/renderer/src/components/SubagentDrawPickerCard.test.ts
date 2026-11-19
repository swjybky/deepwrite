import { describe, expect, it } from "vitest";
import {
  drawCandidateLength,
  drawCandidateNumber,
  drawSelectionAnswers
} from "./subagentDrawCandidates";

describe("SubagentDrawPickerCard", () => {
  it("answers with one option id and a trimmed, optional note", () => {
    expect(drawSelectionAnswers("c2", "  短一点 ")).toEqual([
      { id: "draw", selectedOptionIds: ["c2"], text: "短一点" }
    ]);
    expect(drawSelectionAnswers("reject", "  ")).toEqual([
      { id: "draw", selectedOptionIds: ["reject"] }
    ]);
    expect(drawCandidateNumber({ index: 2 })).toBe(3);
    expect(drawCandidateLength("标题😀")).toBe(3);
  });
});
