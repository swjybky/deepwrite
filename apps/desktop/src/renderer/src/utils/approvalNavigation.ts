import { createScopedTranslator } from "../i18n";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationBatch,
  LongWorkspaceRoot,
  LongBookSummary
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { AgentEditProposal } from "../types/conversation";
import {
  createLongChapterSelection,
  createLongCharacterGroupSelection,
  createLongCharacterOverviewSelection,
  createLongContinuitySelection,
  createLongPlotPointVolumeSelection,
  reconcileLongWorkspaceSelection,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import { createLongRootSelection } from "./longWorkspaceResourceTree";
import { longLedgerApprovalTarget } from "./longLedgerApprovalTarget";

const t = createScopedTranslator("workspace.approvalNavigation");

export type LongApprovalNavigationCandidate =
  | { kind: "file"; fileId: string }
  | { kind: "worldbuilding"; categoryId: string; itemId?: string }
  | { kind: "character"; characterId: string }
  | { kind: "character-group"; groupId: string }
  | { kind: "volume"; volumeId: string }
  | { kind: "arc"; arcId: string }
  | {
      kind: "chapter-card";
      chapterCardId: string;
      view: "card" | "draft" | "continuity";
    }
  | { kind: "story-plot"; storyPlotId: string }
  | { kind: "placement"; placementId: string }
  | { kind: "foreshadowing"; threadId?: string; beatId?: string }
  | { kind: "root"; root: LongWorkspaceRoot };

export type ApprovalNavigationTarget =
  | {
      kind: "document";
      workspaceId: string;
      documentId: string;
    }
  | {
      kind: "library";
      domain: "material" | "skill";
      libraryId: string;
      entryId?: string;
      documentId: string;
    }
  | {
      kind: "draft-section";
      workspaceId: string;
      sectionId?: string;
      fileKind: "body" | "character-state";
    }
  | {
      kind: "character-item";
      workspaceId: string;
      itemId?: string;
    }
  | {
      kind: "long";
      bookId: string;
      candidates: LongApprovalNavigationCandidate[];
    };

export interface LongApprovalEditorFocus {
  fileId?: string;
  bookLineVolumeId?: string;
  foreshadowingThreadId?: string;
  foreshadowingBeatId?: string;
}

export interface ResolvedLongApprovalNavigation {
  selection: LongWorkspaceSelection;
  focus?: LongApprovalEditorFocus;
  /** Index of the first candidate that still exists in the latest snapshot. */
  candidateIndex: number;
}

type ResolvedLongApprovalCandidate = Omit<
  ResolvedLongApprovalNavigation,
  "candidateIndex"
>;

function uniqueLongCandidates(
  candidates: readonly LongApprovalNavigationCandidate[]
): LongApprovalNavigationCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function longOperationCandidates(operation: LongWorkspaceOperation): {
  primary: LongApprovalNavigationCandidate[];
  fallback: LongApprovalNavigationCandidate[];
} {
  const root = (value: LongWorkspaceRoot): LongApprovalNavigationCandidate => ({
    kind: "root",
    root: value
  });
  switch (operation.type) {
    case "featureSettings.update":
      return { primary: [], fallback: [root("worldbuilding")] };
    case "worldbuilding.create":
      return {
        primary: [{ kind: "worldbuilding", categoryId: operation.category.id }],
        fallback: [root("worldbuilding")]
      };
    case "worldbuilding.update":
      return {
        primary: [{ kind: "worldbuilding", categoryId: operation.id }],
        fallback: [root("worldbuilding")]
      };
    case "worldbuilding.delete":
    case "worldbuilding.reorder":
      return { primary: [], fallback: [root("worldbuilding")] };
    case "worldbuildingItem.create":
      return {
        primary: [
          {
            kind: "worldbuilding",
            categoryId: operation.categoryId,
            itemId: operation.item.id
          }
        ],
        fallback: [
          { kind: "worldbuilding", categoryId: operation.categoryId },
          root("worldbuilding")
        ]
      };
    case "worldbuildingItem.update":
      return {
        primary: [
          {
            kind: "worldbuilding",
            categoryId: operation.categoryId,
            itemId: operation.id
          }
        ],
        fallback: [
          { kind: "worldbuilding", categoryId: operation.categoryId },
          root("worldbuilding")
        ]
      };
    case "worldbuildingItem.delete":
    case "worldbuildingItem.reorder":
      return {
        primary: [],
        fallback: [
          { kind: "worldbuilding", categoryId: operation.categoryId },
          root("worldbuilding")
        ]
      };
    case "characterType.create":
      return {
        primary: [
          { kind: "character-group", groupId: operation.characterType.id }
        ],
        fallback: [root("character_design")]
      };
    case "characterType.update":
      return {
        primary: [{ kind: "character-group", groupId: operation.id }],
        fallback: [root("character_design")]
      };
    case "characterType.delete":
    case "characterType.reorder":
      return { primary: [], fallback: [root("character_design")] };
    case "character.create":
      return {
        primary: [{ kind: "character", characterId: operation.character.id }],
        fallback: [
          { kind: "character-group", groupId: operation.character.group },
          root("character_design")
        ]
      };
    case "character.update":
    case "character.move":
      return {
        primary: [{ kind: "character", characterId: operation.id }],
        fallback: [root("character_design")]
      };
    case "character.delete":
      return { primary: [], fallback: [root("character_design")] };
    case "character.reorder":
      return {
        primary: [],
        fallback: [
          { kind: "character-group", groupId: operation.group },
          root("character_design")
        ]
      };
    case "volume.create":
      return {
        primary: [{ kind: "volume", volumeId: operation.volume.id }],
        fallback: [root("plot_design")]
      };
    case "volume.update":
      return {
        primary: [{ kind: "volume", volumeId: operation.id }],
        fallback: [root("plot_design")]
      };
    case "volume.delete":
    case "volume.reorder":
      return { primary: [], fallback: [root("plot_design")] };
    case "arc.create":
      return {
        primary: [{ kind: "arc", arcId: operation.arc.id }],
        fallback: [
          { kind: "volume", volumeId: operation.arc.volumeId },
          root("plot_design")
        ]
      };
    case "arc.update":
    case "arc.move":
      return {
        primary: [{ kind: "arc", arcId: operation.id }],
        fallback: [root("plot_design")]
      };
    case "arc.delete":
      return { primary: [], fallback: [root("plot_design")] };
    case "arc.reorder":
      return {
        primary: [],
        fallback: [
          { kind: "volume", volumeId: operation.volumeId },
          root("plot_design")
        ]
      };
    case "chapter.create":
      return {
        primary: [
          {
            kind: "chapter-card",
            chapterCardId: operation.chapterCard.id,
            view: "card"
          }
        ],
        fallback: [
          { kind: "volume", volumeId: operation.chapterCard.volumeId },
          root("plot_design")
        ]
      };
    case "chapter.update":
    case "chapter.move":
      return {
        primary: [
          { kind: "chapter-card", chapterCardId: operation.id, view: "card" }
        ],
        fallback: [root("plot_design")]
      };
    case "chapter.delete":
      return { primary: [], fallback: [root("plot_design")] };
    case "chapter.reorder":
      return {
        primary: [],
        fallback: [
          { kind: "volume", volumeId: operation.volumeId },
          root("plot_design")
        ]
      };
    case "chapterContinuity.worldReveals.create":
    case "chapterContinuity.worldReveals.delete":
    case "chapterContinuity.character.create":
    case "chapterContinuity.character.delete":
      return {
        primary: [
          {
            kind: "chapter-card",
            chapterCardId: operation.chapterCardId,
            view: "continuity"
          }
        ],
        fallback: [root("continuity_ledger")]
      };
    case "storyPlot.create":
      return {
        primary: [
          { kind: "file", fileId: operation.storyPlot.file.id },
          { kind: "story-plot", storyPlotId: operation.storyPlot.id }
        ],
        fallback: [root("plot_design")]
      };
    case "storyPlot.update":
      return {
        primary: [{ kind: "story-plot", storyPlotId: operation.id }],
        fallback: [root("plot_design")]
      };
    case "storyPlot.delete":
      return { primary: [], fallback: [root("plot_design")] };
    case "storyPlot.reorder":
      return {
        primary: [],
        fallback: [{ kind: "arc", arcId: operation.arcId }, root("plot_design")]
      };
    case "placement.create":
      return {
        primary: [
          {
            kind: "chapter-card",
            chapterCardId: operation.placement.chapterCardId,
            view: "card"
          }
        ],
        fallback: [root("plot_design")]
      };
    case "placement.update":
      return {
        primary: [{ kind: "placement", placementId: operation.id }],
        fallback: [root("plot_design")]
      };
    case "placement.move":
      return {
        primary: [
          {
            kind: "chapter-card",
            chapterCardId: operation.toChapterCardId,
            view: "card"
          }
        ],
        fallback: [root("plot_design")]
      };
    case "placement.delete":
      return { primary: [], fallback: [root("plot_design")] };
    case "placement.reorder":
      return {
        primary: [],
        fallback: [
          {
            kind: "chapter-card",
            chapterCardId: operation.chapterCardId,
            view: "card"
          },
          root("plot_design")
        ]
      };
    case "foreshadowing.create":
      return {
        primary: [{ kind: "foreshadowing", threadId: operation.thread.id }],
        fallback: [root("plot_design")]
      };
    case "foreshadowing.update":
      return {
        primary: [{ kind: "foreshadowing", threadId: operation.id }],
        fallback: [root("plot_design")]
      };
    case "foreshadowing.delete":
    case "foreshadowing.reorder":
      return {
        primary: [],
        fallback: [{ kind: "foreshadowing" }, root("plot_design")]
      };
    case "foreshadowingBeat.create":
      return {
        primary: [
          {
            kind: "foreshadowing",
            threadId: operation.threadId,
            beatId: operation.beat.id
          }
        ],
        fallback: [{ kind: "foreshadowing", threadId: operation.threadId }]
      };
    case "foreshadowingBeat.update":
      return {
        primary: [{ kind: "foreshadowing", beatId: operation.id }],
        fallback: [{ kind: "foreshadowing" }, root("plot_design")]
      };
    case "foreshadowingBeat.move":
      return {
        primary: [{ kind: "foreshadowing", threadId: operation.toThreadId }],
        fallback: [{ kind: "foreshadowing" }, root("plot_design")]
      };
    case "foreshadowingBeat.delete":
      return {
        primary: [],
        fallback: [{ kind: "foreshadowing" }, root("plot_design")]
      };
    case "foreshadowingBeat.reorder":
      return {
        primary: [],
        fallback: [
          { kind: "foreshadowing", threadId: operation.threadId },
          root("plot_design")
        ]
      };
    case "event.create":
    case "event.update":
    case "event.delete":
    case "event.reorder":
    case "connection.create":
    case "connection.update":
    case "connection.delete":
      return { primary: [], fallback: [root("plot_design")] };
  }
}

export function longApprovalCandidatesForBatch(
  batch: LongWorkspaceOperationBatch,
  fallbackRoot: LongWorkspaceRoot = "plot_design"
): LongApprovalNavigationCandidate[] {
  const primary: LongApprovalNavigationCandidate[] = [];
  const fallback: LongApprovalNavigationCandidate[] = [];
  for (const operation of batch.operations) {
    const candidates = longOperationCandidates(operation);
    primary.push(...candidates.primary);
    fallback.push(...candidates.fallback);
  }
  return uniqueLongCandidates([
    ...(batch.documentWrites ?? []).map(({ fileId }) => ({
      kind: "file" as const,
      fileId
    })),
    ...primary,
    ...fallback,
    { kind: "root", root: fallbackRoot }
  ]);
}

function preferredCharacterFile<T extends { document: string }>(
  files: readonly T[]
): T | undefined {
  return (
    files.find(({ document }) => document === "core_profile") ??
    files.find(({ document }) => document !== "overview") ??
    files[0]
  );
}

export function resolveAgentEditApprovalTarget(
  proposal: AgentEditProposal
): ApprovalNavigationTarget {
  if (proposal.libraryTarget) {
    return {
      kind: "library",
      domain: proposal.libraryTarget.domain,
      libraryId: proposal.libraryTarget.libraryId,
      ...(proposal.libraryTarget.entryId
        ? { entryId: proposal.libraryTarget.entryId }
        : {}),
      documentId: proposal.documentId
    };
  }
  if (proposal.draftSectionCreationTarget) {
    const section = proposal.draftSectionCreationTarget.sections.at(-1);
    return {
      kind: "draft-section",
      workspaceId: proposal.workspaceId,
      ...(section?.realSectionId || section?.provisionalSectionId
        ? {
            sectionId: section.realSectionId ?? section.provisionalSectionId
          }
        : {}),
      fileKind: "body"
    };
  }
  if (proposal.draftSectionRenameTarget) {
    return {
      kind: "draft-section",
      workspaceId: proposal.workspaceId,
      sectionId: proposal.draftSectionRenameTarget.sectionId,
      fileKind: "body"
    };
  }
  if (proposal.draftSectionDeletionTarget) {
    return {
      kind: "draft-section",
      workspaceId: proposal.workspaceId,
      fileKind: "body"
    };
  }
  if (proposal.characterStructureTarget) {
    const mutation = proposal.characterStructureTarget.mutation;
    const itemId =
      mutation.type === "createItem" || mutation.type === "setFormat"
        ? mutation.type === "createItem"
          ? mutation.itemId
          : undefined
        : mutation.type === "deleteItem"
          ? undefined
          : mutation.itemId;
    return {
      kind: "character-item",
      workspaceId: proposal.workspaceId,
      ...(itemId ? { itemId } : {})
    };
  }
  if (proposal.longWorldbuildingTarget) {
    return {
      kind: "long",
      bookId: proposal.longWorldbuildingTarget.bookId,
      candidates: [
        { kind: "file", fileId: proposal.longWorldbuildingTarget.file.fileId },
        {
          kind: "worldbuilding",
          categoryId: proposal.longWorldbuildingTarget.file.categoryId,
          ...(proposal.longWorldbuildingTarget.file.itemId
            ? { itemId: proposal.longWorldbuildingTarget.file.itemId }
            : {})
        },
        { kind: "root", root: "worldbuilding" }
      ]
    };
  }
  if (proposal.longCharacterTarget) {
    const file = preferredCharacterFile(proposal.longCharacterTarget.files);
    return {
      kind: "long",
      bookId: proposal.longCharacterTarget.bookId,
      candidates: uniqueLongCandidates([
        ...(file ? [{ kind: "file" as const, fileId: file.fileId }] : []),
        ...(file && file.document !== "overview"
          ? [
              {
                kind: "character" as const,
                characterId: file.characterId
              }
            ]
          : []),
        { kind: "root", root: "character_design" }
      ])
    };
  }
  if (proposal.longPlotDesignTarget) {
    const targetKind = proposal.longPlotDesignTarget.review?.targetKind;
    const fallbackRoot =
      targetKind === "character" || targetKind === "character_overview"
        ? "character_design"
        : targetKind === "worldbuilding_category" ||
            targetKind === "worldbuilding_item"
          ? "worldbuilding"
          : targetKind === "continuity_file"
            ? "continuity_ledger"
            : "plot_design";
    return {
      kind: "long",
      bookId: proposal.longPlotDesignTarget.bookId,
      candidates: longApprovalCandidatesForBatch(
        proposal.longPlotDesignTarget.batch,
        fallbackRoot
      )
    };
  }
  if (proposal.longDraftTarget) {
    return {
      kind: "long",
      bookId: proposal.longDraftTarget.bookId,
      candidates: [
        { kind: "file", fileId: proposal.longDraftTarget.file.fileId },
        {
          kind: "chapter-card",
          chapterCardId: proposal.longDraftTarget.file.chapterCardId,
          view: "draft"
        },
        { kind: "root", root: "draft" }
      ]
    };
  }
  return {
    kind: "document",
    workspaceId: proposal.workspaceId,
    documentId: proposal.documentId
  };
}

export function resolveLongProposalApprovalTarget(
  item: LongWorkspaceProposalItem
): ApprovalNavigationTarget {
  const event = item.event;
  if (event.type === "long.worldbuilding_file_proposal") {
    return {
      kind: "long",
      bookId: event.payload.bookId,
      candidates: uniqueLongCandidates([
        ...event.payload.files.flatMap((file) => [
          { kind: "file" as const, fileId: file.fileId },
          {
            kind: "worldbuilding" as const,
            categoryId: file.categoryId,
            ...(file.itemId ? { itemId: file.itemId } : {})
          }
        ]),
        { kind: "root", root: "worldbuilding" }
      ])
    };
  }
  if (event.type === "long.character_file_proposal") {
    const preferred = preferredCharacterFile(event.payload.files);
    const ordered = preferred
      ? [preferred, ...event.payload.files.filter((file) => file !== preferred)]
      : event.payload.files;
    return {
      kind: "long",
      bookId: event.payload.bookId,
      candidates: uniqueLongCandidates([
        ...ordered.flatMap((file) => [
          { kind: "file" as const, fileId: file.fileId },
          ...(file.document === "overview"
            ? []
            : [{ kind: "character" as const, characterId: file.characterId }])
        ]),
        { kind: "root", root: "character_design" }
      ])
    };
  }
  if (event.type === "long.continuity_file_proposal") {
    return {
      kind: "long",
      bookId: event.payload.bookId,
      candidates: uniqueLongCandidates([
        ...event.payload.files.map(({ fileId }) => ({
          kind: "file" as const,
          fileId
        })),
        ...event.payload.files.map(({ chapterCardId }) => ({
          kind: "chapter-card" as const,
          chapterCardId,
          view: "continuity" as const
        })),
        { kind: "root", root: "continuity_ledger" }
      ])
    };
  }
  if (event.type === "long.ledger_commit_proposal") {
    return longLedgerApprovalTarget(event);
  }
  return {
    kind: "long",
    bookId: event.payload.bookId,
    candidates: longApprovalCandidatesForBatch(
      event.payload.batch,
      "plot_design"
    )
  };
}

function baseSelection(
  summary: LongBookSummary,
  key: string,
  root: LongWorkspaceRoot,
  title: string,
  preferredRole: LongWorkspaceSelection["preferredRole"] = "content"
): LongWorkspaceSelection {
  return {
    key,
    root,
    title,
    breadcrumbs: [summary.title, title],
    files: [],
    preferredRole
  };
}

function bookLineSelection(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot
): LongWorkspaceSelection | undefined {
  return reconcileLongWorkspaceSelection(
    summary,
    index,
    baseSelection(
      summary,
      "plot-design:book-line",
      "plot_design",
      t("overallStoryline"),
      "book-line"
    )
  );
}

function foreshadowingSelection(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot
): LongWorkspaceSelection | undefined {
  return reconcileLongWorkspaceSelection(
    summary,
    index,
    baseSelection(
      summary,
      "plot-design:foreshadowing",
      "plot_design",
      t("foreshadowingOverview"),
      "book-line"
    )
  );
}

function resolveLongFileNavigation(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): ResolvedLongApprovalCandidate | undefined {
  if (index.bookLine.id === fileId) {
    const selection = bookLineSelection(summary, index);
    return selection
      ? {
          selection: {
            ...selection,
            preferredFileId: fileId,
            bookLineVolumeId: null
          },
          focus: { fileId }
        }
      : undefined;
  }
  if (index.characterOverview?.id === fileId) {
    const selection = createLongCharacterOverviewSelection(summary, index);
    return selection
      ? {
          selection: { ...selection, preferredFileId: fileId },
          focus: { fileId }
        }
      : undefined;
  }
  for (const category of index.worldbuilding) {
    const matchesCategory =
      (category.format === "text" && category.file.id === fileId) ||
      (category.format === "list" &&
        (category.overview?.id === fileId ||
          category.items.some(({ file }) => file.id === fileId)));
    if (!matchesCategory) continue;
    const selection = reconcileLongWorkspaceSelection(
      summary,
      index,
      baseSelection(
        summary,
        `worldbuilding:${category.id}`,
        "worldbuilding",
        category.title
      )
    );
    if (!selection) return undefined;
    const item =
      category.format === "list"
        ? category.items.find(({ file }) => file.id === fileId)
        : undefined;
    return {
      selection: {
        ...selection,
        preferredFileId: fileId,
        ...(category.format === "list"
          ? { worldbuildingItemId: item?.id ?? null }
          : {})
      },
      focus: { fileId }
    };
  }
  for (const entry of index.characterFiles) {
    if (![entry.coreProfile.id, entry.relationships.id].includes(fileId)) {
      continue;
    }
    const character =
      index.characters?.find(({ id }) => id === entry.characterId) ??
      summary.navigation.characters.find(({ id }) => id === entry.characterId);
    if (!character) return undefined;
    return {
      selection: {
        ...createLongCharacterGroupSelection(
          summary,
          index,
          character.group,
          character.id
        ),
        preferredFileId: fileId
      },
      focus: { fileId }
    };
  }
  for (const chapter of index.chapters) {
    if (chapter.body.id === fileId || chapter.card.id === fileId) {
      const selection = createLongChapterSelection(
        summary,
        index,
        chapter.chapterCardId
      );
      return selection
        ? {
            selection: {
              ...selection,
              preferredFileId: fileId,
              preferredRole: chapter.card.id === fileId ? "card" : "body"
            },
            focus: { fileId }
          }
        : undefined;
    }
    const continuityFiles = [
      chapter.characterState,
      chapter.handoff,
      chapter.foreshadowingChanges,
      ...(chapter.worldReveals ? [chapter.worldReveals] : []),
      ...chapter.characterContinuity.flatMap((entry) => [
        entry.currentState,
        entry.history
      ])
    ];
    if (!continuityFiles.some(({ id }) => id === fileId)) continue;
    const selection = createLongContinuitySelection(
      summary,
      index,
      chapter.chapterCardId
    );
    return selection
      ? {
          selection: { ...selection, preferredFileId: fileId },
          focus: { fileId }
        }
      : undefined;
  }
  for (const storyPlot of index.plot.storyPlots ?? []) {
    if (storyPlot.file.id !== fileId) continue;
    const arc = index.plot.arcs.find(({ id }) => id === storyPlot.arcId);
    if (!arc) return undefined;
    const selection = createLongPlotPointVolumeSelection(
      summary,
      index,
      arc.volumeId,
      arc.id
    );
    return selection
      ? {
          selection: { ...selection, preferredFileId: fileId },
          focus: { fileId }
        }
      : undefined;
  }
  for (const commit of index.ledger.commits) {
    if (commit.recordFile.id !== fileId) continue;
    const selection = createLongContinuitySelection(
      summary,
      index,
      commit.chapterCardId
    );
    return selection ? { selection } : undefined;
  }
  return undefined;
}

function resolveLongCandidate(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot,
  candidate: LongApprovalNavigationCandidate
): ResolvedLongApprovalCandidate | undefined {
  if (candidate.kind === "file") {
    return resolveLongFileNavigation(summary, index, candidate.fileId);
  }
  if (candidate.kind === "root") {
    return { selection: createLongRootSelection(summary, candidate.root) };
  }
  if (candidate.kind === "worldbuilding") {
    const category = index.worldbuilding.find(
      ({ id }) => id === candidate.categoryId
    );
    if (!category) return undefined;
    const selection = reconcileLongWorkspaceSelection(
      summary,
      index,
      baseSelection(
        summary,
        `worldbuilding:${category.id}`,
        "worldbuilding",
        category.title
      )
    );
    if (!selection) return undefined;
    const item = candidate.itemId
      ? category.format === "list"
        ? category.items.find(({ id }) => id === candidate.itemId)
        : undefined
      : undefined;
    const fileId =
      item?.file.id ??
      (category.format === "text"
        ? category.file.id
        : (category.overview?.id ?? category.items[0]?.file.id));
    return {
      selection: {
        ...selection,
        ...(category.format === "list"
          ? { worldbuildingItemId: item?.id ?? null }
          : {}),
        ...(fileId ? { preferredFileId: fileId } : {})
      },
      ...(fileId ? { focus: { fileId } } : {})
    };
  }
  if (candidate.kind === "character") {
    const character =
      index.characters?.find(({ id }) => id === candidate.characterId) ??
      summary.navigation.characters.find(
        ({ id }) => id === candidate.characterId
      );
    if (!character) return undefined;
    return {
      selection: createLongCharacterGroupSelection(
        summary,
        index,
        character.group,
        character.id
      )
    };
  }
  if (candidate.kind === "character-group") {
    if (!index.characterTypes.some(({ id }) => id === candidate.groupId)) {
      return undefined;
    }
    return {
      selection: createLongCharacterGroupSelection(
        summary,
        index,
        candidate.groupId
      )
    };
  }
  if (candidate.kind === "volume") {
    if (!index.plot.volumes.some(({ id }) => id === candidate.volumeId)) {
      return undefined;
    }
    const selection = bookLineSelection(summary, index);
    return selection
      ? {
          selection: { ...selection, bookLineVolumeId: candidate.volumeId },
          focus: { bookLineVolumeId: candidate.volumeId }
        }
      : undefined;
  }
  if (candidate.kind === "arc") {
    const arc = index.plot.arcs.find(({ id }) => id === candidate.arcId);
    if (!arc) return undefined;
    const selection = createLongPlotPointVolumeSelection(
      summary,
      index,
      arc.volumeId,
      arc.id
    );
    return selection ? { selection } : undefined;
  }
  if (candidate.kind === "chapter-card") {
    const chapter = index.plot.chapterCards.find(
      ({ id }) => id === candidate.chapterCardId
    );
    if (!chapter) return undefined;
    if (candidate.view === "draft") {
      const selection = createLongChapterSelection(summary, index, chapter.id);
      return selection ? { selection } : undefined;
    }
    if (candidate.view === "continuity") {
      const selection = createLongContinuitySelection(
        summary,
        index,
        chapter.id
      );
      if (selection) return { selection };
    }
    const card = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === chapter.id
    )?.card;
    return card
      ? resolveLongFileNavigation(summary, index, card.id)
      : undefined;
  }
  if (candidate.kind === "story-plot") {
    const storyPlot = (index.plot.storyPlots ?? []).find(
      ({ id }) => id === candidate.storyPlotId
    );
    if (!storyPlot) return undefined;
    return resolveLongFileNavigation(summary, index, storyPlot.file.id);
  }
  if (candidate.kind === "placement") {
    const placement = index.plot.narrativePlacements.find(
      ({ id }) => id === candidate.placementId
    );
    if (!placement) return undefined;
    return resolveLongCandidate(summary, index, {
      kind: "chapter-card",
      chapterCardId: placement.chapterCardId,
      view: "card"
    });
  }
  const thread = candidate.threadId
    ? index.plot.foreshadowing.find(({ id }) => id === candidate.threadId)
    : candidate.beatId
      ? index.plot.foreshadowing.find(({ beats }) =>
          beats.some(({ id }) => id === candidate.beatId)
        )
      : undefined;
  if ((candidate.threadId || candidate.beatId) && !thread) return undefined;
  if (
    candidate.beatId &&
    !thread?.beats.some(({ id }) => id === candidate.beatId)
  ) {
    return undefined;
  }
  const selection = foreshadowingSelection(summary, index);
  return selection
    ? {
        selection,
        focus: {
          ...(thread ? { foreshadowingThreadId: thread.id } : {}),
          ...(candidate.beatId ? { foreshadowingBeatId: candidate.beatId } : {})
        }
      }
    : undefined;
}

export function resolveLongApprovalNavigation(
  target: Extract<ApprovalNavigationTarget, { kind: "long" }>,
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot
): ResolvedLongApprovalNavigation | undefined {
  for (const [candidateIndex, candidate] of target.candidates.entries()) {
    const resolved = resolveLongCandidate(summary, index, candidate);
    if (resolved) return { ...resolved, candidateIndex };
  }
  return undefined;
}
