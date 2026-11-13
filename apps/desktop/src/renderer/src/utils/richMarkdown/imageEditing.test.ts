import { describe, expect, it } from "vitest";
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Transaction
} from "prosemirror-state";
import { deleteSelection } from "prosemirror-commands";
import { RichMarkdownSource } from "./source";
import { deleteImageBeforeCursor, imageEditingPlugin } from "./imageEditing";

function setup(markdown: string) {
  const source = new RichMarkdownSource(markdown, true);
  let state = EditorState.create({
    doc: source.document,
    plugins: [imageEditingPlugin()],
    selection: TextSelection.atEnd(source.document)
  });
  function dispatch(transaction: Transaction) {
    const result = state.applyTransaction(transaction);
    result.transactions.forEach((entry) => source.track(entry));
    state = result.state;
  }
  return {
    get state() {
      return state;
    },
    source,
    dispatch,
    saved: () => source.serialize(state.doc)
  };
}

describe("images at the end of the preview", () => {
  it.each(["", "\n\n", "\r\n\r\n"])(
    "provides a text cursor after the image without changing source ending %j",
    (ending) => {
      const markdown = `正文\n\n![地图](images/map.png)${ending}`;
      const source = new RichMarkdownSource(markdown, true);
      expect(source.document.lastChild?.type.name).toBe("paragraph");
      expect(source.document.lastChild?.content.size).toBe(0);
      const state = EditorState.create({ doc: source.document });
      const next = state.apply(
        state.tr.setSelection(TextSelection.atEnd(state.doc))
      );
      expect(next.selection.$from.parent.type.name).toBe("paragraph");
      expect(source.serialize(next.doc)).toBe(markdown);
      expect(source.offset(next.doc, next.selection.from)).toBe(
        markdown.length
      );
      expect(source.position(next.doc, markdown.length)).toBe(
        next.selection.from
      );
    }
  );
  it("deletes the final image with Backspace from its following line and can continue typing", () => {
    const editor = setup("原文**粗体**\n\n![地图](images/map.png)");
    expect(deleteImageBeforeCursor(editor.state, editor.dispatch)).toBe(true);
    expect(editor.saved().trimEnd()).toBe("原文**粗体**");
    editor.dispatch(editor.state.tr.insertText("继续写"));
    expect(editor.saved()).toBe("原文**粗体**\n\n继续写");
  });
  it("clears an image-only document and leaves an editable empty paragraph", () => {
    const editor = setup("![地图](images/map.png)\n\n");
    expect(deleteImageBeforeCursor(editor.state, editor.dispatch)).toBe(true);
    expect(editor.saved()).toBe("");
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    editor.dispatch(editor.state.tr.insertText("继续写"));
    expect(editor.saved().trimEnd()).toBe("继续写");
  });
  it("deletes a selected final image without deleting preceding text", () => {
    const editor = setup("正文\n\n![地图](images/map.png)");
    const position = editor.source
      .blocks(editor.state.doc)
      .find((block) => block.node.type.name === "image")!.position;
    editor.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, position)
      )
    );
    expect(deleteSelection(editor.state, editor.dispatch)).toBe(true);
    expect(editor.saved().trimEnd()).toBe("正文");
  });
  it("restores the trailing cursor when deleting text after an image", () => {
    const editor = setup("![地图](images/map.png)\n\n后文");
    editor.dispatch(editor.state.tr.delete(1, editor.state.doc.content.size));
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.content.size).toBe(0);
    expect(editor.saved()).toBe("![地图](images/map.png)");
  });
  it("does not intercept deletion inside text after an image", () => {
    const editor = setup("![地图](images/map.png)\n\n后文");
    expect(deleteImageBeforeCursor(editor.state, editor.dispatch)).toBe(false);
  });
});
