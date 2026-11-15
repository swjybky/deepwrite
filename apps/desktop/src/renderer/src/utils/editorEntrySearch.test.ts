import { describe, expect, it } from "vitest";
import type { WorkspaceDocument } from "../types/workspace";
import { editorEntrySearchSources } from "./editorEntrySearch";

function document(
  id: string,
  patch: Partial<WorkspaceDocument> = {}
): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: id,
    eyebrow: "测试",
    path: [id],
    content: `${id} content`,
    workspaceId: "book-a",
    workspaceType: "short",
    stageId: "character_design",
    ...patch
  };
}

describe("editorEntrySearchSources", () => {
  it("includes every document in the active creative stage only", () => {
    const active = document("character-a");
    const sources = editorEntrySearchSources(
      [
        active,
        document("character-b"),
        document("plot", { stageId: "plot_design" }),
        document("other-book", { workspaceId: "book-b" })
      ],
      active
    );

    expect(sources.map(({ id }) => id)).toEqual(["character-a", "character-b"]);
  });

  it("uses the whole active library as the entry scope", () => {
    const active = document("entry-a", {
      domain: "material",
      libraryId: "library-a"
    });
    const sources = editorEntrySearchSources(
      [
        active,
        document("entry-b", {
          domain: "material",
          libraryId: "library-a"
        }),
        document("entry-c", {
          domain: "material",
          libraryId: "library-b"
        })
      ],
      active
    );

    expect(sources.map(({ id }) => id)).toEqual(["entry-a", "entry-b"]);
  });

  it("makes paired draft files distinguishable in results", () => {
    const body = document("body", {
      stageId: "draft",
      title: "第一节",
      draftFileKind: "body"
    });
    const state = document("state", {
      stageId: "draft",
      title: "第一节",
      draftFileKind: "character-state"
    });

    expect(editorEntrySearchSources([body, state], body)).toEqual([
      { id: "body", title: "第一节 · 正文", content: "body content" },
      {
        id: "state",
        title: "第一节 · 状态",
        content: "state content"
      }
    ]);
  });
});
