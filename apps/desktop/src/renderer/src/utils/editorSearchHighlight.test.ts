import { describe, expect, it } from "vitest";
import { buildEditorSearchHighlightSegments } from "./editorSearchHighlight";

describe("editor search highlight segments", () => {
  it("keeps matching text in place and marks the active result", () => {
    expect(
      buildEditorSearchHighlightSegments(
        "一封来信，又一封来信",
        [
          { start: 2, end: 4 },
          { start: 8, end: 10 }
        ],
        1
      )
    ).toEqual([
      { text: "一封", match: false, active: false },
      { text: "来信", match: true, active: false },
      { text: "，又一封", match: false, active: false },
      { text: "来信", match: true, active: true }
    ]);
  });

  it("bounds rendered marks while retaining a distant active result", () => {
    const content = "字".repeat(20);
    const matches = Array.from({ length: 20 }, (_, index) => ({
      start: index,
      end: index + 1
    }));
    const segments = buildEditorSearchHighlightSegments(
      content,
      matches,
      17,
      4
    );

    expect(segments.filter((segment) => segment.match)).toHaveLength(4);
    expect(segments.some((segment) => segment.match && segment.active)).toBe(
      true
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(content);
  });
});
