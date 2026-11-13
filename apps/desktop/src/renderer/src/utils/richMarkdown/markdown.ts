import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from "prosemirror-markdown";
import type { Node } from "prosemirror-model";
import { parseBookImageLine } from "@deepwrite/contracts/renderer";
import { richMarkdownSchema as schema } from "./schema";

function tokenizer(allowImages: boolean): MarkdownIt {
  // Keep reference definitions visible as literal text, as in the existing preview.
  const markdown = new MarkdownIt("commonmark", { html: false })
    .disable("reference")
    .enable(["table", "strikethrough"]);
  if (allowImages)
    markdown.block.ruler.before(
      "paragraph",
      "book-image",
      (state, line, _end, silent) => {
        if (state.level !== 0) return false;
        const reference = parseBookImageLine(
          state.src.slice(state.bMarks[line], state.eMarks[line])
        );
        if (!reference) return false;
        if (!silent) {
          const image = state.push("image", "img", 0);
          image.block = true;
          image.map = [line, line + 1];
          image.attrs = [
            ["src", reference.path],
            ["alt", reference.alt]
          ];
          state.line = line + 1;
        }
        return true;
      },
      { alt: ["paragraph"] }
    );
  markdown.core.ruler.after("inline", "literal-images-and-cells", (state) => {
    const result: Token[] = [];
    const Token = state.Token;
    for (const token of state.tokens) {
      if (token.type === "inline")
        for (const child of token.children ?? []) {
          if (child.type !== "image") continue;
          child.type = "text";
          child.content = `![${child.content}](${child.attrGet("src") ?? ""})`;
          child.children = null;
        }
      if (token.type === "th_close" || token.type === "td_close")
        result.push(new Token("paragraph_close", "p", -1));
      result.push(token);
      if (token.type === "th_open" || token.type === "td_open")
        result.push(new Token("paragraph_open", "p", 1));
    }
    state.tokens = result;
  });
  return markdown;
}

function parser(allowImages: boolean): MarkdownParser {
  return new MarkdownParser(schema, tokenizer(allowImages), {
    ...defaultMarkdownParser.tokens,
    image: {
      node: "image",
      getAttrs: (token) => ({
        src: token.attrGet("src"),
        alt: token.attrGet("alt") ?? ""
      })
    },
    s: { mark: "strike" },
    table: { block: "table" },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: "table_row" },
    th: {
      block: "table_header",
      getAttrs: (token) => ({
        align:
          token
            .attrGet("style")
            ?.match(/text-align:(left|center|right)/u)?.[1] ?? null
      })
    },
    td: {
      block: "table_cell",
      getAttrs: (token) => ({
        align:
          token
            .attrGet("style")
            ?.match(/text-align:(left|center|right)/u)?.[1] ?? null
      })
    },
    softbreak: { node: "hard_break" }
  });
}
export const richMarkdownParsers = { book: parser(true), plain: parser(false) };

export const richMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    image(state, node) {
      state.write(
        `![${String(node.attrs.alt).replace(/[\]\r\n]/gu, "")}](${node.attrs.src})`
      );
      state.closeBlock(node);
    },
    table(state, node) {
      node.forEach((row, _offset, index) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const text = richMarkdownSerializer.serialize(
            schema.nodes.doc!.create(null, cell.content)
          );
          cells.push(text.replace(/\|/gu, "\\|").replace(/\n+/gu, " "));
        });
        state.write(`| ${cells.join(" | ")} |\n`);
        if (index === 0) {
          const alignments: string[] = [];
          row.forEach((cell) =>
            alignments.push(
              cell.attrs.align === "center"
                ? ":---:"
                : cell.attrs.align === "right"
                  ? "---:"
                  : cell.attrs.align === "left"
                    ? ":---"
                    : "---"
            )
          );
          state.write(`| ${alignments.join(" | ")} |\n`);
        }
      });
      state.closeBlock(node);
    }
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true
    }
  }
);

export function serializeRichBlock(node: Node): string {
  return richMarkdownSerializer.serialize(schema.nodes.doc!.create(null, node));
}
