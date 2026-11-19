import type {
  LongMutationContentChange,
  LongMutationReview,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  LONG_BOOK_LINE_FILE_ID,
  serializeLongForeshadowingBody
} from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../types/conversation";
import { buildAgentTextDiff, type AgentTextDiffResult } from "./agentTextDiff";

const ENTITY_KIND_LABELS: Record<LongMutationReview["targetKind"], string> = {
  worldbuilding_category: "世界观分类",
  worldbuilding_item: "世界观条目",
  character: "人物",
  character_overview: "人物概览",
  book_line: "全书故事线",
  volume: "分卷",
  arc: "剧情点",
  story_plot: "故事情节",
  chapter_card: "章卡",
  story_event: "故事事件",
  event_connection: "事件连接",
  narrative_placement: "叙事落点",
  foreshadowing: "伏笔线",
  foreshadowing_beat: "伏笔触点",
  continuity_file: "连续性文件"
};

function entityDisplayTitle(
  kind: LongMutationReview["targetKind"],
  id: string,
  index?: LongWorkspaceIndexSnapshot | null
): string | undefined {
  if (!index) return undefined;
  switch (kind) {
    case "volume":
      return index.plot.volumes.find((item) => item.id === id)?.title;
    case "arc":
      return index.plot.arcs.find((item) => item.id === id)?.title;
    case "chapter_card":
      return index.plot.chapterCards.find((item) => item.id === id)?.title;
    case "story_plot":
      return index.plot.storyPlots.find((item) => item.id === id)?.title;
    case "story_event":
      return index.plot.storyEvents.find((item) => item.id === id)?.title;
    case "foreshadowing":
      return index.plot.foreshadowing.find((item) => item.id === id)?.title;
    case "character":
      return index.characters.find((item) => item.id === id)?.name;
    case "worldbuilding_category":
      return index.worldbuilding.find((item) => item.id === id)?.title;
    case "worldbuilding_item":
      for (const category of index.worldbuilding) {
        if (category.format !== "list") continue;
        const found = category.items.find((item) => item.id === id);
        if (found) return `${category.title} / ${found.title}`;
      }
      return undefined;
    default:
      return undefined;
  }
}

function contentFromIndexProse(
  operation: LongWorkspaceOperation
): LongMutationContentChange | undefined {
  switch (operation.type) {
    case "volume.create":
      return operation.volume.summary.trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.volume.summary
          }
        : undefined;
    case "arc.create":
      return (operation.arc.summary ?? "").trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.arc.summary ?? ""
          }
        : undefined;
    case "event.create":
      return operation.event.summary.trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.event.summary
          }
        : undefined;
    case "connection.create":
      return operation.connection.note.trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.connection.note
          }
        : undefined;
    case "placement.create":
      return operation.placement.writingPrompt.trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.placement.writingPrompt
          }
        : undefined;
    case "foreshadowing.create": {
      const thread = operation.thread;
      if (
        !thread.coreQuestion.trim() &&
        !(thread.hiddenTruth ?? "").trim() &&
        !thread.expectedReaderEffect.trim()
      ) {
        return undefined;
      }
      return {
        operation: "create",
        beforeText: "",
        afterText: serializeLongForeshadowingBody(thread)
      };
    }
    case "foreshadowingBeat.create":
      return operation.beat.note.trim()
        ? {
            operation: "create",
            beforeText: "",
            afterText: operation.beat.note
          }
        : undefined;
    default:
      return undefined;
  }
}

function singleOperationTarget(
  operation: LongWorkspaceOperation,
  index?: LongWorkspaceIndexSnapshot | null
):
  | {
      kind: LongMutationReview["targetKind"];
      id: string;
      action: LongMutationReview["action"];
      title: string;
    }
  | undefined {
  switch (operation.type) {
    case "volume.create":
      return {
        kind: "volume",
        id: operation.volume.id,
        action: "create",
        title: `新建分卷 · ${operation.volume.title}`
      };
    case "arc.create":
      return {
        kind: "arc",
        id: operation.arc.id,
        action: "create",
        title: `新建剧情点 · ${operation.arc.title}`
      };
    case "storyPlot.create":
      return {
        kind: "story_plot",
        id: operation.storyPlot.id,
        action: "create",
        title: `新建故事情节 · ${operation.storyPlot.title}`
      };
    case "chapter.create":
      return {
        kind: "chapter_card",
        id: operation.chapterCard.id,
        action: "create",
        title: `新建章卡 · ${operation.chapterCard.title}`
      };
    case "event.create":
      return {
        kind: "story_event",
        id: operation.event.id,
        action: "create",
        title: `新建故事事件 · ${operation.event.title}`
      };
    case "connection.create":
      return {
        kind: "event_connection",
        id: operation.connection.id,
        action: "create",
        title: "新建事件连接"
      };
    case "placement.create":
      return {
        kind: "narrative_placement",
        id: operation.placement.id,
        action: "create",
        title: "新建叙事落点"
      };
    case "foreshadowing.create":
      return {
        kind: "foreshadowing",
        id: operation.thread.id,
        action: "create",
        title: `新建伏笔线 · ${operation.thread.title}`
      };
    case "foreshadowingBeat.create":
      return {
        kind: "foreshadowing_beat",
        id: operation.beat.id,
        action: "create",
        title: "新建伏笔触点"
      };
    case "volume.update":
    case "arc.update":
    case "arc.move":
    case "storyPlot.update":
    case "chapter.update":
    case "chapter.move":
    case "event.update":
    case "connection.update":
    case "placement.update":
    case "placement.move":
    case "foreshadowing.update":
    case "foreshadowingBeat.update":
    case "foreshadowingBeat.move":
    case "character.update":
    case "character.move":
    case "worldbuilding.update":
    case "worldbuildingItem.update": {
      const kindMap: Record<string, LongMutationReview["targetKind"]> = {
        "volume.update": "volume",
        "arc.update": "arc",
        "arc.move": "arc",
        "storyPlot.update": "story_plot",
        "chapter.update": "chapter_card",
        "chapter.move": "chapter_card",
        "event.update": "story_event",
        "connection.update": "event_connection",
        "placement.update": "narrative_placement",
        "placement.move": "narrative_placement",
        "foreshadowing.update": "foreshadowing",
        "foreshadowingBeat.update": "foreshadowing_beat",
        "foreshadowingBeat.move": "foreshadowing_beat",
        "character.update": "character",
        "character.move": "character",
        "worldbuilding.update": "worldbuilding_category",
        "worldbuildingItem.update": "worldbuilding_item"
      };
      const kind = kindMap[operation.type]!;
      const name = entityDisplayTitle(kind, operation.id, index);
      const prefix =
        kind === "character" ? "人物信息" : ENTITY_KIND_LABELS[kind];
      return {
        kind,
        id: operation.id,
        action: "meta",
        title: name ? `${prefix} · ${name}` : prefix
      };
    }
    case "chapter.reorder": {
      const name = entityDisplayTitle("volume", operation.volumeId, index);
      return {
        kind: "volume",
        id: operation.volumeId,
        action: "meta",
        title: name ? `分卷 · ${name}` : "分卷章节顺序"
      };
    }
    case "volume.delete":
    case "arc.delete":
    case "storyPlot.delete":
    case "chapter.delete":
    case "event.delete":
    case "connection.delete":
    case "placement.delete":
    case "foreshadowing.delete":
    case "foreshadowingBeat.delete":
    case "character.delete":
    case "worldbuilding.delete":
    case "worldbuildingItem.delete": {
      const kindMap: Record<string, LongMutationReview["targetKind"]> = {
        "volume.delete": "volume",
        "arc.delete": "arc",
        "storyPlot.delete": "story_plot",
        "chapter.delete": "chapter_card",
        "event.delete": "story_event",
        "connection.delete": "event_connection",
        "placement.delete": "narrative_placement",
        "foreshadowing.delete": "foreshadowing",
        "foreshadowingBeat.delete": "foreshadowing_beat",
        "character.delete": "character",
        "worldbuilding.delete": "worldbuilding_category",
        "worldbuildingItem.delete": "worldbuilding_item"
      };
      const kind = kindMap[operation.type]!;
      const name = entityDisplayTitle(kind, operation.id, index);
      return {
        kind,
        id: operation.id,
        action: "delete",
        title: name
          ? `删除${ENTITY_KIND_LABELS[kind]} · ${name}`
          : `删除${ENTITY_KIND_LABELS[kind]}`
      };
    }
    case "chapterContinuity.worldReveals.delete":
    case "chapterContinuity.character.delete": {
      const chapter = entityDisplayTitle(
        "chapter_card",
        operation.chapterCardId,
        index
      );
      return {
        kind: "continuity_file",
        id: operation.chapterCardId,
        action: "delete",
        title: chapter ? `删除连续性文件 · ${chapter}` : "删除连续性文件"
      };
    }
    default:
      return undefined;
  }
}

function twoOpSameTarget(
  operations: readonly LongWorkspaceOperation[],
  index?: LongWorkspaceIndexSnapshot | null
):
  | {
      kind: LongMutationReview["targetKind"];
      id: string;
      title: string;
    }
  | undefined {
  if (operations.length !== 2) return undefined;
  const [first, second] = operations;
  if (!first || !second) return undefined;
  if (
    (first.type === "character.update" &&
      second.type === "character.move" &&
      first.id === second.id) ||
    (first.type === "character.move" &&
      second.type === "character.update" &&
      first.id === second.id)
  ) {
    const name = entityDisplayTitle("character", first.id, index);
    return {
      kind: "character",
      id: first.id,
      title: name ? `人物信息 · ${name}` : "人物信息"
    };
  }
  if (
    (first.type === "chapter.update" &&
      second.type === "chapter.move" &&
      first.id === second.id) ||
    (first.type === "chapter.move" &&
      second.type === "chapter.update" &&
      first.id === second.id)
  ) {
    const name = entityDisplayTitle("chapter_card", first.id, index);
    return {
      kind: "chapter_card",
      id: first.id,
      title: name ? `章卡 · ${name}` : "章卡"
    };
  }
  if (
    first.type === "volume.update" &&
    second.type === "chapter.reorder" &&
    first.id === second.volumeId
  ) {
    const name = entityDisplayTitle("volume", first.id, index);
    return {
      kind: "volume",
      id: first.id,
      title: name ? `分卷 · ${name}` : "分卷"
    };
  }
  return undefined;
}

/**
 * Fallback review metadata when an older persisted proposal or test batch lacks
 * an explicit `review` payload. Multi-target batches stay ungrouped rather than
 * inventing a misleading single target.
 */
export function deriveLongMutationReviewFromBatch(
  batch: LongWorkspaceOperationBatch,
  index?: LongWorkspaceIndexSnapshot | null
): LongMutationReview | undefined {
  if (batch.operations.length === 0 && batch.documentWrites.length === 1) {
    const write = batch.documentWrites[0]!;
    if (write.fileId === LONG_BOOK_LINE_FILE_ID) {
      return {
        targetKey: `doc:${write.fileId}`,
        targetKind: "book_line",
        targetId: "book_line",
        action: "edit",
        title: "全书故事线",
        content: {
          fileId: write.fileId,
          operation: write.mode === "create" ? "create" : "write",
          beforeText: "",
          afterText: write.content
        }
      };
    }
    const chapter = index?.chapters.find(
      (entry) => entry.card.id === write.fileId
    );
    if (chapter) {
      const cardTitle = entityDisplayTitle(
        "chapter_card",
        chapter.chapterCardId,
        index
      );
      return {
        targetKey: `doc:${write.fileId}`,
        targetKind: "chapter_card",
        targetId: chapter.chapterCardId,
        action: "edit",
        title: cardTitle ? `${cardTitle} / 章卡` : "章卡",
        content: {
          fileId: write.fileId,
          filePath: chapter.card.path,
          operation: write.mode === "create" ? "create" : "write",
          beforeText: "",
          afterText: write.content
        }
      };
    }
    const storyPlot = index?.plot.storyPlots.find(
      (entry) => entry.file.id === write.fileId
    );
    if (storyPlot) {
      return {
        targetKey: `doc:${write.fileId}`,
        targetKind: "story_plot",
        targetId: storyPlot.id,
        action: "edit",
        title: `故事情节 · ${storyPlot.title}`,
        content: {
          fileId: write.fileId,
          filePath: storyPlot.file.path,
          operation: write.mode === "create" ? "create" : "write",
          beforeText: "",
          afterText: write.content
        }
      };
    }
    return {
      targetKey: `doc:${write.fileId}`,
      targetKind: write.fileId.startsWith("file_chapter_")
        ? "chapter_card"
        : "story_plot",
      targetId: write.fileId,
      action: "edit",
      title: write.fileId.startsWith("file_chapter_") ? "章卡" : "故事情节",
      content: {
        fileId: write.fileId,
        operation: write.mode === "create" ? "create" : "write",
        beforeText: "",
        afterText: write.content
      }
    };
  }

  if (batch.operations.length === 1) {
    const operation = batch.operations[0]!;
    const target = singleOperationTarget(operation, index);
    if (!target) return undefined;

    if (
      (operation.type === "chapter.create" ||
        operation.type === "storyPlot.create") &&
      batch.documentWrites.length <= 1
    ) {
      const write = batch.documentWrites[0];
      const fileId =
        operation.type === "chapter.create"
          ? operation.files.card.id
          : operation.storyPlot.file.id;
      const filePath =
        operation.type === "chapter.create"
          ? operation.files.card.path
          : operation.storyPlot.file.path;
      return {
        targetKey: `create:${target.id}`,
        targetKind: target.kind,
        targetId: target.id,
        action: "create",
        title: target.title.slice(0, 600),
        ...(write && write.fileId === fileId && write.content.length > 0
          ? {
              content: {
                fileId,
                filePath,
                operation: "create",
                beforeText: "",
                afterText: write.content
              }
            }
          : {})
      };
    }

    if (target.action === "create" && batch.documentWrites.length === 0) {
      const content = contentFromIndexProse(operation);
      return {
        targetKey: `create:${target.id}`,
        targetKind: target.kind,
        targetId: target.id,
        action: "create",
        title: target.title.slice(0, 600),
        ...(content ? { content } : {})
      };
    }

    if (
      (operation.type === "chapter.update" ||
        operation.type === "chapter.move") &&
      batch.documentWrites.length === 1
    ) {
      const write = batch.documentWrites[0]!;
      const chapter = index?.chapters.find(
        (entry) => entry.chapterCardId === operation.id
      );
      return {
        targetKey: `doc:${write.fileId}`,
        targetKind: "chapter_card",
        targetId: operation.id,
        action: "edit",
        title: `${
          entityDisplayTitle("chapter_card", operation.id, index) ?? "章卡"
        } / 章卡`.slice(0, 600),
        content: {
          fileId: write.fileId,
          ...(chapter ? { filePath: chapter.card.path } : {}),
          operation: write.mode === "create" ? "create" : "write",
          beforeText: "",
          afterText: write.content
        }
      };
    }

    if (batch.documentWrites.length === 0) {
      const prefix =
        target.action === "delete"
          ? "delete"
          : target.kind === "character" || target.kind === "chapter_card"
            ? "meta"
            : "entity";
      return {
        targetKey: `${prefix}:${target.id}`,
        targetKind: target.kind,
        targetId: target.id,
        action: target.action,
        title: target.title.slice(0, 600)
      };
    }
  }

  if (batch.documentWrites.length === 0) {
    const pair = twoOpSameTarget(batch.operations, index);
    if (pair) {
      return {
        targetKey: `meta:${pair.id}`,
        targetKind: pair.kind,
        targetId: pair.id,
        action: "meta",
        title: pair.title.slice(0, 600)
      };
    }
  }

  return undefined;
}

export function longMutationProposalDiff(
  review: LongMutationReview | undefined
): AgentTextDiffResult {
  const content = review?.content;
  if (
    !content ||
    (content.operation === "create" && content.afterText.length === 0)
  ) {
    return { additions: 0, deletions: 0, hunks: [], truncated: false };
  }
  return buildAgentTextDiff(content.beforeText, content.afterText);
}

export function longBatchCreatedEntityIds(
  batch: LongWorkspaceOperationBatch
): Set<string> {
  const ids = new Set<string>();
  for (const operation of batch.operations) {
    switch (operation.type) {
      case "worldbuilding.create":
        ids.add(operation.category.id);
        if (operation.category.format === "text") {
          ids.add(operation.category.file.id);
        } else if (operation.category.overview) {
          ids.add(operation.category.overview.id);
        }
        break;
      case "worldbuildingItem.create":
        ids.add(operation.item.id);
        ids.add(operation.item.file.id);
        break;
      case "characterType.create":
        ids.add(operation.characterType.id);
        break;
      case "character.create":
        ids.add(operation.character.id);
        ids.add(operation.files.coreProfile.id);
        ids.add(operation.files.relationships.id);
        break;
      case "volume.create":
        ids.add(operation.volume.id);
        break;
      case "arc.create":
        ids.add(operation.arc.id);
        break;
      case "storyPlot.create":
        ids.add(operation.storyPlot.id);
        ids.add(operation.storyPlot.file.id);
        break;
      case "chapter.create":
        ids.add(operation.chapterCard.id);
        ids.add(operation.files.body.id);
        ids.add(operation.files.card.id);
        ids.add(operation.files.characterState.id);
        ids.add(operation.files.handoff.id);
        ids.add(operation.files.foreshadowingChanges.id);
        break;
      case "event.create":
        ids.add(operation.event.id);
        break;
      case "connection.create":
        ids.add(operation.connection.id);
        break;
      case "placement.create":
        ids.add(operation.placement.id);
        break;
      case "foreshadowing.create":
        ids.add(operation.thread.id);
        break;
      case "foreshadowingBeat.create":
        ids.add(operation.beat.id);
        break;
      case "chapterContinuity.worldReveals.create":
        ids.add(operation.file.id);
        break;
      case "chapterContinuity.character.create":
        ids.add(operation.currentState.id);
        ids.add(operation.history.id);
        break;
    }
  }
  return ids;
}

export function longProposalCreatedEntityIds(
  proposal: AgentEditProposal
): Set<string> {
  const batch =
    proposal.longPlotDesignTarget?.batch ??
    proposal.longCharacterTarget?.batch ??
    proposal.longWorldbuildingTarget?.batch;
  return batch ? longBatchCreatedEntityIds(batch) : new Set();
}

export function longBatchReferencedIds(
  batch: LongWorkspaceOperationBatch
): Set<string> {
  const ids = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value) ids.add(value);
  };
  for (const write of batch.documentWrites) {
    if (write.mode !== "create") add(write.fileId);
  }
  for (const operation of batch.operations) {
    switch (operation.type) {
      case "worldbuilding.update":
      case "worldbuilding.delete":
      case "characterType.update":
      case "characterType.delete":
      case "character.update":
      case "character.delete":
      case "volume.update":
      case "volume.delete":
      case "arc.update":
      case "arc.delete":
      case "storyPlot.update":
      case "storyPlot.delete":
      case "chapter.update":
      case "chapter.delete":
      case "connection.delete":
      case "placement.delete":
      case "foreshadowing.delete":
      case "foreshadowingBeat.delete":
        add(operation.id);
        if (operation.type === "characterType.delete") {
          add(operation.moveCharactersToTypeId);
        }
        break;
      case "worldbuilding.reorder":
      case "characterType.reorder":
      case "volume.reorder":
      case "event.reorder":
      case "foreshadowing.reorder":
        operation.orderedIds.forEach(add);
        break;
      case "worldbuildingItem.create":
        add(operation.categoryId);
        break;
      case "worldbuildingItem.update":
      case "worldbuildingItem.delete":
        add(operation.categoryId);
        add(operation.id);
        break;
      case "worldbuildingItem.reorder":
        add(operation.categoryId);
        operation.orderedIds.forEach(add);
        break;
      case "character.create":
        add(operation.character.group);
        break;
      case "character.move":
        add(operation.id);
        add(operation.toGroup);
        add(operation.beforeCharacterId);
        break;
      case "character.reorder":
        add(operation.group);
        operation.orderedIds.forEach(add);
        break;
      case "arc.create":
        add(operation.arc.volumeId);
        break;
      case "arc.move":
        add(operation.id);
        add(operation.toVolumeId);
        add(operation.beforeArcId);
        break;
      case "arc.reorder":
        add(operation.volumeId);
        operation.orderedIds.forEach(add);
        break;
      case "storyPlot.create":
        add(operation.storyPlot.arcId);
        break;
      case "storyPlot.reorder":
        add(operation.arcId);
        operation.orderedIds.forEach(add);
        break;
      case "chapter.create":
        add(operation.chapterCard.volumeId);
        add(operation.chapterCard.primaryArcId);
        break;
      case "chapter.move":
        add(operation.id);
        add(operation.toVolumeId);
        add(operation.toPrimaryArcId);
        add(operation.beforeChapterCardId);
        break;
      case "chapter.reorder":
        add(operation.volumeId);
        operation.orderedIds.forEach(add);
        break;
      case "chapterContinuity.worldReveals.create":
      case "chapterContinuity.worldReveals.delete":
        add(operation.chapterCardId);
        break;
      case "chapterContinuity.character.create":
      case "chapterContinuity.character.delete":
        add(operation.chapterCardId);
        add(operation.characterId);
        break;
      case "event.create":
        operation.event.arcIds.forEach(add);
        operation.event.characterIds.forEach(add);
        break;
      case "event.update":
        add(operation.id);
        operation.patch.arcIds?.forEach(add);
        operation.patch.characterIds?.forEach(add);
        break;
      case "event.delete":
        add(operation.id);
        break;
      case "connection.create":
        add(operation.connection.sourceEventId);
        add(operation.connection.targetEventId);
        break;
      case "connection.update":
        add(operation.id);
        add(operation.patch.sourceEventId);
        add(operation.patch.targetEventId);
        break;
      case "placement.create":
        add(operation.placement.eventId);
        add(operation.placement.chapterCardId);
        break;
      case "placement.update":
        add(operation.id);
        add(operation.patch.eventId);
        break;
      case "placement.move":
        add(operation.id);
        add(operation.toChapterCardId);
        add(operation.beforePlacementId);
        break;
      case "placement.reorder":
        add(operation.chapterCardId);
        operation.orderedIds.forEach(add);
        break;
      case "foreshadowing.create":
        add(operation.thread.truthEventId);
        break;
      case "foreshadowing.update":
        add(operation.id);
        add(operation.patch.truthEventId);
        break;
      case "foreshadowingBeat.create":
        add(operation.threadId);
        add(operation.beat.volumeId);
        add(operation.beat.arcId);
        add(operation.beat.eventId);
        add(operation.beat.placementId);
        add(operation.beat.chapterCardId);
        break;
      case "foreshadowingBeat.update":
        add(operation.id);
        add(operation.patch.volumeId);
        add(operation.patch.arcId);
        add(operation.patch.eventId);
        add(operation.patch.placementId);
        add(operation.patch.chapterCardId);
        break;
      case "foreshadowingBeat.move":
        add(operation.id);
        add(operation.toThreadId);
        add(operation.beforeBeatId);
        break;
      case "foreshadowingBeat.reorder":
        add(operation.threadId);
        operation.orderedIds.forEach(add);
        break;
    }
  }
  return ids;
}

export function findSameRunLongPrerequisites(
  proposals: readonly AgentEditProposal[],
  batch: LongWorkspaceOperationBatch,
  excludeProposalId?: string
): AgentEditProposal[] {
  const referenced = longBatchReferencedIds(batch);
  if (referenced.size === 0) return [];
  return proposals
    .filter((proposal) => {
      if (proposal.id === excludeProposalId) return false;
      const created = longProposalCreatedEntityIds(proposal);
      if (created.size === 0) return false;
      for (const id of created) {
        if (referenced.has(id)) return true;
      }
      return false;
    })
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
}
