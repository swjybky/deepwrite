import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

export function isWorkspaceBookNode(node: ResourceTreeNode): boolean {
  return (
    node.catalogNodeType === "book" ||
    node.catalogNodeType === "long-book" ||
    node.catalogNodeType === "mystery-book"
  );
}

export function resourceTreeContainsResource(
  nodes: readonly ResourceTreeNode[],
  resourceId: string
): boolean {
  return nodes.some(
    (node) =>
      node.id === resourceId ||
      resourceTreeContainsResource(node.children ?? [], resourceId)
  );
}

/**
 * Resolves the visible tree node for a selection. Overviews have no row of
 * their own; a selection made by document id belongs to the branch that
 * opens that document.
 */
export function resourceTreeOwnerId(
  nodes: readonly ResourceTreeNode[],
  resourceId: string
): string {
  if (!resourceId) return resourceId;
  let owner: string | undefined;
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === resourceId) return resourceId;
    if (
      owner === undefined &&
      (node.targetDocumentId === resourceId ||
        node.characterStateDocumentId === resourceId)
    ) {
      owner = node.id;
    }
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }
  return owner ?? resourceId;
}

export interface ResourceTreeLookup {
  nodeById: ReadonlyMap<string, ResourceTreeNode>;
  resourceIdByDocumentId: ReadonlyMap<string, string>;
  targetDocumentIdByResourceId: ReadonlyMap<string, string>;
}

function firstNestedTargetDocumentId(
  nodes: readonly ResourceTreeNode[] | undefined
): string | undefined {
  for (const child of nodes ?? []) {
    if (child.targetDocumentId) return child.targetDocumentId;
    const nested = firstNestedTargetDocumentId(child.children);
    if (nested) return nested;
  }
  return undefined;
}

/** Builds lookup tables for the final visible tree, including virtual nodes. */
export function createResourceTreeLookup(
  sections: readonly ResourceTreeSection[]
): ResourceTreeLookup {
  const nodeById = new Map<string, ResourceTreeNode>();
  const resourceIdByDocumentId = new Map<string, string>();
  const targetDocumentIdByResourceId = new Map<string, string>();
  const stack = sections.flatMap((section) => section.nodes).reverse();

  while (stack.length) {
    const node = stack.pop()!;
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    if (!resourceIdByDocumentId.has(node.id)) {
      resourceIdByDocumentId.set(node.id, node.id);
    }
    for (const documentId of [
      node.targetDocumentId,
      node.briefDocumentId,
      node.stateDocumentId,
      node.characterStateDocumentId
    ]) {
      if (documentId && !resourceIdByDocumentId.has(documentId)) {
        resourceIdByDocumentId.set(documentId, node.id);
      }
    }
    const targetDocumentId =
      node.targetDocumentId ??
      (node.stageCategoryId === "draft" || node.academicChapterItem
        ? firstNestedTargetDocumentId(node.children)
        : undefined) ??
      node.id;
    targetDocumentIdByResourceId.set(node.id, targetDocumentId);

    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }

  return {
    nodeById,
    resourceIdByDocumentId,
    targetDocumentIdByResourceId
  };
}
