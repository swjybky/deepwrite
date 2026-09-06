import { ref } from "vue";
import type {
  CreationBookDragPayload,
  ResourceDomain,
  ResourceTreeNode
} from "../types/workspace";

const CREATION_BOOK_DRAG_TYPE = "application/x-deepwrite-creation-book";

export function canDragCreationBook(
  domain: ResourceDomain,
  node: ResourceTreeNode
): boolean {
  return (
    domain === "creation" &&
    (node.catalogNodeType === "book" || node.catalogNodeType === "long-book") &&
    !node.unavailable &&
    !node.missing
  );
}

export function creationBookDropPosition(
  clientY: number,
  bounds: Pick<DOMRect, "top" | "height">
): CreationBookDragPayload["position"] {
  return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function eventRow(
  event: DragEvent,
  node: ResourceTreeNode
): HTMLElement | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const row = event.target.closest<HTMLElement>(".tree-row");
  return row?.dataset.resourceId === node.id ? row : undefined;
}

export function useCreationBookDrag(
  domain: () => ResourceDomain,
  emitMove: (payload: CreationBookDragPayload) => void
) {
  const sourceId = ref<string | null>(null);
  const dropTarget = ref<{
    id: string;
    position: CreationBookDragPayload["position"];
  } | null>(null);

  function canDrag(node: ResourceTreeNode): boolean {
    return canDragCreationBook(domain(), node);
  }

  function readSource(event: DragEvent): string | undefined {
    if (sourceId.value) return sourceId.value;
    const id = event.dataTransfer?.getData(CREATION_BOOK_DRAG_TYPE).trim();
    return id || undefined;
  }

  function start(event: DragEvent, node: ResourceTreeNode): void {
    if (!canDrag(node) || !eventRow(event, node)) {
      return;
    }
    sourceId.value = node.id;
    event.dataTransfer?.setData(CREATION_BOOK_DRAG_TYPE, node.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function over(event: DragEvent, node: ResourceTreeNode): void {
    if (domain() !== "creation" || !readSource(event)) return;
    const row = eventRow(event, node);
    if (!row) return;
    event.preventDefault();
    dropTarget.value = {
      id: node.id,
      position: creationBookDropPosition(
        event.clientY,
        row.getBoundingClientRect()
      )
    };
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function leave(event: DragEvent, node: ResourceTreeNode): void {
    if (dropTarget.value?.id !== node.id) return;
    if (
      event.currentTarget instanceof HTMLElement &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    dropTarget.value = null;
  }

  function drop(event: DragEvent, node: ResourceTreeNode): void {
    const source = readSource(event);
    const row = eventRow(event, node);
    const position = row
      ? creationBookDropPosition(event.clientY, row.getBoundingClientRect())
      : dropTarget.value?.position;
    dropTarget.value = null;
    sourceId.value = null;
    if (!source || !row || !position) return;
    event.preventDefault();
    if (source === node.id) return;
    emitMove({ sourceId: source, targetId: node.id, position });
  }

  function end(): void {
    sourceId.value = null;
    dropTarget.value = null;
  }

  function dropClass(node: ResourceTreeNode): Record<string, boolean> {
    return {
      "is-creation-book-draggable": canDrag(node),
      "is-creation-book-drop-before":
        dropTarget.value?.id === node.id &&
        dropTarget.value.position === "before",
      "is-creation-book-drop-after":
        dropTarget.value?.id === node.id &&
        dropTarget.value.position === "after"
    };
  }

  return { canDrag, dropClass, start, over, leave, drop, end };
}
