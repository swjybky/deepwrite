interface ViewportAnchor {
  id: string;
  top: number;
}

/** Holds a reading position while font/width reflow wakes deferred content. */
export function createConversationViewportAnchor(options: {
  container: () => HTMLElement | undefined;
  element: (id: string) => HTMLElement | undefined;
  followsTail: () => boolean;
  onSettled: () => void;
}) {
  let anchor: ViewportAnchor | undefined;
  let signature = "";
  let frame: number | undefined;
  let remainingFrames = 0;
  let attached: HTMLElement | undefined;

  function cancel(): void {
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    frame = undefined;
    remainingFrames = 0;
  }

  function layoutSignature(): string {
    const container = options.container();
    return container
      ? `${container.clientWidth}:${globalThis.getComputedStyle?.(container).fontSize ?? ""}`
      : "";
  }

  function restore(): void {
    const container = options.container();
    if (!container) return;
    if (options.followsTail()) {
      container.scrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight
      );
      return;
    }
    const element = anchor && options.element(anchor.id);
    if (!element || !anchor) return;
    const delta =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      anchor.top;
    if (Math.abs(delta) > 0.5) container.scrollTop += delta;
  }

  function settle(): void {
    if (frame !== undefined) return;
    frame = globalThis.requestAnimationFrame(() => {
      frame = undefined;
      restore();
      remainingFrames -= 1;
      if (remainingFrames > 0) settle();
      else options.onSettled();
    });
  }

  function capture(id: string, top: number): void {
    if (!remainingFrames) anchor = { id, top };
  }

  function resize(): void {
    const next = layoutSignature();
    if (signature && next !== signature) remainingFrames = 3;
    signature = next;
    if (remainingFrames) {
      restore();
      settle();
    }
  }

  function connect(): void {
    const container = options.container();
    if (attached !== container) {
      for (const type of ["wheel", "pointerdown", "keydown"]) {
        attached?.removeEventListener?.(type, cancel);
        container?.addEventListener?.(type, cancel, { passive: true });
      }
      attached = container;
      cancel();
    }
    signature = layoutSignature();
  }

  function dispose(): void {
    cancel();
    for (const type of ["wheel", "pointerdown", "keydown"])
      attached?.removeEventListener?.(type, cancel);
  }

  return { capture, resize, connect, cancel, dispose };
}
