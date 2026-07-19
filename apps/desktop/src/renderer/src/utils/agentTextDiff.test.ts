import { describe, expect, it } from "vitest";
import { buildAgentTextDiff } from "./agentTextDiff";

describe("buildAgentTextDiff", () => {
  it("returns an empty diff for identical text", () => {
    expect(buildAgentTextDiff("第一行\n第二行", "第一行\n第二行")).toEqual({
      additions: 0,
      deletions: 0,
      hunks: [],
      truncated: false
    });
  });

  it("builds a numbered replacement hunk with surrounding context", () => {
    const result = buildAgentTextDiff(
      "第一行\n旧内容\n第三行",
      "第一行\n新内容\n第三行",
      { contextLines: 1 }
    );

    expect(result).toMatchObject({ additions: 1, deletions: 1, truncated: false });
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toEqual({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { type: "context", text: "第一行", oldLineNumber: 1, newLineNumber: 1 },
        { type: "deletion", text: "旧内容", oldLineNumber: 2 },
        { type: "addition", text: "新内容", newLineNumber: 2 },
        { type: "context", text: "第三行", oldLineNumber: 3, newLineNumber: 3 }
      ]
    });
  });

  it("handles insertion into and deletion to empty text", () => {
    const insertion = buildAgentTextDiff("", "甲\n乙", { contextLines: 0 });
    expect(insertion).toMatchObject({ additions: 2, deletions: 0, truncated: false });
    expect(insertion.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
    expect(insertion.hunks[0]?.lines).toEqual([
      { type: "addition", text: "甲", newLineNumber: 1 },
      { type: "addition", text: "乙", newLineNumber: 2 }
    ]);

    const deletion = buildAgentTextDiff("甲\n乙", "", { contextLines: 0 });
    expect(deletion).toMatchObject({ additions: 0, deletions: 2, truncated: false });
    expect(deletion.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 });
    expect(deletion.hunks[0]?.lines).toEqual([
      { type: "deletion", text: "甲", oldLineNumber: 1 },
      { type: "deletion", text: "乙", oldLineNumber: 2 }
    ]);
  });

  it("creates separate hunks for distant changes", () => {
    const before = ["a", "old-b", "c", "d", "e", "f", "old-g", "h"].join("\n");
    const after = ["a", "new-b", "c", "d", "e", "f", "new-g", "h"].join("\n");
    const result = buildAgentTextDiff(before, after, { contextLines: 1 });

    expect(result.hunks).toHaveLength(2);
    expect(result.hunks.map((hunk) => [hunk.oldStart, hunk.newStart])).toEqual([
      [1, 1],
      [6, 6]
    ]);
    expect(result).toMatchObject({ additions: 2, deletions: 2, truncated: false });
  });

  it("merges hunk windows that touch", () => {
    const before = ["a", "old-b", "c", "d", "old-e", "f"].join("\n");
    const after = ["a", "new-b", "c", "d", "new-e", "f"].join("\n");
    const result = buildAgentTextDiff(before, after, { contextLines: 1 });

    expect(result.hunks).toHaveLength(1);
  });

  it("normalizes platform newlines", () => {
    expect(buildAgentTextDiff("甲\r\n乙\r\n丙", "甲\n乙\n丙")).toEqual({
      additions: 0,
      deletions: 0,
      hunks: [],
      truncated: false
    });
  });

  it("produces a stable minimal edit around repeated and moved lines", () => {
    const repeated = buildAgentTextDiff(
      "开头\n重复\n旧值\n重复\n结尾",
      "开头\n重复\n新值\n重复\n结尾",
      { contextLines: 1 }
    );
    expect(repeated).toMatchObject({ additions: 1, deletions: 1, truncated: false });

    const moved = buildAgentTextDiff("甲\n乙\n丙\n丁", "甲\n丙\n乙\n丁", {
      contextLines: 0
    });
    expect(moved).toMatchObject({ additions: 1, deletions: 1, truncated: false });
  });

  it("keeps global statistics while bounding rendered lines", () => {
    const before = Array.from({ length: 80 }, (_, index) => `旧-${index}`).join("\n");
    const after = Array.from({ length: 80 }, (_, index) => `新-${index}`).join("\n");
    const result = buildAgentTextDiff(before, after, {
      contextLines: 2,
      maxRenderedLines: 12
    });

    expect(result.additions).toBe(80);
    expect(result.deletions).toBe(80);
    expect(result.truncated).toBe(true);
    expect(result.hunks.reduce((count, hunk) => count + hunk.lines.length, 0)).toBeLessThanOrEqual(
      12
    );
    expect(result.hunks[0]?.lines[0]?.text).toBe("旧-0");
    expect(result.hunks.at(-1)?.lines.at(-1)?.text).toBe("新-79");
  });

  it("falls back safely for a high-distance long document", () => {
    const before = Array.from({ length: 1_100 }, (_, index) => `旧行-${index}`).join("\n");
    const after = Array.from({ length: 1_100 }, (_, index) => `新行-${index}`).join("\n");
    const result = buildAgentTextDiff(before, after, { maxRenderedLines: 20 });

    expect(result).toMatchObject({ additions: 1_100, deletions: 1_100, truncated: true });
    expect(result.hunks.reduce((count, hunk) => count + hunk.lines.length, 0)).toBeLessThanOrEqual(
      20
    );
  });

  it("clamps invalid rendering options", () => {
    const result = buildAgentTextDiff("旧", "新", {
      contextLines: Number.NaN,
      maxRenderedLines: -10
    });
    expect(result.hunks.reduce((count, hunk) => count + hunk.lines.length, 0)).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result).toMatchObject({ additions: 1, deletions: 1 });
  });
});
