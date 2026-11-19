import { compileClientRender } from "../../../test-utils/vueClientRender.mjs";
import { afterEach, expect, it, vi } from "vitest";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ssrContextKey
} from "vue";
import { bookBindingsTarget } from "../stores/bookBindingsDialog";
import BookBindingsDialog from "./BookBindingsDialog.vue";

const component = Object.assign({}, BookBindingsDialog, {
  render: compileClientRender(
    new URL("./BookBindingsDialog.vue", import.meta.url)
  )
});

const { saveTeam, toastError } = vi.hoisted(() => ({
  saveTeam: vi.fn(),
  toastError: vi.fn()
}));
vi.mock("../composables/useBookAgentTeamBinding", async () => {
  const { ref } = await import("vue");
  return {
    saveBookAgentTeamBinding: saveTeam,
    useBookAgentTeamCatalog: () => ({ catalog: ref(null), loaded: ref(true) })
  };
});
vi.mock("../ui-feedback", () => ({
  uiMessage: { error: toastError, success: vi.fn() }
}));
vi.mock("../stores/catalogIndexStore", () => ({
  useCatalogIndexStore: () => ({ snapshot: {} })
}));
vi.mock("./BookAgentTeamBindings.vue", () => ({
  default: defineComponent({ render: () => h("div") })
}));
vi.mock("./BookLibraryBindings.vue", async () => {
  const { defineComponent, h, ref } = await import("vue");
  return {
    default: defineComponent({
      props: { domain: { type: String, required: true } },
      emits: ["change"],
      setup(props, { emit }) {
        const selected = ref(false);
        return () =>
          h("button", {
            "data-picker": props.domain,
            "aria-pressed": selected.value,
            onClick() {
              selected.value = !selected.value;
              emit("change", {
                linkedSkillIds: selected.value ? ["skill-1"] : [],
                linkedMaterialIds: selected.value ? ["material-1"] : [],
                linkedSkillIdsByKind: {},
                linkedMaterialIdsByKind: {}
              });
            }
          });
      }
    })
  };
});
vi.mock("./AppIcon.vue", () => ({
  default: defineComponent({ render: () => h("svg") })
}));

class Node {
  parent: Node | null = null;
  children: Node[] = [];
  props: Record<string, unknown> = {};
  style = { display: "" };
  focus = vi.fn();
  constructor(readonly tag: string) {}
  querySelector() {
    return find(this, (node) => node.props["aria-selected"] === true);
  }
}

function find(parent: Node, match: (node: Node) => boolean): Node | undefined {
  for (const child of parent.children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
}

function remove(node: Node) {
  if (node.parent)
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = null;
}

const body = new Node("body");
const renderer = createRenderer<Node, Node>({
  patchProp: (node, key, _previous, value) => {
    node.props[key] = value;
  },
  insert(node, parent, anchor) {
    remove(node);
    node.parent = parent;
    parent.children.splice(
      anchor ? parent.children.indexOf(anchor) : parent.children.length,
      0,
      node
    );
  },
  remove,
  createElement: (tag) => new Node(tag),
  createText: () => new Node("#text"),
  createComment: () => new Node("#comment"),
  setText: () => {},
  setElementText: () => {},
  parentNode: (node) => node.parent,
  nextSibling: (node) =>
    node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  querySelector: () => body
});

function mount() {
  vi.stubGlobal("document", { activeElement: null });
  const saveLibrary = vi.fn().mockResolvedValue(true);
  bookBindingsTarget.value = {
    bookId: "book-1",
    title: "示例作品",
    workspaceType: "short",
    saveLibrary
  };
  const app = renderer.createApp({
    render() {
      const target = bookBindingsTarget.value;
      return target ? h(component, { target }) : null;
    }
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(new Node("root"));
  function element(key: string, value: unknown) {
    const node = find(body, (candidate) => candidate.props[key] === value);
    if (!node) throw new Error(`Missing ${key}=${value}`);
    return node;
  }
  return { app, saveLibrary, element };
}

function invoke(node: Node, name: string) {
  return (node.props[name] as (event: object) => Promise<void> | void)({
    preventDefault() {}
  });
}

afterEach(() => {
  bookBindingsTarget.value = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps selections when switching tabs and saves only the changed tab", async () => {
  const { app, saveLibrary, element } = mount();
  try {
    const skill = element("data-picker", "skill");
    const submit = element("type", "submit");
    expect(submit.props.disabled).toBe(true);
    invoke(skill, "onClick");
    await nextTick();
    invoke(element("id", "book-bindings-tab-material"), "onClick");
    await nextTick();
    expect(element("id", "book-bindings-panel-skill").style.display).toBe(
      "none"
    );
    invoke(element("id", "book-bindings-tab-skill"), "onClick");
    await nextTick();
    expect(skill.props["aria-pressed"]).toBe(true);
    expect(submit.props.disabled).toBe(false);

    await invoke(
      element("class", "dialog-content book-bindings-content"),
      "onSubmit"
    );
    expect(saveLibrary).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        domain: "skill",
        ids: ["skill-1"]
      })
    );
    expect(saveTeam).not.toHaveBeenCalled();
    expect(bookBindingsTarget.value).toBeNull();
  } finally {
    app.unmount();
  }
});

it("keeps a failed tab dirty and retries it without saving the successful tab again", async () => {
  const { app, saveLibrary, element } = mount();
  try {
    saveLibrary.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    invoke(element("data-picker", "skill"), "onClick");
    invoke(element("data-picker", "material"), "onClick");
    await nextTick();
    const form = element("class", "dialog-content book-bindings-content");
    await invoke(form, "onSubmit");
    await nextTick();
    expect(bookBindingsTarget.value).not.toBeNull();
    expect(toastError).toHaveBeenCalledOnce();
    expect(element("id", "book-bindings-tab-skill").props["aria-label"]).toBe(
      "技能库"
    );
    expect(
      element("id", "book-bindings-tab-material").props["aria-label"]
    ).toBe("素材库（未保存）");

    await invoke(form, "onSubmit");
    expect(saveLibrary.mock.calls.map(([change]) => change.domain)).toEqual([
      "skill",
      "material",
      "material"
    ]);
    expect(bookBindingsTarget.value).toBeNull();
  } finally {
    app.unmount();
  }
});
