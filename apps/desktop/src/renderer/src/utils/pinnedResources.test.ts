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
      JSON.stringify([
        "mist-materials",
        "book-mist-harbor",
        "mist-materials",
        "chapter-1"
      ]),
      resourceSections
    );

    expect(pinnedIds).toEqual(["mist-materials", "book-mist-harbor"]);
    expect(
      collectPinnedResourceNodes(resourceSections, pinnedIds).map(
        (node) => node.id
      )
    ).toEqual(["mist-materials", "book-mist-harbor"]);
  });

  it("removes pinned resources from their original sections", () => {
    const sections = excludePinnedResourceNodes(resourceSections, [
      "official-skills",
      "writing-clips"
    ]);

    expect(sections[1]?.nodes.map((node) => node.id)).toEqual(["my-skills"]);
    expect(sections[2]?.nodes.map((node) => node.id)).toEqual([
      "mist-materials"
    ]);
  });

  it("restores long and mystery pins as their catalogs load and skips unavailable books", () => {
    const ids = parsePinnedResourceIds(
      '["mystery-book:2","long-book:1","book-missing"]'
    );
    const sections = [
      {
        id: "creation" as const,
        label: "创作空间",
        icon: "book" as const,
        nodes: [
          {
            id: "long-book:1",
            label: "长篇",
            catalogNodeType: "long-book" as const
          },
          {
            id: "mystery-book:2",
            label: "剧本杀",
            catalogNodeType: "mystery-book" as const
          },
          {
            id: "book-missing",
            label: "无法打开",
            catalogNodeType: "book" as const,
            unavailable: true
          }
        ]
      }
    ];
    expect(collectPinnedResourceNodes([], ids)).toEqual([]);
    expect(
      collectPinnedResourceNodes(sections, ids).map(({ id }) => id)
    ).toEqual(ids.slice(0, 2));
  });

  it("ignores malformed persisted state", () => {
    expect(parsePinnedResourceIds("not-json", resourceSections)).toEqual([]);
    expect(
      parsePinnedResourceIds(
        JSON.stringify({ id: "mist-materials" }),
        resourceSections
      )
    ).toEqual([]);
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
