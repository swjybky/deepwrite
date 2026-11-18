import { createScopedTranslator, i18n, locale } from "../i18n";
import type {
  LongBookSummary,
  LongListBooksResult,
  LongWorkspaceIndexSnapshot,
  MysteryBookSummary,
  MysteryProjectDiagnostic,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { computed, ref, shallowRef, watch, type Ref } from "vue";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { mysteryBookResourceId } from "../stores/mysteryWorkspaceStore";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";
import {
  longBookResourceId,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import {
  applyBookResourcePreferences,
  BOOK_RESOURCE_PREFERENCES_STORAGE_KEY,
  parseBookResourcePreferences,
  type BookResourcePreference
} from "../utils/bookResourcePreferences";
import { longNavigationNodeId } from "../utils/longWorkspaceResourceTree";
import { createLongWorkspaceNavigationCache } from "../utils/longWorkspaceNavigationCache";
import { createResourceTreeLookup } from "../utils/resourceTreeLookup";

const t = createScopedTranslator("workspace");

type LongCatalogDiagnostic = NonNullable<
  LongListBooksResult["diagnostics"]
>[number];

export interface WorkspaceResourceTreeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceResourceTreeCoordinatorOptions {
  catalogProjection: Readonly<Ref<CatalogWorkspaceProjection | null>>;
  fallbackSections: readonly ResourceTreeSection[];
  longBooks: Readonly<Ref<readonly LongBookSummary[]>>;
  longCatalogDiagnostics: Readonly<Ref<readonly LongCatalogDiagnostic[]>>;
  activeLongBookId: Readonly<Ref<string | null>>;
  activeLongWorkspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
  activeLongSelection: Readonly<Ref<LongWorkspaceSelection | null>>;
  mysteryBooks?: Readonly<Ref<readonly MysteryBookSummary[]>>;
  mysteryDiagnostics?: Readonly<Ref<readonly MysteryProjectDiagnostic[]>>;
  selectedMysteryDocumentId?: Readonly<Ref<string | null>>;
  activeMysteryBookId?: Readonly<Ref<string | null>>;
  activeMysteryWorkspaceIndex?: Readonly<
    Ref<MysteryWorkspaceIndexSnapshot | null>
  >;
  selectedResourceId: Ref<string>;
  storage(): WorkspaceResourceTreeStorage | undefined;
  notifications: {
    warning(message: string): void;
  };
}

function collectResourceNodeIds(node: ResourceTreeNode): string[] {
  return [node.id, ...(node.children?.flatMap(collectResourceNodeIds) ?? [])];
}

function readStoredPreferences(
  storage: WorkspaceResourceTreeCoordinatorOptions["storage"]
): string | null {
  try {
    return storage()?.getItem(BOOK_RESOURCE_PREFERENCES_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be unavailable in hardened browser contexts. An unreadable
    // preference must never prevent the workspace tree from rendering.
    return null;
  }
}

/**
 * Owns the final visible resource tree and its lookup indexes. Catalog
 * selection reconciliation remains in useWorkspaceResourceCoordinator so a
 * Catalog metadata/document transaction still has a single owner.
 */
export function useWorkspaceResourceTreeCoordinator(
  options: WorkspaceResourceTreeCoordinatorOptions
) {
  const emptyResourceSections: ResourceTreeSection[] =
    options.fallbackSections.map((section) => ({
      ...section,
      nodes: []
    }));
  const serializedBookResourcePreferences = ref<string | null>(
    readStoredPreferences(options.storage)
  );

  const baseResourceSections = computed<ResourceTreeSection[]>(
    () =>
      options.catalogProjection.value?.resourceSections ?? emptyResourceSections
  );

  // Keep the serialized source until a Catalog projection is available. This
  // avoids discarding valid preferences merely because startup begins with an
  // empty projection, while still revalidating ids after every Catalog refresh.
  const bookResourcePreferences = computed(() =>
    parseBookResourcePreferences(
      serializedBookResourcePreferences.value,
      baseResourceSections.value
    )
  );

  const longNavigationCache = createLongWorkspaceNavigationCache();
  const longBookResourceNodes = computed<ResourceTreeNode[]>(() => {
    const availableIds = new Set(options.longBooks.value.map(({ id }) => id));
    longNavigationCache.retain(availableIds);
    const unavailable = new Map(
      options.longCatalogDiagnostics.value
        .filter(({ bookId }) => !availableIds.has(bookId))
        .map((diagnostic) => [diagnostic.bookId, diagnostic] as const)
    );
    return [
      ...options.longBooks.value.map((book) => {
        const workspaceIndex =
          book.id === options.activeLongBookId.value
            ? options.activeLongWorkspaceIndex.value
            : null;
        return {
          id: longBookResourceId(book.id),
          label: book.title,
          icon: "book" as const,
          badge: t("catalogWorkspace.novel"),
          workspaceType: "long" as const,
          longBookId: book.id,
          catalogNodeType: "long-book" as const,
          selectableBranch: true,
          children: longNavigationCache.project(
            book,
            workspaceIndex,
            locale.value,
            i18n.global.messages.value[locale.value]
          )
        };
      }),
      ...[...unavailable.values()].map((diagnostic) => ({
        id: longBookResourceId(diagnostic.bookId),
        label: t("workspaceResourceTreeCoordinator.unavailableNovel", {
          bookId: diagnostic.bookId
        }),
        icon: "book" as const,
        badge:
          diagnostic.code === "invalid"
            ? t("workspaceResourceTreeCoordinator.novelFailedToReadProject")
            : t("workspaceResourceTreeCoordinator.novelTemporarilyUnavailable"),
        workspaceType: "long" as const,
        longBookId: diagnostic.bookId,
        catalogNodeType: "long-book" as const,
        unavailable: true,
        muted: true
      }))
    ];
  });

  const mysteryTreeBuilder =
    shallowRef<
      typeof import("../utils/mysteryWorkspaceResourceTree").buildMysteryWorkspaceResourceTree
    >();
  watch(
    () => options.activeMysteryWorkspaceIndex?.value,
    (index) => {
      if (index && !mysteryTreeBuilder.value) {
        void import("../utils/mysteryWorkspaceResourceTree").then((module) => {
          mysteryTreeBuilder.value = module.buildMysteryWorkspaceResourceTree;
        });
      }
    },
    { immediate: true }
  );
  const mysteryBookResourceNodes = computed<ResourceTreeNode[]>(() => {
    const books = options.mysteryBooks?.value ?? [];
    const diagnostics = options.mysteryDiagnostics?.value ?? [];
    const availableIds = new Set(books.map(({ id }) => id));
    const unavailable = new Map(
      diagnostics
        .filter(({ bookId }) => !availableIds.has(bookId))
        .map((diagnostic) => [diagnostic.bookId, diagnostic] as const)
    );
    return [
      ...books.map((book) => ({
        id: mysteryBookResourceId(book.id),
        label: book.title,
        icon: "book" as const,
        badge: mysteryLabels("murderMystery"),
        workspaceType: "mystery" as const,
        mysteryBookId: book.id,
        catalogNodeType: "mystery-book" as const,
        selectableBranch: true,
        children:
          book.id === options.activeMysteryBookId?.value &&
          options.activeMysteryWorkspaceIndex?.value?.bookId === book.id &&
          mysteryTreeBuilder.value
            ? mysteryTreeBuilder.value(
                options.activeMysteryWorkspaceIndex.value
              )
            : []
      })),
      ...[...unavailable.values()].map((diagnostic) => ({
        id: mysteryBookResourceId(diagnostic.bookId),
        label: mysteryLabels("unavailableMystery", {
          bookId: diagnostic.bookId
        }),
        icon: "book" as const,
        badge:
          diagnostic.code === "invalid"
            ? mysteryLabels("unavailableMysteryFailed")
            : mysteryLabels("unavailableMysteryTemp"),
        workspaceType: "mystery" as const,
        mysteryBookId: diagnostic.bookId,
        catalogNodeType: "mystery-book" as const,
        unavailable: true,
        muted: true
      }))
    ];
  });

  const resourceTreeSections = computed(() =>
    applyBookResourcePreferences(
      baseResourceSections.value,
      bookResourcePreferences.value
    ).map((section) =>
      section.id === "creation"
        ? {
            ...section,
            nodes: [
              ...section.nodes,
              ...longBookResourceNodes.value,
              ...mysteryBookResourceNodes.value
            ]
          }
        : section
    )
  );

  // Index the final tree, including long-form virtual nodes, exactly once per
  // projection change instead of recursively walking it at every call site.
  const resourceTreeLookup = computed(() =>
    createResourceTreeLookup(resourceTreeSections.value)
  );

  watch(
    () => {
      const id = options.selectedMysteryDocumentId?.value;
      return id && resourceTreeLookup.value.nodeById.has(id) ? id : null;
    },
    (id) => {
      if (id) options.selectedResourceId.value = id;
    }
  );

  function updateBookPreference(
    bookId: string,
    patch: BookResourcePreference
  ): void {
    const nextPreferences = {
      ...bookResourcePreferences.value,
      [bookId]: {
        ...bookResourcePreferences.value[bookId],
        ...patch
      }
    };
    const serialized = JSON.stringify(nextPreferences);

    // Publish the in-memory value before persistence. A storage failure should
    // not roll back the user's current-session action.
    serializedBookResourcePreferences.value = serialized;
    try {
      const storage = options.storage();
      if (!storage) throw new Error("Resource preference storage unavailable");
      storage.setItem(BOOK_RESOURCE_PREFERENCES_STORAGE_KEY, serialized);
    } catch {
      options.notifications.warning(
        t(
          "workspaceResourceTreeCoordinator.bookSettingsCouldNotBeSavedButChangesAre"
        )
      );
    }
  }

  function preferredLongResourceIdForSelection(
    bookId: string,
    index: LongWorkspaceIndexSnapshot,
    selection: LongWorkspaceSelection
  ): string | undefined {
    const settings = index.featureSettings;
    if (
      selection.key.startsWith("worldbuilding:") &&
      selection.key !== "worldbuilding:reveals"
    ) {
      if (settings.worldbuildingItemLayout === "left-tree") {
        const categoryId = selection.key.slice("worldbuilding:".length);
        if (selection.worldbuildingItemId) {
          return longNavigationNodeId(
            bookId,
            `worldbuilding:${categoryId}:item:${selection.worldbuildingItemId}`
          );
        }
        if (selection.worldbuildingItemId === null) {
          return longNavigationNodeId(
            bookId,
            `worldbuilding:${categoryId}:overview`
          );
        }
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key.startsWith("character-group:")) {
      if (
        settings.characterAndContinuityItemLayout === "left-tree" &&
        selection.characterId
      ) {
        return longNavigationNodeId(
          bookId,
          `character:${selection.characterId}`
        );
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key === "plot-design:book-line") {
      if (settings.plotItemLayout === "left-tree") {
        return longNavigationNodeId(
          bookId,
          selection.bookLineVolumeId
            ? `plot-design:book-line:volume:${selection.bookLineVolumeId}`
            : "plot-design:book-line:overview"
        );
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key.startsWith("plot-design:plot-points:")) {
      if (settings.plotItemLayout === "left-tree" && selection.plotPointId) {
        return longNavigationNodeId(
          bookId,
          `plot-design:plot-point:${selection.plotPointId}`
        );
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key.startsWith("plot-design:chapter-cards:")) {
      if (settings.plotItemLayout === "left-tree" && selection.chapterCardId) {
        return longNavigationNodeId(
          bookId,
          `plot-design:chapter-card:${selection.chapterCardId}`
        );
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key.startsWith("continuity:")) {
      if (
        settings.characterAndContinuityItemLayout === "left-tree" &&
        selection.preferredFileId
      ) {
        return longNavigationNodeId(
          bookId,
          `${selection.key}:file:${selection.preferredFileId}`
        );
      }
      return longNavigationNodeId(bookId, selection.key);
    }
    if (selection.key.startsWith("chapter:")) {
      return longNavigationNodeId(bookId, selection.key);
    }
    return undefined;
  }

  function synchronizeSelectedLongResourceForLayout(bookId: string): void {
    const index = options.activeLongWorkspaceIndex.value;
    const selection = options.activeLongSelection.value;
    if (!index || !selection || options.activeLongBookId.value !== bookId) {
      return;
    }
    const resourceId = preferredLongResourceIdForSelection(
      bookId,
      index,
      selection
    );
    if (resourceId && resourceTreeLookup.value.nodeById.has(resourceId)) {
      options.selectedResourceId.value = resourceId;
    }
  }

  return {
    baseResourceSections,
    bookResourcePreferences,
    collectResourceNodeIds,
    longBookResourceNodes,
    preferredLongResourceIdForSelection,
    resourceTreeLookup,
    resourceTreeSections,
    synchronizeSelectedLongResourceForLayout,
    updateBookPreference
  };
}
