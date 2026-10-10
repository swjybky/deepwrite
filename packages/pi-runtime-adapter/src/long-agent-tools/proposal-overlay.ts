import type {
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation
} from "@deepwrite/contracts";
import { maxOrder } from "./shared";

export interface OverlayDocument {
  content: string;
  file: LongWorkspaceFileReference;
}

function chapterById(index: LongWorkspaceIndexSnapshot, chapterCardId: string) {
  return index.chapters.find((entry) => entry.chapterCardId === chapterCardId);
}

function applyStructure(
  index: LongWorkspaceIndexSnapshot,
  operation: LongWorkspaceOperation
): void {
  if (operation.type === "chapter.create") {
    if (
      index.plot.chapterCards.some(({ id }) => id === operation.chapterCard.id)
    ) {
      return;
    }
    index.plot.chapterCards.push(structuredClone(operation.chapterCard));
    if (
      !index.chapters.some(
        ({ chapterCardId }) => chapterCardId === operation.chapterCard.id
      )
    ) {
      index.chapters.push(structuredClone(operation.files));
    }
    return;
  }
  if (operation.type === "storyPlot.create") {
    if (
      index.plot.storyPlots.some(({ id }) => id === operation.storyPlot.id) ||
      !index.plot.arcs.some(({ id }) => id === operation.storyPlot.arcId)
    ) {
      return;
    }
    const storyPlot = structuredClone(operation.storyPlot);
    storyPlot.order =
      maxOrder(
        index.plot.storyPlots
          .filter((candidate) => candidate.arcId === storyPlot.arcId)
          .map(({ order }) => order)
      ) + 1;
    index.plot.storyPlots.push(storyPlot);
    return;
  }
  if (operation.type === "chapterContinuity.worldReveals.create") {
    const chapter = chapterById(index, operation.chapterCardId);
    if (chapter && !chapter.worldReveals) {
      chapter.worldReveals = structuredClone(operation.file);
    }
    return;
  }
  if (operation.type !== "chapterContinuity.character.create") return;
  const chapter = chapterById(index, operation.chapterCardId);
  if (!chapter) return;
  if (
    chapter.characterContinuity.some(
      (entry) => entry.characterId === operation.characterId
    )
  ) {
    return;
  }
  chapter.characterContinuity.push({
    characterId: operation.characterId,
    currentState: structuredClone(operation.currentState),
    history: structuredClone(operation.history)
  });
}

function patchFile(
  index: LongWorkspaceIndexSnapshot,
  file: LongWorkspaceFileReference
): void {
  const replace = (
    current: LongWorkspaceFileReference | null | undefined
  ): LongWorkspaceFileReference | null | undefined =>
    current?.id === file.id ? file : current;

  for (const chapter of index.chapters) {
    chapter.body = replace(chapter.body) ?? chapter.body;
    chapter.card = replace(chapter.card) ?? chapter.card;
    chapter.characterState =
      replace(chapter.characterState) ?? chapter.characterState;
    chapter.handoff = replace(chapter.handoff) ?? chapter.handoff;
    chapter.foreshadowingChanges =
      replace(chapter.foreshadowingChanges) ?? chapter.foreshadowingChanges;
    chapter.worldReveals =
      replace(chapter.worldReveals) ?? chapter.worldReveals;
    for (const entry of chapter.characterContinuity) {
      entry.currentState = replace(entry.currentState) ?? entry.currentState;
      entry.history = replace(entry.history) ?? entry.history;
    }
  }
  for (const storyPlot of index.plot.storyPlots) {
    storyPlot.file = replace(storyPlot.file) ?? storyPlot.file;
  }
}

/** Same-run view of proposals that have not necessarily landed in Core yet. */
export function createProposalOverlay() {
  const structure: LongWorkspaceOperation[] = [];
  const documents = new Map<string, OverlayDocument>();

  return {
    remember(
      operations: readonly LongWorkspaceOperation[],
      writes: readonly OverlayDocument[]
    ): void {
      for (const operation of operations) {
        if (
          operation.type === "chapter.create" ||
          operation.type === "chapterContinuity.worldReveals.create" ||
          operation.type === "chapterContinuity.character.create" ||
          operation.type === "storyPlot.create"
        ) {
          structure.push(operation);
        }
      }
      for (const write of writes) {
        documents.set(write.file.id, write);
      }
    },
    applyToIndex(
      index: LongWorkspaceIndexSnapshot
    ): LongWorkspaceIndexSnapshot {
      if (structure.length === 0 && documents.size === 0) return index;
      const next = structuredClone(index);
      for (const operation of structure) applyStructure(next, operation);
      for (const write of documents.values()) patchFile(next, write.file);
      return next;
    },
    document(fileId: string): OverlayDocument | undefined {
      return documents.get(fileId);
    }
  };
}

export type ProposalOverlay = ReturnType<typeof createProposalOverlay>;

/** Pending proposal content shared for one parent run. */
export interface LongWorkspaceToolSharedState {
  readonly proposalOverlay: ProposalOverlay;
}

export function createLongWorkspaceToolSharedState(): LongWorkspaceToolSharedState {
  return { proposalOverlay: createProposalOverlay() };
}
