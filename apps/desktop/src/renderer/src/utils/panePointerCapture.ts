/** Keep resize gestures from hovering controls in the adjacent panes. */
export function createPanePointerCapture(onLostCapture: () => void) {
  let capture: { target: Element; pointerId: number } | undefined;

  function release(): void {
    if (!capture) return;
    const { target, pointerId } = capture;
    capture = undefined;
    target.removeEventListener("lostpointercapture", onLostCapture);
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }

  function start(event: PointerEvent): void {
    release();
    const target = event.currentTarget as Element | null;
    if (!target?.setPointerCapture) return;
    target.setPointerCapture(event.pointerId);
    capture = { target, pointerId: event.pointerId };
    target.addEventListener("lostpointercapture", onLostCapture);
  }

  return { start, release };
}
