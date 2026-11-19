import { createRenderer, computed, h, markRaw, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLongEditorPaneResize } from "./useLongEditorPaneResize";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

async function fixture(active = false) {
  const entryActive = ref(active);
  const storyActive = ref(false);
  const observers: {
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
  }[] = [];
  const measure = vi.fn(() => ({ width: 1000, right: 1000 }));
  const container = markRaw({
    getBoundingClientRect: measure
  }) as unknown as HTMLElement;
  const events = new EventTarget();
  const storage = { getItem: () => null, setItem: vi.fn() };
  vi.stubGlobal(
    "window",
    Object.assign(events, {
      localStorage: storage
    })
  );
  vi.stubGlobal("document", {
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() } }
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push(this);
      }
    }
  );
  const renderer = createRenderer({
    patchProp: () => {},
    insert: () => {},
    remove: () => {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null
  });
  let panes!: ReturnType<typeof useLongEditorPaneResize>;
  const app = renderer.createApp({
    setup() {
      panes = useLongEditorPaneResize({
        currentUsesAnyRightEntryList: computed(() => entryActive.value),
        currentIsPlotPointStoryline: computed(() => storyActive.value)
      });
      panes.longEditorDocumentElement.value = container;
      return () => h("div");
    }
  });
  app.mount({});
  cleanups.push(() => app.unmount());
  const flush = async () => {
    await nextTick();
    await nextTick();
  };
  await flush();
  const notify = (width: number) => {
    const entry = {
      target: container,
      contentRect: { width },
      borderBoxSize: [{ inlineSize: width }]
    } as unknown as ResizeObserverEntry;
    for (const observer of observers)
      observer.callback([entry], observer as unknown as ResizeObserver);
  };
  return {
    panes,
    entryActive,
    storyActive,
    container,
    measure,
    observers,
    storage,
    flush,
    notify
  };
}

describe("long editor pane resize measurements", () => {
  it("does not measure or observe an inactive list while resizing a manuscript", async () => {
    const f = await fixture();
    expect(f.measure).not.toHaveBeenCalled();
    expect(f.observers.every((o) => !o.observe.mock.calls.length)).toBe(true);
    f.notify(800);
    await f.flush();
    expect(f.measure).not.toHaveBeenCalled();
    expect(f.panes.entryListWidth.value).toBeUndefined();
    expect(f.panes.entryListGridStyle.value).toBeUndefined();
  });

  it("uses observer sizes without reading layout and ignores callbacks after deactivation", async () => {
    const f = await fixture(true);
    expect(f.panes.entryListWidth.value).toBe(380);
    expect(f.observers[0]!.observe).toHaveBeenCalledWith(f.container);
    f.measure.mockClear();
    f.notify(800);
    await f.flush();
    expect(f.panes.entryListWidth.value).toBe(304);
    expect(f.measure).not.toHaveBeenCalled();
    f.entryActive.value = false;
    await f.flush();
    f.measure.mockClear();
    f.notify(600);
    await f.flush();
    expect(f.measure).not.toHaveBeenCalled();
    expect(f.panes.entryListGridStyle.value).toBeUndefined();
    f.entryActive.value = true;
    await f.flush();
    expect(f.panes.entryListWidth.value).toBe(380);
  });

  it("measures a drag once per move and restores its preferred width after a container shrink", async () => {
    const f = await fixture(true);
    f.panes.startLongEditorPaneResize("entry-list", {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as PointerEvent);
    f.measure.mockClear();
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 20 })
    );
    expect(f.measure).toHaveBeenCalledOnce();
    expect(f.panes.entryListWidth.value).toBe(753);
    f.notify(800);
    expect(f.panes.entryListWidth.value).toBe(753);
    f.panes.stopLongEditorPaneResize();
    expect(f.storage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ version: 1, entryListWidth: 753 })
    );
    f.notify(600);
    expect(f.panes.entryListWidth.value).toBe(353);
    f.notify(1000);
    expect(f.panes.entryListWidth.value).toBe(753);
  });

  it("reconciles the outer list when the nested story layout needs more content width", async () => {
    const f = await fixture(true);
    expect(f.panes.entryListMaxWidth.value).toBe(753);
    f.storyActive.value = true;
    await f.flush();
    expect(f.panes.entryListMaxWidth.value).toBe(496);
    f.storyActive.value = false;
    await f.flush();
    expect(f.panes.entryListMaxWidth.value).toBe(753);
  });
});
