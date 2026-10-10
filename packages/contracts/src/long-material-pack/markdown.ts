import {
  LONG_MATERIAL_ENTRY_MAX_CHARACTERS,
  LONG_MATERIAL_ENTRY_TARGET_CHARACTERS
} from "./limits";

/** Normalizes line endings, trims and collapses runs of blank lines. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Re-levels the text's headings so its shallowest heading sits one level
 * below `depth` (the heading the text is placed under). Code is untouched.
 */
export function nestHeadings(text: string, depth: number): string {
  const lines = cleanText(text).split("\n");
  const headings: (RegExpExecArray | null)[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/u.test(line)) fenced = !fenced;
    headings.push(fenced ? null : /^(#{1,6})(\s.*)$/u.exec(line));
  }
  const levels = headings.flatMap((match) => (match ? [match[1]!.length] : []));
  if (!levels.length) return lines.join("\n");
  const shift = depth + 1 - Math.min(...levels);
  return lines
    .map((line, index) => {
      const match = headings[index];
      if (!match) return line;
      const level = Math.max(1, Math.min(6, match[1]!.length + shift));
      return `${"#".repeat(level)}${match[2]}`;
    })
    .join("\n");
}

/** The first prose line (headings skipped), shortened for index lines. */
export function firstLine(text: string, maximum = 60): string {
  const lines = cleanText(text).split("\n");
  const prose = lines.filter((value) => !/^#{1,6}\s/u.test(value));
  const line =
    (prose.length ? prose : lines)
      .map((value) =>
        value
          .replace(/^#{1,6}\s+/u, "")
          .replace(/^[-*+]\s+/u, "")
          .replace(/^>\s?/u, "")
          .replace(/\*\*/gu, "")
          .trim()
      )
      .find((value) => value && !/^[-*_]{3,}$/u.test(value)) ?? "";
  return line.length > maximum ? `${line.slice(0, maximum - 1)}…` : line;
}

/** Splits text into pieces no longer than `maximum`, at paragraph breaks. */
export function splitParagraphs(text: string, maximum: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const paragraph of cleanText(text).split(/\n{2,}/u)) {
    if (paragraph.length > maximum) {
      push();
      for (let start = 0; start < paragraph.length; start += maximum)
        pieces.push(paragraph.slice(start, start + maximum));
      continue;
    }
    if (current && current.length + paragraph.length + 2 > maximum) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return pieces;
}

/**
 * Packs sections greedily into parts around the target size. A section that
 * alone passes the hard cap is cut at paragraph breaks.
 */
export function packSections(
  sections: readonly string[],
  target = LONG_MATERIAL_ENTRY_TARGET_CHARACTERS,
  maximum = LONG_MATERIAL_ENTRY_MAX_CHARACTERS
): string[] {
  const parts: string[] = [];
  let current = "";
  for (const section of sections.map(cleanText).filter(Boolean)) {
    const pieces =
      section.length > maximum ? splitParagraphs(section, target) : [section];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > target) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

const INTERNAL_ID =
  /\b(?:longbook|world|worlditem|character|chartype|volume|arc|chapter|event|storyplot|connection|placement|foreshadow|beat|commit|fact|loop|file)_[A-Za-z0-9_-]{4,}\b/gu;

/** Replaces business ids the book's own text may mention with their names. */
export function replaceInternalIds(
  text: string,
  names: ReadonlyMap<string, string>
): string {
  return text.replace(INTERNAL_ID, (id) => names.get(id) ?? id);
}

export function containsInternalId(text: string): boolean {
  return new RegExp(INTERNAL_ID.source, "u").test(text);
}

export function partTitle(title: string, index: number, count: number) {
  return count > 1 ? `${title}（${index + 1}/${count}）` : title;
}

export function chapterLabel(number: number, title: string): string {
  const name = title.trim();
  return name ? `第${number}章 · ${name}` : `第${number}章`;
}

export function chapterRange(first: number, last: number): string {
  return first === last ? `第${first}章` : `第${first}–${last}章`;
}
