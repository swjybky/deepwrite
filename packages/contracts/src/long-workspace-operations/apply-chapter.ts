import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
import { deleteChapter } from "./cascade";
import {
  addFileCreateIntent,
  assertChapterIsMutable,
  assertExactOrder,
  assertNewEntityId,
  concreteChapterIdForBeat,
  ensureFilesAvailable,
  findEntityIndex,
  insertBeforeId,
  markCreated,
  markUpdated,
  nextOrder,
  operationError,
  registerProvisionalId,
  retargetBeatPlanningAnchorsToChapter,
  updateOrdersById
} from "./state";

/**
 * Chapter card titles must stay unique within a volume so duplicate agent
 * tool calls (or repeated proposals) cannot stack same-named empty cards in
 * the manuscript directory.
 */
function assertChapterTitleAvailable(
  workspace: LongWorkspaceIndexSnapshot,
  volumeId: string,
  title: string,
  exceptChapterCardId?: string
): void {
  const duplicated = workspace.plot.chapterCards.some(
    (candidate) =>
      candidate.id !== exceptChapterCardId &&
      candidate.volumeId === volumeId &&
      candidate.title === title
  );
  if (duplicated) {
    operationError(
      "already_exists",
      `Chapter card titled "${title}" already exists in this volume.`
    );
  }
}

export function applyChapterOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "chapter.create": {
      assertNewEntityId(
        workspace.plot.chapterCards,
        operation.chapterCard.id,
        "Chapter card"
      );
      assertChapterTitleAvailable(
        workspace,
        operation.chapterCard.volumeId,
        operation.chapterCard.title
      );
      if (
        operation.files.chapterCardId !== operation.chapterCard.id ||
        operation.files.commitId !== null
      ) {
        operationError(
          "invalid_reference",
          "New chapter files must reference the created uncommitted chapter."
        );
      }
      const files = [
        operation.files.body,
        operation.files.card,
        operation.files.characterState,
        operation.files.handoff,
        operation.files.foreshadowingChanges,
        ...(operation.files.worldReveals ? [operation.files.worldReveals] : []),
        ...operation.files.characterContinuity.flatMap((character) => [
          character.currentState,
          character.history
        ])
      ];
      ensureFilesAvailable(state, files);
      const chapterCard = structuredClone(operation.chapterCard);
      chapterCard.narrativeOrder = nextOrder(
        workspace.plot.chapterCards
          .filter((candidate) => candidate.volumeId === chapterCard.volumeId)
          .map(({ narrativeOrder }) => narrativeOrder)
      );
      workspace.plot.chapterCards.push(chapterCard);
      workspace.chapters.push(structuredClone(operation.files));
      files.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create chapter ${operation.chapterCard.id}`
        )
      );
      markCreated(state, operation.chapterCard.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.chapterCard.id
      );
      break;
    }
    case "chapter.update": {
      const chapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.id,
            "Chapter card"
          )
        ]!;
      if (
        operation.patch.title !== undefined &&
        operation.patch.title !== chapter.title
      ) {
        assertChapterTitleAvailable(
          workspace,
          chapter.volumeId,
          operation.patch.title,
          chapter.id
        );
      }
      Object.assign(chapter, operation.patch);
      markUpdated(state, chapter.id);
      break;
    }
    case "chapter.delete":
      deleteChapter(state, operation.id);
      break;
    case "chapter.move": {
      assertChapterIsMutable(workspace, operation.id, "move");
      findEntityIndex(
        workspace.plot.volumes,
        operation.toVolumeId,
        "Target volume"
      );
      if (operation.toPrimaryArcId !== null) {
        const targetArc =
          workspace.plot.arcs[
            findEntityIndex(
              workspace.plot.arcs,
              operation.toPrimaryArcId,
              "Target primary arc"
            )
          ]!;
        if (targetArc.volumeId !== operation.toVolumeId) {
          operationError(
            "invalid_reference",
            "Target chapter volume and primary arc must match."
          );
        }
      }
      const chapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.id,
            "Chapter card"
          )
        ]!;
      chapter.volumeId = operation.toVolumeId;
      chapter.primaryArcId = operation.toPrimaryArcId;
      workspace.plot.foreshadowing.forEach((thread) => {
        thread.beats.forEach((beat) => {
          if (concreteChapterIdForBeat(workspace, beat) !== chapter.id) return;
          retargetBeatPlanningAnchorsToChapter(
            state,
            beat,
            chapter,
            "move with its concrete chapter"
          );
        });
      });
      const target = workspace.plot.chapterCards
        .filter(({ volumeId }) => volumeId === operation.toVolumeId)
        .sort((left, right) => left.narrativeOrder - right.narrativeOrder);
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        chapter.id,
        operation.beforeChapterCardId,
        "Chapter move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.narrativeOrder = order;
        },
        state
      );
      markUpdated(state, chapter.id);
      break;
    }
    case "chapter.reorder": {
      const target = workspace.plot.chapterCards
        .filter(({ volumeId }) => volumeId === operation.volumeId)
        .sort((left, right) => left.narrativeOrder - right.narrativeOrder);
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Chapters in ${operation.volumeId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.narrativeOrder = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
