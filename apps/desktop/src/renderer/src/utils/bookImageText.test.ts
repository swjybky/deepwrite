import { describe, expect, it } from "vitest";
import { countDocumentCharacters } from "./bookImageText";
import { createBoundedTextHistory } from "./boundedTextHistory";

describe("document character totals with illustrations", () => {
  it("excludes only valid standalone book image references", () => {
    expect(
      countDocumentCharacters(
        "甲 乙\r\n![地图](images/map.png)\r\n丙\n![](images/photo.jpg)"
      )
    ).toBe(3);
    for (const line of [
      "甲![图](images/map.png)",
      "![图](https://example.test/map.png)",
      "![图](images/../map.png)"
    ]) {
      expect(countDocumentCharacters(line)).toBe(
        line.replace(/\s/gu, "").length
      );
    }
  });

  it("keeps totals stable across inserting, removing, undoing and redoing an image", () => {
    const history = createBoundedTextHistory();
    const original = "原稿";
    const inserted = `${original}\n\n![图](images/map.png)`;
    history.recordChange({
      beforeContent: original,
      afterContent: inserted,
      selectionBefore: { start: 2, end: 2 },
      selectionAfter: { start: inserted.length, end: inserted.length }
    });
    expect(countDocumentCharacters(inserted)).toBe(2);
    const undone = history.undo(inserted)!;
    expect(countDocumentCharacters(undone.content)).toBe(2);
    expect(countDocumentCharacters(history.redo(undone.content)!.content)).toBe(
      2
    );
  });
});
