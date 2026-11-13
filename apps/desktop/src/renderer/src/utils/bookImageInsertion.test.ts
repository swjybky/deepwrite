import { describe, expect, it } from "vitest";
import { createBoundedTextHistory } from "./boundedTextHistory";
import {
  applyMarkdownSourceEdit,
  bookImageInsertionEdit,
  textareaOffsetToMarkdownSource
} from "./bookImageInsertion";

const image = { path: "images/map-12345678.png", alt: "地图" };

describe("book image insertion", () => {
  it("inserts after the selection's final line without replacing selected text", () => {
    const content = "第一行\n第二行\n第三行";
    const edit = bookImageInsertionEdit(content, 6, [image]);
    expect(applyMarkdownSourceEdit(content, edit)).toBe(
      "第一行\n第二行\n\n![地图](images/map-12345678.png)\n\n第三行"
    );
  });
  it("normalizes excess surrounding blank lines and preserves image order", () => {
    const content = "前文\n\n\n\n后文";
    const edit = bookImageInsertionEdit(content, 3, [
      image,
      { ...image, alt: "第二张" }
    ]);
    expect(applyMarkdownSourceEdit(content, edit)).toBe(
      "前文\n\n![地图](images/map-12345678.png)\n\n![第二张](images/map-12345678.png)\n\n后文"
    );
  });
  it("inserts at the end of an empty or unterminated document", () => {
    expect(
      applyMarkdownSourceEdit("", bookImageInsertionEdit("", 0, [image]))
    ).toBe("![地图](images/map-12345678.png)\n\n");
    expect(
      applyMarkdownSourceEdit(
        "文末",
        bookImageInsertionEdit("文末", 1, [image])
      )
    ).toBe("文末\n\n![地图](images/map-12345678.png)\n\n");
  });
  it("preserves hard-break spaces and indentation in the surrounding nonblank lines", () => {
    const content = "正文  \n    code\n后文";
    expect(
      applyMarkdownSourceEdit(
        content,
        bookImageInsertionEdit(content, 1, [image])
      )
    ).toBe("正文  \n\n![地图](images/map-12345678.png)\n\n    code\n后文");
  });
  it("records one undoable change and restores the original manuscript", () => {
    const content = "前文\n后文";
    const edit = bookImageInsertionEdit(content, 1, [image]);
    const afterContent = applyMarkdownSourceEdit(content, edit);
    const history = createBoundedTextHistory();
    history.recordChange({
      beforeContent: content,
      afterContent,
      selectionBefore: { start: 0, end: 1 },
      selectionAfter: { start: edit.start, end: edit.start }
    });
    expect(history.undo(afterContent)?.content).toBe(content);
    expect(history.redo(content)?.content).toBe(afterContent);
  });
  it("maps Windows textarea selection offsets back to the original Markdown line", () => {
    const content = "A\r\nB\r\nC\r\nD\r\nE";
    const offset = textareaOffsetToMarkdownSource(content, 9);
    expect(offset).toBe(content.length);
    const result = applyMarkdownSourceEdit(
      content,
      bookImageInsertionEdit(content, offset, [image])
    );
    expect(result).toBe(`${content}\n\n![地图](images/map-12345678.png)\n\n`);
  });
});
