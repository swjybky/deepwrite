import { getCurrentInstance, onBeforeUnmount } from "vue";
import "../styles/row-order-drag.css";

export type RowOrderDropPosition = "before" | "after";

export function useRowOrderDrag<T>(
  rowAttribute: string,
  ignore: string,
  prepare: (id: string) =>
    | {
        findTarget: (id: string) => T | undefined;
        canDrop?: (target: T, position: RowOrderDropPosition) => boolean;
        drop: (target: T, position: RowOrderDropPosition) => void;
      }
    | undefined
) {
  const selector = `[${rowAttribute}]`;
  let dispose: (() => void) | undefined;
  let suppressClick = false;

  function start(
    event: Pick<
      PointerEvent,
      | "button"
      | "isPrimary"
      | "pointerId"
      | "clientX"
      | "clientY"
      | "currentTarget"
      | "target"
    >,
    delayMs = 350
  ): void {
    if (event.button !== 0 || !event.isPrimary || dispose) return;
    if (!(event.target instanceof Element) || event.target.closest(ignore))
      return;
    const root = event.currentTarget as HTMLElement;
    const hitRow = event.target.closest<HTMLElement>(selector);
    if (!hitRow || !root.contains(hitRow)) return;
    const row = hitRow;
    const drag = prepare(row.getAttribute(rowAttribute)!);
    if (!drag) return;
    const { findTarget, canDrop, drop } = drag;

    const { pointerId, clientX: startX, clientY: startY } = event;
    let x = startX;
    let y = startY;
    let ghost: HTMLElement | undefined;
    let marker: HTMLElement | undefined;
    let position: RowOrderDropPosition = "before";
    let frame: number | undefined;
    let scrollArea: HTMLElement | null = null;

    function markTarget(): T | undefined {
      if (!row.isConnected) {
        cancel();
        return;
      }
      const hit = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>(selector);
      const target =
        hit && hit !== row && root.contains(hit)
          ? findTarget(hit.getAttribute(rowAttribute)!)
          : undefined;
      if (target === undefined || !hit || !marker) {
        if (marker) marker.hidden = true;
        return;
      }
      const bounds = hit.getBoundingClientRect();
      const next: RowOrderDropPosition =
        y < bounds.top + bounds.height / 2 ? "before" : "after";
      if (canDrop && !canDrop(target, next)) {
        marker.hidden = true;
        return;
      }
      position = next;
      const edge = position === "before" ? bounds.top : bounds.bottom;
      const visible = scrollArea?.getBoundingClientRect();
      marker.hidden = false;
      Object.assign(marker.style, {
        left: `${bounds.left}px`,
        top: `${visible ? Math.max(visible.top, Math.min(edge, visible.bottom)) : edge}px`,
        width: `${bounds.width}px`
      });
      return target;
    }

    function autoScroll(): void {
      if (!scrollArea) return;
      if (!row.isConnected) {
        cancel();
        return;
      }
      const bounds = scrollArea.getBoundingClientRect();
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        const previous = scrollArea.scrollTop;
        if (y < bounds.top + 32) scrollArea.scrollTop -= 8;
        else if (y > bounds.bottom - 32) scrollArea.scrollTop += 8;
        if (previous !== scrollArea.scrollTop) markTarget();
      }
      frame = requestAnimationFrame(autoScroll);
    }

    function moveGhost(): void {
      if (ghost) {
        ghost.style.transform = `translate3d(${x - startX}px, ${y - startY - 4}px, 0) scale(1.025)`;
      }
    }

    const timer = setTimeout(() => {
      if (!row.isConnected) {
        cancel();
        return;
      }
      const bounds = row.getBoundingClientRect();
      ghost = row.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute(rowAttribute);
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.classList.remove("is-selected");
      ghost.classList.add("row-order-ghost");
      Object.assign(ghost.style, {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        font: getComputedStyle(row).font,
        transformOrigin: `${startX - bounds.left}px ${startY - bounds.top}px`
      });
      moveGhost();
      marker = document.createElement("div");
      marker.className = "row-order-marker";
      marker.hidden = true;
      marker.setAttribute("aria-hidden", "true");
      document.body.append(ghost, marker);
      row.classList.add("row-order-source");
      document.documentElement.classList.add("row-order-dragging");
      window.getSelection()?.removeAllRanges();
      suppressClick = true;
      for (
        let parent = row.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          parent.scrollHeight > parent.clientHeight &&
          /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)
        ) {
          scrollArea = parent;
          frame = requestAnimationFrame(autoScroll);
          break;
        }
      }
    }, delayMs);

    function move(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      if (!row.isConnected) {
        cancel();
        return;
      }
      if (!ghost) {
        if (Math.hypot(next.clientX - startX, next.clientY - startY) > 7)
          cancel();
        return;
      }
      next.preventDefault();
      x = next.clientX;
      y = next.clientY;
      moveGhost();
      markTarget();
    }

    function end(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      if (!row.isConnected) {
        cancel();
        return;
      }
      x = next.clientX;
      y = next.clientY;
      const target = ghost && markTarget();
      cancel();
      if (target !== undefined) drop(target, position);
    }

    function key(next: KeyboardEvent): void {
      if (next.key !== "Escape") return;
      if (ghost) next.preventDefault();
      cancel();
    }

    function contextMenu(next: MouseEvent): void {
      if (ghost) next.preventDefault();
    }

    function dragStart(next: DragEvent): void {
      if (ghost) next.preventDefault();
    }

    function pointerCancel(next: PointerEvent): void {
      if (next.pointerId === pointerId) cancel();
    }

    function cancel(): void {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      marker?.remove();
      if (ghost) {
        ghost.remove();
        row.classList.remove("row-order-source");
        document.documentElement.classList.remove("row-order-dragging");
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", cancel, true);
      window.removeEventListener("contextmenu", contextMenu, true);
      window.removeEventListener("dragstart", dragStart, true);
      dispose = undefined;
    }

    dispose = cancel;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", cancel, true);
    window.addEventListener("contextmenu", contextMenu, true);
    window.addEventListener("dragstart", dragStart, true);
  }

  function click(event: MouseEvent): void {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }

  function stop(): void {
    dispose?.();
  }

  if (getCurrentInstance()) onBeforeUnmount(stop);
  return { start, click, stop };
}
