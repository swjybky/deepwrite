import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  LongTreeItemAction,
  ResourceTreeNode
} from "../../types/workspace";
import { longNavigationNodeId } from "../../utils/longWorkspaceResourceTree";
import { longDeletionDescription } from "../../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../../utils/longImpactConfirmation";
import type { LongStructureCreate } from "./create";
import type { LongStructureLease } from "./lease";
import type { LongStructureSync } from "./sync";
import { NOOP_COMPLETION, type LongTreeItemDetails } from "./types";

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
      label: "世界观条目",
      title: item.title,
      description: "将永久删除该世界观条目及其正文文件。",
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
      label: "人物",
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
      label: "分卷",
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
      label: "剧情点",
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
  const chapter = index.plot.chapterCards.find(({ id }) => id === target.id);
  if (!chapter) return null;
  return {
    label: "章卡",
    title: chapter.title,
    description: longDeletionDescription(index, "chapterCard", chapter.id),
    orderedIds: index.plot.chapterCards
      .filter(({ volumeId }) => volumeId === chapter.volumeId)
      .sort((left, right) => left.narrativeOrder - right.narrativeOrder)
      .map(({ id }) => id),
    parentResourceId: longNavigationNodeId(
      bookId,
      `plot-design:chapter-cards:${chapter.volumeId}`
    ),
    resourceIdForItem: (id) =>
      longNavigationNodeId(bookId, `plot-design:chapter-card:${id}`)
  };
}

export function isActiveLongTreeItem(
  node: ResourceTreeNode,
  selection: {
    worldbuildingItemId?: string | null;
    characterId?: string | null;
    bookLineVolumeId?: string | null;
    plotPointId?: string | null;
    chapterCardId?: string | null;
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
  if (target.kind === "plot-point") {
    return selection.plotPointId === target.id;
  }
  return selection.chapterCardId === target.id;
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
    openLongChapterCardCreateInternal,
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
      uiMessage.warning(`当前长篇尚未准备好${actionLabel}。`);
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
      uiMessage.warning(`当前长篇尚未准备好${actionLabel}。`);
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
          "新增世界观条目",
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
          uiMessage.warning("当前长篇尚未准备好新建分卷。");
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
        "新增条目",
        requestId
      );
      if (!prepared || !dialogRequestIsCurrent(requestId)) return;
      if (target.kind === "character" && target.parentId) {
        const group = prepared.index.characterTypes.find(
          ({ id }) => id === target.parentId
        );
        if (!group) {
          uiMessage.warning("当前人物类型已不存在，请刷新后重试。");
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
      if (target.kind === "chapter-card" && target.parentId) {
        await openLongChapterCardCreateInternal(requestId, {
          bookId: prepared.bookId,
          volumeId: target.parentId,
          source: "chapter-card"
        });
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
        action === "delete" ? "删除条目" : "调整条目顺序",
        requestId
      );
      if (!prepared || !dialogRequestIsCurrent(requestId)) return;
      const details = resolveLongTreeItemDetails(
        prepared.bookId,
        prepared.index,
        node
      );
      if (!details) {
        uiMessage.warning("该条目已不存在，请刷新后重试。");
        return;
      }
      if (action === "delete") {
        let batch: LongWorkspaceOperationBatch;
        try {
          const { createLongStructureMutationBuilder } =
            await loadLongStructureMutationModule();
          const builder = createLongStructureMutationBuilder(prepared.index);
          if (target.kind === "worldbuilding-item") {
            if (!target.parentId) throw new Error("缺少世界观分类 ID。");
            batch = builder.deleteWorldbuildingItem(target.parentId, target.id);
          } else if (target.kind === "character") {
            batch = builder.deleteCharacter(target.id);
          } else if (target.kind === "volume") {
            batch = builder.deleteVolume(target.id);
          } else if (target.kind === "plot-point") {
            batch = builder.deleteArc(target.id);
          } else {
            batch = builder.deleteChapter(target.id);
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
            error instanceof Error ? error.message : "无法预览删除影响。"
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
              if (!target.parentId) throw new Error("缺少世界观分类 ID。");
              batch = builder.reorderWorldbuildingItem(
                target.parentId,
                target.id,
                direction
              );
            } else if (target.kind === "character") {
              batch = builder.reorderCharacter(target.id, direction);
            } else if (target.kind === "volume") {
              batch = builder.reorderVolume(target.id, direction);
            } else if (target.kind === "plot-point") {
              batch = builder.reorderArc(target.id, direction);
            } else {
              batch = builder.reorderChapter(target.id, direction);
            }
          } catch (error: unknown) {
            if (isDisposed()) return;
            uiMessage.warning(
              error instanceof Error ? error.message : "无法调整条目顺序。"
            );
            return;
          }
          await executeLongStructureMutation(
            lease,
            batch,
            NOOP_COMPLETION,
            {
              successMessage: `已${
                action === "move-up" ? "上移" : "下移"
              }${details.label}“${details.title}”`
            },
            prepared.index
          );
        }
      );
    });
  }

  return {
    resolveLongTreeItemDetails,
    ensureLongTreeTargetBook,
    handleCreateLongTreeItem,
    handleLongTreeItemAction
  };
}

export type LongStructureTree = ReturnType<typeof createLongStructureTree>;
