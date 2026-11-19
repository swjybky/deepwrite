import { createScopedTranslator } from "../i18n";
import type {
  LongBookSummary,
  LongCharacterGroup,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import { projectLongWorkspaceContinuityTree } from "./longWorkspaceContinuityTree";
import { createLongWorkspaceTreeNode } from "./longWorkspaceTreeNode";
import { projectLongWorkspaceDraftTree } from "./longWorkspaceDraftTree";
import { createLongChapterLookup } from "../types/longIndexedChapter";
import {
  createLongChapterCardVolumeSelection,
  isLongMigrationEvidenceCategoryId,
  longBookResourceId,
  longCharacterGroupLabel,
  reconcileLongWorkspaceSelection,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

const t = createScopedTranslator("workspace");

export const LONG_WORKSPACE_ROOT_LABELS = {
  get worldbuilding() {
    return t("longWorkspaceResourceTree.worldbuilding");
  },
  get character_design() {
    return t("longWorkspaceResourceTree.characterDesign");
  },
  get plot_design() {
    return t("catalogWorkspace.plotDesign");
  },
  get draft() {
    return t("catalogWorkspace.manuscript");
  },
  get continuity_ledger() {
    return t("longWorkspaceResourceTree.continuityLedger");
  }
} as const;
export const LONG_WORKSPACE_ROOT_DESCRIPTIONS: Record<
  LongWorkspaceRoot,
  string
> = {
  get worldbuilding() {
    return t(
      "longWorkspaceResourceTree.manageWorldRulesFactionsGeographyHistoryTerminologyProgressionSystems"
    );
  },
  get character_design() {
    return t(
      "longWorkspaceResourceTree.manageCharacterProfilesAndRelationshipsAndReviewCurrentStates"
    );
  },
  get plot_design() {
    return t(
      "longWorkspaceResourceTree.manageTheOverallStorylineVolumesPlotPointsAndChapter"
    );
  },
  get draft() {
    return t(
      "longWorkspaceResourceTree.editTheManuscriptInVolumeAndChapterCardOrder"
    );
  },
  get continuity_ledger() {
    return t(
      "longWorkspaceResourceTree.checkContinuityForOneChapterOrAConsecutiveBatch"
    );
  }
};

export function longNavigationNodeId(bookId: string, key: string): string {
  return `${longBookResourceId(bookId)}:${key}`;
}

export function createLongRootSelection(
  book: LongBookSummary,
  root: LongWorkspaceRoot
): LongWorkspaceSelection {
  const label = LONG_WORKSPACE_ROOT_LABELS[root];
  return {
    key: `root:${root}`,
    root,
    title: label,
    breadcrumbs: [book.title, label],
    files: [],
    preferredRole: "content",
    description: LONG_WORKSPACE_ROOT_DESCRIPTIONS[root]
  };
}

export function projectLongWorkspaceNavigation(
  book: LongBookSummary,
  index?: LongWorkspaceIndexSnapshot | null
): ResourceTreeNode[] {
  const node = createLongWorkspaceTreeNode(book);
  const lookup = index ? createLongChapterLookup(book, index) : undefined;

  const reconcile = (
    selection: LongWorkspaceSelection
  ): LongWorkspaceSelection | undefined =>
    index
      ? reconcileLongWorkspaceSelection(book, index, selection, lookup)
      : selection;

  const characterCountByGroup = new Map<LongCharacterGroup, number>();
  for (const character of book.navigation.characters) {
    characterCountByGroup.set(
      character.group,
      (characterCountByGroup.get(character.group) ?? 0) + 1
    );
  }
  const arcCountByVolume = new Map<string, number>();
  for (const arc of book.navigation.arcs) {
    arcCountByVolume.set(
      arc.volumeId,
      (arcCountByVolume.get(arc.volumeId) ?? 0) + 1
    );
  }
  const chaptersByVolume = new Map<
    string,
    (typeof book.navigation.chapterCards)[number][]
  >();
  for (const chapter of book.navigation.chapterCards) {
    const chapters = chaptersByVolume.get(chapter.volumeId);
    if (chapters) {
      chapters.push(chapter);
    } else {
      chaptersByVolume.set(chapter.volumeId, [chapter]);
    }
  }
  for (const chapters of chaptersByVolume.values()) {
    chapters.sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  }
  const sortedVolumes = [...book.navigation.volumes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const worldbuildingUsesLeftTree =
    index?.featureSettings.worldbuildingItemLayout === "left-tree";
  const characterAndContinuityUseLeftTree =
    index?.featureSettings.characterAndContinuityItemLayout === "left-tree";
  const plotUsesLeftTree =
    index?.featureSettings.plotItemLayout === "left-tree";

  // Long book summaries already contain the lightweight navigation needed by
  // the resource tree. Render it before the book is opened, then reconcile
  // the selection against the complete index when a user selects an item.
  // This keeps the first render consistent with short/script books without
  // loading every long project's file references or document contents.
  const worldRevealSelection = reconcile({
    key: "worldbuilding:reveals",
    root: "worldbuilding",
    title: t("longWorkspaceResourceTree.worldRevelations"),
    breadcrumbs: [
      book.title,
      t("longWorkspaceResourceTree.worldbuilding"),
      t("longWorkspaceResourceTree.worldRevelations")
    ],
    files: [],
    preferredRole: "world-reveals",
    description: t(
      "longWorkspaceResourceTree.showsWorldRevelationsFromTheMostRecentlyCommittedChapter"
    )
  });
  const worldChildren = [
    ...[...book.navigation.worldbuilding]
      .sort((left, right) => left.order - right.order)
      .flatMap((category) => {
        const baseSelection: LongWorkspaceSelection = {
          key: `worldbuilding:${category.id}`,
          root: "worldbuilding",
          title: category.title,
          breadcrumbs: [
            book.title,
            t("longWorkspaceResourceTree.worldbuilding"),
            category.title
          ],
          files: [],
          preferredRole: "content",
          description:
            category.format === "list"
              ? t("longWorkspaceResourceTree.listBasedWorldbuilding")
              : t("longWorkspaceResourceTree.textBasedWorldbuilding")
        };
        const indexedCategory = index?.worldbuilding.find(
          ({ id }) => id === category.id
        );
        const readonly = isLongMigrationEvidenceCategoryId(category.id);
        const listUsesLeftTree =
          worldbuildingUsesLeftTree && indexedCategory?.format === "list";
        // In the left tree the category itself opens its overview, so the
        // items are its only children.
        const selection = listUsesLeftTree
          ? (reconcile({
              ...baseSelection,
              worldbuildingItemId: null,
              preferredRole: "overview"
            }) ?? reconcile(baseSelection))
          : reconcile(baseSelection);
        const itemChildren = listUsesLeftTree
          ? [...indexedCategory.items]
              .sort(
                (left, right) =>
                  left.order - right.order || left.id.localeCompare(right.id)
              )
              .flatMap((item) => {
                const itemSelection = reconcile({
                  ...baseSelection,
                  worldbuildingItemId: item.id,
                  preferredFileId: item.file.id,
                  preferredRole: "content"
                });
                return itemSelection
                  ? [
                      node(itemSelection, {
                        nodeKey: `worldbuilding:${category.id}:item:${item.id}`,
                        icon: "file",
                        label: item.title,
                        readOnly: readonly,
                        ...(!readonly
                          ? {
                              longTreeItem: {
                                kind: "worldbuilding-item" as const,
                                id: item.id,
                                parentId: category.id
                              }
                            }
                          : {})
                      })
                    ]
                  : [];
              })
          : undefined;
        return selection
          ? [
              node(selection, {
                icon: "file",
                badge:
                  category.format === "list"
                    ? t("longWorkspaceResourceTree.list")
                    : t("longWorkspaceResourceTree.text"),
                ...(itemChildren ? { children: itemChildren } : {}),
                ...(listUsesLeftTree ? { selectableBranch: true } : {}),
                ...(listUsesLeftTree && !readonly
                  ? {
                      longTreeCollection: {
                        kind: "worldbuilding-item" as const,
                        parentId: category.id
                      }
                    }
                  : {})
              })
            ]
          : [];
      }),
    ...(worldRevealSelection
      ? [
          node(worldRevealSelection, {
            icon: "file",
            label: t("longWorkspaceResourceTree.worldRevelations")
          })
        ]
      : [])
  ];

  const characterOverviewSelection = reconcile({
    key: "character-overview",
    root: "character_design",
    title: t("catalogWorkspace.overview"),
    breadcrumbs: [
      book.title,
      t("longWorkspaceResourceTree.characterDesign"),
      t("catalogWorkspace.overview")
    ],
    files: [],
    preferredRole: "overview",
    description: t(
      "longWorkspaceResourceTree.characterDesignOverviewASummaryOfAllCharactersTo"
    )
  });
  const characterGroupChildren = [...book.navigation.characterTypes]
    .sort((left, right) => left.order - right.order)
    .map((group) => {
      const groupLabel = longCharacterGroupLabel(
        group.id,
        book.navigation.characterTypes
      );
      const characterCount = characterCountByGroup.get(group.id) ?? 0;
      const baseSelection: LongWorkspaceSelection = {
        key: `character-group:${group.id}`,
        root: "character_design",
        characterGroup: group.id,
        title: groupLabel,
        breadcrumbs: [
          book.title,
          t("longWorkspaceResourceTree.characterDesign"),
          groupLabel
        ],
        files: [],
        preferredRole: "core-profile",
        description: t("longWorkspaceResourceTree.manageCharactersOfType", {
          title: groupLabel
        })
      };
      const selection = reconcile(baseSelection);
      const groupSelection = selection ?? baseSelection;
      const characters = [...book.navigation.characters]
        .filter(({ group: characterGroup }) => characterGroup === group.id)
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id)
        );
      const children = characterAndContinuityUseLeftTree
        ? characters.flatMap((character) => {
            const characterSelection = reconcile({
              ...baseSelection,
              characterId: character.id,
              title: character.name,
              breadcrumbs: [
                book.title,
                t("longWorkspaceResourceTree.characterDesign"),
                groupLabel,
                character.name
              ]
            });
            return characterSelection
              ? [
                  node(characterSelection, {
                    nodeKey: `character:${character.id}`,
                    icon: "user",
                    label: character.name,
                    longTreeItem: {
                      kind: "character",
                      id: character.id,
                      parentId: group.id
                    }
                  })
                ]
              : [];
          })
        : undefined;
      return node(groupSelection, {
        icon: "folder",
        label: groupLabel,
        badge: String(characterCount),
        longCharacterGroup: group.id,
        ...(children ? { children } : {}),
        ...(characterAndContinuityUseLeftTree
          ? {
              longTreeCollection: {
                kind: "character" as const,
                parentId: group.id
              }
            }
          : {})
      });
    });

  const bookLineBaseSelection: LongWorkspaceSelection = {
    key: "plot-design:book-line",
    root: "plot_design",
    title: t("approvalNavigation.overallStoryline"),
    breadcrumbs: [
      book.title,
      t("catalogWorkspace.plotDesign"),
      t("approvalNavigation.overallStoryline")
    ],
    files: [],
    preferredRole: "book-line",
    description: t("longWorkspaceResourceTree.theMainStorylineOfTheEntireNovel")
  };
  const bookLineSelection = reconcile({
    ...bookLineBaseSelection,
    ...(plotUsesLeftTree ? { bookLineVolumeId: null } : {})
  });
  // The storyline node itself opens the full outline; volumes are its children.
  const bookLineChildren = plotUsesLeftTree
    ? sortedVolumes.flatMap((volume) => {
        const volumeSelection = reconcile({
          ...bookLineBaseSelection,
          bookLineVolumeId: volume.id,
          title: volume.title
        });
        return volumeSelection
          ? [
              node(volumeSelection, {
                nodeKey: `plot-design:book-line:volume:${volume.id}`,
                icon: "file",
                label: volume.title,
                longTreeItem: {
                  kind: "volume",
                  id: volume.id
                }
              })
            ]
          : [];
      })
    : undefined;
  const foreshadowingSelection = reconcile({
    key: "plot-design:foreshadowing",
    root: "plot_design",
    title: t("approvalNavigation.foreshadowingOverview"),
    breadcrumbs: [
      book.title,
      t("catalogWorkspace.plotDesign"),
      t("approvalNavigation.foreshadowingOverview")
    ],
    files: [],
    preferredRole: "book-line",
    description: t(
      "longWorkspaceResourceTree.manageForeshadowingThreadsAndReviewBeatsAcrossVolumesAnd"
    )
  });
  const plotPointVolumeChildren: ResourceTreeNode[] = sortedVolumes.map(
    (volume) => {
      const plotPointCount = arcCountByVolume.get(volume.id) ?? 0;
      const baseSelection: LongWorkspaceSelection = {
        key: `plot-design:plot-points:${volume.id}`,
        root: "plot_design",
        plotPointVolumeId: volume.id,
        title: volume.title,
        breadcrumbs: [
          book.title,
          t("catalogWorkspace.plotDesign"),
          t("longImpactConfirmation.plotPoint"),
          volume.title
        ],
        files: [],
        preferredRole: "book-line",
        description: t("longWorkspaceResourceTree.containsPlotPoints", {
          title: volume.title,
          plotPointCount: plotPointCount
        })
      };
      const selection = reconcile(baseSelection);
      const volumeSelection = selection ?? baseSelection;
      const plotPoints = [...book.navigation.arcs]
        .filter(({ volumeId }) => volumeId === volume.id)
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id)
        );
      const children = plotUsesLeftTree
        ? plotPoints.flatMap((plotPoint) => {
            const plotPointSelection = reconcile({
              ...baseSelection,
              plotPointId: plotPoint.id,
              title: plotPoint.title
            });
            return plotPointSelection
              ? [
                  node(plotPointSelection, {
                    nodeKey: `plot-design:plot-point:${plotPoint.id}`,
                    icon: "file",
                    label: plotPoint.title,
                    longTreeItem: {
                      kind: "plot-point",
                      id: plotPoint.id,
                      parentId: volume.id
                    }
                  })
                ]
              : [];
          })
        : undefined;
      return node(volumeSelection, {
        icon: "folder",
        label: volume.title,
        badge: t("longWorkspaceResourceTree.points", {
          plotPointCount: plotPointCount
        }),
        ...(children ? { children } : {}),
        ...(plotUsesLeftTree
          ? {
              longTreeCollection: {
                kind: "plot-point" as const,
                parentId: volume.id
              }
            }
          : {})
      });
    }
  );

  const chapterCardManagementChildren: ResourceTreeNode[] = sortedVolumes.map(
    (volume) => {
      const chapters = chaptersByVolume.get(volume.id) ?? [];
      const fallbackSelection: LongWorkspaceSelection = {
        key: `plot-design:chapter-cards:${volume.id}`,
        root: "plot_design",
        chapterCardVolumeId: volume.id,
        ...(chapters[0] ? { chapterCardId: chapters[0].id } : {}),
        chapterCardTabs: chapters.map((chapter) => ({
          id: chapter.id,
          label: chapter.title,
          narrativeOrder: chapter.narrativeOrder
        })),
        title: chapters[0]?.title ?? volume.title,
        breadcrumbs: [
          book.title,
          t("catalogWorkspace.plotDesign"),
          t("longImpactConfirmation.chapterCard"),
          volume.title,
          ...(chapters[0] ? [chapters[0].title] : [])
        ],
        files: [],
        preferredRole: "book-line",
        description: chapters.length
          ? `${volume.title} · ${chapters[0]!.title}`
          : t(
              "longWorkspaceResourceTree.hasNoChapterCardsYetUseThePlusButton",
              { title: volume.title }
            )
      };
      const selection =
        (index
          ? createLongChapterCardVolumeSelection(
              book,
              index,
              volume.id,
              undefined,
              lookup
            )
          : undefined) ?? fallbackSelection;
      const children =
        plotUsesLeftTree && index
          ? chapters.flatMap((chapter) => {
              const chapterSelection = createLongChapterCardVolumeSelection(
                book,
                index,
                volume.id,
                chapter.id,
                lookup
              );
              return chapterSelection
                ? [
                    node(chapterSelection, {
                      nodeKey: `plot-design:chapter-card:${chapter.id}`,
                      icon: "file",
                      label: chapter.title,
                      longTreeItem: {
                        kind: "chapter-card",
                        id: chapter.id,
                        parentId: volume.id
                      }
                    })
                  ]
                : [];
            })
          : undefined;
      return node(selection, {
        icon: "folder",
        label: volume.title,
        badge: t("longWorkspaceResourceTree.chapters", {
          length: chapters.length
        }),
        ...(children ? { children } : {}),
        ...(plotUsesLeftTree
          ? {
              longTreeCollection: {
                kind: "chapter-card" as const,
                parentId: volume.id
              }
            }
          : {})
      });
    }
  );

  const plotChildren: ResourceTreeNode[] = [
    ...(bookLineSelection
      ? [
          node(bookLineSelection, {
            icon: "file",
            badge: t("longWorkspaceResourceTree.storyline"),
            ...(bookLineChildren ? { children: bookLineChildren } : {}),
            ...(plotUsesLeftTree ? { selectableBranch: true } : {}),
            ...(plotUsesLeftTree
              ? {
                  longTreeCollection: {
                    kind: "volume" as const
                  }
                }
              : {})
          })
        ]
      : []),
    node(
      {
        key: "root:plot-points",
        root: "plot_design",
        title: t("longImpactConfirmation.plotPoint"),
        breadcrumbs: [
          book.title,
          t("catalogWorkspace.plotDesign"),
          t("longImpactConfirmation.plotPoint")
        ],
        files: [],
        preferredRole: "book-line",
        description: t(
          "longWorkspaceResourceTree.organizePlotPointsByVolumeEachVolumeCanContain"
        )
      },
      {
        icon: "history",
        badge: String(book.navigation.counts.arcs),
        children: plotPointVolumeChildren
      }
    ),
    ...(foreshadowingSelection
      ? [
          node(foreshadowingSelection, {
            icon: "pin",
            badge: String(book.navigation.counts.foreshadowingThreads)
          })
        ]
      : []),
    node(
      {
        key: "root:plot-chapter-cards",
        root: "plot_design",
        title: t("longImpactConfirmation.chapterCard"),
        breadcrumbs: [
          book.title,
          t("catalogWorkspace.plotDesign"),
          t("longImpactConfirmation.chapterCard")
        ],
        files: [],
        preferredRole: "book-line",
        description: t(
          "longWorkspaceResourceTree.manageNovelChapterCardsHereEditProseInManuscript"
        )
      },
      {
        icon: "file",
        badge: String(book.navigation.counts.chapterCards),
        children: chapterCardManagementChildren
      }
    )
  ];

  const draftChildren = projectLongWorkspaceDraftTree({
    book,
    ...(index ? { index } : {}),
    volumes: sortedVolumes,
    chaptersByVolume,
    lookup,
    nodeId: (key) => longNavigationNodeId(book.id, key)
  });

  const continuityChildren = projectLongWorkspaceContinuityTree(
    book,
    index,
    lookup
  );

  const counts = book.navigation.counts;
  return [
    node(createLongRootSelection(book, "worldbuilding"), {
      icon: "globe",
      badge: String(counts.worldbuildingCategories),
      children: worldChildren
    }),
    // The character root opens the overview; groups are its only children.
    node(
      characterOverviewSelection ??
        createLongRootSelection(book, "character_design"),
      {
        nodeKey: "root:character_design",
        icon: "user",
        label: LONG_WORKSPACE_ROOT_LABELS.character_design,
        badge: String(counts.characters),
        children: characterGroupChildren,
        selectableBranch: true
      }
    ),
    node(createLongRootSelection(book, "plot_design"), {
      icon: "history",
      badge: String(counts.arcs + counts.volumes + counts.chapterCards),
      children: plotChildren
    }),
    node(createLongRootSelection(book, "draft"), {
      icon: "edit",
      label: t("catalogWorkspace.manuscript"),
      badge: String(counts.chapterCards),
      children: draftChildren,
      longTreeCollection: {
        kind: "volume"
      }
    }),
    node(createLongRootSelection(book, "continuity_ledger"), {
      icon: "ledger",
      badge: String(counts.committedChapters),
      children: continuityChildren
    })
  ];
}
