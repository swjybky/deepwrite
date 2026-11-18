import { describe, expect, it } from "vitest";
import type { Book } from "@deepwrite/contracts";
import { scopeBookLibrariesToReadAccess } from "./shortWorkspaceLibraryScope";

describe("scopeBookLibrariesToReadAccess", () => {
  it("removes disallowed bindings before attachment capacity is applied", () => {
    const book = {
      id: "book-short",
      bookType: "short",
      linkedMaterialIdsByKind: {
        character: ["material-character"],
        gimmick: ["material-gimmick"],
        plot: ["material-plot"],
        draft: ["material-draft"],
        other: ["material-other"]
      },
      linkedSkillIdsByKind: {
        general: ["skill-general"],
        plot: ["skill-plot"],
        style: ["skill-style"],
        other: ["skill-other"]
      }
    } as Book;

    const scoped = scopeBookLibrariesToReadAccess(book, {
      material: ["character"],
      skill: ["general", "other"]
    });
    if (scoped.bookType === "academic" || book.bookType === "academic") {
      throw new Error("Expected short book");
    }
    expect(scoped.linkedMaterialIdsByKind).toEqual({
      character: ["material-character"],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    });
    expect(scoped.linkedSkillIdsByKind).toEqual({
      general: ["skill-general"],
      plot: [],
      style: [],
      other: ["skill-other"]
    });
    expect(book.linkedMaterialIdsByKind.plot).toEqual(["material-plot"]);
  });
});
