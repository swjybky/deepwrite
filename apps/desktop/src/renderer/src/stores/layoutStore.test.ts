import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { isReactive, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RIGHT_PANE_PREFERENCES_STORAGE_KEY } from "../utils/rightPanePreferences";
import {
  LEFT_PANE_MAX,
  RIGHT_PANE_MAX,
  defaultLeftPaneWidth,
  defaultRightPaneWidth,
  useLayoutStore
} from "./layoutStore";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface RuntimeFixture {
  storage: MemoryStorage;
  animationFrames: FrameRequestCallback[];
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installRuntime(viewportWidth = 1400): RuntimeFixture {
  const storage = new MemoryStorage();
  const animationFrames: FrameRequestCallback[] = [];
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", {
    innerWidth: viewportWidth,
    localStorage: storage,
    addEventListener,
    removeEventListener,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }),
    cancelAnimationFrame: vi.fn(),
    getComputedStyle: vi.fn(
      () =>
        ({
          getPropertyValue: (property: string) =>
            property === "--center-pane-min" ? "420" : ""
        }) as CSSStyleDeclaration
    )
  } satisfies Partial<Window>);
  return { storage, animationFrames, addEventListener, removeEventListener };
}

function shell(width: number, left = 100): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 800,
      width,
      height: 800,
      toJSON: () => ({})
    })
  } as HTMLElement;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layout store", () => {
  it("exposes typed view switching and pane toggles through Pinia refs", async () => {
    installRuntime();
    const store = useLayoutStore();
    const refs = storeToRefs(store);

    expect(refs.currentView.value).toBe("workspace");
    expect(refs.workspaceMainView.value).toBe("conversation");
    expect(refs.leftPaneWidth.value).toBe(defaultLeftPaneWidth(1400));
    expect(refs.rightPaneWidth.value).toBe(defaultRightPaneWidth(1400));

    store.showWorkspaceFeature("models");
    expect(refs.currentView.value).toBe("workspace");
    expect(refs.workspaceMainView.value).toBe("models");
    expect(refs.activePrimaryFeature.value).toBe("models");

    store.showSettings("official-models");
    expect(refs.currentView.value).toBe("settings");
    expect(refs.settingsInitialCategory.value).toBe("official-models");
    store.showWorkspace();
    expect(refs.currentView.value).toBe("workspace");

    store.togglePane("left");
    store.setPaneCollapsed("right", true);
    expect(refs.leftCollapsed.value).toBe(true);
    expect(refs.rightCollapsed.value).toBe(true);
    await nextTick();
    store.$dispose();
  });

  it("keeps DOM handles and preference snapshots shallow", () => {
    installRuntime();
    const refs = storeToRefs(useLayoutStore());

    refs.desktopShell.value = shell(1200);
    expect(isReactive(refs.desktopShell.value)).toBe(false);
    expect(isReactive(refs.rightPanePreferences.value)).toBe(false);
  });

  it("clamps panes against their own limits and the remaining center width", () => {
    installRuntime(1200);
    const store = useLayoutStore();
    store.desktopShell = shell(1200);

    store.setPaneCollapsed("right", true);
    store.setPaneWidth("left", 2_000);
    expect(store.leftPaneWidth).toBe(LEFT_PANE_MAX);

    store.setPaneCollapsed("right", false);
    store.setPaneCollapsed("left", true);
    store.setPaneWidth("right", 2_000);
    expect(store.rightPaneWidth).toBe(780);
    expect(store.rightPaneWidth).toBeLessThan(RIGHT_PANE_MAX);
  });

  it("tracks pointer resizing and removes global listeners on completion", () => {
    const runtime = installRuntime(1200);
    const store = useLayoutStore();
    store.desktopShell = shell(1000, 100);
    store.setPaneCollapsed("right", true);
    const preventDefault = vi.fn();

    store.startPaneResize("left", {
      preventDefault
    } as unknown as PointerEvent);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(store.resizingPane).toBe("left");
    expect(runtime.addEventListener).toHaveBeenCalledTimes(3);

    store.handleResizeMove({ clientX: 450 } as PointerEvent);
    expect(store.leftPaneWidth).toBe(350);
    store.stopPaneResize();

    expect(store.resizingPane).toBeNull();
    expect(
      runtime.removeEventListener.mock.calls.map(([type]) => type)
    ).toEqual(
      expect.arrayContaining(["pointermove", "pointerup", "pointercancel"])
    );
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "dispose"])(
    "captures the separator while dragging across chat controls and releases on %s",
    (completion) => {
      const runtime = installRuntime(1400);
      const store = useLayoutStore();
      store.desktopShell = shell(1400, 0);
      const target = new EventTarget();
      const setPointerCapture = vi.fn();
      const releasePointerCapture = vi.fn();
      Object.assign(target, {
        setPointerCapture,
        hasPointerCapture: () => true,
        releasePointerCapture
      });

      store.startPaneResize("right", {
        currentTarget: target,
        pointerId: 7,
        preventDefault: vi.fn()
      } as unknown as PointerEvent);
      expect(setPointerCapture).toHaveBeenCalledWith(7);
      store.handleResizeMove({ clientX: 800 } as PointerEvent);
      expect(store.rightPaneWidth).toBe(600);
      expect(releasePointerCapture).not.toHaveBeenCalled();

      if (completion === "dispose") store.$dispose();
      else if (completion === "lostpointercapture") {
        target.dispatchEvent(new Event(completion));
      } else {
        runtime.addEventListener.mock.calls.find(
          ([type]) => type === completion
        )?.[1]();
      }
      expect(store.resizingPane).toBeNull();
      expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
      store.stopPaneResize();
      expect(releasePointerCapture).toHaveBeenCalledOnce();
    }
  );

  it("persists keyboard-resized right-pane widths by workspace key", () => {
    const runtime = installRuntime(1400);
    const store = useLayoutStore();
    store.desktopShell = shell(1400);
    store.setActiveRightPanePreferenceKey("short:plot", false);
    const previousWidth = store.rightPaneWidth;
    const preventDefault = vi.fn();

    store.handleResizeKeydown("right", {
      key: "ArrowLeft",
      preventDefault
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    const expectedWidth = Math.round(previousWidth + 12);
    expect(store.rightPaneWidth).toBe(expectedWidth);
    expect(
      JSON.parse(
        runtime.storage.getItem(RIGHT_PANE_PREFERENCES_STORAGE_KEY) ?? "{}"
      )
    ).toEqual({
      version: 1,
      widths: { "short:plot": expectedWidth }
    });
  });

  it("suppresses transitions until a restored width has painted", async () => {
    const runtime = installRuntime(1400);
    runtime.storage.setItem(
      RIGHT_PANE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, widths: { "short:draft": 610 } })
    );
    const store = useLayoutStore();
    store.desktopShell = shell(1400);

    store.setActiveRightPanePreferenceKey("short:draft");
    expect(store.rightPaneWidth).toBe(610);
    expect(store.paneTransitionSuppressed).toBe(true);
    await nextTick();

    expect(runtime.animationFrames).toHaveLength(1);
    runtime.animationFrames.shift()?.(0);
    expect(store.paneTransitionSuppressed).toBe(true);
    expect(runtime.animationFrames).toHaveLength(1);
    runtime.animationFrames.shift()?.(16);
    expect(store.paneTransitionSuppressed).toBe(false);
  });
});
