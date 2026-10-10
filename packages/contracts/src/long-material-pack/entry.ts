import type { MaterialKind, MaterialStageId } from "../catalog";
import {
  LONG_MATERIAL_ENTRY_MAX_CHARACTERS,
  LONG_MATERIAL_ENTRY_TARGET_CHARACTERS
} from "./limits";
import {
  cleanText,
  packSections,
  partTitle,
  replaceInternalIds
} from "./markdown";

/** One entry the conversion writes; `body` excludes the metadata header. */
export interface LongMaterialPlannedEntry {
  key: string;
  kind: MaterialKind;
  stageId: MaterialStageId;
  title: string;
  description: string;
  body: string;
  enhanced?: boolean;
}

export interface LongMaterialRenderContext {
  bookTitle: string;
  libraryTitles: Readonly<Record<MaterialKind, string>>;
  /** Business ids the book's text may mention, mapped to their names. */
  names: ReadonlyMap<string, string>;
}

/** A full catalog title the agent can pass straight to `entry_name`. */
export function entryRef(
  context: LongMaterialRenderContext,
  kind: MaterialKind,
  title: string
): string {
  return `「${context.libraryTitles[kind]} · ${title}」`;
}

const HEADER_RESERVE = 400;

function shortDescription(text: string): string {
  const plain = text.replace(/\s+/gu, " ").trim();
  return plain.length > 150 ? `${plain.slice(0, 149)}…` : plain;
}

export function composeEntry(
  context: LongMaterialRenderContext,
  input: Omit<LongMaterialPlannedEntry, "body"> & {
    scope: string;
    sections: readonly string[];
  }
): LongMaterialPlannedEntry {
  const body = [
    `# ${input.title}`,
    `来源：《${context.bookTitle}》· ${input.scope}`,
    ...input.sections.map(cleanText).filter(Boolean)
  ].join("\n\n");
  return {
    key: input.key,
    kind: input.kind,
    stageId: input.stageId,
    title: input.title,
    description: shortDescription(input.description),
    body: `${replaceInternalIds(body, context.names)}\n`,
    ...(input.enhanced ? { enhanced: true } : {})
  };
}

/**
 * Builds one entry, or numbered parts when the sections pass the target
 * size. Keys carry the part number so later conversions update in place.
 */
export function composeParts(
  context: LongMaterialRenderContext,
  input: {
    key: string;
    kind: MaterialKind;
    stageId: MaterialStageId;
    title: string;
    scope: string;
    description(part: number, count: number): string;
    sections: readonly string[];
  }
): LongMaterialPlannedEntry[] {
  const parts = packSections(
    input.sections,
    LONG_MATERIAL_ENTRY_TARGET_CHARACTERS - HEADER_RESERVE,
    LONG_MATERIAL_ENTRY_MAX_CHARACTERS - HEADER_RESERVE
  );
  return parts.map((text, index) =>
    composeEntry(context, {
      key: `${input.key}:${index + 1}`,
      kind: input.kind,
      stageId: input.stageId,
      title: partTitle(input.title, index, parts.length),
      description: input.description(index, parts.length),
      scope: input.scope,
      sections: [text]
    })
  );
}
