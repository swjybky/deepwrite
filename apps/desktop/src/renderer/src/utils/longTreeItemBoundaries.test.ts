import { expect, it } from "vitest";
import type {
  LongTreeCollectionKind,
  ResourceTreeNode
} from "../types/workspace";
import { createLongTreeItemBoundaries } from "./longTreeItemBoundaries";

function node(id: string, kind?: LongTreeCollectionKind): ResourceTreeNode {
  return { id, label: id, ...(kind ? { longTreeItem: { kind, id } } : {}) };
}

it("keeps first and last boundaries per kind, including singleton and interleaved groups", () => {
  const boundaries = createLongTreeItemBoundaries([
    node("ignored"),
    node("point-a", "plot-point"),
    node("character-a", "character"),
    node("point-b", "plot-point"),
    node("volume-a", "volume"),
    node("point-c", "plot-point"),
    node("character-b", "character")
  ]);
  expect([...boundaries]).toEqual([
    ["point-a", { first: true, last: false }],
    ["point-c", { first: false, last: true }],
    ["character-a", { first: true, last: false }],
    ["character-b", { first: false, last: true }],
    ["volume-a", { first: true, last: true }]
  ]);
  expect(boundaries.has("point-b")).toBe(false);
  expect(createLongTreeItemBoundaries([]).size).toBe(0);
});

it("does not copy accumulated sibling-id arrays when indexing a large parent", () => {
  const count = 1000;
  const children = Array.from({ length: count }, (_, index) =>
    node(`boundary-test-${index}`, "plot-point")
  );
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator
  )!;
  let copiedIds = 0;
  // Count ids visited by array spreads without relying on wall-clock timing.
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    ...descriptor,
    value: function* (this: unknown[]) {
      for (let index = 0; index < this.length; index += 1) {
        const value = this[index];
        if (typeof value === "string" && value.startsWith("boundary-test-"))
          copiedIds += 1;
        yield value;
      }
    }
  });
  let boundaries: ReturnType<typeof createLongTreeItemBoundaries>;
  try {
    boundaries = createLongTreeItemBoundaries(children);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
  expect(copiedIds).toBeLessThan(count * 3);
  expect(boundaries!.size).toBe(2);
  expect(boundaries!.get("boundary-test-0")).toEqual({
    first: true,
    last: false
  });
  expect(boundaries!.get(`boundary-test-${count - 1}`)).toEqual({
    first: false,
    last: true
  });
});
