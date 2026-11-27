import {
  applyLongWorkspaceOperations,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";
import { allEntityIds } from "./shared";

export interface OverlayDocument {
  content: string;
  file: LongWorkspaceFileReference;
  fromContinuityProposal?: true;
}

type Creation = Extract<LongWorkspaceOperation, { type: `${string}.create` }>;

function isCreation(operation: LongWorkspaceOperation): operation is Creation {
  return operation.type.endsWith(".create");
}

function createdId(operation: Creation): string | undefined {
  switch (operation.type) {
    case "worldbuilding.create":
      return operation.category.id;
    case "worldbuildingItem.create":
      return operation.item.id;
    case "characterType.create":
      return operation.characterType.id;
    case "character.create":
      return operation.character.id;
    case "volume.create":
      return operation.volume.id;
    case "arc.create":
      return operation.arc.id;
    case "storyPlot.create":
      return operation.storyPlot.id;
    case "chapter.create":
      return operation.chapterCard.id;
    case "event.create":
      return operation.event.id;
    case "connection.create":
      return operation.connection.id;
    case "placement.create":
      return operation.placement.id;
    case "foreshadowing.create":
      return operation.thread.id;
    case "foreshadowingBeat.create":
      return operation.beat.id;
    case "chapterContinuity.worldReveals.create":
    case "chapterContinuity.character.create":
      return undefined;
  }
}

function alreadyCreated(
  index: LongWorkspaceIndexSnapshot,
  operation: Creation,
  knownIds: ReadonlySet<string>
): boolean {
  const id = createdId(operation);
  if (id) return knownIds.has(id);
  if (operation.type === "chapterContinuity.worldReveals.create") {
    return index.chapters.some(
      (chapter) =>
        chapter.chapterCardId === operation.chapterCardId &&
        chapter.worldReveals !== null
    );
  }
  if (operation.type === "chapterContinuity.character.create") {
    return index.chapters.some(
      (chapter) =>
        chapter.chapterCardId === operation.chapterCardId &&
        chapter.characterContinuity.some(
          (entry) => entry.characterId === operation.characterId
        )
    );
  }
  return false;
}

/** Secondary files are created empty even when only the primary body is supplied. */
function initialFiles(operation: Creation): LongWorkspaceFileReference[] {
  if (operation.type === "character.create") {
    return [operation.files.coreProfile, operation.files.relationships];
  }
  if (operation.type === "chapter.create") {
    const files = operation.files;
    return [
      files.card,
      files.body,
      files.characterState,
      files.handoff,
      files.foreshadowingChanges
    ];
  }
  return [];
}

function patchFile(
  index: LongWorkspaceIndexSnapshot,
  file: LongWorkspaceFileReference
): void {
  const replace = (current: LongWorkspaceFileReference) =>
    current.id === file.id ? file : current;
  index.bookLine = replace(index.bookLine);
  if (index.characterOverview)
    index.characterOverview = replace(index.characterOverview);
  for (const category of index.worldbuilding) {
    if (category.format === "text") category.file = replace(category.file);
    else {
      if (category.overview) category.overview = replace(category.overview);
      for (const item of category.items) item.file = replace(item.file);
    }
  }
  for (const character of index.characterFiles) {
    character.coreProfile = replace(character.coreProfile);
    character.relationships = replace(character.relationships);
  }
  for (const chapter of index.chapters) {
    chapter.body = replace(chapter.body);
    chapter.card = replace(chapter.card);
    chapter.characterState = replace(chapter.characterState);
    chapter.handoff = replace(chapter.handoff);
    chapter.foreshadowingChanges = replace(chapter.foreshadowingChanges);
    if (chapter.worldReveals)
      chapter.worldReveals = replace(chapter.worldReveals);
    for (const entry of chapter.characterContinuity) {
      entry.currentState = replace(entry.currentState);
      entry.history = replace(entry.history);
    }
  }
  for (const storyPlot of index.plot.storyPlots)
    storyPlot.file = replace(storyPlot.file);
}

/** Same-run view of proposals that have not necessarily landed in Core yet. */
export function createProposalOverlay() {
  const structure: Creation[] = [];
  const documents = new Map<string, OverlayDocument>();
  let inFlightReload: Promise<LongWorkspaceIndexSnapshot> | undefined;

  return {
    remember(
      operations: readonly LongWorkspaceOperation[],
      writes: readonly OverlayDocument[]
    ): void {
      inFlightReload = undefined;
      for (const operation of operations) {
        if (!isCreation(operation)) continue;
        structure.push(structuredClone(operation));
        for (const file of initialFiles(operation)) {
          if (!documents.has(file.id))
            documents.set(file.id, { content: "", file });
        }
      }
      for (const write of writes) documents.set(write.file.id, write);
    },
    /** Coalesces concurrent clean index loads so parallel subagents share one IPC round-trip. */
    coalesceIndexReload(
      loader: () => Promise<LongWorkspaceIndexSnapshot>
    ): Promise<LongWorkspaceIndexSnapshot> {
      if (inFlightReload) return inFlightReload;
      const promise = loader().finally(() => {
        if (inFlightReload === promise) inFlightReload = undefined;
      });
      inFlightReload = promise;
      return promise;
    },
    applyToIndex(
      index: LongWorkspaceIndexSnapshot
    ): LongWorkspaceIndexSnapshot {
      if (structure.length === 0 && documents.size === 0) return index;
      const knownIds = allEntityIds(index);
      const operations = structure.filter((operation) => {
        if (alreadyCreated(index, operation, knownIds)) return false;
        const id = createdId(operation);
        if (id) knownIds.add(id);
        return true;
      });
      // Apply once for the whole overlay, using Core's ordering/reference rules.
      const next = operations.length
        ? applyLongWorkspaceOperations(index, {
            updatedAt: index.updatedAt,
            operations,
            documentWrites: []
          }).snapshot
        : structuredClone(index);
      for (const write of documents.values()) patchFile(next, write.file);
      return next;
    },
    document(fileId: string): OverlayDocument | undefined {
      return documents.get(fileId);
    },
    /** After the user settled the proposals, Core is the only source again. */
    clear(): void {
      inFlightReload = undefined;
      structure.length = 0;
      documents.clear();
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
