import {
  createEmptyLongMarkdownFileReference,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";
import type { LongFileChangeInput } from "./proposals";
import type { LongCreateKind } from "./entity-registry";
import type { LongDocumentTarget } from "./target";

/** Flat, snake_case metadata accepted by `create` for every entity kind. */
export interface LongCreateMeta {
  title?: string;
  name?: string;
  aliases?: string[];
  type_id?: string;
  category_id?: string;
  volume_id?: string;
  arc_id?: string;
  primary_arc_id?: string | null;
  arc_ids?: string[];
  character_ids?: string[];
  character_id?: string;
  chapter_card_id?: string;
  document?: "current_state" | "history";
  event_id?: string;
  source_event_id?: string;
  target_event_id?: string;
  truth_event_id?: string | null;
  foreshadowing_id?: string;
  placement_id?: string;
  time_mode?: "exact" | "relative" | "sequence" | "unknown";
  time_label?: string;
  location?: string;
  type?: string;
  mode?: string;
  disclosure?: string;
  planned_span?: "local" | "within_volume" | "cross_volume";
  planned_scope?: string;
}

export interface LongCreateInput {
  kind: LongCreateKind;
  meta: LongCreateMeta;
  content: string;
  index: LongWorkspaceIndexSnapshot;
  timestamp: string;
  idSeed: string;
  activeChapterCardId?: string;
}

export interface LongCreateResult {
  operations: LongWorkspaceOperation[];
  changes: LongFileChangeInput[];
  createdId: string;
  label: string;
  action?: "create" | "write";
}

const LONG_TITLE_MAX_LENGTH = 256;
const LEADING_MARKDOWN_H1_PATTERN =
  /^[ \t]{0,3}#[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/u;

/**
 * Some providers put a worldbuilding item's title in the document heading but
 * omit the conditionally required meta.title field. Recover only from an
 * unambiguous leading H1 so ordinary section headings cannot rename an item.
 */
export function resolveWorldbuildingItemTitle(
  title: string | undefined,
  content: string
): string | undefined {
  const explicitTitle = title?.trim();
  if (explicitTitle) return explicitTitle;

  const firstContentLine = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .find((line) => line.trim().length > 0);
  const inferredTitle = firstContentLine
    ?.match(LEADING_MARKDOWN_H1_PATTERN)?.[1]
    ?.trim();
  if (!inferredTitle || inferredTitle.length > LONG_TITLE_MAX_LENGTH) {
    return undefined;
  }
  return inferredTitle;
}

export function requireMeta<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`创建该对象必须提供 meta.${field}。`);
  }
  return value;
}

export function newLongFile(
  id: string,
  path: string,
  timestamp: string,
  _content: string
): LongWorkspaceFileReference {
  return createEmptyLongMarkdownFileReference(id, path, timestamp);
}

export function createChange(
  target: LongDocumentTarget,
  file: LongWorkspaceFileReference,
  content: string
): LongFileChangeInput {
  return {
    target: { ...target, file },
    operation: "create",
    beforeText: "",
    afterText: content,
    file
  };
}
