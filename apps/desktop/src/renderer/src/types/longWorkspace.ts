import { createScopedTranslator } from "../i18n";

import {
  DEFAULT_LONG_CHARACTER_TYPES,
  createEmptyLongMarkdownFileReference,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  type DeepWriteApi,
  type LongArcId,
  type LongBookSummary,
  type LongChapterCardId,
  type LongCharacterGroup,
  type LongCharacterId,
  type LongCharacterType,
  type LongFileId,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceFileReference,
  type LongWorkspaceOperationBatch,
  type LongWorkspaceRoot,
  type LongVolumeId,
  type LongWorldbuildingItemId,
  type LongWorldbuildingFormat
} from "@deepwrite/contracts";
import {
  indexedVolume,
  indexedChapterCard,
  createLongChapterLookup,
  nextWritableLongChapterId,
  type LongChapterLookup
} from "./longIndexedChapter";
export { nextWritableLongChapterId } from "./longIndexedChapter";
import { createLongContinuitySelection } from "./longContinuitySelection";
import { latestCommittedContinuityChapter } from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("workspace.selection");

export { createLongContinuitySelection } from "./longContinuitySelection";
export { latestCommittedContinuityChapter } from "@deepwrite/contracts/renderer";

export type LongWorkspaceFileRole =
  | "content"
  | "overview"
  | "book-line"
  | "core-profile"
  | "relationships"
  | "current-state"
  | "history"
  | "body"
  | "card"
  | "foreshadowing-changes"
  | "world-reveals"
  | "character-state"
  | "handoff"
  | "ledger-record";

export type LongContinuityView =
  "inbox" | "snapshot" | "execution" | "knowledge" | "history";

export function longCharacterGroupLabel(
  group: LongCharacterGroup,
  characterTypes: readonly LongCharacterType[] = DEFAULT_LONG_CHARACTER_TYPES
): string {
  const current = characterTypes.find(({ id }) => id === group);
  const original = DEFAULT_LONG_CHARACTER_TYPES.find(({ id }) => id === group);
  if (!current || current.title !== original?.title)
    return current?.title ?? group;
  const keys = {
    protagonist: "protagonist",
    major_supporting: "majorSupporting",
    minor_supporting: "minorSupporting",
    passerby: "passerby"
  } as const;
  const key = keys[group as keyof typeof keys];
  return key ? t(key) : current.title;
}

export interface LongWorkspaceSelectionFile {
  role: LongWorkspaceFileRole;
  label: string;
  file: LongWorkspaceFileReference;
  readOnly?: boolean;
  /** Read-only renderer content used when a mapped source does not exist yet. */
  inlineContent?: string;
}

export interface LongForeshadowingFocus {
  threadId: string | null;
  beatId: string | null;
}

/**
 * Renderer-only navigation state. Long-form files never enter the short/script
 * WorkspaceDocument or editor-draft stores.
 */
export interface LongWorkspaceSelection {
  key: string;
  root: LongWorkspaceRoot;
  continuityView?: LongContinuityView;
  worldbuildingFormat?: LongWorldbuildingFormat;
  worldbuildingItems?: Array<{
    id: string;
    title: string;
    order: number;
    file: LongWorkspaceFileReference;
  }>;
  worldbuildingItemId?: LongWorldbuildingItemId | null;
  /** Targets a specific file when several files share the same semantic role. */
  preferredFileId?: LongFileId;
  /** Selects the full-book overview when null, or one volume when set. */
  bookLineVolumeId?: LongVolumeId | null;
  chapterCardId?: LongChapterCardId;
  characterGroup?: LongCharacterGroup;
  characterId?: LongCharacterId;
  characterTabs?: Array<{
    id: LongCharacterId;
    label: string;
  }>;
  plotPointVolumeId?: LongVolumeId;
  plotPointId?: LongArcId;
  plotPointTabs?: Array<{
    id: LongArcId;
    label: string;
  }>;
  storyPlots?: Array<{
    id: string;
    title: string;
    order: number;
    file: LongWorkspaceFileReference;
  }>;
  chapterCardVolumeId?: LongVolumeId;
  chapterCardTabs?: Array<{
    id: LongChapterCardId;
    label: string;
    narrativeOrder?: number;
  }>;
  title: string;
  breadcrumbs: string[];
  files: LongWorkspaceSelectionFile[];
  preferredRole: LongWorkspaceFileRole;
  description?: string;
}

/**
 * Completion handshake for a manual structure mutation.
 *
 * `succeed` is only valid after the operation was durably applied and the
 * renderer refreshed. `fail` means nothing was applied and the editor should
 * preserve the user's draft for a retry. `appliedButRefreshFailed` closes the
 * submitted surface without offering a blind retry because the durable write
 * already happened even though the refreshed snapshot is unavailable.
 */
export interface LongStructureMutationCompletion {
  succeed(): void;
  fail(message?: string, changedImpact?: LongWorkspaceImpactConfirmation): void;
  appliedButRefreshFailed(message?: string): void;
}

export interface LongWorldbuildingSyncPreparedChange {
  batch: LongWorkspaceOperationBatch;
  confirmation: LongWorkspaceImpactConfirmation;
  createdCategoryCount: number;
  deletedCategoryCount: number;
  writtenFileCount: number;
}

export interface LongWorldbuildingSyncRequest {
  sourceBookId: string;
  sourceTitle: string;
  prepared?: LongWorldbuildingSyncPreparedChange;
}

export interface LongWorldbuildingSyncCompletion extends LongStructureMutationCompletion {
  review(prepared: LongWorldbuildingSyncPreparedChange): void;
}

export type LongWorkspaceRendererApi = DeepWriteApi["long"];

export function resolveLongWorkspaceApi():
  LongWorkspaceRendererApi | undefined {
  return window.deepwrite?.long;
}

export function longBookResourceId(bookId: string): string {
  return `long-book:${bookId}`;
}

export function longBookIdFromResourceId(
  resourceId: string
): string | undefined {
  const prefix = "long-book:";
  if (!resourceId.startsWith(prefix)) return undefined;
  const suffix = resourceId.slice(prefix.length);
  const separator = suffix.indexOf(":");
  const bookId = separator >= 0 ? suffix.slice(0, separator) : suffix;
  return bookId || undefined;
}

export function isEditableLongFile(
  file: Pick<LongWorkspaceFileReference, "id" | "path">
): file is Pick<LongWorkspaceFileReference, "id" | "path"> & {
  id: LongFileId;
} {
  return file.path.toLowerCase().endsWith(".md");
}

export function isLongMigrationEvidenceCategoryId(categoryId: string): boolean {
  return categoryId.startsWith("world_migration-evidence-");
}

export function replaceLongBookSummary(
  books: readonly LongBookSummary[],
  summary: LongBookSummary
): LongBookSummary[] {
  const next = books.filter((book) => book.id !== summary.id);
  next.push(summary);
  return next.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
  );
}

function characterDesignSelectionFiles(
  workspaceIndex: LongWorkspaceIndexSnapshot,
  entry: LongWorkspaceIndexSnapshot["characterFiles"][number]
): LongWorkspaceSelectionFile[] {
  const latestChapter = latestCommittedContinuityChapter(
    workspaceIndex,
    (chapter) =>
      chapter.characterContinuity.some(
        ({ characterId }) => characterId === entry.characterId
      )
  );
  const continuity = latestChapter?.characterContinuity.find(
    ({ characterId }) => characterId === entry.characterId
  );
  const emptyMappedFile = (
    role: "current-state" | "history"
  ): LongWorkspaceSelectionFile => ({
    role,
    get label() {
      return role === "current-state" ? t("currentState") : t("history");
    },
    file: createEmptyLongMarkdownFileReference(
      role === "current-state"
        ? longCharacterCurrentStateFileId(entry.characterId)
        : longCharacterHistoryFileId(entry.characterId),
      longCharacterFilePath(
        entry.characterId,
        role === "current-state" ? "current-state.md" : "history.md"
      ),
      workspaceIndex.updatedAt ??
        entry.coreProfile.updatedAt ??
        "1970-01-01T00:00:00.000Z"
    ),
    readOnly: true,
    inlineContent: ""
  });
  return [
    {
      role: "core-profile",
      get label() {
        return t("profile");
      },
      file: entry.coreProfile
    },
    {
      role: "relationships",
      get label() {
        return t("relationships");
      },
      file: entry.relationships
    },
    ...(continuity
      ? [
          {
            role: "current-state" as const,
            get label() {
              return t("currentState");
            },
            file: continuity.currentState,
            readOnly: true
          },
          {
            role: "history" as const,
            get label() {
              return t("history");
            },
            file: continuity.history,
            readOnly: true
          }
        ]
      : [emptyMappedFile("current-state"), emptyMappedFile("history")])
  ];
}

export function createLongCharacterOverviewSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot
): LongWorkspaceSelection | undefined {
  if (!workspaceIndex.characterOverview) return undefined;
  return {
    key: "character-overview",
    root: "character_design",
    get title() {
      return t("overview");
    },
    get breadcrumbs() {
      return [summary.title, t("characters"), t("overview")];
    },
    files: [
      {
        role: "overview",
        get label() {
          return t("overview");
        },
        file: workspaceIndex.characterOverview
      }
    ],
    preferredRole: "overview",
    get description() {
      return t("characterOverviewHelp");
    }
  };
}

function indexedCharacters(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot
) {
  return workspaceIndex.characters?.length
    ? workspaceIndex.characters
    : summary.navigation.characters;
}

function indexedArcs(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot
) {
  return workspaceIndex.plot.arcs?.length
    ? workspaceIndex.plot.arcs
    : summary.navigation.arcs;
}

export function createLongCharacterGroupSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  group: LongCharacterGroup,
  preferredCharacterId?: LongCharacterId
): LongWorkspaceSelection {
  const groupLabel = () =>
    longCharacterGroupLabel(group, workspaceIndex.characterTypes);
  const characters = indexedCharacters(summary, workspaceIndex)
    .filter((character) => character.group === group)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  const characterTabs = characters.map((character) => ({
    id: character.id,
    label: character.name
  }));
  const character =
    characters.find(({ id }) => id === preferredCharacterId) ?? characters[0];
  const baseSelection = {
    key: `character-group:${group}`,
    root: "character_design" as const,
    characterGroup: group,
    characterTabs,
    preferredRole: "core-profile" as const
  };
  if (!character) {
    return {
      ...baseSelection,
      get title() {
        return groupLabel();
      },
      get breadcrumbs() {
        return [summary.title, t("characters"), groupLabel()];
      },
      files: [],
      get description() {
        return t("emptyCharacterGroup", { groupLabel: groupLabel() });
      }
    };
  }
  const entry = workspaceIndex.characterFiles.find(
    (candidate) => candidate.characterId === character.id
  );
  if (!entry) {
    return {
      ...baseSelection,
      get title() {
        return groupLabel();
      },
      get breadcrumbs() {
        return [summary.title, t("characters"), groupLabel()];
      },
      files: [],
      get description() {
        return t("characterIndexPending", { name: character.name });
      }
    };
  }
  const latestMappedChapter = latestCommittedContinuityChapter(
    workspaceIndex,
    (chapter) =>
      (chapter.characterContinuity ?? []).some(
        ({ characterId }) => characterId === character.id
      )
  );
  return {
    ...baseSelection,
    characterId: character.id,
    title: character.name,
    get breadcrumbs() {
      return [summary.title, t("characters"), groupLabel(), character.name];
    },
    files: characterDesignSelectionFiles(workspaceIndex, entry),
    get description() {
      return latestMappedChapter
        ? t("characterStateReadonly")
        : t("characterStateEmpty");
    }
  };
}

export function createLongPlotPointVolumeSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId,
  preferredPlotPointId?: LongArcId
): LongWorkspaceSelection | undefined {
  const volume = indexedVolume(summary, workspaceIndex, volumeId);
  if (!volume) return undefined;
  const plotPoints = indexedArcs(summary, workspaceIndex)
    .filter((arc) => arc.volumeId === volumeId)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  const plotPointTabs = plotPoints.map((plotPoint) => ({
    id: plotPoint.id,
    label: plotPoint.title
  }));
  const plotPoint =
    plotPoints.find(({ id }) => id === preferredPlotPointId) ?? plotPoints[0];
  const baseSelection = {
    key: `plot-design:plot-points:${volume.id}`,
    root: "plot_design" as const,
    plotPointVolumeId: volume.id,
    plotPointTabs,
    preferredRole: "book-line" as const
  };
  if (!plotPoint) {
    return {
      ...baseSelection,
      title: volume.title,
      get breadcrumbs() {
        return [summary.title, t("plotDesign"), t("plotPoints"), volume.title];
      },
      files: [],
      get description() {
        return t("emptyVolumePlot", { title: volume.title });
      }
    };
  }
  const entry = workspaceIndex.plot.arcs.find(({ id }) => id === plotPoint.id);
  if (!entry) return undefined;
  const storyPlots = [...(workspaceIndex.plot.storyPlots ?? [])]
    .filter((storyPlot) => storyPlot.arcId === plotPoint.id)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    )
    .map((storyPlot) => ({
      id: storyPlot.id,
      title: storyPlot.title,
      order: storyPlot.order,
      file: storyPlot.file
    }));
  return {
    ...baseSelection,
    plotPointId: plotPoint.id,
    title: plotPoint.title,
    get breadcrumbs() {
      return [
        summary.title,
        t("plotDesign"),
        t("plotPoints"),
        volume.title,
        plotPoint.title
      ];
    },
    storyPlots,
    files: [
      {
        role: "book-line",
        get label() {
          return t("plotPoints");
        },
        file: workspaceIndex.bookLine
      },
      ...storyPlots.map((storyPlot) => ({
        role: "content" as const,
        label: storyPlot.title,
        file: storyPlot.file
      }))
    ],
    description: `${volume.title} · ${plotPoint.title}`
  };
}

export function createLongChapterCardVolumeSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId,
  preferredChapterCardId?: LongChapterCardId,
  lookup = createLongChapterLookup(summary, workspaceIndex)
): LongWorkspaceSelection | undefined {
  const volume = indexedVolume(summary, workspaceIndex, volumeId, lookup);
  if (!volume) return undefined;
  const chapterCards = lookup.chaptersByVolume.get(volumeId) ?? [];
  const chapterCardTabs = lookup.tabsByVolume.get(volumeId) ?? [];
  const preferred = preferredChapterCardId
    ? lookup.cardsByVolume.get(volumeId)?.get(preferredChapterCardId)
    : undefined;
  const chapterCard = preferred ?? chapterCards[0];
  const baseSelection = {
    key: `plot-design:chapter-cards:${volume.id}`,
    root: "plot_design" as const,
    chapterCardVolumeId: volume.id,
    chapterCardTabs,
    preferredRole: "book-line" as const
  };
  if (!chapterCard) {
    return {
      ...baseSelection,
      title: volume.title,
      get breadcrumbs() {
        return [
          summary.title,
          t("plotDesign"),
          t("chapterCards"),
          volume.title
        ];
      },
      files: [],
      get description() {
        return t("emptyChapterCards", { title: volume.title });
      }
    };
  }
  const entry = lookup.entries.get(chapterCard.id);
  if (!entry) {
    return {
      ...baseSelection,
      chapterCardId: chapterCard.id,
      title: chapterCard.title || chapterCard.id,
      get breadcrumbs() {
        return [
          summary.title,
          t("plotDesign"),
          t("chapterCards"),
          volume.title,
          chapterCard.title
        ];
      },
      files: [],
      get description() {
        return t("chapterCardIndexPending", { title: chapterCard.title });
      }
    };
  }
  const committed = entry.commitId !== null;
  return {
    ...baseSelection,
    chapterCardId: chapterCard.id,
    title: chapterCard.title,
    get breadcrumbs() {
      return [
        summary.title,
        t("plotDesign"),
        t("chapterCards"),
        volume.title,
        chapterCard.title
      ];
    },
    files: [
      {
        role: "card",
        get label() {
          return t("chapterCardContent");
        },
        file: entry.card
      }
    ],
    preferredRole: "card",
    get description() {
      return committed
        ? t("chapterCardEditable", {
            title: volume.title,
            title2: chapterCard.title
          })
        : `${volume.title} · ${chapterCard.title}`;
    }
  };
}

export function createLongChapterSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId,
  lookup?: LongChapterLookup
): LongWorkspaceSelection | undefined {
  const chapter = indexedChapterCard(
    summary,
    workspaceIndex,
    chapterCardId,
    lookup
  );
  const volume = chapter
    ? indexedVolume(summary, workspaceIndex, chapter.volumeId, lookup)
    : undefined;
  const entry = lookup
    ? lookup.entries.get(chapterCardId)
    : workspaceIndex.chapters.find(
        ({ chapterCardId: id }) => id === chapterCardId
      );
  if (!chapter || !volume || !entry) return undefined;
  const committed = entry.commitId !== null;
  const nextWritable =
    committed || entry.bodyStatus === "written"
      ? null
      : lookup
        ? lookup.nextWritable
        : nextWritableLongChapterId(workspaceIndex);
  return {
    key: `chapter:${chapter.id}`,
    root: "draft",
    chapterCardId: chapter.id,
    title: chapter.title || chapter.id,
    get breadcrumbs() {
      return [
        summary.title,
        t("manuscript"),
        volume.title,
        chapter.title || chapter.id
      ];
    },
    files: [
      {
        role: "body",
        get label() {
          return t("manuscript");
        },
        file: entry.body
      },
      {
        role: "character-state",
        get label() {
          return t("chapterEndState");
        },
        file: entry.characterState,
        readOnly: true
      },
      {
        role: "handoff",
        get label() {
          return t("nextChapterHandoff");
        },
        file: entry.handoff,
        readOnly: true
      }
    ],
    preferredRole: "body",
    get description() {
      return committed
        ? t("continuityEditable")
        : entry.bodyStatus === "written"
          ? t("completedEditable")
          : nextWritable === chapter.id
            ? t("nextBlankChapter")
            : t("blankChapterOrder");
    }
  };
}

function preserveRequestedLongFile(
  resolved: LongWorkspaceSelection | undefined,
  requested: LongWorkspaceSelection,
  promoteFileLabel = true
): LongWorkspaceSelection | undefined {
  if (!resolved || !requested.preferredFileId) return resolved;
  const preferred = resolved.files.find(
    ({ file }) => file.id === requested.preferredFileId
  );
  if (!preferred) return resolved;
  return {
    ...resolved,
    preferredFileId: preferred.file.id,
    preferredRole: preferred.role,
    ...(promoteFileLabel
      ? {
          title: preferred.label,
          breadcrumbs: [...resolved.breadcrumbs, preferred.label]
        }
      : {})
  };
}

export function reconcileLongWorkspaceSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  selection: LongWorkspaceSelection,
  lookup?: LongChapterLookup
): LongWorkspaceSelection | undefined {
  if (selection.key.startsWith("root:")) {
    return {
      ...selection,
      breadcrumbs: [summary.title, selection.title],
      files: []
    };
  }
  if (selection.key.startsWith("chapter:")) {
    return preserveRequestedLongFile(
      createLongChapterSelection(
        summary,
        workspaceIndex,
        selection.key.slice("chapter:".length),
        lookup
      ),
      selection,
      false
    );
  }
  if (selection.key.startsWith("continuity:")) {
    return preserveRequestedLongFile(
      createLongContinuitySelection(
        summary,
        workspaceIndex,
        selection.key.slice("continuity:".length),
        lookup
      ),
      selection
    );
  }
  if (selection.key === "plot-design:book-line") {
    const requestedVolumeId = selection.bookLineVolumeId;
    const volume =
      requestedVolumeId === undefined || requestedVolumeId === null
        ? undefined
        : workspaceIndex.plot.volumes.find(
            ({ id }) => id === requestedVolumeId
          );
    return {
      ...selection,
      ...(requestedVolumeId === undefined
        ? {}
        : { bookLineVolumeId: volume?.id ?? null }),
      get title() {
        return volume?.title ?? t("bookStoryline");
      },
      get breadcrumbs() {
        return [
          summary.title,
          t("plotDesign"),
          t("bookStoryline"),
          ...(volume ? [volume.title] : [])
        ];
      },
      files: [
        {
          role: "book-line",
          get label() {
            return t("storyline");
          },
          file: workspaceIndex.bookLine
        }
      ]
    };
  }
  if (selection.key === "plot-design:foreshadowing") {
    return {
      ...selection,
      get title() {
        return t("foreshadowing");
      },
      get breadcrumbs() {
        return [summary.title, t("plotDesign"), t("foreshadowing")];
      },
      files: [],
      preferredRole: "book-line",
      get description() {
        return t("foreshadowingHelp");
      }
    };
  }
  if (selection.key.startsWith("plot-design:plot-points:")) {
    const volumeId = selection.key.slice(
      "plot-design:plot-points:".length
    ) as LongVolumeId;
    return preserveRequestedLongFile(
      createLongPlotPointVolumeSelection(
        summary,
        workspaceIndex,
        volumeId,
        selection.plotPointId
      ),
      selection,
      false
    );
  }
  if (selection.key.startsWith("plot-design:chapter-cards:")) {
    const volumeId = selection.key.slice(
      "plot-design:chapter-cards:".length
    ) as LongVolumeId;
    return preserveRequestedLongFile(
      createLongChapterCardVolumeSelection(
        summary,
        workspaceIndex,
        volumeId,
        selection.chapterCardId,
        lookup
      ),
      selection,
      false
    );
  }
  if (selection.key === "worldbuilding:reveals") {
    const mappedChapter = latestCommittedContinuityChapter(
      workspaceIndex,
      (chapter) => chapter.worldReveals !== null
    );
    return {
      ...selection,
      get title() {
        return t("worldRevelations");
      },
      get breadcrumbs() {
        return [summary.title, t("worldbuilding"), t("worldRevelations")];
      },
      files: mappedChapter?.worldReveals
        ? [
            {
              role: "world-reveals",
              get label() {
                return t("worldRevelations");
              },
              file: mappedChapter.worldReveals,
              readOnly: true
            }
          ]
        : [],
      preferredRole: "world-reveals",
      get description() {
        return mappedChapter
          ? t("worldRevelationsReadonly")
          : t("worldRevelationsEmpty");
      }
    };
  }
  if (selection.key.startsWith("worldbuilding:")) {
    const category = workspaceIndex.worldbuilding.find(
      ({ id }) => id === selection.key.slice("worldbuilding:".length)
    );
    if (!category) return undefined;
    const requestedItemId = selection.worldbuildingItemId;
    const requestedItem =
      category.format === "list" && requestedItemId
        ? category.items.find(({ id }) => id === requestedItemId)
        : undefined;
    const resolvedWorldbuildingItemId =
      requestedItemId === undefined ? undefined : (requestedItem?.id ?? null);
    return {
      ...selection,
      ...(resolvedWorldbuildingItemId === undefined
        ? {}
        : { worldbuildingItemId: resolvedWorldbuildingItemId }),
      ...(requestedItem
        ? {
            preferredFileId: requestedItem.file.id,
            preferredRole: "content" as const
          }
        : requestedItemId === null
          ? { preferredRole: "overview" as const }
          : {}),
      title: requestedItem?.title ?? category.title,
      worldbuildingFormat: category.format,
      get breadcrumbs() {
        return [
          summary.title,
          t("worldbuilding"),
          category.title,
          ...(requestedItem ? [requestedItem.title] : [])
        ];
      },
      ...(category.format === "list"
        ? {
            worldbuildingItems: category.items,
            files: [
              ...(category.overview
                ? [
                    {
                      role: "overview" as const,
                      get label() {
                        return t("overview");
                      },
                      file: category.overview,
                      ...(isLongMigrationEvidenceCategoryId(category.id)
                        ? { readOnly: true }
                        : {})
                    }
                  ]
                : []),
              ...category.items.map((item) => ({
                role: "content" as const,
                label: item.title,
                file: item.file,
                ...(isLongMigrationEvidenceCategoryId(category.id)
                  ? { readOnly: true }
                  : {})
              }))
            ]
          }
        : {
            files: [
              {
                role: "content" as const,
                get label() {
                  return t("worldbuildingContent");
                },
                file: category.file,
                ...(isLongMigrationEvidenceCategoryId(category.id)
                  ? { readOnly: true }
                  : {})
              }
            ]
          }),
      get description() {
        return isLongMigrationEvidenceCategoryId(category.id)
          ? t("migrationEvidence")
          : category.format === "list"
            ? t("worldbuildingListHelp")
            : t("worldbuildingTextHelp");
      }
    };
  }
  if (selection.key === "character-overview") {
    return createLongCharacterOverviewSelection(summary, workspaceIndex);
  }
  if (selection.key.startsWith("character-group:")) {
    const groupId = selection.key.slice("character-group:".length);
    const group = workspaceIndex.characterTypes.find(
      ({ id }) => id === groupId
    );
    if (!group) return undefined;
    return preserveRequestedLongFile(
      createLongCharacterGroupSelection(
        summary,
        workspaceIndex,
        group.id,
        selection.characterId
      ),
      selection,
      false
    );
  }
  if (selection.key.startsWith("character:")) {
    const characterId = selection.key.slice("character:".length);
    const character = summary.navigation.characters.find(
      ({ id }) => id === characterId
    );
    const entry = workspaceIndex.characterFiles.find(
      (candidate) => candidate.characterId === characterId
    );
    if (!character || !entry) return undefined;
    const latestMappedChapter = latestCommittedContinuityChapter(
      workspaceIndex,
      (chapter) =>
        (chapter.characterContinuity ?? []).some(
          ({ characterId: mappedCharacterId }) =>
            mappedCharacterId === character.id
        )
    );
    const groupLabel = () =>
      longCharacterGroupLabel(character.group, workspaceIndex.characterTypes);
    return {
      ...selection,
      title: character.name,
      get breadcrumbs() {
        return [summary.title, t("characters"), groupLabel(), character.name];
      },
      files: characterDesignSelectionFiles(workspaceIndex, entry),
      get description() {
        return latestMappedChapter
          ? t("characterStateReadonly")
          : t("characterStateEmpty");
      }
    };
  }
  if (selection.key.startsWith("ledger:")) {
    const commit = workspaceIndex.ledger.commits.find(
      ({ id }) => id === selection.key.slice("ledger:".length)
    );
    if (!commit) return undefined;
    const chapterCardIds = commit.chapterCardIds ?? [commit.chapterCardId];
    const titleByChapterId = new Map(
      summary.navigation.chapterCards.map(({ id, title }) => [id, title])
    );
    const firstTitle =
      titleByChapterId.get(chapterCardIds[0]!) ?? chapterCardIds[0]!;
    const checkpointTitle =
      titleByChapterId.get(commit.chapterCardId) ?? commit.chapterCardId;
    const recordTitle =
      chapterCardIds.length === 1
        ? checkpointTitle
        : `${firstTitle} — ${checkpointTitle}`;
    const chapterSelection = createLongContinuitySelection(
      summary,
      workspaceIndex,
      commit.chapterCardId
    );
    if (!chapterSelection) return undefined;
    return preserveRequestedLongFile(
      {
        ...chapterSelection,
        key: selection.key,
        continuityView: "history",
        title: recordTitle,
        get breadcrumbs() {
          return [
            summary.title,
            t("continuityLedger"),
            t("chapterRecords"),
            recordTitle
          ];
        },
        get description() {
          return t("combinedContinuity", {
            committedAt: commit.committedAt,
            length: chapterCardIds.length
          });
        }
      },
      selection
    );
  }
  return selection;
}
