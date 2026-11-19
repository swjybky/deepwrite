import { describe, expect, it } from "vitest";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";
import {
  createResourceTreeLookup,
  resourceTreeOwnerId
} from "./resourceTreeLookup";

describe("resource tree lookup", () => {
  it("indexes nested resources and their body/state documents", () => {
    const sections: ResourceTreeSection[] = [
      {
        id: "creation",
        label: "创作空间",
        icon: "book",
        nodes: [
          {
            id: "draft-directory",
            label: "正文",
            icon: "folder",
            shortAgentId: "short",
            stageCategoryId: "draft",
            children: [
              {
                id: "draft-section",
                label: "第一节",
                icon: "file",
                targetDocumentId: "body-document",
                characterStateDocumentId: "state-document"
              }
            ]
          }
        ]
      }
    ];

    const lookup = createResourceTreeLookup(sections);
    expect(lookup.nodeById.get("draft-section")?.label).toBe("第一节");
    expect(lookup.resourceIdByDocumentId.get("body-document")).toBe(
      "draft-section"
    );
    expect(lookup.resourceIdByDocumentId.get("state-document")).toBe(
      "draft-section"
    );
    expect(lookup.targetDocumentIdByResourceId.get("draft-directory")).toBe(
      "body-document"
    );
  });

  it("keeps the first visible resource when duplicate targets exist", () => {
    const sections: ResourceTreeSection[] = [
      {
        id: "creation",
        label: "创作空间",
        icon: "book",
        nodes: [
          {
            id: "first",
            label: "第一处",
            icon: "file",
            targetDocumentId: "shared"
          },
          {
            id: "second",
            label: "第二处",
            icon: "file",
            targetDocumentId: "shared"
          }
        ]
      }
    ];

    expect(
      createResourceTreeLookup(sections).resourceIdByDocumentId.get("shared")
    ).toBe("first");
  });

  it("highlights the branch that opens an overview selected by document id", () => {
    const nodes: ResourceTreeNode[] = [
      {
        id: "book",
        label: "作品",
        icon: "book",
        children: [
          {
            id: "character-directory",
            label: "人物",
            icon: "user",
            selectableBranch: true,
            targetDocumentId: "overview-document",
            children: [{ id: "character-item", label: "角色", icon: "file" }]
          }
        ]
      }
    ];

    expect(resourceTreeOwnerId(nodes, "overview-document")).toBe(
      "character-directory"
    );
    expect(resourceTreeOwnerId(nodes, "character-item")).toBe("character-item");
    expect(resourceTreeOwnerId(nodes, "unknown")).toBe("unknown");
    expect(resourceTreeOwnerId(nodes, "")).toBe("");
  });
});
