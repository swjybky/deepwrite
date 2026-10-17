import { describe, expect, it } from "vitest";
import {
  LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE,
  longManuscriptNavigationPageCount,
  longManuscriptNavigationPageForIndex,
  longManuscriptNavigationPageSlice
} from "./longManuscriptNavigationPagination";

describe("long manuscript navigation pagination", () => {
  it("keeps a large navigation bounded to one page of items", () => {
    const items = Array.from({ length: 301 }, (_, index) => index);
    expect(longManuscriptNavigationPageCount(items.length)).toBe(7);
    expect(longManuscriptNavigationPageSlice(items, 1)).toHaveLength(
      LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE
    );
    expect(longManuscriptNavigationPageSlice(items, 7)).toEqual([300]);
  });

  it("maps the active item to its page", () => {
    expect(longManuscriptNavigationPageForIndex(0)).toBe(1);
    expect(longManuscriptNavigationPageForIndex(49)).toBe(1);
    expect(longManuscriptNavigationPageForIndex(50)).toBe(2);
    expect(longManuscriptNavigationPageForIndex(-1)).toBe(1);
  });

  it("clamps invalid pages to the first page", () => {
    expect(longManuscriptNavigationPageSlice(["a", "b"], 0)).toEqual([
      "a",
      "b"
    ]);
  });
});
