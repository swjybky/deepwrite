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
import { indexedVolume, indexedChapterCard } from "./longIndexedChapter";
import { createLongContinuitySelection } from "./longContinuitySelection";
import { latestCommittedContinuityChapter } from "../utils/longLatestContinuityChapter";

export { createLongContinuitySelection } from "./longContinuitySelection";
export { latestCommittedContinuityChapter } from "../utils/longLatestContinuityChapter";

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
  return characterTypes.find(({ id }) => id === group)?.title ?? group;
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

export function nextWritableLongChapterId(
  workspaceIndex: LongWorkspaceIndexSnapshot
): LongChapterCardId | null {
  const volumeOrder = new Map(
    workspaceIndex.plot.volumes.map(({ id, order }) => [id, order])
  );
  const ordered = [...workspaceIndex.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  return (
    ordered.find((candidate) =>
      workspaceIndex.chapters.some(
        ({ chapterCardId, bodyStatus }) =>
          chapterCardId === candidate.id && bodyStatus === "empty"
      )
    )?.id ?? null
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
    label: role === "current-state" ? "当前状态" : "历史轨迹",
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
      label: "核心档案",
      file: entry.coreProfile
    },
    {
      role: "relationships",
      label: "人物关系",
      file: entry.relationships
    },
    ...(continuity
      ? [
          {
            role: "current-state" as const,
            label: "当前状态",
            file: continuity.currentState,
            readOnly: true
          },
          {
            role: "history" as const,
            label: "历史轨迹",
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
    title: "概览",
    breadcrumbs: [summary.title, "人物设计", "概览"],
    files: [
      {
        role: "overview",
        label: "概览",
        file: workspaceIndex.characterOverview
      }
    ],
    preferredRole: "overview",
    description:
      "人物设计阶段概览；统计全部人物的简单信息，供智能体先读后定位。"
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
  const groupLabel = longCharacterGroupLabel(
    group,
    workspaceIndex.characterTypes
  );
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
      title: groupLabel,
      breadcrumbs: [summary.title, "人物设计", groupLabel],
      files: [],
      description: `还没有${groupLabel}，请使用右侧人物标签栏的加号新建人物。`
    };
  }
  const entry = workspaceIndex.characterFiles.find(
    (candidate) => candidate.characterId === character.id
  );
  if (!entry) {
    return {
      ...baseSelection,
      title: groupLabel,
      breadcrumbs: [summary.title, "人物设计", groupLabel],
      files: [],
      description: `${character.name}的人物档案索引尚未就绪。`
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
    breadcrumbs: [summary.title, "人物设计", groupLabel, character.name],
    files: characterDesignSelectionFiles(workspaceIndex, entry),
    description: latestMappedChapter
      ? "当前状态和历史轨迹映射自最新已提交章节，只读展示。"
      : "尚无该人物的已提交章节记录；当前状态和历史轨迹为空。"
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
      breadcrumbs: [summary.title, "剧情设计", "剧情点", volume.title],
      files: [],
      description: `${volume.title}还没有剧情点，请使用左侧分卷旁的加号新建。`
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
    breadcrumbs: [
      summary.title,
      "剧情设计",
      "剧情点",
      volume.title,
      plotPoint.title
    ],
    storyPlots,
    files: [
      {
        role: "book-line",
        label: "剧情点",
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
  preferredChapterCardId?: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const volume = indexedVolume(summary, workspaceIndex, volumeId);
  if (!volume) return undefined;
  const indexedChapterIds = new Set(
    workspaceIndex.plot.chapterCards.map(({ id }) => id)
  );
  const navigationChapters = summary.navigation.chapterCards.filter(
    (chapter) =>
      chapter.volumeId === volumeId && indexedChapterIds.has(chapter.id)
  );
  const navigationIds = new Set(navigationChapters.map(({ id }) => id));
  const chapterCards = [
    ...navigationChapters,
    ...workspaceIndex.plot.chapterCards.filter(
      (chapter) =>
        chapter.volumeId === volumeId && !navigationIds.has(chapter.id)
    )
  ].sort(
    (left, right) =>
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  const chapterCardTabs = chapterCards.map((chapter) => ({
    id: chapter.id,
    label: chapter.title || chapter.id,
    narrativeOrder: chapter.narrativeOrder
  }));
  const chapterCard =
    chapterCards.find(({ id }) => id === preferredChapterCardId) ??
    chapterCards[0];
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
      breadcrumbs: [summary.title, "剧情设计", "章卡", volume.title],
      files: [],
      description: `${volume.title}还没有章卡，请使用右侧章卡标签栏的加号新建。`
    };
  }
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCard.id
  );
  if (!entry) {
    return {
      ...baseSelection,
      chapterCardId: chapterCard.id,
      title: chapterCard.title || chapterCard.id,
      breadcrumbs: [
        summary.title,
        "剧情设计",
        "章卡",
        volume.title,
        chapterCard.title
      ],
      files: [],
      description: `${chapterCard.title}的章卡文件索引尚未就绪。`
    };
  }
  const committed = entry.commitId !== null;
  return {
    ...baseSelection,
    chapterCardId: chapterCard.id,
    title: chapterCard.title,
    breadcrumbs: [
      summary.title,
      "剧情设计",
      "章卡",
      volume.title,
      chapterCard.title
    ],
    files: [
      {
        role: "card",
        label: "章卡内容",
        file: entry.card
      }
    ],
    preferredRole: "card",
    description: committed
      ? `${volume.title} · ${chapterCard.title}；已有连续性记录，章卡仍可自由修改。`
      : `${volume.title} · ${chapterCard.title}`
  };
}

export function createLongChapterSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const chapter = indexedChapterCard(summary, workspaceIndex, chapterCardId);
  const volume = chapter
    ? indexedVolume(summary, workspaceIndex, chapter.volumeId)
    : undefined;
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCardId
  );
  if (!chapter || !volume || !entry) return undefined;
  const committed = entry.commitId !== null;
  const nextWritable = nextWritableLongChapterId(workspaceIndex);
  return {
    key: `chapter:${chapter.id}`,
    root: "draft",
    chapterCardId: chapter.id,
    title: chapter.title || chapter.id,
    breadcrumbs: [
      summary.title,
      "正文",
      volume.title,
      chapter.title || chapter.id
    ],
    files: [
      {
        role: "body",
        label: "正文",
        file: entry.body
      },
      {
        role: "character-state",
        label: "章末状态",
        file: entry.characterState,
        readOnly: true
      },
      {
        role: "handoff",
        label: "下一章接续包",
        file: entry.handoff,
        readOnly: true
      }
    ],
    preferredRole: "body",
    description: committed
      ? "本章已有连续性记录；记录仅供参考，正文仍可继续修改。"
      : entry.bodyStatus === "written"
        ? "本章正文已完成，可继续修改或按需补充连续性记录。"
        : nextWritable === chapter.id
          ? "这是连续下一张空白章卡，可启动单章写作。"
          : "本章仍为空白；自动写作需先完成前面的空白章节。"
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
  selection: LongWorkspaceSelection
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
        selection.key.slice("chapter:".length)
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
        selection.key.slice("continuity:".length)
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
      title: volume?.title ?? "全书故事线",
      breadcrumbs: [
        summary.title,
        "剧情设计",
        "全书故事线",
        ...(volume ? [volume.title] : [])
      ],
      files: [
        {
          role: "book-line",
          label: "故事线",
          file: workspaceIndex.bookLine
        }
      ]
    };
  }
  if (selection.key === "plot-design:foreshadowing") {
    return {
      ...selection,
      title: "伏笔总览",
      breadcrumbs: [summary.title, "剧情设计", "伏笔总览"],
      files: [],
      preferredRole: "book-line",
      description: "维护全书伏笔线及其埋设、推进、揭示与回收触点。"
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
        selection.chapterCardId
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
      title: "世界观揭露",
      breadcrumbs: [summary.title, "世界观", "世界观揭露"],
      files: mappedChapter?.worldReveals
        ? [
            {
              role: "world-reveals",
              label: "世界观揭露",
              file: mappedChapter.worldReveals,
              readOnly: true
            }
          ]
        : [],
      preferredRole: "world-reveals",
      description: mappedChapter
        ? "只读映射最近一次包含世界观揭露的已提交章节记录。"
        : "尚无已提交的按章世界观揭露记录。"
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
      breadcrumbs: [
        summary.title,
        "世界观",
        category.title,
        ...(requestedItem ? [requestedItem.title] : [])
      ],
      ...(category.format === "list"
        ? {
            worldbuildingItems: category.items,
            files: [
              ...(category.overview
                ? [
                    {
                      role: "overview" as const,
                      label: "概览",
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
                label: "设定正文",
                file: category.file,
                ...(isLongMigrationEvidenceCategoryId(category.id)
                  ? { readOnly: true }
                  : {})
              }
            ]
          }),
      description: isLongMigrationEvidenceCategoryId(category.id)
        ? "这是迁移生成的只读证据，可搜索并供 Agent 按需读取。"
        : category.format === "list"
          ? "列表型世界设定；通过条目 Tab 切换并编辑内容。"
          : "文本型世界设定。"
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
    const groupLabel = longCharacterGroupLabel(
      character.group,
      workspaceIndex.characterTypes
    );
    return {
      ...selection,
      title: character.name,
      breadcrumbs: [summary.title, "人物设计", groupLabel, character.name],
      files: characterDesignSelectionFiles(workspaceIndex, entry),
      description: latestMappedChapter
        ? "当前状态和历史轨迹映射自最新已提交章节，只读展示。"
        : "尚无该人物的已提交章节记录；当前状态和历史轨迹为空。"
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
        breadcrumbs: [summary.title, "连续性账本", "章节记录", recordTitle],
        description: `${commit.committedAt} · ${chapterCardIds.length} 章共用的末章汇总连续性记录`
      },
      selection
    );
  }
  return selection;
}
