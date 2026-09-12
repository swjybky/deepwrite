import {
  createEmptyLongMarkdownFileReference,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId
} from "../long-workspace";
import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
import { cleanupProjectionForDeletedEntity } from "./ledger-cleanup";

import {
  addFileCreateIntent,
  addFileDeleteIntent,
  assertExactOrder,
  assertNewEntityId,
  ensureFilesAvailable,
  findEntityIndex,
  markCreated,
  markDeleted,
  markUpdated,
  operationError,
  registerProvisionalId,
  updateOrdersById,
  nextOrder
} from "./state";

export function applyWorldbuildingOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "featureSettings.update": {
      if (operation.patch.worldbuildingItemLayout !== undefined) {
        workspace.featureSettings.worldbuildingItemLayout =
          operation.patch.worldbuildingItemLayout;
      }
      if (operation.patch.characterAndContinuityItemLayout !== undefined) {
        workspace.featureSettings.characterAndContinuityItemLayout =
          operation.patch.characterAndContinuityItemLayout;
      }
      if (operation.patch.plotItemLayout !== undefined) {
        workspace.featureSettings.plotItemLayout =
          operation.patch.plotItemLayout;
      }
      break;
    }
    case "worldbuilding.create": {
      assertNewEntityId(
        workspace.worldbuilding,
        operation.category.id,
        "Worldbuilding category"
      );
      const category = structuredClone(operation.category);
      if (category.format === "list" && !category.overview) {
        category.overview = createEmptyLongMarkdownFileReference(
          longWorldbuildingOverviewFileId(category.id),
          longWorldbuildingOverviewContentPath(category.id),
          workspace.updatedAt
        );
      }
      const categoryFiles =
        category.format === "text"
          ? [category.file]
          : [
              ...(category.overview ? [category.overview] : []),
              ...category.items.map(({ file }) => file)
            ];
      ensureFilesAvailable(state, categoryFiles);
      category.order = nextOrder(
        workspace.worldbuilding.map(({ order }) => order)
      );
      workspace.worldbuilding.push(category);
      categoryFiles.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create worldbuilding category ${category.id}`
        )
      );
      markCreated(state, category.id);
      registerProvisionalId(state, operation.provisionalId, category.id);
      break;
    }
    case "worldbuilding.update": {
      const categoryIndex = findEntityIndex(
        workspace.worldbuilding,
        operation.id,
        "Worldbuilding category"
      );
      const category = workspace.worldbuilding[categoryIndex]!;
      if (
        operation.patch.format !== undefined &&
        operation.patch.format !== category.format
      ) {
        const title = operation.patch.title ?? category.title;
        if (category.format === "list") {
          if (category.overview) {
            addFileDeleteIntent(
              state,
              category.overview,
              `Convert worldbuilding category ${category.id} to text`
            );
          }
          category.items.forEach((item) => {
            addFileDeleteIntent(
              state,
              item.file,
              `Convert worldbuilding category ${category.id} to text`
            );
            cleanupProjectionForDeletedEntity(state, item.id);
          });
          const file = createEmptyLongMarkdownFileReference(
            longWorldbuildingFileId(category.id),
            longWorldbuildingContentPath(category.id),
            workspace.updatedAt
          );
          ensureFilesAvailable(state, [file]);
          addFileCreateIntent(
            state,
            file,
            `Convert worldbuilding category ${category.id} to text`
          );
          workspace.worldbuilding[categoryIndex] = {
            id: category.id,
            title,
            order: category.order,
            format: "text",
            contentAuthority: "markdown",
            file
          };
        } else {
          addFileDeleteIntent(
            state,
            category.file,
            `Convert worldbuilding category ${category.id} to list`
          );
          // This id becomes a filename; keep the suffix valid on Windows.
          const itemId = `worlditem_${category.id
            .replace(/^world_/u, "")
            .slice(0, 120)}_converted`;
          const existingItems = workspace.worldbuilding.flatMap((candidate) =>
            candidate.format === "list" ? candidate.items : []
          );
          assertNewEntityId(
            existingItems,
            itemId,
            "Converted worldbuilding item"
          );
          const file = createEmptyLongMarkdownFileReference(
            longWorldbuildingItemFileId(itemId),
            longWorldbuildingItemContentPath(category.id, itemId),
            workspace.updatedAt
          );
          const overview = createEmptyLongMarkdownFileReference(
            longWorldbuildingOverviewFileId(category.id),
            longWorldbuildingOverviewContentPath(category.id),
            workspace.updatedAt
          );
          ensureFilesAvailable(state, [overview, file]);
          addFileCreateIntent(
            state,
            overview,
            `Convert worldbuilding category ${category.id} to list`
          );
          addFileCreateIntent(
            state,
            file,
            `Convert worldbuilding category ${category.id} to list`
          );
          workspace.worldbuilding[categoryIndex] = {
            id: category.id,
            title,
            order: category.order,
            format: "list",
            contentAuthority: "files",
            overview,
            items: [
              {
                id: itemId,
                title: "原文本内容",
                order: 1,
                file
              }
            ]
          };
        }
      } else if (operation.patch.title !== undefined) {
        category.title = operation.patch.title;
      }
      markUpdated(state, operation.id);
      break;
    }
    case "worldbuilding.delete": {
      const index = findEntityIndex(
        workspace.worldbuilding,
        operation.id,
        "Worldbuilding category"
      );
      const category = workspace.worldbuilding[index]!;
      const files =
        category.format === "text"
          ? [category.file]
          : [
              ...(category.overview ? [category.overview] : []),
              ...category.items.map(({ file }) => file)
            ];
      files.forEach((file) =>
        addFileDeleteIntent(
          state,
          file,
          `Delete worldbuilding category ${category.id}`
        )
      );
      if (category.format === "list") {
        category.items.forEach((item) =>
          cleanupProjectionForDeletedEntity(state, item.id)
        );
      }
      cleanupProjectionForDeletedEntity(state, category.id);
      workspace.worldbuilding.splice(index, 1);
      markDeleted(state, category.id);
      break;
    }
    case "worldbuildingItem.create": {
      const category =
        workspace.worldbuilding[
          findEntityIndex(
            workspace.worldbuilding,
            operation.categoryId,
            "Worldbuilding category"
          )
        ]!;
      if (category.format !== "list") {
        operationError(
          "invalid_reference",
          `Worldbuilding category ${category.id} is not a list.`
        );
      }
      const allItems = workspace.worldbuilding.flatMap((candidate) =>
        candidate.format === "list" ? candidate.items : []
      );
      assertNewEntityId(allItems, operation.item.id, "Worldbuilding item");
      ensureFilesAvailable(state, [operation.item.file]);
      const item = structuredClone(operation.item);
      item.order = nextOrder(category.items.map(({ order }) => order));
      category.items.push(item);
      addFileCreateIntent(
        state,
        operation.item.file,
        `Create worldbuilding item ${operation.item.id}`
      );
      markCreated(state, operation.item.id);
      markUpdated(state, category.id);
      registerProvisionalId(state, operation.provisionalId, operation.item.id);
      break;
    }
    case "worldbuildingItem.update": {
      const category =
        workspace.worldbuilding[
          findEntityIndex(
            workspace.worldbuilding,
            operation.categoryId,
            "Worldbuilding category"
          )
        ]!;
      if (category.format !== "list") {
        operationError(
          "invalid_reference",
          "Worldbuilding category is not a list."
        );
      }
      const item =
        category.items[
          findEntityIndex(category.items, operation.id, "Worldbuilding item")
        ]!;
      Object.assign(item, operation.patch);
      markUpdated(state, item.id);
      markUpdated(state, category.id);
      break;
    }
    case "worldbuildingItem.delete": {
      const category =
        workspace.worldbuilding[
          findEntityIndex(
            workspace.worldbuilding,
            operation.categoryId,
            "Worldbuilding category"
          )
        ]!;
      if (category.format !== "list") {
        operationError(
          "invalid_reference",
          "Worldbuilding category is not a list."
        );
      }
      const itemIndex = findEntityIndex(
        category.items,
        operation.id,
        "Worldbuilding item"
      );
      const item = category.items[itemIndex]!;
      addFileDeleteIntent(
        state,
        item.file,
        `Delete worldbuilding item ${item.id}`
      );
      cleanupProjectionForDeletedEntity(state, item.id);
      category.items.splice(itemIndex, 1);
      markDeleted(state, item.id);
      markUpdated(state, category.id);
      break;
    }
    case "worldbuildingItem.reorder": {
      const category =
        workspace.worldbuilding[
          findEntityIndex(
            workspace.worldbuilding,
            operation.categoryId,
            "Worldbuilding category"
          )
        ]!;
      if (category.format !== "list") {
        operationError(
          "invalid_reference",
          "Worldbuilding category is not a list."
        );
      }
      assertExactOrder(
        category.items.map(({ id }) => id),
        operation.orderedIds,
        "Worldbuilding items"
      );
      updateOrdersById(
        category.items,
        operation.orderedIds,
        (item, order) => {
          item.order = order;
        },
        state
      );
      markUpdated(state, category.id);
      break;
    }
    case "worldbuilding.reorder": {
      assertExactOrder(
        workspace.worldbuilding.map(({ id }) => id),
        operation.orderedIds,
        "Worldbuilding"
      );
      updateOrdersById(
        workspace.worldbuilding,
        operation.orderedIds,
        (category, order) => {
          category.order = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
