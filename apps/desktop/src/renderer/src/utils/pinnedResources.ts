import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

export const PINNED_RESOURCE_STORAGE_KEY = "deepwrite:pinned-resource-ids";

export function flattenResourceNodes(
  nodes: readonly ResourceTreeNode[]
): ResourceTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenResourceNodes(node.children ?? [])
  ]);
}

export function pinnableResourceNodes(
  sections: readonly ResourceTreeSection[]
): ResourceTreeNode[] {
  return sections.flatMap((section) => {
    const topLevel = new Set(section.nodes);
    return flattenResourceNodes(section.nodes).filter(
      (node) =>
        (node.catalogNodeType === "book" && !node.unavailable) ||
        (node.catalogNodeType === "library" && !node.missing && !node.unavailable) ||
        (node.catalogNodeType === undefined && topLevel.has(node))
    );
  });
}

export function parsePinnedResourceIds(
  storedValue: string | null,
  sections: ResourceTreeSection[]
): string[] {
  if (!storedValue) {
    return [];
  }

  try {
    const value: unknown = JSON.parse(storedValue);
    if (!Array.isArray(value)) {
      return [];
    }

    const validIds = new Set(
      pinnableResourceNodes(sections).map((node) => node.id)
    );
    return [...new Set(value.filter((id): id is string => typeof id === "string"))].filter((id) =>
      validIds.has(id)
    );
  } catch {
    return [];
  }
}

export function collectPinnedResourceNodes(
  sections: ResourceTreeSection[],
  pinnedIds: string[]
): ResourceTreeNode[] {
  const nodesById = new Map(
    sections.flatMap((section) =>
      flattenResourceNodes(section.nodes).map((node) => [node.id, node] as const)
    )
  );
  return pinnedIds.flatMap((id) => {
    const node = nodesById.get(id);
    return node ? [node] : [];
  });
}

export function excludePinnedResourceNodes(
  sections: ResourceTreeSection[],
  pinnedIds: string[]
): ResourceTreeSection[] {
  const pinnedIdSet = new Set(pinnedIds);
  return sections.map((section) => ({
    ...section,
    nodes: section.nodes.filter((node) => !pinnedIdSet.has(node.id))
  }));
}
