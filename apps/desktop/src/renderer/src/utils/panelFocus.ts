/** Checks whether a DOM event target belongs to a panel trigger, body, or recursively nested teleported controls. */
export function isTargetInPanel(
  target: Node,
  trigger: HTMLElement | null,
  panel: HTMLElement | null
): boolean {
  if (trigger?.contains(target) || panel?.contains(target)) return true;
  if (!panel) return false;

  const visited = new Set<Element>();
  const queue: Element[] = [panel];

  while (queue.length > 0) {
    const container = queue.shift();
    if (!container || visited.has(container)) continue;
    visited.add(container);

    for (const control of container.querySelectorAll("[aria-controls]")) {
      const id = control.getAttribute("aria-controls");
      if (!id) continue;
      const controlled = document.getElementById(id);
      if (!controlled) continue;
      if (controlled.contains(target)) return true;
      if (!visited.has(controlled)) queue.push(controlled);
    }
  }

  return false;
}
