import type {
  LongBookSummary,
  LongListBooksResult,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { computed, ref, type Ref } from "vue";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
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
import {
  longNavigationNodeId,
  projectLongWorkspaceNavigation
} from "../utils/longWorkspaceResourceTree";
import { createResourceTreeLookup } from "../utils/resourceTreeLookup";

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

  const longBookResourceNodes = computed<ResourceTreeNode[]>(() => {
    const availableIds = new Set(options.longBooks.value.map(({ id }) => id));
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
          badge: "长篇",
          workspaceType: "long" as const,
          longBookId: book.id,
          catalogNodeType: "long-book" as const,
          selectableBranch: true,
          children: projectLongWorkspaceNavigation(book, workspaceIndex)
        };
      }),
      ...[...unavailable.values()].map((diagnostic) => ({
        id: longBookResourceId(diagnostic.bookId),
        label: `不可用长篇 · ${diagnostic.bookId}`,
        icon: "book" as const,
        badge:
          diagnostic.code === "invalid"
            ? "长篇 · 项目读取失败"
            : "长篇 · 暂不可用",
        workspaceType: "long" as const,
        longBookId: diagnostic.bookId,
        catalogNodeType: "long-book" as const,
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
            nodes: [...section.nodes, ...longBookResourceNodes.value]
          }
        : section
    )
  );

  // Index the final tree, including long-form virtual nodes, exactly once per
  // projection change instead of recursively walking it at every call site.
  const resourceTreeLookup = computed(() =>
    createResourceTreeLookup(resourceTreeSections.value)
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
      options.notifications.warning("书籍设置暂时无法保存，但本次操作仍然有效");
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
