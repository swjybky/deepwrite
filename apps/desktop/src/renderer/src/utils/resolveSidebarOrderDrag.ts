import type {
  CatalogResourceNodeActionPayload,
  CreationTreeReorderPayload,
  ResourceDomain,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";

export interface SidebarOrderDragResolution {
  findTarget: (id: string) => ResourceTreeNode | undefined;
  canDrop: (target: ResourceTreeNode, position: "before" | "after") => boolean;
  drop: (target: ResourceTreeNode, position: "before" | "after") => void;
}

export interface SidebarOrderDragOptions {
  sections: readonly ResourceTreeSection[];
  pinnedNodes?: readonly ResourceTreeNode[] | undefined;
  domainForPinnedNode?:
    ((node: ResourceTreeNode) => ResourceDomain) | undefined;
  longTreeActionsDisabled?: boolean | undefined;
  canReorderMysteryBook?: ((bookId: string) => boolean) | undefined;
  onReorderLibrary: (payload: CatalogResourceNodeActionPayload) => void;
  onReorderCreationNode: (payload: CreationTreeReorderPayload) => void;
}

interface LocatedSidebarNode {
  node: ResourceTreeNode;
  siblings: readonly ResourceTreeNode[];
  parent?: ResourceTreeNode | undefined;
  domain: ResourceDomain;
  bookId?: string | undefined;
  isPinnedRoot: boolean;
}

function owningBookId(node: ResourceTreeNode): string | undefined {
  if (node.catalogNodeType === "book") return node.id;
  if (node.catalogNodeType === "long-book") return node.longBookId;
  if (node.catalogNodeType === "mystery-book") return node.mysteryBookId;
  return undefined;
}

function findInTree(
  nodes: readonly ResourceTreeNode[],
  targetId: string,
  domainForNode: (
    node: ResourceTreeNode,
    topRoot: ResourceTreeNode
  ) => ResourceDomain,
  parent?: ResourceTreeNode,
  inheritedBookId?: string,
  topRoot?: ResourceTreeNode,
  pinnedRootLayer = false
): LocatedSidebarNode | undefined {
  for (const node of nodes) {
    const root = topRoot ?? node;
    const bookId = inheritedBookId ?? owningBookId(node);
    const domain = domainForNode(node, root);
    if (node.id === targetId) {
      return {
        node,
        siblings: nodes,
        parent,
        domain,
        bookId,
        isPinnedRoot: pinnedRootLayer
      };
    }
    if (node.children?.length) {
      const found = findInTree(
        node.children,
        targetId,
        domainForNode,
        node,
        bookId,
        root,
        false
      );
      if (found) return found;
    }
  }
  return undefined;
}

function locateSidebarNode(
  id: string,
  options: SidebarOrderDragOptions
): LocatedSidebarNode | undefined {
  if (options.pinnedNodes?.length) {
    const pinnedMatch = findInTree(
      options.pinnedNodes,
      id,
      (node, topRoot) =>
        options.domainForPinnedNode?.(topRoot) ??
        options.domainForPinnedNode?.(node) ??
        "creation",
      undefined,
      undefined,
      undefined,
      true
    );
    if (pinnedMatch) return pinnedMatch;
  }
  for (const section of options.sections) {
    const match = findInTree(
      section.nodes,
      id,
      () => section.id,
      undefined,
      undefined,
      undefined,
      false
    );
    if (match) return match;
  }
  return undefined;
}

function isNoOpMove(
  list: readonly ResourceTreeNode[],
  sourceId: string,
  targetId: string,
  position: "before" | "after"
): boolean {
  const sourceIndex = list.findIndex((item) => item.id === sourceId);
  const targetIndex = list.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return true;
  }
  return (
    (position === "before" && sourceIndex + 1 === targetIndex) ||
    (position === "after" && targetIndex + 1 === sourceIndex)
  );
}

function recordedSlots(
  list: readonly ResourceTreeNode[],
  isRecorded: (node: ResourceTreeNode) => boolean
): Map<string, string> {
  const slots = new Map<string, string>();
  let gap = 0;
  list.forEach((item, index) => {
    if (isRecorded(item)) {
      gap += 1;
      slots.set(item.id, `recorded:${index}`);
    } else {
      slots.set(item.id, `gap:${gap}`);
    }
  });
  return slots;
}

function violatesRecordedOrder(
  list: readonly ResourceTreeNode[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
  isRecorded: (node: ResourceTreeNode) => boolean
): boolean {
  if (!list.some(isRecorded)) return false;
  const sourceIndex = list.findIndex((item) => item.id === sourceId);
  if (sourceIndex < 0) return true;
  const reordered = list.filter((item) => item.id !== sourceId);
  const anchorIndex = reordered.findIndex((item) => item.id === targetId);
  if (anchorIndex < 0) return true;
  reordered.splice(
    anchorIndex + (position === "after" ? 1 : 0),
    0,
    list[sourceIndex]!
  );
  const before = recordedSlots(list, isRecorded);
  const after = recordedSlots(reordered, isRecorded);
  return [...before].some(([id, slot]) => after.get(id) !== slot);
}

function longVolumeIdOf(node: ResourceTreeNode): string | undefined {
  if (node.longTreeItem?.kind === "volume") return node.longTreeItem.id;
  if (node.longDraftVolumeId) return node.longDraftVolumeId;
  if (node.longWorkspaceSelection?.plotPointVolumeId && !node.longTreeItem) {
    return node.longWorkspaceSelection.plotPointVolumeId;
  }
  return undefined;
}

function buildSiblingResolution(
  located: LocatedSidebarNode,
  eligible: readonly ResourceTreeNode[],
  buildPayload: (
    target: ResourceTreeNode,
    position: "before" | "after"
  ) => CreationTreeReorderPayload,
  onDrop: (payload: CreationTreeReorderPayload) => void,
  extraCanDrop?: (
    target: ResourceTreeNode,
    position: "before" | "after"
  ) => boolean,
  noOpReference: readonly ResourceTreeNode[] = located.siblings
): SidebarOrderDragResolution | undefined {
  if (eligible.length < 2) return undefined;
  const eligibleIds = new Set(eligible.map((item) => item.id));
  if (!eligibleIds.has(located.node.id)) return undefined;
  return {
    findTarget: (id) =>
      id !== located.node.id && eligibleIds.has(id)
        ? eligible.find((item) => item.id === id)
        : undefined,
    canDrop: (target, position) =>
      !isNoOpMove(noOpReference, located.node.id, target.id, position) &&
      (extraCanDrop ? extraCanDrop(target, position) : true),
    drop: (target, position) => {
      onDrop(buildPayload(target, position));
    }
  };
}

export function resolveSidebarOrderDrag(
  id: string,
  options: SidebarOrderDragOptions
): SidebarOrderDragResolution | undefined {
  const located = locateSidebarNode(id, options);
  if (!located) return undefined;
  const { node, siblings, parent, domain, bookId, isPinnedRoot } = located;
  if (isPinnedRoot || node.unavailable || node.missing) return undefined;

  if (domain === "material" || domain === "skill") {
    if (
      (node.catalogNodeType !== "library" &&
        node.catalogNodeType !== "group") ||
      parent?.readOnly
    ) {
      return undefined;
    }
    const eligible = siblings.filter(
      (item) =>
        !item.unavailable &&
        !item.missing &&
        item.catalogNodeType === node.catalogNodeType
    );
    if (eligible.length < 2) return undefined;
    const eligibleIds = new Set(eligible.map((item) => item.id));
    return {
      findTarget: (targetId) =>
        targetId !== node.id && eligibleIds.has(targetId)
          ? eligible.find((item) => item.id === targetId)
          : undefined,
      canDrop: (target, position) =>
        !isNoOpMove(siblings, node.id, target.id, position),
      drop: (target, position) => {
        options.onReorderLibrary({
          domain,
          action: "reorder-library",
          node,
          anchorId:
            target.catalogNodeType === "group"
              ? target.groupId!
              : target.libraryId!,
          position
        });
      }
    };
  }

  if (domain !== "creation" || !bookId) return undefined;

  // Short / Script
  if (node.plotStageId) {
    const stageId = node.plotStageId;
    const eligible = siblings.filter(
      (item) => Boolean(item.plotStageId) && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "short-plot-stage",
        bookId,
        stageId,
        anchorId: target.plotStageId!,
        position
      }),
      options.onReorderCreationNode
    );
  }

  if (node.characterItemId) {
    const itemId = node.characterItemId;
    const eligible = siblings.filter(
      (item) => Boolean(item.characterItemId) && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "short-character-item",
        bookId,
        itemId,
        anchorId: target.characterItemId!,
        position
      }),
      options.onReorderCreationNode
    );
  }

  if (node.expertSectionId && !node.academicSectionItem) {
    const sectionId = node.expertSectionId;
    const eligible = siblings.filter(
      (item) =>
        Boolean(item.expertSectionId && !item.academicSectionItem) &&
        !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "short-draft-section",
        bookId,
        sectionId,
        anchorSectionId: target.expertSectionId!,
        position
      }),
      options.onReorderCreationNode
    );
  }

  // Long
  if (node.workspaceType === "long") {
    if (options.longTreeActionsDisabled) return undefined;

    if (node.longWorldbuildingCategoryId && !node.readOnly) {
      const categoryId = node.longWorldbuildingCategoryId;
      const eligible = siblings.filter(
        (item) =>
          Boolean(item.longWorldbuildingCategoryId) &&
          !item.readOnly &&
          !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-worldbuilding-category",
          bookId,
          categoryId,
          anchorId: target.longWorldbuildingCategoryId!,
          position
        }),
        options.onReorderCreationNode,
        undefined,
        eligible
      );
    }

    if (
      node.longTreeItem?.kind === "worldbuilding-item" &&
      !node.readOnly &&
      node.longTreeItem.parentId
    ) {
      const { id: itemId, parentId: categoryId } = node.longTreeItem;
      const eligible = siblings.filter(
        (item) =>
          item.longTreeItem?.kind === "worldbuilding-item" &&
          !item.readOnly &&
          !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-worldbuilding-item",
          bookId,
          categoryId,
          itemId,
          anchorId: target.longTreeItem!.id,
          position
        }),
        options.onReorderCreationNode
      );
    }

    if (node.longCharacterGroup) {
      const groupId = node.longCharacterGroup;
      const eligible = siblings.filter(
        (item) => Boolean(item.longCharacterGroup) && !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-character-group",
          bookId,
          groupId,
          anchorId: target.longCharacterGroup!,
          position
        }),
        options.onReorderCreationNode
      );
    }

    if (node.longTreeItem?.kind === "character" && node.longTreeItem.parentId) {
      const { id: characterId, parentId: groupId } = node.longTreeItem;
      const eligible = siblings.filter(
        (item) => item.longTreeItem?.kind === "character" && !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-character",
          bookId,
          groupId,
          characterId,
          anchorId: target.longTreeItem!.id,
          position
        }),
        options.onReorderCreationNode
      );
    }

    const volumeId = longVolumeIdOf(node);
    if (volumeId) {
      if (node.longVolumeHasRecordedChapters) return undefined;
      const eligible = siblings.filter(
        (item) => Boolean(longVolumeIdOf(item)) && !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-volume",
          bookId,
          volumeId,
          anchorId: longVolumeIdOf(target)!,
          position
        }),
        options.onReorderCreationNode,
        (target, position) =>
          !violatesRecordedOrder(
            eligible,
            node.id,
            target.id,
            position,
            (item) => Boolean(item.longVolumeHasRecordedChapters)
          )
      );
    }

    if (
      node.longTreeItem?.kind === "plot-point" &&
      node.longTreeItem.parentId
    ) {
      const { id: plotPointId, parentId: volumeId } = node.longTreeItem;
      const eligible = siblings.filter(
        (item) => item.longTreeItem?.kind === "plot-point" && !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-plot-point",
          bookId,
          volumeId,
          plotPointId,
          anchorId: target.longTreeItem!.id,
          position
        }),
        options.onReorderCreationNode
      );
    }

    if (
      node.longWorkspaceSelection?.root === "draft" &&
      node.longWorkspaceSelection.chapterCardId &&
      parent?.longDraftVolumeId
    ) {
      if (node.longDraftChapterRecorded) return undefined;
      const chapterCardId = node.longWorkspaceSelection.chapterCardId;
      const volumeId = parent.longDraftVolumeId;
      const eligible = siblings.filter(
        (item) =>
          item.longWorkspaceSelection?.root === "draft" &&
          Boolean(item.longWorkspaceSelection.chapterCardId) &&
          !item.unavailable
      );
      return buildSiblingResolution(
        located,
        eligible,
        (target, position) => ({
          kind: "long-draft-chapter",
          bookId,
          volumeId,
          chapterCardId,
          anchorId: target.longWorkspaceSelection!.chapterCardId!,
          position
        }),
        options.onReorderCreationNode,
        (target, position) =>
          !violatesRecordedOrder(
            eligible,
            node.id,
            target.id,
            position,
            (item) => Boolean(item.longDraftChapterRecorded)
          )
      );
    }

    return undefined;
  }

  // Academic
  if (node.academicFrameworkStageItem) {
    const { bookId: academicBookId, stageId } = node.academicFrameworkStageItem;
    const eligible = siblings.filter(
      (item) => Boolean(item.academicFrameworkStageItem) && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "academic-framework-stage",
        bookId: academicBookId,
        stageId,
        anchorId: target.academicFrameworkStageItem!.stageId,
        position
      }),
      options.onReorderCreationNode
    );
  }

  if (node.academicChapterItem) {
    const { bookId: academicBookId, chapterId } = node.academicChapterItem;
    const eligible = siblings.filter(
      (item) => Boolean(item.academicChapterItem) && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "academic-chapter",
        bookId: academicBookId,
        chapterId,
        anchorChapterId: target.academicChapterItem!.chapterId,
        position
      }),
      options.onReorderCreationNode
    );
  }

  if (node.academicSectionItem) {
    const { bookId: academicBookId, sectionId } = node.academicSectionItem;
    const eligible = siblings.filter(
      (item) => Boolean(item.academicSectionItem) && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "academic-section",
        bookId: academicBookId,
        sectionId,
        anchorSectionId: target.academicSectionItem!.sectionId,
        position
      }),
      options.onReorderCreationNode
    );
  }

  // Mystery
  if (node.mysteryItem) {
    if (
      options.canReorderMysteryBook &&
      !options.canReorderMysteryBook(bookId)
    ) {
      return undefined;
    }
    const { kind: itemKind, id: itemId } = node.mysteryItem;
    const eligible = siblings.filter(
      (item) => item.mysteryItem?.kind === itemKind && !item.unavailable
    );
    return buildSiblingResolution(
      located,
      eligible,
      (target, position) => ({
        kind: "mystery-item",
        bookId,
        itemKind,
        id: itemId,
        anchorId: target.mysteryItem!.id,
        position
      }),
      options.onReorderCreationNode
    );
  }

  return undefined;
}
