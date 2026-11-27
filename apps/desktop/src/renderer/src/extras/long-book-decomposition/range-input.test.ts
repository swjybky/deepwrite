import { describe, expect, it } from "vitest";
import {
  normalizeChapterRange,
  syncDecompositionChapterRange
} from "./range-input";

describe("normalizeChapterRange", () => {
  it("clamps typed values into the book", () => {
    expect(normalizeChapterRange({ start: 0, end: 5000 }, 1200, "end")).toEqual(
      { start: 1, end: 1200 }
    );
    expect(
      normalizeChapterRange({ start: 3.6, end: 9 }, 1200, "start")
    ).toEqual({ start: 4, end: 9 });
  });

  it("falls back to the first chapter for empty or invalid input", () => {
    expect(
      normalizeChapterRange({ start: "", end: "abc" }, 50, "start")
    ).toEqual({ start: 1, end: 1 });
  });

  it("moves the opposite side so the pair stays ordered", () => {
    expect(normalizeChapterRange({ start: 40, end: 10 }, 100, "start")).toEqual(
      {
        start: 40,
        end: 40
      }
    );
    expect(normalizeChapterRange({ start: 40, end: 10 }, 100, "end")).toEqual({
      start: 10,
      end: 10
    });
  });

  it("tolerates an empty book", () => {
    expect(normalizeChapterRange({ start: 5, end: 9 }, 0, "end")).toEqual({
      start: 1,
      end: 1
    });
  });

  it("syncs range on chapter merge, undo, custom sub-range, and source switch", () => {
    expect(syncDecompositionChapterRange({ start: 2, end: 5 }, 16)).toEqual({
      start: 1,
      end: 16
    });
    expect(
      syncDecompositionChapterRange({ start: 1, end: 16 }, 15, 16)
    ).toEqual({
      start: 1,
      end: 15
    });
    expect(
      syncDecompositionChapterRange({ start: 1, end: 15 }, 16, 15)
    ).toEqual({
      start: 1,
      end: 16
    });
    expect(
      syncDecompositionChapterRange({ start: 1, end: 10 }, 15, 16)
    ).toEqual({
      start: 1,
      end: 10
    });
    expect(
      syncDecompositionChapterRange({ start: 1, end: 10 }, 16, 15)
    ).toEqual({
      start: 1,
      end: 10
    });
  });
});
