import { describe, expect, it } from "vitest";
import { resourceSections } from "../data/demoWorkspace";
import {
  applyBookResourcePreferences,
  parseBookResourcePreferences
} from "./bookResourcePreferences";

describe("book resource preferences", () => {
  it("keeps valid names and library bindings", () => {
    const preferences = parseBookResourcePreferences(
      JSON.stringify({
        "book-mist-harbor": {
          label: "  新书名  ",
          skillLibraryIds: ["my-skills", "missing", "my-skills"],
          materialLibraryIds: ["mist-materials"]
        },
        missing: { removed: true }
      }),
      resourceSections
    );

    expect(preferences).toEqual({
      "book-mist-harbor": {
        label: "新书名",
        skillLibraryIds: ["my-skills"],
        materialLibraryIds: ["mist-materials"]
      }
    });
  });

  it("renames, binds and removes books without changing library sections", () => {
    const sections = applyBookResourcePreferences(resourceSections, {
      "short-mist": { removed: true },
      "book-mist-harbor": {
        label: "潮声来信",
        skillLibraryIds: ["official-skills"],
        materialLibraryIds: ["writing-clips"]
      }
    });

    expect(sections[0]?.nodes.map((node) => node.label)).toEqual(["潮声来信"]);
    expect(sections[0]?.nodes[0]?.boundSkillLibraryIds).toEqual(["official-skills"]);
    expect(sections[0]?.nodes[0]?.boundMaterialLibraryIds).toEqual(["writing-clips"]);
    expect(sections[1]).toBe(resourceSections[1]);
    expect(sections[2]).toBe(resourceSections[2]);
  });
});
