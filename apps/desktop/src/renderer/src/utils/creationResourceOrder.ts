import type {
  CreationBookDragPayload,
  ResourceTreeSection
} from "../types/workspace";

export const CREATION_RESOURCE_ORDER_STORAGE_KEY =
  "deepwrite:creation-resource-order";

export function parseCreationResourceOrder(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
      )
    ];
  } catch {
    return [];
  }
}

export function creationResourceIds(
  sections: readonly ResourceTreeSection[]
): string[] {
  return (
    sections.find(({ id }) => id === "creation")?.nodes.map(({ id }) => id) ??
    []
  );
}

export function reconcileCreationResourceOrder(
  order: readonly string[],
  currentIds: readonly string[],
  previouslySeenIds: ReadonlySet<string>
): string[] {
  const current = [...new Set(currentIds)];
  const currentSet = new Set(current);
  const removed = new Set(
    [...previouslySeenIds].filter((id) => !currentSet.has(id))
  );
  const next = [...new Set(order)].filter((id) => !removed.has(id));
  const ordered = new Set(next);
  for (const id of current) {
    if (ordered.has(id)) continue;
    ordered.add(id);
    next.push(id);
  }
  return next;
}

export function moveCreationResource(
  order: readonly string[],
  payload: CreationBookDragPayload
): string[] {
  if (
    payload.sourceId === payload.targetId ||
    !order.includes(payload.sourceId) ||
    !order.includes(payload.targetId)
  ) {
    return [...order];
  }
  const next = order.filter((id) => id !== payload.sourceId);
  const targetIndex = next.indexOf(payload.targetId);
  next.splice(
    targetIndex + (payload.position === "after" ? 1 : 0),
    0,
    payload.sourceId
  );
  return next;
}

export function applyCreationResourceOrder(
  sections: readonly ResourceTreeSection[],
  order: readonly string[]
): ResourceTreeSection[] {
  const positions = new Map(order.map((id, index) => [id, index] as const));
  return sections.map((section) => {
    if (section.id !== "creation") return section;
    return {
      ...section,
      nodes: section.nodes
        .map((node, index) => ({ node, index }))
        .sort(
          (left, right) =>
            (positions.get(left.node.id) ?? Number.MAX_SAFE_INTEGER) -
              (positions.get(right.node.id) ?? Number.MAX_SAFE_INTEGER) ||
            left.index - right.index
        )
        .map(({ node }) => node)
    };
  });
}
