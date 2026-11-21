import { createRenderer, computed, h, markRaw, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLongEditorPaneResize } from "./useLongEditorPaneResize";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

async function fixture(storedValue: string | null = null) {
  const entryActive = ref(false);
  const storyActive = ref(false);
  let width = 1000;
  const measure = vi.fn(() => ({ width, right: width }));
  const container = markRaw({
    getBoundingClientRect: measure
  }) as unknown as HTMLElement;
  const events = new EventTarget();
  const storage = { getItem: () => storedValue, setItem: vi.fn() };
  vi.stubGlobal("window", Object.assign(events, { localStorage: storage }));
  const classList = { add: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("document", { documentElement: { classList } });
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
      panes.storyPlotLayoutElement.value = container;
      return () => h("div");
    }
  });
  app.mount({});
  cleanups.push(() => app.unmount());
  await nextTick();
  return {
    panes,
    entryActive,
    storyActive,
    measure,
    storage,
    classList,
    setWidth: (next: number) => {
      width = next;
    }
  };
}

describe("long editor pane resize", () => {
  it("leaves grid sizing to CSS and refreshes the accessible range on focus", async () => {
    const f = await fixture();
    expect(f.measure).not.toHaveBeenCalled();
    f.entryActive.value = true;
    await nextTick();
    expect(f.panes.entryListRange.value).toEqual({ width: 380, max: 753 });
    expect(f.panes.entryListGridStyle.value).toBeUndefined();
    f.measure.mockClear();

    f.setWidth(600);
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(f.measure).not.toHaveBeenCalled();
    expect(f.panes.entryListRange.value.width).toBe(380);
    f.panes.refreshLongEditorPaneRange("entry-list");
    expect(f.panes.entryListRange.value).toEqual({ width: 228, max: 353 });
  });

  it("drags the entry list and keeps the preference across CSS clamping", async () => {
    const f = await fixture();
    f.entryActive.value = true;
    await nextTick();
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    f.panes.startLongEditorPaneResize(
      "entry-list",
      event as unknown as PointerEvent
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    f.measure.mockClear();
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 20 })
    );
    expect(f.measure).toHaveBeenCalledOnce();
    expect(f.panes.entryListRange.value).toEqual({ width: 753, max: 753 });
    expect(f.panes.entryListGridStyle.value).toEqual({
      "--long-entry-list-width": "753px"
    });
    expect(f.storage.setItem).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerup"));
    expect(f.panes.resizingLongEditorPane.value).toBeNull();
    expect(f.classList.remove).toHaveBeenCalledWith(
      "is-long-editor-pane-resizing"
    );
    expect(f.storage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ version: 1, entryListWidth: 753 })
    );
    f.setWidth(600);
    f.panes.refreshLongEditorPaneRange("entry-list");
    expect(f.panes.entryListRange.value).toEqual({ width: 353, max: 353 });
    expect(f.panes.entryListGridStyle.value).toEqual({
      "--long-entry-list-width": "753px"
    });
  });

  it("uses current geometry for keyboard changes in the nested story list", async () => {
    const f = await fixture(
      JSON.stringify({ version: 1, entryListWidth: 475 })
    );
    f.entryActive.value = true;
    f.storyActive.value = true;
    await nextTick();
    expect(f.panes.entryListRange.value).toEqual({ width: 475, max: 496 });
    expect(f.panes.storyPlotListRange.value).toEqual({ width: 380, max: 673 });
    f.setWidth(600);
    const event = { key: "ArrowLeft", preventDefault: vi.fn() };
    f.panes.handleLongEditorPaneResizeKeydown(
      "story-plot-list",
      event as unknown as KeyboardEvent
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.panes.storyPlotListRange.value).toEqual({ width: 240, max: 273 });
    expect(f.panes.storyPlotListGridStyle.value).toEqual({
      "--long-story-plot-list-width": "240px"
    });
    expect(f.storage.setItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({
        version: 1,
        entryListWidth: 475,
        storyPlotListWidth: 240
      })
    );
  });
});
