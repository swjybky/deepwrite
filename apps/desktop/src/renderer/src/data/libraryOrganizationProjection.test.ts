import { describe, expect, it } from "vitest";
import { emptyLibraryOrganization } from "@deepwrite/contracts/renderer";
import { orderLibraryNodes } from "./libraryOrganizationProjection";
import type { ResourceTreeNode } from "../types/workspace";

describe("library ordering projection", () => {
  it("uses library identity inside a group, preserves all siblings and annotates menu bounds", () => {
    const members: ResourceTreeNode[] = ["a", "b"].map((id) => ({
      id,
      label: id,
      catalogNodeType: "library",
      libraryId: id,
      groupId: "group"
    }));
    const nodes: ResourceTreeNode[] = [
      {
        id: "group-row",
        label: "组",
        catalogNodeType: "group",
        groupId: "group",
        children: members
      },
      { id: "c", label: "库", catalogNodeType: "library", libraryId: "c" }
    ];
    const organization = {
      ...emptyLibraryOrganization(),
      skill: ["c", "group"],
      groups: { group: ["b", "a"] }
    };
    const result = orderLibraryNodes(nodes, "skill", organization);
    expect(result.map((node) => node.id)).toEqual(["c", "group-row"]);
    expect(result[1]?.children?.map((node) => node.id)).toEqual(["b", "a"]);
    expect(result[1]?.children?.[0]).toMatchObject({
      canMoveLibraryUp: false,
      canMoveLibraryDown: true
    });
    expect(result[1]?.children?.[1]).toMatchObject({
      canMoveLibraryUp: true,
      canMoveLibraryDown: false
    });
  });
});
