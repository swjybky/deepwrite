import { onBeforeUnmount } from "vue";
import type {
  ResourceTreeSection,
  ResourceTreeNode,
  CatalogResourceNodeActionPayload
} from "../types/workspace";

/** Pointer gestures are scoped to a section; ordinary clicks keep their native behavior. */
export function useLibraryOrderDrag(
  section: () => ResourceTreeSection,
  emit: (payload: CatalogResourceNodeActionPayload) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source:
    { node: ResourceTreeNode; siblings: ResourceTreeNode[] } | undefined;
  let target:
    { node: ResourceTreeNode; position: "before" | "after" } | undefined;
  let active = false;
  let origin = { x: 0, y: 0 };
  let marked: HTMLElement | null = null;
  let sourceRow: HTMLElement | undefined;
  let ghost: HTMLElement | undefined;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function clearMark() {
    marked?.classList.remove("library-order-before", "library-order-after");
    marked = null;
  }
  function cancel() {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      suppressClick = false;
    }, 0);
    clearTimeout(timer);
    clearMark();
    ghost?.remove();
    ghost = undefined;
    sourceRow?.classList.remove("library-order-source");
    sourceRow = undefined;
    document.documentElement.classList.remove("library-order-dragging");
    active = false;
    source = undefined;
    target = undefined;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key);
    window.removeEventListener("wheel", cancel, true);
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") cancel();
  }
  function find(id: string, nodes = section().nodes): typeof source {
    const node = nodes.find((item) => item.id === id);
    if (node) return { node, siblings: nodes };
    for (const parent of nodes) {
      if (parent.catalogNodeType !== "group") continue;
      const found = find(id, parent.children ?? []);
      if (found) return found;
    }
  }
  function start(event: PointerEvent) {
    if (event.button !== 0 || section().id === "creation") return;
    const element = event.target instanceof Element ? event.target : null;
    const row = element?.closest<HTMLElement>(".tree-row[data-resource-id]");
    if (!row || element?.closest(".tree-chevron")) return;
    const found = find(row.dataset.resourceId ?? "");
    if (
      !found ||
      found.node.unavailable ||
      !["library", "group"].includes(found.node.catalogNodeType ?? "")
    )
      return;
    cancel();
    source = found;
    sourceRow = row;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      if (!row.isConnected) {
        cancel();
        return;
      }
      const bounds = row.getBoundingClientRect();
      ghost = row.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute("data-resource-id");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.classList.remove("is-selected");
      ghost.classList.add("library-order-ghost");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        font: getComputedStyle(row).font,
        transformOrigin: `${origin.x - bounds.left}px ${origin.y - bounds.top}px`,
        transform: "translate3d(0, -4px, 0) scale(1.025)"
      });
      document.body.append(ghost);
      row.classList.add("library-order-source");
      document.documentElement.classList.add("library-order-dragging");
      window.getSelection()?.removeAllRanges();
      active = true;
      suppressClick = true;
    }, 350);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", cancel, true);
  }
  function move(event: PointerEvent) {
    if (!source) return;
    if (!active) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 7)
        cancel();
      return;
    }
    event.preventDefault();
    if (ghost)
      ghost.style.transform = `translate3d(${event.clientX - origin.x}px, ${event.clientY - origin.y - 4}px, 0) scale(1.025)`;
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(".tree-row[data-resource-id]");
    const node = source.siblings.find(
      (item) => item.id === row?.dataset.resourceId
    );
    clearMark();
    target = undefined;
    if (!row || !node || node.id === source.node.id || node.unavailable) return;
    const box = row.getBoundingClientRect();
    const position =
      event.clientY < box.top + box.height / 2 ? "before" : "after";
    target = { node, position };
    marked = row;
    row.classList.add(`library-order-${position}`);
    let parent = row.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight)
      parent = parent.parentElement;
    if (parent) {
      const bounds = parent.getBoundingClientRect();
      if (event.clientY < bounds.top + 32) parent.scrollTop -= 12;
      if (event.clientY > bounds.bottom - 32) parent.scrollTop += 12;
    }
  }
  function end() {
    if (active && source && target && section().id !== "creation")
      emit({
        domain: section().id as "material" | "skill",
        action: "reorder-library",
        node: source.node,
        anchorId:
          target.node.catalogNodeType === "group"
            ? target.node.groupId!
            : target.node.libraryId!,
        position: target.position
      });
    cancel();
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  function click(event: MouseEvent) {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }
  onBeforeUnmount(() => {
    cancel();
    clearTimeout(clickTimer);
  });
  return { start, click };
}
