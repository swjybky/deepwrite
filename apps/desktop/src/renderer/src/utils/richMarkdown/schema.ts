import { Schema } from "prosemirror-model";
import { schema as markdownSchema } from "prosemirror-markdown";
import { tableNodes } from "prosemirror-tables";

const tables = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (element) => element.style.textAlign || null,
      setDOMAttr(value, attributes) {
        if (["left", "center", "right"].includes(String(value)))
          attributes.class = `align-${value}`;
      }
    }
  }
});
tables.table = {
  ...tables.table,
  toDOM: () => [
    "div",
    { class: "markdown-table-wrap" },
    ["table", ["tbody", 0]]
  ]
};

export const richMarkdownSchema = new Schema({
  nodes: markdownSchema.spec.nodes
    .update("heading", {
      ...markdownSchema.spec.nodes.get("heading"),
      content: "inline*"
    })
    .update("image", {
      group: "block",
      atom: true,
      draggable: false,
      attrs: { src: {}, alt: { default: "" }, title: { default: null } },
      // Images enter only through validated Markdown / the existing picker.
      parseDOM: [],
      toDOM: (node) => [
        "figure",
        { class: "markdown-image", "data-image-path": node.attrs.src },
        ["img", { alt: node.attrs.alt }]
      ]
    })
    .append(tables),
  marks: markdownSchema.spec.marks
    .update("link", {
      ...markdownSchema.spec.marks.get("link"),
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (element) => {
            const href = element.getAttribute("href") ?? "";
            return /^https?:\/\//u.test(href)
              ? { href, title: element.getAttribute("title") }
              : false;
          }
        }
      ]
    })
    .addToEnd("strike", {
      parseDOM: [{ tag: "del" }, { tag: "s" }],
      toDOM: () => ["del", 0]
    })
});
