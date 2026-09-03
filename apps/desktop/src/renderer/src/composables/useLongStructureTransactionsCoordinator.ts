import { computed } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { previewLongWorkspaceOperations } from "@deepwrite/contracts/renderer";
import {
  isLongMigrationEvidenceCategoryId,
  type LongStructureMutationCompletion
} from "../types/longWorkspace";
import type { ResourceTreeNode } from "../types/workspace";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import { longDeletionDescription } from "../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../utils/longImpactConfirmation";
import { createLongStructureCreate } from "./long-structure-transactions/create";
import { createLongStructureDelete } from "./long-structure-transactions/delete";
import { createLongStructureLease } from "./long-structure-transactions/lease";
import { createLongStructureRenameSave } from "./long-structure-transactions/rename-save";
import { createLongStructureSync } from "./long-structure-transactions/sync";
import { createLongStructureTree } from "./long-structure-transactions/tree";
import { NOOP_COMPLETION } from "./long-structure-transactions/types";
import type { LongStructureTransactionsCoordinatorOptions } from "./long-structure-transactions/types";

export type {
  LongStructureTransactionsCoordinatorOptions,
  LongStructureTransactionsNotifications,
  LongStructureTransactionsResourcePort,
  LongStructureTransactionsSessionPort,
  LongStructureTransactionsState
} from "./long-structure-transactions/types";

let longStructureMutationModulePromise: Promise<
  typeof import("../types/longStructureMutations")
> | null = null;

function loadLongStructureMutationModule() {
  return (longStructureMutationModulePromise ??=
    import("../types/longStructureMutations"));
}

/**
 * Owns long-form structure CRUD and its durable preview/apply transaction.
 * Continuity recovery, generic long navigation, approvals and conversations
 * deliberately remain outside this boundary.
 */
export function useLongStructureTransactionsCoordinator(
  options: LongStructureTransactionsCoordinatorOptions
) {
  const { state, session } = options;
  const longWorldbuildingSyncBookOptions = computed<
    LongWorldbuildingSyncBookOption[]
  >(() =>
    state.longBooks.value.map((book) => ({
      id: book.id,
      title: book.title,
      categoryCount: book.navigation.worldbuilding.filter(
        (category) => !isLongMigrationEvidenceCategoryId(category.id)
      ).length
    }))
  );

  const lease = createLongStructureLease(options);
  const sync = createLongStructureSync(lease, loadLongStructureMutationModule);
  const created = createLongStructureCreate(
    lease,
    sync,
    loadLongStructureMutationModule
  );
  const tree = createLongStructureTree(
    lease,
    sync,
    created,
    loadLongStructureMutationModule
  );
  const renameSave = createLongStructureRenameSave(
    lease,
    sync,
    loadLongStructureMutationModule
  );
  const deletion = createLongStructureDelete(
    lease,
    sync,
    loadLongStructureMutationModule
  );

  async function handleLongStructureMutation(
    expectedBookId: string,
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): Promise<void> {
    await lease.withMutation(
      expectedBookId,
      (message) => {
        options.notifications.warning(message);
        completion.fail(message);
      },
      (mutationLease) =>
        sync.executeLongStructureMutation(
          mutationLease,
          batch,
          completion,
          {},
          mutationLease.target.index
        )
    );
  }

  async function handleActiveLongStructureMutation(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): Promise<void> {
    const expectedBookId = state.activeBookId.value;
    if (!expectedBookId) {
      const message = "当前长篇结构尚未就绪。";
      options.notifications.warning(message);
      completion.fail(message);
      return;
    }
    await handleLongStructureMutation(expectedBookId, batch, completion);
  }

  async function previewActiveLongStructureMutation(
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): Promise<void> {
    const expectedBookId = state.activeBookId.value;
    const expectedIndex = state.workspaceIndex.value;
    if (!expectedBookId || !expectedIndex) {
      options.notifications.warning("当前长篇结构尚未就绪。");
      completion();
      return;
    }
    try {
      const impact = previewLongWorkspaceOperations(
        expectedIndex,
        batch
      ).confirmation;
      if (
        state.activeBookId.value !== expectedBookId ||
        state.workspaceIndex.value !== expectedIndex
      ) {
        completion();
        return;
      }
      completion(impact);
    } catch (error: unknown) {
      if (lease.isDisposed()) return;
      options.notifications.warning(
        error instanceof Error
          ? error.message
          : "无法读取这次结构修改的关联影响。"
      );
      completion();
    }
  }

  async function handleLongDraftSectionAction(
    action: "move-up" | "move-down" | "delete",
    node: ResourceTreeNode
  ): Promise<void> {
    await lease.runTracked(async () => {
      const bookId = node.longBookId;
      const chapterCardId = node.longWorkspaceSelection?.chapterCardId;
      if (
        !bookId ||
        !chapterCardId ||
        node.longWorkspaceSelection?.root !== "draft"
      ) {
        options.notifications.warning("当前小节尚未准备好。");
        return;
      }
      if (state.activeBookId.value !== bookId) {
        if (!(await session.saveActiveEditorBeforeLeaving(bookId))) return;
        await session.openBook(bookId);
      } else if (!(await session.saveActiveEditorChanges())) {
        return;
      }
      if (lease.isDisposed()) return;
      const index = state.workspaceIndex.value;
      const chapter = index?.plot.chapterCards.find(
        ({ id }) => id === chapterCardId
      );
      if (state.activeBookId.value !== bookId || !index || !chapter) {
        options.notifications.warning("该小节已不存在，请刷新后重试。");
        return;
      }
      if (action === "delete") {
        try {
          const { createLongStructureMutationBuilder } =
            await loadLongStructureMutationModule();
          const batch =
            createLongStructureMutationBuilder(index).deleteChapter(
              chapterCardId
            );
          const expectedImpact = await sync.previewLongStructureImpact(
            bookId,
            batch
          );
          if (lease.isDisposed() || state.workspaceIndex.value !== index)
            return;
          lease.cancelDialogRequests();
          state.draftSectionDeleteTarget.value = {
            bookId,
            chapterCardId,
            volumeId: chapter.volumeId,
            operationUpdatedAt: batch.updatedAt,
            title: chapter.title,
            description: longImpactConfirmationDescription(
              expectedImpact,
              longDeletionDescription(index, "chapterCard", chapterCardId)
            ),
            expectedImpact
          };
        } catch (error: unknown) {
          if (!lease.isDisposed()) {
            options.notifications.warning(
              error instanceof Error ? error.message : "无法预览小节删除影响。"
            );
          }
        }
        return;
      }
      await lease.withMutation(
        bookId,
        (message) => options.notifications.info(message),
        async (mutationLease) => {
          if (mutationLease.target.index !== index) {
            options.notifications.warning(
              "活动长篇或结构已切换，本次调整已取消。"
            );
            return;
          }
          let batch: LongWorkspaceOperationBatch;
          try {
            const { createLongStructureMutationBuilder } =
              await loadLongStructureMutationModule();
            lease.assertCurrentLongStructureMutationTarget(
              mutationLease.target,
              mutationLease,
              "活动长篇或结构已切换，本次调整已取消。"
            );
            batch = createLongStructureMutationBuilder(index).reorderChapter(
              chapterCardId,
              action === "move-up" ? "up" : "down"
            );
          } catch (error: unknown) {
            if (lease.isDisposed()) return;
            options.notifications.warning(
              error instanceof Error ? error.message : "无法调整小节顺序。"
            );
            return;
          }
          await sync.executeLongStructureMutation(
            mutationLease,
            batch,
            NOOP_COMPLETION,
            {
              saveEditor: false,
              successMessage:
                action === "move-up"
                  ? `已上移小节“${chapter.title}”`
                  : `已下移小节“${chapter.title}”`
            },
            index
          );
        }
      );
    });
  }

  return {
    longWorldbuildingSyncBookOptions,
    openLongChapterCardCreate: created.openLongChapterCardCreate,
    requestCreateLongDraftSection: created.requestCreateLongDraftSection,
    handleLongDraftSectionAction,
    handleCreateLongTreeItem: tree.handleCreateLongTreeItem,
    handleLongTreeItemAction: tree.handleLongTreeItemAction,
    confirmDeleteLongTreeItem: deletion.confirmDeleteLongTreeItem,
    confirmDeleteLongDraftSection: deletion.confirmDeleteLongDraftSection,
    renameLongCharacter: renameSave.renameLongCharacter,
    renameLongStructureTitle: renameSave.renameLongStructureTitle,
    openLongCharacterCreate: created.openLongCharacterCreate,
    openLongWorldbuildingItemCreate: created.openLongWorldbuildingItemCreate,
    openLongVolumeCreate: created.openLongVolumeCreate,
    openLongPlotPointCreate: created.openLongPlotPointCreate,
    saveLongVolumeOutline: renameSave.saveLongVolumeOutline,
    saveLongPlotPointContent: renameSave.saveLongPlotPointContent,
    createLongVolume: created.createLongVolume,
    createLongWorldbuildingItem: created.createLongWorldbuildingItem,
    createLongPlotPoint: created.createLongPlotPoint,
    createLongChapterCard: created.createLongChapterCard,
    handleLongStructureMutation,
    handleActiveLongStructureMutation,
    previewActiveLongStructureMutation,
    handleLongWorldbuildingSync: sync.handleLongWorldbuildingSync,
    deleteActiveLongNavigationStructure:
      deletion.deleteActiveLongNavigationStructure,
    previewActiveLongNavigationStructure:
      deletion.previewActiveLongNavigationStructure,
    createLongCharacter: created.createLongCharacter,
    closeLongStructureDialog: lease.closeLongStructureDialog,
    closeLongCharacterCreate: lease.closeLongCharacterCreate,
    closeLongWorldbuildingItemCreate: lease.closeLongWorldbuildingItemCreate,
    closeLongPlotPointCreate: lease.closeLongPlotPointCreate,
    closeLongChapterCardCreate: lease.closeLongChapterCardCreate,
    closeLongDraftSectionDelete: lease.closeLongDraftSectionDelete,
    closeLongTreeItemDelete: lease.closeLongTreeItemDelete,
    closeLongVolumeCreate: lease.closeLongVolumeCreate,
    drain: lease.drain,
    dispose: lease.dispose
  };
}

export type LongStructureTransactionsCoordinator = ReturnType<
  typeof useLongStructureTransactionsCoordinator
>;
