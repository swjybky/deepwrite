import { describe, expect, it } from "vitest";
import { resourceSections } from "../data/demoWorkspace";
import {
  collectPinnedResourceNodes,
  excludePinnedResourceNodes,
  parsePinnedResourceIds
} from "./pinnedResources";

describe("pinned resources", () => {
  it("keeps valid top-level resources in the saved pin order", () => {
    const pinnedIds = parsePinnedResourceIds(
      JSON.stringify(["mist-materials", "book-mist-harbor", "mist-materials", "chapter-1"]),
      resourceSections
    );

    expect(pinnedIds).toEqual(["mist-materials", "book-mist-harbor"]);
    expect(collectPinnedResourceNodes(resourceSections, pinnedIds).map((node) => node.id)).toEqual([
      "mist-materials",
      "book-mist-harbor"
    ]);
  });

  it("removes pinned resources from their original sections", () => {
    const sections = excludePinnedResourceNodes(resourceSections, [
      "official-skills",
      "writing-clips"
    ]);

    expect(sections[1]?.nodes.map((node) => node.id)).toEqual(["my-skills"]);
    expect(sections[2]?.nodes.map((node) => node.id)).toEqual(["mist-materials"]);
  });

  it("ignores malformed persisted state", () => {
    expect(parsePinnedResourceIds("not-json", resourceSections)).toEqual([]);
    expect(parsePinnedResourceIds(JSON.stringify({ id: "mist-materials" }), resourceSections)).toEqual(
      []
    );
  });

  it("supports folder-project libraries nested under catalog categories", () => {
    const sections = [
      {
        id: "skill" as const,
        label: "技能库",
        icon: "library" as const,
        nodes: [
          {
            id: "skill-category",
            label: "通用",
            catalogNodeType: "category" as const,
            children: [
              {
                id: "skill-library-local",
                label: "我的技能库",
                catalogNodeType: "library" as const
              }
            ]
          }
        ]
      }
    ];

    const pinnedIds = parsePinnedResourceIds(
      JSON.stringify(["skill-category", "skill-library-local"]),
      sections
    );
    expect(pinnedIds).toEqual(["skill-library-local"]);
    expect(collectPinnedResourceNodes(sections, pinnedIds)[0]?.label).toBe(
      "我的技能库"
    );
  });
});
