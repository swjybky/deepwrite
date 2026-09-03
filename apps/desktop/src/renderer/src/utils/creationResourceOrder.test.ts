import { describe, expect, it } from "vitest";
import type { ResourceTreeSection } from "../types/workspace";
import {
  applyCreationResourceOrder,
  creationResourceIds,
  moveCreationResource,
  parseCreationResourceOrder,
  reconcileCreationResourceOrder
} from "./creationResourceOrder";
import {
  collectPinnedResourceNodes,
  excludePinnedResourceNodes
} from "./pinnedResources";

function sections(ids: readonly string[]): ResourceTreeSection[] {
  return [
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: ids.map((id) => ({
        id,
        label: id,
        icon: "book",
        catalogNodeType: id.startsWith("long-book:") ? "long-book" : "book"
      }))
    },
    { id: "skill", label: "技能库", icon: "library", nodes: [] }
  ];
}

describe("creation resource order", () => {
  it("parses a unique string order and ignores malformed storage", () => {
    expect(
      parseCreationResourceOrder('["short","long","short",3,"","   "]')
    ).toEqual(["short", "long"]);
    expect(parseCreationResourceOrder("not-json")).toEqual([]);
    expect(parseCreationResourceOrder('{"short":1}')).toEqual([]);
  });

  it("appends newly observed books and removes books that disappeared after being seen", () => {
    const initial = reconcileCreationResourceOrder(
      ["long-book:one", "short-one", "not-loaded-yet"],
      ["short-one", "long-book:one", "script-new"],
      new Set(["short-one", "long-book:one", "removed-book"])
    );

    expect(initial).toEqual([
      "long-book:one",
      "short-one",
      "not-loaded-yet",
      "script-new"
    ]);
  });

  it("moves mixed book types before or after a target without losing dormant ids", () => {
    const order = ["short-one", "dormant-long", "long-book:one", "script-one"];
    expect(
      moveCreationResource(order, {
        sourceId: "script-one",
        targetId: "short-one",
        position: "before"
      })
    ).toEqual(["script-one", "short-one", "dormant-long", "long-book:one"]);
    expect(
      moveCreationResource(order, {
        sourceId: "short-one",
        targetId: "script-one",
        position: "after"
      })
    ).toEqual(["dormant-long", "long-book:one", "script-one", "short-one"]);
  });

  it("keeps no-op drops stable and projects only the creation section", () => {
    const input = sections(["short-one", "long-book:one", "script-one"]);
    const noOp = moveCreationResource(
      ["short-one", "long-book:one", "script-one"],
      { sourceId: "short-one", targetId: "short-one", position: "after" }
    );
    expect(noOp).toEqual(["short-one", "long-book:one", "script-one"]);

    const projected = applyCreationResourceOrder(input, [
      "script-one",
      "short-one",
      "long-book:one"
    ]);
    expect(creationResourceIds(projected)).toEqual([
      "script-one",
      "short-one",
      "long-book:one"
    ]);
    expect(projected[1]).toBe(input[1]);
  });

  it("keeps unavailable books in their slots and restores an unpinned book to its manual position", () => {
    const input = sections(["short-one", "long-book:one", "script-one"]);
    input[0]!.nodes[1] = {
      ...input[0]!.nodes[1]!,
      unavailable: true
    };
    const ordered = applyCreationResourceOrder(input, [
      "script-one",
      "long-book:one",
      "short-one"
    ]);

    expect(creationResourceIds(ordered)).toEqual([
      "script-one",
      "long-book:one",
      "short-one"
    ]);
    expect(collectPinnedResourceNodes(ordered, ["script-one"])).toHaveLength(1);
    expect(
      creationResourceIds(excludePinnedResourceNodes(ordered, ["script-one"]))
    ).toEqual(["long-book:one", "short-one"]);
    expect(
      creationResourceIds(excludePinnedResourceNodes(ordered, []))
    ).toEqual(["script-one", "long-book:one", "short-one"]);
  });
});
