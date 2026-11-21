import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  CreationTreeReorderPayload,
  LongTreeItemAction,
  ResourceTreeNode
} from "../../types/workspace";
import { isLongMigrationEvidenceCategoryId } from "../../types/longWorkspace";
import { moveLongEntry } from "../../utils/longEntryReorder";
import { longNavigationNodeId } from "../../utils/longWorkspaceResourceTree";
import { longDeletionDescription } from "../../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../../utils/longImpactConfirmation";
import type { LongStructureCreate } from "./create";
import type { LongStructureLease } from "./lease";
import type { LongStructureSync } from "./sync";
import { NOOP_COMPLETION, type LongTreeItemDetails } from "./types";

const t = createScopedTranslator("workspace");

type MutationModule = typeof import("../../types/longStructureMutations");

export function resolveLongTreeItemDetails(
  bookId: string,
  index: LongWorkspaceIndexSnapshot,
  node: ResourceTreeNode
): LongTreeItemDetails | null {
  const target = node.longTreeItem;
  if (!target) return null;
  if (target.kind === "worldbuilding-item") {
    const category = index.worldbuilding.find(
      ({ id }) => id === target.parentId
    );
    if (!category || category.format !== "list") return null;
    const item = category.items.find(({ id }) => id === target.id);
    if (!item) return null;
    const orderedIds = [...category.items]
      .sort((left, right) => left.order - right.order)
      .map(({ id }) => id);
    return {
      label: t("longImpactConfirmation.worldbuildingEntry"),
      title: item.title,
      description: t(
        "tree.thisWillPermanentlyDeleteTheWorldbuildingEntryAndIts"
      ),
      orderedIds,
      parentResourceId: longNavigationNodeId(
        bookId,
        `worldbuilding:${category.id}`
      ),
      resourceIdForItem: (id) =>
        longNavigationNodeId(bookId, `worldbuilding:${category.id}:item:${id}`)
    };
  }
  if (target.kind === "character") {
    const character = index.characters.find(({ id }) => id === target.id);
    if (!character) return null;
    const orderedIds = index.characters
      .filter(({ group }) => group === character.group)
      .sort((left, right) => left.order - right.order)
      .map(({ id }) => id);
    return {
      label: t("catalogWorkspace.characters"),
      title: character.name,
      description: longDeletionDescription(index, "character", character.id),
      orderedIds,
      parentResourceId: longNavigationNodeId(
        bookId,
        `character-group:${character.group}`
      ),
      resourceIdForItem: (id) => longNavigationNodeId(bookId, `character:${id}`)
    };
  }
  if (target.kind === "volume") {
    const volume = index.plot.volumes.find(({ id }) => id === target.id);
    if (!volume) return null;
    return {
      label: t("longImpactConfirmation.volume"),
      title: volume.title,
      description: longDeletionDescription(index, "volume", volume.id),
      orderedIds: [...index.plot.volumes]
        .sort((left, right) => left.order - right.order)
        .map(({ id }) => id),
      parentResourceId: longNavigationNodeId(bookId, "plot-design:book-line"),
      resourceIdForItem: (id) =>
        longNavigationNodeId(bookId, `plot-design:book-line:volume:${id}`)
    };
  }
  if (target.kind === "plot-point") {
    const plotPoint = index.plot.arcs.find(({ id }) => id === target.id);
    if (!plotPoint) return null;
    return {
      label: t("longImpactConfirmation.plotPoint"),
      title: plotPoint.title,
      description: longDeletionDescription(index, "plotPoint", plotPoint.id),
      orderedIds: index.plot.arcs
        .filter(({ volumeId }) => volumeId === plotPoint.volumeId)
        .sort((left, right) => left.order - right.order)
        .map(({ id }) => id),
      parentResourceId: longNavigationNodeId(
        bookId,
        `plot-design:plot-points:${plotPoint.volumeId}`
      ),
      resourceIdForItem: (id) =>
        longNavigationNodeId(bookId, `plot-design:plot-point:${id}`)
    };
  }
  return null;
}

export function isActiveLongTreeItem(
  node: ResourceTreeNode,
  selection: {
    worldbuildingItemId?: string | null;
    characterId?: string | null;
    bookLineVolumeId?: string | null;
    plotPointId?: string | null;
  } | null
): boolean {
  const target = node.longTreeItem;
  if (!target || !selection) return false;
  if (target.kind === "worldbuilding-item") {
    return selection.worldbuildingItemId === target.id;
  }
  if (target.kind === "character") {
    return selection.characterId === target.id;
  }
  if (target.kind === "volume") {
    return selection.bookLineVolumeId === target.id;
  }
  return selection.plotPointId === target.id;
}

export function createLongStructureTree(
  host: LongStructureLease,
  sync: LongStructureSync,
  created: LongStructureCreate,
  loadLongStructureMutationModule: () => Promise<MutationModule>
) {
  const {
    uiMessage,
    session,
    state,
    isDisposed,
    assertCurrentLongStructureMutationTarget,
    withMutation,
    runTracked,
    beginDialogRequest,
    dialogRequestIsCurrent
  } = host;
  const { executeLongStructureMutation, previewLongStructureImpact } = sync;
  const {
    openLongWorldbuildingItemCreateForCategoryInternal,
    openLongPlotPointCreateForVolumeInternal,
    openLongVolumeCreateInternal
  } = created;
  const {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    characterCreateTarget: longCharacterCreate,
    treeItemDeleteTarget: longTreeItemDelete
  } = state;
  const {
    saveActiveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
    openBook: openLongBook
  } = session;

  async function ensureLongTreeTargetBook(
    node: ResourceTreeNode,
    actionLabel: string,
    requestId: number
  ): Promise<{
    bookId: string;
    summary: LongBookSummary;
    index: LongWorkspaceIndexSnapshot;
  } | null> {
    const bookId = node.longBookId;
    if (!bookId || node.workspaceType !== "long") {
      uiMessage.warning(
        t("tree.theCurrentLongFormProjectIsNotReadyFor", {
          actionLabel: actionLabel
        })
      );
      return null;
    }
    if (activeLongBookId.value !== bookId) {
      if (!(await saveActiveLongEditorBeforeLeaving(bookId))) return null;
      if (!dialogRequestIsCurrent(requestId)) return null;
      await openLongBook(bookId, node.longWorkspaceSelection ?? null);
    }
    if (!dialogRequestIsCurrent(requestId)) return null;
    const summary = activeLongBookSummary.value;
    const index = activeLongWorkspaceIndex.value;
    if (!summary || !index || summary.id !== bookId) {
      uiMessage.warning(
        t("tree.theCurrentLongFormProjectIsNotReadyFor", {
          actionLabel: actionLabel
        })
      );
      return null;
    }
    return { bookId, summary, index };
  }

  async function handleCreateLongTreeItem(
    node: ResourceTreeNode
  ): Promise<void> {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    await runTracked(async () => {
      const target = node.longTreeCollection;
      if (!target) return;
      if (target.kind === "worldbuilding-item" && target.parentId) {
        const prepared = await ensureLongTreeTargetBook(
          node,
          t("tree.addWorldbuildingEntry"),
          requestId
        );
        if (!prepared || !dialogRequestIsCurrent(requestId)) return;
        await openLongWorldbuildingItemCreateForCategoryInternal(
          requestId,
          prepared.bookId,
          target.parentId
        );
        return;
      }
      if (target.kind === "volume") {
        const bookId = node.longBookId;
        if (!bookId || node.workspaceType !== "long") {
          uiMessage.warning(t("tree.theCurrentLongFormProjectIsNotReadyTo"));
          return;
        }
        await openLongVolumeCreateInternal(requestId, {
          bookId,
          source:
            node.longWorkspaceSelection?.root === "draft"
              ? "draft"
              : "book-line"
        });
        return;
      }
      const prepared = await ensureLongTreeTargetBook(
        node,
        t("tree.addEntry"),
        requestId
      );
      if (!prepared || !dialogRequestIsCurrent(requestId)) return;
      if (target.kind === "character" && target.parentId) {
        const group = prepared.index.characterTypes.find(
          ({ id }) => id === target.parentId
        );
        if (!group) {
          uiMessage.warning(
            t("tree.thisCharacterTypeNoLongerExistsRefreshAndTry")
          );
          return;
        }
        longCharacterCreate.value = {
          bookId: prepared.bookId,
          group: group.id,
          groupLabel: group.title
        };
        return;
      }
      if (target.kind === "plot-point" && target.parentId) {
        await openLongPlotPointCreateForVolumeInternal(
          requestId,
          prepared.bookId,
          target.parentId
        );
        return;
      }
    });
  }

  async function handleLongTreeItemAction(
    action: LongTreeItemAction,
    node: ResourceTreeNode
  ): Promise<void> {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    await runTracked(async () => {
      const target = node.longTreeItem;
      if (!target) return;
      const prepared = await ensureLongTreeTargetBook(
        node,
        action === "delete" ? t("tree.deleteEntry") : t("tree.reorderEntry"),
        requestId
      );
      if (!prepared || !dialogRequestIsCurrent(requestId)) return;
      const details = resolveLongTreeItemDetails(
        prepared.bookId,
        prepared.index,
        node
      );
      if (!details) {
        uiMessage.warning(
          t("delete.thisEntryNoLongerExistsRefreshAndTryAgain")
        );
        return;
      }
      if (action === "delete") {
        let batch: LongWorkspaceOperationBatch;
        try {
          const { createLongStructureMutationBuilder } =
            await loadLongStructureMutationModule();
          const builder = createLongStructureMutationBuilder(prepared.index);
          if (target.kind === "worldbuilding-item") {
            if (!target.parentId)
              throw new Error(t("delete.theWorldbuildingCategoryIdIsMissing"));
            batch = builder.deleteWorldbuildingItem(target.parentId, target.id);
          } else if (target.kind === "character") {
            batch = builder.deleteCharacter(target.id);
          } else if (target.kind === "volume") {
            batch = builder.deleteVolume(target.id);
          } else {
            batch = builder.deleteArc(target.id);
          }
          const expectedImpact = await previewLongStructureImpact(
            prepared.bookId,
            batch
          );
          if (!dialogRequestIsCurrent(requestId)) return;
          longTreeItemDelete.value = {
            bookId: prepared.bookId,
            node,
            operationUpdatedAt: batch.updatedAt,
            label: details.label,
            title: details.title,
            description: longImpactConfirmationDescription(
              expectedImpact,
              details.description
            ),
            expectedImpact
          };
        } catch (error: unknown) {
          if (isDisposed()) return;
          uiMessage.warning(
            formatError(error, t("tree.couldNotPreviewTheDeletionImpact"))
          );
        }
        return;
      }
      await withMutation(
        prepared.bookId,
        (message) => uiMessage.info(message),
        async (lease) => {
          if (lease.target.index !== prepared.index) return;
          let batch: LongWorkspaceOperationBatch;
          try {
            const { createLongStructureMutationBuilder } =
              await loadLongStructureMutationModule();
            assertCurrentLongStructureMutationTarget(lease.target, lease);
            const builder = createLongStructureMutationBuilder(prepared.index);
            const direction = action === "move-up" ? "up" : "down";
            if (target.kind === "worldbuilding-item") {
              if (!target.parentId)
                throw new Error(
                  t("delete.theWorldbuildingCategoryIdIsMissing")
                );
              batch = builder.reorderWorldbuildingItem(
                target.parentId,
                target.id,
                direction
              );
            } else if (target.kind === "character") {
              batch = builder.reorderCharacter(target.id, direction);
            } else if (target.kind === "volume") {
              batch = builder.reorderVolume(target.id, direction);
            } else {
              batch = builder.reorderArc(target.id, direction);
            }
          } catch (error: unknown) {
            if (isDisposed()) return;
            uiMessage.warning(
              formatError(error, t("tree.couldNotReorderTheEntry"))
            );
            return;
          }
          await executeLongStructureMutation(
            lease,
            batch,
            NOOP_COMPLETION,
            {
              successMessage: t("tree.message", {
                value:
                  action === "move-up"
                    ? t("proposalCoordinator.moveUp")
                    : t("proposalCoordinator.moveDown"),
                label: details.label,
                title: details.title
              })
            },
            prepared.index
          );
        }
      );
    });
  }

  function buildLongReorderOperation(
    index: LongWorkspaceIndexSnapshot,
    payload: Extract<
      CreationTreeReorderPayload,
      {
        kind:
          | "long-worldbuilding-category"
          | "long-worldbuilding-item"
          | "long-character-group"
          | "long-character"
          | "long-volume"
          | "long-plot-point"
          | "long-draft-chapter";
      }
    >
  ): LongWorkspaceOperation | null {
    switch (payload.kind) {
      case "long-worldbuilding-category": {
        const allIds = [...index.worldbuilding]
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const mutableIds = allIds.filter(
          (id) => !isLongMigrationEvidenceCategoryId(id)
        );
        const reorderedMutable = moveLongEntry(
          mutableIds,
          payload.categoryId,
          payload.anchorId,
          payload.position
        );
        if (reorderedMutable.every((id, idx) => id === mutableIds[idx])) {
          return null;
        }
        let cursor = 0;
        const orderedIds = allIds.map((id) =>
          isLongMigrationEvidenceCategoryId(id)
            ? id
            : reorderedMutable[cursor++]!
        );
        return { type: "worldbuilding.reorder", orderedIds };
      }
      case "long-worldbuilding-item": {
        const category = index.worldbuilding.find(
          ({ id }) => id === payload.categoryId
        );
        if (
          !category ||
          category.format !== "list" ||
          isLongMigrationEvidenceCategoryId(category.id)
        ) {
          return null;
        }
        const currentIds = [...category.items]
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.itemId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return {
          type: "worldbuildingItem.reorder",
          categoryId: payload.categoryId,
          orderedIds
        };
      }
      case "long-character-group": {
        const currentIds = [...index.characterTypes]
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.groupId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return { type: "characterType.reorder", orderedIds };
      }
      case "long-character": {
        const currentIds = index.characters
          .filter((candidate) => candidate.group === payload.groupId)
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.characterId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return {
          type: "character.reorder",
          group: payload.groupId,
          orderedIds
        };
      }
      case "long-volume": {
        const currentIds = [...index.plot.volumes]
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.volumeId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return { type: "volume.reorder", orderedIds };
      }
      case "long-plot-point": {
        const currentIds = index.plot.arcs
          .filter((candidate) => candidate.volumeId === payload.volumeId)
          .sort((left, right) => left.order - right.order)
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.plotPointId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return {
          type: "arc.reorder",
          volumeId: payload.volumeId,
          orderedIds
        };
      }
      case "long-draft-chapter": {
        const currentIds = index.plot.chapterCards
          .filter((candidate) => candidate.volumeId === payload.volumeId)
          .sort(
            (left, right) =>
              left.narrativeOrder - right.narrativeOrder ||
              left.id.localeCompare(right.id)
          )
          .map(({ id }) => id);
        const orderedIds = moveLongEntry(
          currentIds,
          payload.chapterCardId,
          payload.anchorId,
          payload.position
        );
        if (orderedIds.every((id, idx) => id === currentIds[idx])) {
          return null;
        }
        return {
          type: "chapter.reorder",
          volumeId: payload.volumeId,
          orderedIds
        };
      }
    }
  }

  async function handleReorderLongTreeNode(
    payload: Extract<
      CreationTreeReorderPayload,
      {
        kind:
          | "long-worldbuilding-category"
          | "long-worldbuilding-item"
          | "long-character-group"
          | "long-character"
          | "long-volume"
          | "long-plot-point"
          | "long-draft-chapter";
      }
    >
  ): Promise<void> {
    const requestId = beginDialogRequest();
    if (requestId === null) return;
    await runTracked(async () => {
      if (activeLongBookId.value !== payload.bookId) {
        if (!(await saveActiveLongEditorBeforeLeaving(payload.bookId))) return;
        if (!dialogRequestIsCurrent(requestId)) return;
        await openLongBook(payload.bookId, null);
      }
      if (!dialogRequestIsCurrent(requestId)) return;
      const summary = activeLongBookSummary.value;
      const index = activeLongWorkspaceIndex.value;
      if (!summary || !index || summary.id !== payload.bookId) {
        uiMessage.warning(
          t("longBookLifecycleCoordinator.theCurrentNovelStructureIsNotReady")
        );
        return;
      }
      await withMutation(
        payload.bookId,
        (message) => uiMessage.info(message),
        async (lease) => {
          const operation = buildLongReorderOperation(
            lease.target.index,
            payload
          );
          if (!operation) return;
          const batch: LongWorkspaceOperationBatch = {
            updatedAt: new Date().toISOString(),
            operations: [operation],
            documentWrites: []
          };
          await executeLongStructureMutation(
            lease,
            batch,
            NOOP_COMPLETION,
            { saveEditor: false },
            lease.target.index
          );
        },
        { blockUi: false }
      );
    });
  }

  return {
    resolveLongTreeItemDetails,
    ensureLongTreeTargetBook,
    handleCreateLongTreeItem,
    handleLongTreeItemAction,
    handleReorderLongTreeNode
  };
}

export type LongStructureTree = ReturnType<typeof createLongStructureTree>;
