import { createScopedTranslator } from "../i18n";
import {
  LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS_PER_CATEGORY,
  type LongFileId,
  type LongWorldbuildingCategory,
  type LongWorldbuildingDirectorySnapshot,
  type LongWorldbuildingFocusSnapshot
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";

const t = createScopedTranslator("workspace");

export function buildLongWorldbuildingDirectorySnapshot(
  categories: readonly LongWorldbuildingCategory[]
): LongWorldbuildingDirectorySnapshot {
  const visibleCategories = [...categories]
    .sort((left, right) => left.order - right.order)
    .slice(0, LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES);
  let remainingItemCapacity = LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS;
  return {
    categories: visibleCategories.map((category) => {
      if (category.format === "text") {
        return {
          categoryId: category.id,
          title: category.title,
          order: category.order,
          format: "text" as const
        };
      }
      const orderedItems = [...category.items].sort(
        (left, right) => left.order - right.order
      );
      const items = orderedItems
        .slice(
          0,
          Math.min(
            remainingItemCapacity,
            LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS_PER_CATEGORY
          )
        )
        .map((item) => ({
          itemId: item.id,
          title: item.title,
          order: item.order
        }));
      remainingItemCapacity -= items.length;
      return {
        categoryId: category.id,
        title: category.title,
        order: category.order,
        format: "list" as const,
        itemCount: orderedItems.length,
        items,
        omittedItemCount: orderedItems.length - items.length
      };
    }),
    omittedCategoryCount: categories.length - visibleCategories.length
  };
}

export function buildLongWorldbuildingFocusSnapshot(input: {
  selection: LongWorkspaceSelection | null;
  activeFileId: LongFileId | null;
}): LongWorldbuildingFocusSnapshot | undefined {
  const { selection, activeFileId } = input;
  if (
    selection?.root !== "worldbuilding" ||
    !selection.worldbuildingFormat ||
    !activeFileId
  ) {
    return undefined;
  }

  const activeFile = selection.files.find(
    ({ file }) => file.id === activeFileId
  );
  const categoryId = selection.key.slice("worldbuilding:".length);
  if (!activeFile || !categoryId.startsWith("world_")) return undefined;

  if (selection.worldbuildingFormat === "text") {
    return {
      categoryId,
      categoryTitle: selection.title,
      format: "text",
      currentStage: { kind: "text", title: selection.title }
    };
  }

  const activeItem = selection.worldbuildingItems?.find(
    ({ file }) => file.id === activeFileId
  );
  if (activeItem) {
    return {
      categoryId,
      categoryTitle: selection.title,
      format: "list",
      currentStage: {
        kind: "item",
        itemId: activeItem.id,
        title: activeItem.title
      }
    };
  }

  const overviewFile = selection.files.find(({ role }) => role === "overview");
  if (overviewFile?.file.id !== activeFileId) return undefined;
  return {
    categoryId,
    categoryTitle: selection.title,
    format: "list",
    currentStage: { kind: "overview", title: t("catalogWorkspace.overview") }
  };
}
