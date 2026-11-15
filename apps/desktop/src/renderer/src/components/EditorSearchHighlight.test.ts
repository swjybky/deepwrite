import {
  createRenderer,
  getCurrentInstance,
  h,
  nextTick,
  reactive,
  ssrContextKey,
  type Component
} from "vue";
import { afterEach, expect, it, vi } from "vitest";
import EditorSearchHighlight from "./EditorSearchHighlight.vue";

afterEach(() => vi.unstubAllGlobals());

it("only measures the editor while search has visible matches", async () => {
  const editor = new EventTarget();
  const measure = vi.fn(() => 500);
  Object.defineProperty(editor, "scrollHeight", { get: measure });
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize = () => {};
  vi.stubGlobal("getComputedStyle", () => ({}));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
  );
  const renderer = createRenderer({
    patchProp: () => {},
    insert: () => {},
    remove: () => {},
    createElement: () => ({ querySelector: () => editor }),
    createText: () => ({}),
    createComment: () => ({}),
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null
  });
  const props = reactive({
    content: "正文".repeat(50_000),
    matches: [] as { start: number; end: number }[],
    activeIndex: 0,
    visible: false
  });
  const component = {
    ...EditorSearchHighlight,
    render() {
      const instance = getCurrentInstance() as unknown as {
        setupState: { rootElement: unknown };
      };
      return h("div", {
        ref: (element: unknown) => {
          instance.setupState.rootElement = element;
        }
      });
    }
  } as Component;
  const app = renderer.createApp({ render: () => h(component, props) });
  app.provide(ssrContextKey, { modules: new Set() });
  const flush = async () => {
    await nextTick();
    await nextTick();
  };
  try {
    app.mount({ querySelector: () => editor });
    await flush();
    expect(measure).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    props.visible = true;
    await flush();
    expect(measure).not.toHaveBeenCalled();
    props.matches = [{ start: 0, end: 2 }];
    await flush();
    expect(observe).toHaveBeenCalledWith(editor);
    expect(measure).toHaveBeenCalled();
    measure.mockClear();
    resize();
    expect(measure).toHaveBeenCalledOnce();
    props.visible = false;
    await flush();
    expect(disconnect).toHaveBeenCalled();
    measure.mockClear();
    resize();
    editor.dispatchEvent(new Event("scroll"));
    props.content += "新增正文";
    await flush();
    expect(measure).not.toHaveBeenCalled();
    props.visible = true;
    await flush();
    expect(measure).toHaveBeenCalled();
    props.matches = [];
    await flush();
    measure.mockClear();
    resize();
    editor.dispatchEvent(new Event("scroll"));
    expect(measure).not.toHaveBeenCalled();
  } finally {
    app.unmount();
  }
});
