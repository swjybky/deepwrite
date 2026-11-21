// @vitest-environment deepwrite-renderer
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createPinia } from "pinia";
import { createRenderer, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RIGHT_PANE_MIN, useLayoutStore } from "../stores/layoutStore";
import LongWorkspaceModule from "./LongWorkspaceModule.vue";
import WorkspacePaneResizer from "./WorkspacePaneResizer.vue";

const editorRendered = vi.hoisted(() => vi.fn());
vi.mock("./LongWorkspaceEditor.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      setup() {
        return () => {
          editorRendered();
          return h("section", { class: "test-editor" });
        };
      }
    })
  };
});

interface Node {
  parent: Node | null;
  children: Node[];
  props: Record<string, unknown>;
  style: { display: string; setProperty: () => void };
}
function node(): Node {
  return {
    parent: null,
    children: [],
    props: {},
    style: { display: "", setProperty() {} }
  };
}
function detach(child: Node): void {
  const parent = child.parent;
  if (parent) parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
}

const renderer = createRenderer<Node, Node>({
  patchProp: (element, key, _previous, value) => {
    element.props[key] = value;
  },
  insert: (child, parent, anchor) => {
    detach(child);
    parent.children.splice(
      anchor ? parent.children.indexOf(anchor) : parent.children.length,
      0,
      child
    );
    child.parent = parent;
  },
  remove: detach,
  createElement: node,
  createText: node,
  createComment: node,
  setText: () => {},
  setElementText: () => {},
  parentNode: (element) => element.parent,
  nextSibling: (element) =>
    element.parent?.children[element.parent.children.indexOf(element) + 1] ??
    null
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const unmount of cleanup.splice(0)) unmount();
  vi.unstubAllGlobals();
  editorRendered.mockClear();
});

function mount(
  render: (layout: ReturnType<typeof useLayoutStore>) => ReturnType<typeof h>
) {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      innerWidth: 1400,
      localStorage: { getItem: () => null, setItem: vi.fn() },
      getComputedStyle: () => ({ getPropertyValue: () => "320px" })
    })
  );
  const pinia = createPinia();
  const layout = useLayoutStore(pinia);
  layout.desktopShell = {
    getBoundingClientRect: () => ({ width: 1400, right: 1400, left: 0 })
  } as HTMLElement;
  layout.rightCollapsed = false;
  const app = renderer.createApp({ setup: () => () => render(layout) });
  app.use(pinia);
  const root = node();
  app.mount(root);
  cleanup.push(() => {
    app.unmount();
    layout.$dispose();
  });
  return { root, layout };
}

function find(root: Node, key: string, value: string): Node | undefined {
  return root.props[key] === value
    ? root
    : root.children.map((child) => find(child, key, value)).find(Boolean);
}

describe("workspace pane resizer", () => {
  it("shows the store range and uses its keyboard and pointer resize behavior", async () => {
    const { root, layout } = mount(() => h(WorkspacePaneResizer));
    await nextTick();
    await nextTick();
    const separator = find(root, "role", "separator")!;
    expect(separator.props).toMatchObject({
      "aria-orientation": "vertical",
      "aria-valuemin": RIGHT_PANE_MIN,
      "aria-valuemax": 1400 - layout.leftPaneWidth - 320,
      "aria-valuenow": layout.rightPaneWidth,
      tabindex: "0"
    });
    const initial = layout.rightPaneWidth;
    const keyboard = { key: "ArrowLeft", preventDefault: vi.fn() };
    (separator.props.onKeydown as (e: typeof keyboard) => void)(keyboard);
    await nextTick();
    expect(keyboard.preventDefault).toHaveBeenCalledOnce();
    expect(separator.props["aria-valuenow"]).toBe(initial + 12);

    const pointer = { preventDefault: vi.fn() };
    (separator.props.onPointerdown as (e: typeof pointer) => void)(pointer);
    expect(layout.resizingPane).toBe("right");
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 840 })
    );
    await nextTick();
    expect(separator.props["aria-valuenow"]).toBe(560);
    window.dispatchEvent(new Event("pointerup"));
    expect(layout.resizingPane).toBeNull();

    layout.setPaneCollapsed("right", true);
    await nextTick();
    expect(find(root, "role", "separator")).toBeUndefined();
  });

  it("updates the shell and separator without rerendering the long workspace or its editor", async () => {
    const moduleUpdated = vi.fn();
    const props = {
      book: { id: "book-test" } as LongBookSummary,
      workspaceIndex: {} as LongWorkspaceIndexSnapshot,
      selection: null,
      conversationController: null,
      agentProfile: null,
      availableSkillReferences: [],
      availableMaterialReferences: [],
      proposalItems: [],
      refreshStatus: null,
      paneLayout: "agent-editor",
      runtimeAvailable: false,
      sendContextReady: false,
      sendPreflightPending: false,
      editorLocked: false,
      editorLockedReason: undefined,
      leftCollapsed: false,
      loading: false,
      defaultTextViewMode: "edit",
      autoSaveEnabled: false
    } satisfies Omit<
      InstanceType<typeof LongWorkspaceModule>["$props"],
      "rightCollapsed"
    >;
    const { root, layout } = mount((layout) =>
      h("div", { style: layout.shellStyle }, [
        h(LongWorkspaceModule, {
          ...props,
          rightCollapsed: layout.rightCollapsed,
          onVnodeUpdated: moduleUpdated
        })
      ])
    );
    await nextTick();
    await nextTick();
    const editor = find(root, "class", "test-editor")!;
    expect(editorRendered).toHaveBeenCalledOnce();
    layout.setPaneWidth("right", 510);
    await nextTick();
    layout.setPaneWidth("right", 600);
    await nextTick();
    expect(root.children[0]?.props.style).toMatchObject({
      "--right-pane-width": "600px"
    });
    expect(find(root, "role", "separator")?.props["aria-valuenow"]).toBe(600);
    expect(moduleUpdated).not.toHaveBeenCalled();
    expect(editorRendered).toHaveBeenCalledOnce();

    layout.setPaneCollapsed("right", true);
    await nextTick();
    expect(editor.parent?.style.display).toBe("none");
    layout.setPaneCollapsed("right", false);
    await nextTick();
    expect(find(root, "class", "test-editor")).toBe(editor);
    expect(editor.parent?.style.display).toBe("");
  });
});
