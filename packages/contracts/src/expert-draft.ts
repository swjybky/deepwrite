import { z } from "zod";

export const ExpertDraftSectionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().max(240),
  wordCountRequirement: z.string().max(1_000),
  body: z.string().max(10_000_000),
  characterState: z.string().max(10_000_000)
});
export type ExpertDraftSection = z.infer<typeof ExpertDraftSectionSchema>;

export const ExpertDraftSchema = z
  .object({
    sections: z.array(ExpertDraftSectionSchema).min(1).max(100)
  })
  .superRefine((value, context) => {
    const ids = value.sections.map((section) => section.id);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `Duplicate expert draft section id: ${id}`
        });
      }
    });
  });
export type ExpertDraft = z.infer<typeof ExpertDraftSchema>;

export type ExpertDraftSectionPatch = Partial<
  Pick<ExpertDraftSection, "title" | "wordCountRequirement" | "body" | "characterState">
>;

const SECTION_MARKER_PATTERN =
  /^[\t ]{0,3}<!--\s*deepwrite:expert-draft-section\s+id=([^\s]+)(?:\s+meta=([^\s]+))?\s*-->[\t ]*$/;
const MARKDOWN_SECTION_HEADING_PATTERN = /^[\t ]{0,3}##(?!#)[\t ]+(.+?)[\t ]*$/;
const WORD_COUNT_REQUIREMENT_PATTERN =
  /^>[\t ]*字数要求[：:][\t ]*(.*?)[\t ]*$/;

interface ParsedSectionMarker {
  id: string;
  wordCountRequirement: string;
  characterState: string;
  hasMetadata: boolean;
}

interface LocatedSectionMarker extends ParsedSectionMarker {
  lineIndex: number;
}

interface MarkdownFence {
  character: "`" | "~";
  length: number;
}

/** Creates the stable empty structure used by a new short story. */
export function createDefaultExpertDraft(): ExpertDraft {
  return {
    sections: [
      {
        id: "intro",
        title: "导语",
        wordCountRequirement: "",
        body: "",
        characterState: ""
      },
      {
        id: "section-1",
        title: "第一节",
        wordCountRequirement: "",
        body: "",
        characterState: ""
      }
    ]
  };
}

export function findExpertDraftSection(
  draft: ExpertDraft,
  sectionId: string
): ExpertDraftSection | undefined {
  return draft.sections.find((section) => section.id === sectionId);
}

/** Returns a new draft when the section exists, and the original draft otherwise. */
export function updateExpertDraftSection(
  draft: ExpertDraft,
  sectionId: string,
  patch: ExpertDraftSectionPatch
): ExpertDraft {
  const sectionIndex = draft.sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return draft;

  const current = draft.sections[sectionIndex]!;
  const next: ExpertDraftSection = {
    ...current,
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.wordCountRequirement === undefined
      ? {}
      : { wordCountRequirement: patch.wordCountRequirement }),
    ...(patch.body === undefined ? {} : { body: patch.body }),
    ...(patch.characterState === undefined
      ? {}
      : { characterState: patch.characterState })
  };
  if (
    next.title === current.title &&
    next.wordCountRequirement === current.wordCountRequirement &&
    next.body === current.body &&
    next.characterState === current.characterState
  ) {
    return draft;
  }

  return {
    sections: draft.sections.map((section, index) =>
      index === sectionIndex ? next : section
    )
  };
}

export function updateExpertDraftSectionBody(
  draft: ExpertDraft,
  sectionId: string,
  body: string
): ExpertDraft {
  return updateExpertDraftSection(draft, sectionId, { body });
}

export function updateExpertDraftSectionCharacterState(
  draft: ExpertDraft,
  sectionId: string,
  characterState: string
): ExpertDraft {
  return updateExpertDraftSection(draft, sectionId, { characterState });
}

/** Appends the next numbered section while preserving every existing stable id. */
export function appendExpertDraftSection(draft: ExpertDraft): ExpertDraft {
  if (draft.sections.length >= 100) return draft;

  const usedIds = new Set(draft.sections.map((section) => section.id));
  const highestSectionNumber = draft.sections.reduce((highest, section) => {
    const match = /^section-(\d+)$/.exec(section.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  let sectionNumber = highestSectionNumber + 1;
  while (usedIds.has(`section-${sectionNumber}`)) sectionNumber += 1;
  const id = `section-${sectionNumber}`;

  return {
    sections: [
      ...draft.sections,
      {
        id,
        title: defaultSectionTitle(id, draft.sections.length),
        wordCountRequirement: "",
        body: "",
        characterState: ""
      }
    ]
  };
}

/** Removes one section while keeping the draft schema's required final section. */
export function removeExpertDraftSection(
  draft: ExpertDraft,
  sectionId: string
): ExpertDraft {
  if (draft.sections.length <= 1) return draft;
  const nextSections = draft.sections.filter((section) => section.id !== sectionId);
  return nextSections.length === draft.sections.length
    ? draft
    : { sections: nextSections };
}

function normalizedMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function trimBlankBoundaryLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start += 1;
  while (end > start && !lines[end - 1]!.trim()) end -= 1;
  return lines.slice(start, end);
}

function normalizeBodyLines(lines: readonly string[]): string {
  return trimBlankBoundaryLines(lines).join("\n");
}

function headingTitle(line: string): string | undefined {
  const match = MARKDOWN_SECTION_HEADING_PATTERN.exec(line);
  if (!match) return undefined;
  const title = match[1]!.replace(/[\t ]+#+[\t ]*$/, "").trim();
  return title || undefined;
}

function fenceOpening(line: string): MarkdownFence | undefined {
  const match = /^[\t ]{0,3}(`{3,}|~{3,})/.exec(line);
  const marker = match?.[1];
  if (!marker) return undefined;
  return {
    character: marker[0] as "`" | "~",
    length: marker.length
  };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const pattern = new RegExp(
    `^[\\t ]{0,3}\\${fence.character}{${fence.length},}[\\t ]*$`
  );
  return pattern.test(line);
}

function scanOutsideFences(
  lines: readonly string[],
  visit: (line: string, lineIndex: number) => void
): void {
  let fence: MarkdownFence | undefined;
  lines.forEach((line, lineIndex) => {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      return;
    }
    const opening = fenceOpening(line);
    if (opening) {
      fence = opening;
      return;
    }
    visit(line, lineIndex);
  });
}

function decodeSectionMarker(line: string): ParsedSectionMarker | undefined {
  const match = SECTION_MARKER_PATTERN.exec(line);
  if (!match) return undefined;

  try {
    const id = decodeURIComponent(match[1]!).trim();
    if (!id) return undefined;

    let wordCountRequirement = "";
    let characterState = "";
    let hasMetadata = false;
    if (match[2]) {
      const metadata: unknown = JSON.parse(decodeURIComponent(match[2]));
      if (metadata && typeof metadata === "object") {
        hasMetadata = true;
        const record = metadata as Record<string, unknown>;
        if (typeof record.wordCountRequirement === "string") {
          wordCountRequirement = record.wordCountRequirement;
        }
        if (typeof record.characterState === "string") {
          characterState = record.characterState;
        }
      }
    }
    return { id, wordCountRequirement, characterState, hasMetadata };
  } catch {
    return undefined;
  }
}

function chineseSectionNumber(value: number): string {
  const digits = [
    "零",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九"
  ];
  if (value <= 10) return value === 10 ? "十" : digits[value]!;
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(value);
}

function defaultSectionTitle(id: string, index: number): string {
  if (id === "intro") return "导语";
  const numericId = /^section-(\d+)$/.exec(id)?.[1];
  const sectionNumber = numericId ? Number(numericId) : index + 1;
  return `第${chineseSectionNumber(sectionNumber)}节`;
}

function nextUnusedSectionId(usedIds: ReadonlySet<string>): string {
  let number = 1;
  while (usedIds.has(`section-${number}`)) number += 1;
  return `section-${number}`;
}

function uniqueSectionId(preferredId: string, usedIds: Set<string>): string {
  const id = usedIds.has(preferredId) ? nextUnusedSectionId(usedIds) : preferredId;
  usedIds.add(id);
  return id;
}

function extractLegacyWordCountRequirement(lines: readonly string[]): {
  body: string;
  wordCountRequirement: string;
} {
  const bodyLines = trimBlankBoundaryLines(lines);
  const requirementMatch = bodyLines[0]
    ? WORD_COUNT_REQUIREMENT_PATTERN.exec(bodyLines[0])
    : undefined;
  if (!requirementMatch) {
    return { body: bodyLines.join("\n"), wordCountRequirement: "" };
  }
  return {
    body: normalizeBodyLines(bodyLines.slice(1)),
    wordCountRequirement: requirementMatch[1]!.trim()
  };
}

function prependBody(preamble: string, body: string): string {
  if (!preamble) return body;
  return body ? `${preamble}\n\n${body}` : preamble;
}

function parseMarkedExpertDraft(lines: readonly string[]): ExpertDraft | undefined {
  const markers: LocatedSectionMarker[] = [];
  scanOutsideFences(lines, (line, lineIndex) => {
    const marker = decodeSectionMarker(line);
    if (marker) markers.push({ ...marker, lineIndex });
  });
  if (markers.length === 0) return undefined;

  const sections: ExpertDraftSection[] = [];
  const usedIds = new Set<string>();
  markers.forEach((marker, markerIndex) => {
    const nextMarker = markers[markerIndex + 1];
    const segment = trimBlankBoundaryLines(
      lines.slice(marker.lineIndex + 1, nextMarker?.lineIndex ?? lines.length)
    );
    const title = segment[0] ? headingTitle(segment[0]) : undefined;
    const contentLines = title ? segment.slice(1) : segment;
    const legacy = marker.hasMetadata
      ? { body: normalizeBodyLines(contentLines), wordCountRequirement: "" }
      : extractLegacyWordCountRequirement(contentLines);
    const id = uniqueSectionId(marker.id, usedIds);
    sections.push({
      id,
      title: title ?? defaultSectionTitle(id, sections.length),
      wordCountRequirement: marker.hasMetadata
        ? marker.wordCountRequirement
        : legacy.wordCountRequirement,
      body: legacy.body,
      characterState: marker.characterState
    });
  });

  const preamble = normalizeBodyLines(lines.slice(0, markers[0]!.lineIndex));
  if (preamble) {
    const targetIndex = Math.max(
      0,
      sections.findIndex((section) => section.id === "section-1")
    );
    const target = sections[targetIndex]!;
    sections[targetIndex] = {
      ...target,
      body: prependBody(preamble, target.body)
    };
  }
  return { sections };
}

function parseHeadingBasedExpertDraft(lines: readonly string[]): ExpertDraft | undefined {
  const headings: Array<{ lineIndex: number; title: string }> = [];
  scanOutsideFences(lines, (line, lineIndex) => {
    const title = headingTitle(line);
    if (title) headings.push({ lineIndex, title });
  });
  if (headings.length === 0) return undefined;

  const preamble = normalizeBodyLines(lines.slice(0, headings[0]!.lineIndex));
  const sections: ExpertDraftSection[] = [];
  let hasIntro = false;
  let sectionNumber = 1;
  headings.forEach((heading, headingIndex) => {
    const nextHeading = headings[headingIndex + 1];
    const legacy = extractLegacyWordCountRequirement(
      lines.slice(heading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length)
    );
    const isIntro = heading.title === "导语" && !hasIntro;
    const id = isIntro ? "intro" : `section-${sectionNumber++}`;
    if (isIntro) hasIntro = true;
    sections.push({
      id,
      title: heading.title,
      wordCountRequirement: legacy.wordCountRequirement,
      body: legacy.body,
      characterState: ""
    });
  });

  const introIndex = sections.findIndex((section) => section.id === "intro");
  if (preamble) {
    const targetIndex = introIndex < 0 ? 0 : introIndex;
    const target = sections[targetIndex]!;
    sections[targetIndex] = {
      ...target,
      body: prependBody(preamble, target.body)
    };
  }
  return { sections };
}

/**
 * Parses persisted expert-draft Markdown as well as older heading-only draft text.
 * Untitled legacy text is deliberately assigned to section-1, never to the intro.
 */
export function parseExpertDraftMarkdown(markdown: string): ExpertDraft {
  const normalized = normalizedMarkdown(markdown);
  if (!normalized.trim()) return createDefaultExpertDraft();

  const lines = normalized.split("\n");
  const marked = parseMarkedExpertDraft(lines);
  if (marked) return marked;
  const headingBased = parseHeadingBasedExpertDraft(lines);
  if (headingBased) return headingBased;

  return updateExpertDraftSectionBody(
    createDefaultExpertDraft(),
    "section-1",
    normalizeBodyLines(lines)
  );
}

function oneLineTitle(section: ExpertDraftSection, index: number): string {
  return (
    section.title.replace(/\r\n?|\n/g, " ").trim() ||
    defaultSectionTitle(section.id, index)
  );
}

/** Serializes the lossless model. Character state only appears in hidden metadata. */
export function serializeExpertDraftMarkdown(draft: ExpertDraft): string {
  return draft.sections
    .map((section, index) => {
      const id = encodeURIComponent(section.id);
      const metadata = encodeURIComponent(
        JSON.stringify({
          wordCountRequirement: section.wordCountRequirement,
          characterState: section.characterState
        })
      );
      const marker = `<!-- deepwrite:expert-draft-section id=${id} meta=${metadata} -->`;
      const title = `## ${oneLineTitle(section, index)}`;
      const body = normalizeBodyLines(normalizedMarkdown(section.body).split("\n"));
      return body ? `${marker}\n${title}\n\n${body}` : `${marker}\n${title}`;
    })
    .join("\n\n");
}

/** Projects only reader-visible titles and manuscript text. */
export function renderExpertDraftManuscript(draft: ExpertDraft): string {
  return draft.sections
    .map((section, index) => {
      const title = `## ${oneLineTitle(section, index)}`;
      const body = normalizeBodyLines(normalizedMarkdown(section.body).split("\n"));
      return body ? `${title}\n\n${body}` : title;
    })
    .join("\n\n");
}

/** Renders a readable diff projection without exposing encoded persistence markers. */
export function renderExpertDraftReview(draft: ExpertDraft): string {
  return draft.sections
    .map((section, index) => {
      const manuscript = [
        `## ${oneLineTitle(section, index)}`,
        normalizeBodyLines(normalizedMarkdown(section.body).split("\n"))
      ]
        .filter(Boolean)
        .join("\n\n");
      const metadata = [
        section.wordCountRequirement
          ? `字数要求：${section.wordCountRequirement}`
          : "",
        section.characterState
          ? `人物状态：\n${normalizedMarkdown(section.characterState)}`
          : ""
      ].filter(Boolean);
      return metadata.length > 0
        ? `${manuscript}\n\n【小节内部信息（不进入正文）】\n${metadata.join("\n")}`
        : manuscript;
    })
    .join("\n\n");
}
