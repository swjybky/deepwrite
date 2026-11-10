import { describe, expect, it } from "vitest";
import { revertJson } from "./restore-merge";

const item = (id: string, order: number, title = id) => ({ id, order, title });

describe("revertJson", () => {
  it("puts a deleted member back into its slot and renumbers positions", () => {
    const before = { items: [item("a", 1), item("b", 2), item("c", 3)] };
    const after = { items: [item("a", 1), item("c", 2)] };
    const current = { items: [item("a", 1), item("c", 2), item("d", 3)] };
    const { value, conflicts } = revertJson(current, before, after);
    expect(conflicts).toEqual([]);
    expect(value).toEqual({
      items: [item("a", 1), item("b", 2), item("c", 3), item("d", 4)]
    });
  });

  it("reports a field the batch changed that later work changed again", () => {
    const { conflicts, value } = revertJson(
      { title: "third" },
      { title: "first" },
      { title: "second" }
    );
    expect(conflicts).toHaveLength(1);
    expect(value).toEqual({ title: "third" });
  });

  it("removes members the batch created unless they were edited later", () => {
    const before = { items: [item("a", 1)] };
    const after = { items: [item("a", 1), item("n", 2)] };
    expect(revertJson(after, before, after)).toEqual({
      value: before,
      conflicts: []
    });
    const edited = { items: [item("a", 1), item("n", 2, "renamed")] };
    expect(revertJson(edited, before, after).conflicts).toHaveLength(1);
  });

  it("merges id lists member by member", () => {
    const { value, conflicts } = revertJson(
      { ids: ["a", "c", "z"] },
      { ids: ["a", "b", "c"] },
      { ids: ["a", "c"] }
    );
    expect(conflicts).toEqual([]);
    expect(value).toEqual({ ids: ["a", "b", "c", "z"] });
  });

  it("ignores write timestamps when deciding conflicts", () => {
    const { value, conflicts } = revertJson(
      { title: "after", updatedAt: "2026-11-07T02:00:00.000Z" },
      { title: "before", updatedAt: "2026-11-07T00:00:00.000Z" },
      { title: "after", updatedAt: "2026-11-07T01:00:00.000Z" }
    );
    expect(conflicts).toEqual([]);
    expect(value).toMatchObject({ title: "before" });
  });
});
