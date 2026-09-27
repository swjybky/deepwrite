import { describe, expect, it } from "vitest";
import { buildAnalysisRoundRanges } from "./plan-rounds";

describe("analysis round windows", () => {
  it("splits a whole book into 50-chapter windows", () => {
    const ranges = buildAnalysisRoundRanges(1, 120);
    expect(ranges).toEqual([
      { index: 0, startOrder: 1, endOrder: 50 },
      { index: 1, startOrder: 51, endOrder: 100 },
      { index: 2, startOrder: 101, endOrder: 120 }
    ]);
  });

  it("keeps the last window short when the count is not a multiple of 50", () => {
    const ranges = buildAnalysisRoundRanges(1, 1490);
    expect(ranges).toHaveLength(30);
    expect(ranges[29]).toEqual({
      index: 29,
      startOrder: 1451,
      endOrder: 1490
    });
    // Every window must stay within the pipeline's own single-run limit.
    for (const range of ranges) {
      expect(range.endOrder - range.startOrder + 1).toBeLessThanOrEqual(50);
    }
  });

  it("handles an exact multiple without an empty trailing window", () => {
    const ranges = buildAnalysisRoundRanges(1, 100);
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toEqual({ index: 1, startOrder: 51, endOrder: 100 });
  });

  it("covers a selection that starts mid-book", () => {
    expect(buildAnalysisRoundRanges(51, 60)).toEqual([
      { index: 0, startOrder: 51, endOrder: 60 }
    ]);
  });

  it("covers a selection that starts mid-book and does not divide evenly", () => {
    const ranges = buildAnalysisRoundRanges(5, 1000);
    expect(ranges).toHaveLength(20);
    expect(ranges[0]).toEqual({ index: 0, startOrder: 5, endOrder: 54 });
    expect(ranges[18]).toEqual({ index: 18, startOrder: 905, endOrder: 954 });
    expect(ranges[19]).toEqual({ index: 19, startOrder: 955, endOrder: 1000 });
    for (const range of ranges) {
      expect(range.endOrder - range.startOrder + 1).toBeLessThanOrEqual(50);
    }
  });

  it("returns nothing for an inverted range", () => {
    expect(buildAnalysisRoundRanges(60, 51)).toEqual([]);
  });
});
