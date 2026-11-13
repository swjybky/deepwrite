import { parseBookImageLine } from "@deepwrite/contracts/renderer";
import { parseMarkdownHeadingLine } from "./markdownOutline";

export interface RenderMarkdownOptions {
  annotateHeadings?: boolean;
  resolveImage?: ((path: string) => string | undefined) | undefined;
  blockHtmlCache?: Map<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value: string): string {
  const codeTokens: string[] = [];
  const tokenized = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  let rendered = escapeHtml(tokenized)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label: string, url: string) => {
        return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
      }
    );

  for (const [index, code] of codeTokens.entries()) {
    rendered = rendered.replace(`\u0000CODE${index}\u0000`, code);
  }
  return rendered;
}

function renderList(lines: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const expression = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  const items = lines.map((line) => {
    const content = line.match(expression)?.[1] ?? line;
    return `<li>${renderInline(content)}</li>`;
  });
  return `<${tag}>${items.join("")}</${tag}>`;
}

type TableAlignment = "left" | "center" | "right" | undefined;

function splitTableRow(line: string): string[] | undefined {
  const cells: string[] = [];
  let cell = "";
  let delimiterCount = 0;
  let inCode = false;
  let endsWithDelimiter = false;
  const trimmed = line.trim();

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? "";
    if (character === "`") {
      inCode = !inCode;
      cell += character;
      endsWithDelimiter = false;
      continue;
    }

    if (character === "|" && !inCode) {
      let precedingBackslashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && trimmed[cursor] === "\\";
        cursor -= 1
      ) {
        precedingBackslashes += 1;
      }
      if (precedingBackslashes % 2 === 1) {
        cell = cell.slice(0, -1) + character;
        endsWithDelimiter = false;
        continue;
      }

      cells.push(cell.trim());
      cell = "";
      delimiterCount += 1;
      endsWithDelimiter = true;
      continue;
    }

    cell += character;
    endsWithDelimiter = false;
  }

  if (delimiterCount === 0) {
    return undefined;
  }

  cells.push(cell.trim());
  if (trimmed.startsWith("|")) {
    cells.shift();
  }
  if (endsWithDelimiter) {
    cells.pop();
  }
  return cells;
}

function parseTableDelimiter(
  line: string,
  columnCount: number
): TableAlignment[] | undefined {
  const cells = splitTableRow(line);
  if (!cells || cells.length !== columnCount) {
    return undefined;
  }

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) {
      return undefined;
    }
    alignments.push(
      cell.startsWith(":") && cell.endsWith(":")
        ? "center"
        : cell.endsWith(":")
          ? "right"
          : cell.startsWith(":")
            ? "left"
            : undefined
    );
  }
  return alignments;
}

function renderTableCell(
  tag: "th" | "td",
  value: string,
  alignment: TableAlignment
): string {
  const alignmentClass = alignment ? ` class="align-${alignment}"` : "";
  return `<${tag}${alignmentClass}>${renderInline(value)}</${tag}>`;
}

function renderTable(
  header: string[],
  rows: string[][],
  alignments: TableAlignment[]
): string {
  const headerHtml = header
    .map((cell, index) => renderTableCell("th", cell, alignments[index]))
    .join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = header.map((_, index) =>
        renderTableCell("td", row[index] ?? "", alignments[index])
      );
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    line
  );
}

export type MarkdownBlockKind =
  | "paragraph"
  | "heading"
  | "quote"
  | "list"
  | "table"
  | "code"
  | "separator"
  | "image";

export interface MarkdownBlock {
  start: number;
  end: number;
  kind: MarkdownBlockKind;
  html: string;
}

export function renderMarkdownBlocks(
  source: string,
  options: RenderMarkdownOptions = {}
): MarkdownBlock[] {
  const lines = source.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + (source[offset + line.length] === "\r" ? 2 : 1);
  }
  const blocks: MarkdownBlock[] = [];
  const usedCacheKeys = new Set<string>();
  let paragraphStart = -1;
  let index = 0;
  let headingIndex = 0;

  function push(
    kind: MarkdownBlockKind,
    first: number,
    after: number,
    render: () => string,
    suffix = ""
  ): void {
    const start = offsets[first] ?? source.length;
    const last = Math.min(after - 1, lines.length - 1);
    const end = (offsets[last] ?? source.length) + (lines[last]?.length ?? 0);
    const key = `${kind}\0${suffix}\0${source.slice(start, end)}`;
    usedCacheKeys.add(key);
    let html = options.blockHtmlCache?.get(key);
    if (html === undefined) {
      html = render();
      options.blockHtmlCache?.set(key, html);
    }
    blocks.push({ start, end, kind, html });
  }
  const flushParagraph = (): void => {
    if (paragraphStart < 0) return;
    const paragraph = lines.slice(paragraphStart, index);
    push(
      "paragraph",
      paragraphStart,
      index,
      () => `<p>${paragraph.map(renderInline).join("<br>")}</p>`
    );
    paragraphStart = -1;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const first = index;
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      const language = fence[1]
        ? ` class="language-${escapeHtml(fence[1])}"`
        : "";
      index = Math.min(index + 1, lines.length);
      push(
        "code",
        first,
        index,
        () =>
          `<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`
      );
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    const image = options.resolveImage ? parseBookImageLine(line) : undefined;
    const imageUrl = image && options.resolveImage?.(image.path);
    if (image && imageUrl) {
      flushParagraph();
      index += 1;
      push(
        "image",
        first,
        index,
        () =>
          `<figure class="markdown-image" data-image-path="${escapeHtml(image.path)}"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(image.alt)}" loading="lazy"></figure>`,
        imageUrl
      );
      continue;
    }
    const tableHeader = splitTableRow(line);
    const tableAlignments = tableHeader
      ? parseTableDelimiter(lines[index + 1] ?? "", tableHeader.length)
      : undefined;
    if (tableHeader && tableAlignments) {
      flushParagraph();
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = splitTableRow(lines[index] ?? "");
        if (!row) break;
        rows.push(row);
        index += 1;
      }
      push("table", first, index, () =>
        renderTable(tableHeader, rows, tableAlignments)
      );
      continue;
    }
    if (isThematicBreak(line)) {
      flushParagraph();
      index += 1;
      push("separator", first, index, () => "<hr>");
      continue;
    }
    const heading = parseMarkdownHeadingLine(line);
    if (heading) {
      flushParagraph();
      const attributes = options.annotateHeadings
        ? ` data-markdown-heading-index="${headingIndex}" tabindex="-1"`
        : "";
      index += 1;
      push(
        "heading",
        first,
        index,
        () =>
          `<h${heading.level}${attributes}>${renderInline(heading.source)}</h${heading.level}>`,
        attributes
      );
      headingIndex += 1;
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    if (ordered || /^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const expression = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items: string[] = [];
      while (index < lines.length && expression.test(lines[index] ?? "")) {
        items.push(lines[index] ?? "");
        index += 1;
      }
      push("list", first, index, () => renderList(items, ordered));
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      push(
        "quote",
        first,
        index,
        () => `<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`
      );
      continue;
    }
    if (paragraphStart < 0) paragraphStart = index;
    index += 1;
  }
  flushParagraph();
  if (options.blockHtmlCache) {
    for (const key of options.blockHtmlCache.keys()) {
      if (!usedCacheKeys.has(key)) options.blockHtmlCache.delete(key);
    }
  }
  return blocks;
}

export function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {}
): string {
  return renderMarkdownBlocks(source, options)
    .map((block) => block.html)
    .join("");
}
