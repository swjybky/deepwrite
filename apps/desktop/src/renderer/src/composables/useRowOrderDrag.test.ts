import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRowOrderDrag } from "./useRowOrderDrag";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

class FakeClassList {
  private readonly items = new Set<string>();
  add(...tokens: string[]) {
    for (const token of tokens) this.items.add(token);
  }
  remove(...tokens: string[]) {
    for (const token of tokens) this.items.delete(token);
  }
  replaceAll(value: string) {
    this.items.clear();
    for (const token of value.split(/\s+/u)) {
      if (token) this.items.add(token);
    }
  }
  toString() {
    return [...this.items].join(" ");
  }
  contains(token: string) {
    return this.items.has(token);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  hidden = false;
  inert = false;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  isConnected = true;

  get className(): string {
    return this.classList.toString();
  }

  set className(value: string) {
    this.classList.replaceAll(value);
  }

  constructor(
    readonly tagName: string,
    private rect: Rect = {
      left: 0,
      top: 0,
      width: 180,
      height: 28,
      right: 180,
      bottom: 28
    }
  ) {}

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "class") {
      for (const token of value.split(/\s+/u)) {
        if (token) this.classList.add(token);
      }
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement = this;
      node.isConnected = this.isConnected;
      this.children.push(node);
    }
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    this.isConnected = false;
  }

  contains(other: FakeElement | null): boolean {
    let cur: FakeElement | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  matchesSingle(part: string): boolean {
    const trimmed = part.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return this.attributes.has(trimmed.slice(1, -1));
    }
    if (trimmed.startsWith(".")) {
      return this.classList.contains(trimmed.slice(1));
    }
    return this.tagName.toLowerCase() === trimmed.toLowerCase();
  }

  closest(selector: string): FakeElement | null {
    const parts = selector.split(",");
    if (parts.some((part) => this.matchesSingle(part))) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  getBoundingClientRect(): Rect {
    return this.rect;
  }

  cloneNode(): FakeElement {
    const clone = new FakeElement(this.tagName, { ...this.rect });
    for (const [k, v] of this.attributes) clone.setAttribute(k, v);
    return clone;
  }
}

function setupDomEnvironment() {
  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  documentElement.append(body);

  let hitTarget: FakeElement | null = null;
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const win = {
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        if (typeof listener === "function") listener(event as unknown as Event);
        else listener.handleEvent(event as unknown as Event);
      }
    },
    getSelection: () => ({ removeAllRanges: vi.fn() })
  };

  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    documentElement,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    elementFromPoint: () => hitTarget
  });
  vi.stubGlobal("getComputedStyle", () => ({
    font: "14px sans-serif",
    overflowY: "visible"
  }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  return {
    documentElement,
    body,
    win,
    setHitTarget(el: FakeElement | null) {
      hitTarget = el;
    }
  };
}

function pointerEvent(
  currentTarget: FakeElement,
  target: FakeElement,
  overrides: Record<string, unknown> = {}
) {
  return {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 40,
    clientY: 14,
    currentTarget,
    target,
    preventDefault: vi.fn(),
    ...overrides
  };
}

describe("useRowOrderDrag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("activates after 350ms long-press, suppresses click, and drops at before/after halves", () => {
    const dom = setupDomEnvironment();
    const list = new FakeElement("ol");
    const row1 = new FakeElement("li", {
      left: 0,
      top: 0,
      width: 200,
      height: 30,
      right: 200,
      bottom: 30
    });
    row1.setAttribute("data-row-id", "r1");
    const row2 = new FakeElement("li", {
      left: 0,
      top: 30,
      width: 200,
      height: 30,
      right: 200,
      bottom: 60
    });
    row2.setAttribute("data-row-id", "r2");
    list.append(row1, row2);
    dom.body.append(list);

    const drop = vi.fn();
    const scope = effectScope();
    const drag = scope.run(() =>
      useRowOrderDrag<string>("data-row-id", "button", (id) => ({
        findTarget: (targetId) => (targetId === id ? undefined : targetId),
        drop
      }))
    )!;

    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    vi.advanceTimersByTime(350);

    expect(row1.classList.contains("row-order-source")).toBe(true);
    expect(dom.documentElement.classList.contains("row-order-dragging")).toBe(
      true
    );
    const ghost = dom.body.children.find((c) =>
      c.classList.contains("row-order-ghost")
    );
    const marker = dom.body.children.find((c) =>
      c.classList.contains("row-order-marker")
    );
    expect(ghost).toBeDefined();
    expect(marker).toBeDefined();

    dom.setHitTarget(row2);
    // Bottom half of row2 (top=30, height=30 => mid=45; y=50 => after)
    dom.win.dispatch("pointermove", {
      pointerId: 1,
      clientX: 40,
      clientY: 50,
      preventDefault: vi.fn()
    });
    expect(marker!.hidden).toBe(false);
    expect(marker!.style.top).toBe("60px");

    dom.win.dispatch("pointerup", {
      pointerId: 1,
      clientX: 40,
      clientY: 50
    });

    expect(drop).toHaveBeenCalledWith("r2", "after");
    expect(row1.classList.contains("row-order-source")).toBe(false);
    expect(dom.documentElement.classList.contains("row-order-dragging")).toBe(
      false
    );

    const clickEvent = {
      detail: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    drag.click(clickEvent as unknown as MouseEvent);
    expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(clickEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("ignores quick release and pre-activation jitter, and respects ignored selectors", () => {
    const dom = setupDomEnvironment();
    const list = new FakeElement("ol");
    const row1 = new FakeElement("li");
    row1.setAttribute("data-row-id", "r1");
    const btn = new FakeElement("button");
    row1.append(btn);
    list.append(row1);
    dom.body.append(list);

    const drop = vi.fn();
    const scope = effectScope();
    const drag = scope.run(() =>
      useRowOrderDrag<string>("data-row-id", "button", () => ({
        findTarget: (id) => id,
        drop
      }))
    )!;

    // Ignored child element does not start
    drag.start(pointerEvent(list, btn) as unknown as PointerEvent);
    vi.advanceTimersByTime(400);
    expect(row1.classList.contains("row-order-source")).toBe(false);

    // Quick release before 350ms does not activate
    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    vi.advanceTimersByTime(150);
    dom.win.dispatch("pointerup", { pointerId: 1, clientX: 40, clientY: 14 });
    vi.advanceTimersByTime(250);
    expect(row1.classList.contains("row-order-source")).toBe(false);
    expect(drop).not.toHaveBeenCalled();

    // Pointer jitter > 7px cancels pending long-press timer
    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    dom.win.dispatch("pointermove", { pointerId: 1, clientX: 55, clientY: 14 });
    vi.advanceTimersByTime(400);
    expect(row1.classList.contains("row-order-source")).toBe(false);
  });

  it("enforces canDrop, Escape cancellation, contextmenu/dragstart blocking, and disconnect guard", () => {
    const dom = setupDomEnvironment();
    const list = new FakeElement("ol");
    const row1 = new FakeElement("li", {
      left: 0,
      top: 0,
      width: 200,
      height: 30,
      right: 200,
      bottom: 30
    });
    row1.setAttribute("data-row-id", "r1");
    const row2 = new FakeElement("li", {
      left: 0,
      top: 30,
      width: 200,
      height: 30,
      right: 200,
      bottom: 60
    });
    row2.setAttribute("data-row-id", "r2");
    list.append(row1, row2);
    dom.body.append(list);

    const drop = vi.fn();
    const scope = effectScope();
    const drag = scope.run(() =>
      useRowOrderDrag<string>("data-row-id", "button", () => ({
        findTarget: (id) => id,
        canDrop: () => false,
        drop
      }))
    )!;

    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    vi.advanceTimersByTime(350);

    const contextEvent = { preventDefault: vi.fn() };
    const nativeDragEvent = { preventDefault: vi.fn() };
    dom.win.dispatch("contextmenu", contextEvent);
    dom.win.dispatch("dragstart", nativeDragEvent);
    expect(contextEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(nativeDragEvent.preventDefault).toHaveBeenCalledTimes(1);

    dom.setHitTarget(row2);
    dom.win.dispatch("pointermove", {
      pointerId: 1,
      clientX: 40,
      clientY: 50,
      preventDefault: vi.fn()
    });
    const marker = dom.body.children.find((c) =>
      c.classList.contains("row-order-marker")
    );
    expect(marker!.hidden).toBe(true);

    dom.win.dispatch("pointerup", {
      pointerId: 1,
      clientX: 40,
      clientY: 50
    });
    expect(drop).not.toHaveBeenCalled();

    // Escape cancels active drag cleanly
    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    vi.advanceTimersByTime(350);
    const esc = { key: "Escape", preventDefault: vi.fn() };
    dom.win.dispatch("keydown", esc);
    expect(esc.preventDefault).toHaveBeenCalledTimes(1);
    expect(row1.classList.contains("row-order-source")).toBe(false);

    // Disconnected row cancels safely during drag
    drag.start(pointerEvent(list, row1) as unknown as PointerEvent);
    vi.advanceTimersByTime(350);
    row1.isConnected = false;
    dom.win.dispatch("pointerup", {
      pointerId: 1,
      clientX: 40,
      clientY: 50
    });
    expect(drop).not.toHaveBeenCalled();
  });
});
