import { describe, expect, it } from "vitest";
import {
  activeRunResourceIds,
  hasActiveResourceRun
} from "./active-resource-runs";

describe("active resource runs", () => {
  it("blocks unknown and global runs, but allows an unrelated work", () => {
    expect(hasActiveResourceRun(0, new Set(["*"]), ["book-a"])).toBe(false);
    expect(hasActiveResourceRun(1, undefined, ["book-a"])).toBe(true);
    expect(hasActiveResourceRun(1, new Set(["*"]), ["book-a"])).toBe(true);
    expect(hasActiveResourceRun(1, new Set(["book-a"]))).toBe(true);
    expect(hasActiveResourceRun(1, new Set(["book-a"]), ["book-b"])).toBe(
      false
    );
    expect(hasActiveResourceRun(1, new Set(["book-a"]), ["book-a"])).toBe(true);
  });

  it("uses the Main-owned resources and conservatively marks unbound runs", () => {
    expect(
      activeRunResourceIds([
        { externalResourceIds: ["book-a", "library-b"], resourceId: "ignored" },
        { resourceId: "book-c" },
        {}
      ])
    ).toEqual(new Set(["book-a", "library-b", "book-c", "*"]));
  });
});
