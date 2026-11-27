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
    expect(result.map((node) => node.id)).toEqual(["group-row", "c"]);
    expect(result[0]?.children?.map((node) => node.id)).toEqual(["b", "a"]);
    expect(result[0]?.children?.[0]).toMatchObject({
      canMoveLibraryUp: false,
      canMoveLibraryDown: true
    });
    expect(result[0]?.children?.[1]).toMatchObject({
      canMoveLibraryUp: true,
      canMoveLibraryDown: false
    });
  });

  it("keeps groups above libraries and limits move bounds to the same kind", () => {
    const nodes: ResourceTreeNode[] = [
      {
        id: "lib1",
        label: "库1",
        catalogNodeType: "library",
        libraryId: "lib1"
      },
      { id: "g1", label: "组1", catalogNodeType: "group", groupId: "g1" },
      {
        id: "lib2",
        label: "库2",
        catalogNodeType: "library",
        libraryId: "lib2"
      },
      { id: "g2", label: "组2", catalogNodeType: "group", groupId: "g2" }
    ];
    const organization = {
      ...emptyLibraryOrganization(),
      material: ["lib1", "g1", "lib2", "g2"]
    };
    const result = orderLibraryNodes(nodes, "material", organization);
    expect(result.map((node) => node.id)).toEqual(["g1", "g2", "lib1", "lib2"]);
    expect(result.map((node) => node.canMoveLibraryUp)).toEqual([
      false,
      true,
      false,
      true
    ]);
    expect(result.map((node) => node.canMoveLibraryDown)).toEqual([
      true,
      false,
      true,
      false
    ]);
  });
});
