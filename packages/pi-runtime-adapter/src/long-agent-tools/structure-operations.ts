import {
  LongWorkspaceOperationSchema,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";
import {
  LONG_DELETABLE_KINDS,
  LONG_ENTITY_KIND_LABELS,
  type LongEntityKind
} from "./entity-registry";
import type { LongEntityTarget } from "./entity-target";
import type { LongDocumentTarget } from "./target";

const DELETE_OPERATION_TYPES: Partial<Record<LongEntityKind, string>> = {
  character: "character.delete",
  story_plot: "storyPlot.delete",
  chapter_card: "chapter.delete",
  volume: "volume.delete",
  arc: "arc.delete",
  story_event: "event.delete",
  event_connection: "connection.delete",
  narrative_placement: "placement.delete",
  foreshadowing: "foreshadowing.delete",
  foreshadowing_beat: "foreshadowingBeat.delete"
};

/** Metadata updates for the entities whose body lives in a Markdown file. */
export function longStructureUpdateOperation(
  index: LongWorkspaceIndexSnapshot,
  target: LongDocumentTarget,
  patch: Record<string, unknown>
): LongWorkspaceOperation {
  const operation = {
    worldbuilding_item: {
      type: "worldbuildingItem.update",
      categoryId: target.categoryId,
      id: target.id,
      patch
    },
    character: { type: "character.update", id: target.id, patch },
    chapter_card: { type: "chapter.update", id: target.id, patch },
    story_plot: { type: "storyPlot.update", id: target.id, patch }
  }[target.kind as string];
  if (!operation) {
    throw new Error(`${LONG_ENTITY_KIND_LABELS[target.kind]}不支持修改信息。`);
  }
  if (
    target.kind === "story_plot" &&
    !index.plot.storyPlots.some(({ id }) => id === target.id)
  ) {
    throw new Error(`故事情节 ${target.id} 不存在。`);
  }
  return LongWorkspaceOperationSchema.parse(operation);
}

/** Optional chapter continuity files are the only deletable documents. */
export function longContinuityDeleteOperation(
  target: LongDocumentTarget
): LongWorkspaceOperation {
  if (target.kind === "chapter_card" && target.document === "world_reveals") {
    return {
      type: "chapterContinuity.worldReveals.delete",
      chapterCardId: target.id
    };
  }
  if (
    target.kind === "chapter_card" &&
    (target.document === "continuity_character_current_state" ||
      target.document === "continuity_character_history")
  ) {
    return {
      type: "chapterContinuity.character.delete",
      chapterCardId: target.id,
      characterId: target.characterId!
    };
  }
  throw new Error(
    "只能删除可选的世界观揭露文件，或按人物成对删除本章人物连续性文件；其余文档随所属对象存在。"
  );
}

/**
 * Deletion is limited to leaves. Containers such as worldbuilding categories
 * and character types stay under the UI's own structure editor.
 */
export function longEntityDeleteOperation(
  target: LongEntityTarget
): LongWorkspaceOperation {
  if (!LONG_DELETABLE_KINDS.has(target.kind)) {
    throw new Error(
      `${LONG_ENTITY_KIND_LABELS[target.kind]}不支持删除，请提示用户在界面上操作。`
    );
  }
  const type = DELETE_OPERATION_TYPES[target.kind];
  if (target.kind === "worldbuilding_item") {
    return LongWorkspaceOperationSchema.parse({
      type: "worldbuildingItem.delete",
      categoryId: target.categoryId,
      id: target.id
    });
  }
  return LongWorkspaceOperationSchema.parse({ type, id: target.id });
}
