import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { RichMarkdownSource } from "../utils/richMarkdown/source";
import {
  richMarkdownParsers,
  richMarkdownSerializer
} from "../utils/richMarkdown/markdown";

function insert(source: RichMarkdownSource, find: string, text: string) {
  let position = -1;
  source.document.descendants((node, offset) => {
    if (position < 0 && node.isText && node.text === find)
      position = offset + find.length;
  });
  expect(position).toBeGreaterThanOrEqual(0);
  const transaction = EditorState.create({
    doc: source.document
  }).tr.insertText(text, position);
  source.track(transaction);
  return transaction.doc;
}
describe("structured preview document", () => {
  it("changes only selection on click without changing any Markdown or formatted node", () => {
    const markdown = "## 标题\n\n开场。**粗体**继续。\n\n- 第一项\n- 第二项";
    const source = new RichMarkdownSource(markdown, true);
    const state = EditorState.create({ doc: source.document });
    const next = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    );
    expect(next.doc).toBe(state.doc);
    expect(next.doc.child(0)).toBe(state.doc.child(0));
    expect(next.doc.child(1)).toBe(state.doc.child(1));
    expect(source.serialize(next.doc)).toBe(markdown);
  });
  it("edits directly inside bold text while preserving its mark and untouched blocks byte for byte", () => {
    const source = new RichMarkdownSource(
      "## 原标题\r\n\r\n开场。**粗体**继续。\r\n\r\n- 原列表",
      true
    );
    const next = insert(source, "粗体", "修改");
    expect(next.child(1).child(1).marks[0]?.type.name).toBe("strong");
    const saved = source.serialize(next);
    expect(saved).toContain("**粗体修改**");
    expect(saved.startsWith("## 原标题")).toBe(true);
    expect(saved.endsWith("- 原列表")).toBe(true);
    expect(richMarkdownParsers.book.parse(saved).eq(next)).toBe(true);
  });
  it("retains heading and list structure when editing their text", () => {
    for (const [markdown, target, name] of [
      ["## 标题", "标题", "heading"],
      ["- 第一项\n- 第二项", "第一项", "bullet_list"]
    ] as const) {
      const source = new RichMarkdownSource(markdown, false);
      const next = insert(source, target, "修改");
      expect(next.firstChild?.type.name).toBe(name);
      expect(
        richMarkdownParsers.plain.parse(source.serialize(next)).eq(next)
      ).toBe(true);
    }
  });
  it("round-trips edited table cells, alignment, code and strikethrough", () => {
    const markdown =
      "| 名称 | 内容 |\n| :--- | ---: |\n| 地点 | 庭院 |\n\n```ts\nconst x = 1;\n```\n\n~~删除~~";
    const source = new RichMarkdownSource(markdown, false);
    expect(source.document.child(0).type.name).toBe("table");
    const next = insert(source, "庭院", "修改");
    expect(
      richMarkdownParsers.plain.parse(source.serialize(next)).eq(next)
    ).toBe(true);
    expect(source.serialize(next)).toContain("const x = 1;");
    expect(source.serialize(next)).toContain("~~删除~~");
  });
  it("allows only standalone validated book images, with no external image nodes", () => {
    const source = new RichMarkdownSource("![地图](images/map.png)", true);
    expect(source.document.firstChild?.type.name).toBe("image");
    expect(source.serialize(source.document)).toBe("![地图](images/map.png)");
    const adjacent = new RichMarkdownSource(
      "前文\n![地图](images/map.png)\n后文",
      true
    );
    expect(adjacent.document.childCount).toBe(3);
    expect(adjacent.document.child(1).type.name).toBe("image");
    for (const markdown of [
      "正文![图](images/map.png)",
      "![图](https://example.test/a.png)",
      "![图](images/../a.png)"
    ]) {
      const document = richMarkdownParsers.book.parse(markdown);
      document.descendants((node) => expect(node.type.name).not.toBe("image"));
    }
    expect(
      richMarkdownParsers.plain.parse("![地图](images/map.png)").firstChild
        ?.type.name
    ).toBe("paragraph");
  });
  it("serializes literal Markdown punctuation without changing its rendered meaning", () => {
    const source = new RichMarkdownSource("文字", false);
    const next = insert(source, "文字", "**普通星号**");
    expect(
      richMarkdownParsers.plain
        .parse(richMarkdownSerializer.serialize(next))
        .eq(next)
    ).toBe(true);
    expect(next.firstChild?.childCount).toBe(1);
  });
  it("maps a caret inside formatted text to its Markdown position", () => {
    const source = new RichMarkdownSource("## 标题\n\n前文**粗体**后文", true);
    let position = 0;
    source.document.descendants((node, offset) => {
      if (node.isText && node.text === "粗体") position = offset + 1;
    });
    expect(source.offset(source.document, position)).toBe(
      source.original.indexOf("粗体") + 1
    );
  });
  it("keeps untouched CRLF blocks and their original blank lines when another block changes", () => {
    const markdown = "\r\n## 原标题\r\n\r\n\r\n__原格式__\r\n\r\n末段\r\n";
    const source = new RichMarkdownSource(markdown, true);
    const next = insert(source, "末段", "修改");
    expect(source.serialize(next)).toBe(markdown.replace("末段", "末段修改"));
  });
  it("preserves reference definitions between blocks when editing their neighbours", () => {
    const markdown =
      "[原链接][ref]\n\n[ref]: https://example.test/page\n\n末段\n\n[另一链接][ref]";
    const source = new RichMarkdownSource(markdown, false);
    const next = insert(source, "末段", "修改");
    const saved = source.serialize(next);
    expect(saved).toBe(markdown.replace("末段", "末段修改"));
    expect(richMarkdownParsers.plain.parse(saved).eq(next)).toBe(true);
  });
  it("maps source ranges into headings, nested lists, bold text and table cells", () => {
    const source = new RichMarkdownSource(
      "## 标题\r\n\r\n前文__粗体__后文\r\n\r\n- 第一项\r\n  - 内层\r\n\r\n| 名称 | 地点 |\r\n| --- | --- |\r\n| 内容 | 庭院 |",
      true
    );
    for (const text of ["标题", "粗体", "第一项", "内层", "庭院"]) {
      const offset = source.original.indexOf(text) + 1;
      const position = source.position(source.document, offset);
      expect(source.document.resolve(position).parent.textContent).toContain(
        text
      );
      expect(source.offset(source.document, position)).toBe(offset);
    }
    const boldEnd = source.original.indexOf("粗体") + 2;
    expect(
      source.offset(source.document, source.position(source.document, boldEnd))
    ).toBe(boldEnd);
  });
  it("keeps source boundaries through paragraph splits and joins", () => {
    const markdown = "## 原标题\r\n\r\n正文继续\r\n\r\n__原格式__";
    const source = new RichMarkdownSource(markdown, true);
    const position = source.position(source.document, markdown.indexOf("继续"));
    const split = EditorState.create({ doc: source.document }).tr.split(
      position
    );
    source.track(split);
    const saved = source.serialize(split.doc);
    expect(saved).toBe(markdown.replace("正文继续", "正文\n\n继续"));
    expect(richMarkdownParsers.book.parse(saved).eq(split.doc)).toBe(true);
    const join = EditorState.create({ doc: split.doc }).tr.join(position + 1);
    source.track(join);
    expect(source.serialize(join.doc)).toBe(markdown);
  });
});
