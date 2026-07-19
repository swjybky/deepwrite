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
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => {
      return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
    });

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
      for (let cursor = index - 1; cursor >= 0 && trimmed[cursor] === "\\"; cursor -= 1) {
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

function parseTableDelimiter(line: string, columnCount: number): TableAlignment[] | undefined {
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
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

export function renderMarkdown(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      blocks.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      index += 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      index += 1;
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
        if (!row) {
          break;
        }
        rows.push(row);
        index += 1;
      }
      blocks.push(renderTable(tableHeader, rows, tableAlignments));
      continue;
    }

    if (isThematicBreak(line)) {
      flushParagraph();
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 1;
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        items.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderList(items, false));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        items.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderList(items, true));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks.join("");
}
