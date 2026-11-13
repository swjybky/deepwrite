import { describe, expect, it, vi } from "vitest";
import {
  EditorState,
  TextSelection,
  type Transaction
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { undoInputRule } from "prosemirror-inputrules";
import { richMarkdownInputRules } from "./inputRules";
import { RichMarkdownSource } from "./source";
import { richMarkdownParsers } from "./markdown";

function setup(markdown = "") {
  const source = new RichMarkdownSource(markdown, true);
  const plugin = richMarkdownInputRules();
  const composition = { active: false };
  let state = EditorState.create({
    doc: source.document,
    selection: TextSelection.atEnd(source.document),
    plugins: [plugin]
  });
  const view = {
    get state() {
      return state;
    },
    get composing() {
      return composition.active;
    },
    dispatch(transaction: Transaction) {
      source.track(transaction);
      state = state.apply(transaction);
    }
  } as unknown as EditorView;
  function type(text: string) {
    const { from, to } = state.selection;
    const insert = () => state.tr.insertText(text, from, to);
    if (
      !plugin.props.handleTextInput!.call(plugin, view, from, to, text, insert)
    )
      view.dispatch(insert());
  }
  return {
    view,
    type,
    composition,
    saved: () => source.serialize(state.doc),
    endComposition() {
      composition.active = false;
      plugin.props.handleDOMEvents!.compositionend!.call(
        plugin,
        view,
        {} as CompositionEvent
      );
    }
  };
}

describe("preview heading input", () => {
  it.each([
    ["", "####### ", "paragraph"],
    ["正文", "## ", "paragraph"],
    ["", "##标题", "paragraph"],
    ["```\n##\n```", " ", "code_block"],
    ["`##`", " ", "paragraph"],
    ["| 标题 |\n| --- |\n| ## |", " ", "paragraph"]
  ])("keeps literal text in %j followed by %j", (markdown, text, nodeType) => {
    const editor = setup(markdown);
    editor.type(text);
    expect(editor.view.state.selection.$from.parent.type.name).toBe(nodeType);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "converts %i hashes and a space into the matching heading",
    (level) => {
      const editor = setup();
      for (const character of "#".repeat(level)) editor.type(character);
      editor.type(" ");
      expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");
      expect(editor.view.state.doc.firstChild?.attrs.level).toBe(level);
      editor.type("你啊后");
      expect(editor.saved()).toBe(`${"#".repeat(level)} 你啊后`);
      expect(
        richMarkdownParsers.book.parse(editor.saved()).eq(editor.view.state.doc)
      ).toBe(true);
    }
  );

  it("creates a heading after Enter while keeping the preceding formatted paragraph", () => {
    const editor = setup("原文**粗体**");
    editor.view.dispatch(
      editor.view.state.tr.split(editor.view.state.selection.from)
    );
    for (const character of "## ") editor.type(character);
    editor.type("你啊后");
    expect(editor.saved()).toBe("原文**粗体**\n\n## 你啊后");
    expect(editor.view.state.doc.child(0).child(1).marks[0]?.type.name).toBe(
      "strong"
    );
    expect(editor.view.state.selection.$from.parent.type.name).toBe("heading");
  });

  it("lets Backspace undo the automatic conversion and keep literal hashes", () => {
    const editor = setup();
    for (const character of "## ") editor.type(character);
    expect(
      undoInputRule(editor.view.state, (transaction) =>
        editor.view.dispatch(transaction)
      )
    ).toBe(true);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.view.state.doc.firstChild?.textContent).toBe("## ");
    editor.type("普通文字");
    expect(editor.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(
      richMarkdownParsers.book.parse(editor.saved()).eq(editor.view.state.doc)
    ).toBe(true);
  });

  it("leaves IME candidate text unconverted until composition completes", async () => {
    vi.useFakeTimers();
    try {
      const editor = setup();
      editor.composition.active = true;
      editor.type("## ");
      expect(editor.view.state.doc.firstChild?.type.name).toBe("paragraph");
      editor.endComposition();
      await vi.runAllTimersAsync();
      expect(editor.view.state.doc.firstChild?.type.name).toBe("heading");
      editor.type("你啊后");
      expect(editor.saved()).toBe("## 你啊后");
    } finally {
      vi.useRealTimers();
    }
  });
});
