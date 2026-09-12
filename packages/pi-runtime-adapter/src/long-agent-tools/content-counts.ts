import type { WritingContentTarget } from "../writing-content-counts";
import type { LongCreateResult } from "./create-support";
import type { LongCreateKind, LongEntityKind } from "./entity-registry";
import {
  parseForeshadowingBody,
  serializeForeshadowingBody
} from "./entity-records";
import type { LongFileChangeInput } from "./proposals";

/** Count the same canonical body that read exposes for index-backed records. */
export function longRecordContentTarget(
  kind: LongCreateKind | LongEntityKind,
  id: string,
  title: string,
  content: string
): WritingContentTarget {
  return {
    id,
    title,
    content:
      kind === "foreshadowing"
        ? serializeForeshadowingBody(parseForeshadowingBody(content))
        : content
  };
}

export function longFileContentTargets(
  changes: readonly LongFileChangeInput[]
): WritingContentTarget[] {
  return changes.map(({ target, file, afterText }) => ({
    title: target.title,
    id: file.id,
    content: afterText
  }));
}

export function longCreatedContentTargets(
  result: LongCreateResult,
  kind: LongCreateKind,
  content: string
): WritingContentTarget[] {
  const targets = longFileContentTargets(result.changes);
  for (const operation of result.operations) {
    if (operation.type === "character.create") {
      targets.push({
        title: `${operation.character.name} / 人物关系`,
        id: operation.files.relationships.id,
        content: ""
      });
    }
    if (operation.type === "chapter.create") {
      for (const [document, title] of [
        ["body", "正文"],
        ["characterState", "章末状态"],
        ["handoff", "接续包"],
        ["foreshadowingChanges", "伏笔变化"]
      ] as const) {
        targets.push({
          title: `${operation.chapterCard.title} / ${title}`,
          id: operation.files[document].id,
          content: ""
        });
      }
    }
  }
  if (targets.length > 0) return targets;
  // Record create operations retain content verbatim except for foreshadowing.
  return [
    longRecordContentTarget(kind, result.createdId, result.label, content)
  ];
}
