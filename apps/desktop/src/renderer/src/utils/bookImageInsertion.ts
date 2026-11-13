import type { TextInputHistoryChange } from "./boundedTextHistory";

export interface MarkdownSourceEdit {
  start: number;
  end: number;
  text: string;
  /** Typed preview input, in document offsets, so history can merge it like editor typing. */
  input?: Omit<TextInputHistoryChange, "beforeContent" | "afterContent">;
}

/** Insert after the whole selected line, retaining at most one surrounding blank line. */
export function bookImageInsertionEdit(
  content: string,
  offset: number,
  images: readonly { path: string; alt: string }[]
): MarkdownSourceEdit {
  const newline = content.indexOf(
    "\n",
    Math.max(0, Math.min(offset, content.length))
  );
  const lineEnd = newline < 0 ? content.length : newline;
  const before = content
    .slice(0, lineEnd)
    .replace(/(?:\r?\n[ \t]*)+$/, "")
    .replace(/\r$/, "");
  const after = content
    .slice(lineEnd)
    .replace(/^(?:\r?\n[ \t]*(?=\r?\n))*\r?\n/, "");
  const references = images
    .map(
      ({ path, alt }) =>
        `![${alt.replace(/[\]\r\n]/g, " ").slice(0, 200)}](${path})`
    )
    .join("\n\n");
  // Only replace whitespace adjacent to the insertion; the selection remains intact.
  return {
    start: before.length,
    end: content.length - after.length,
    text: `${before ? "\n\n" : ""}${references}\n\n`
  };
}

export function applyMarkdownSourceEdit(
  content: string,
  edit: MarkdownSourceEdit
): string {
  return content.slice(0, edit.start) + edit.text + content.slice(edit.end);
}

/** Textarea selection offsets count CRLF as a single rendered newline. */
export function textareaOffsetToMarkdownSource(
  source: string,
  offset: number
): number {
  let cursor = 0;
  let rendered = 0;
  while (cursor < source.length && rendered < offset) {
    cursor += source[cursor] === "\r" && source[cursor + 1] === "\n" ? 2 : 1;
    rendered += 1;
  }
  return cursor;
}
