import { compileClientRender } from "../../../test-utils/vueClientRender.mjs";
import { afterEach, expect, it, vi } from "vitest";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ssrContextKey
} from "vue";
import {
  bookBindingsTarget,
  type BookBindingsTarget
} from "../stores/bookBindingsDialog";
import BookBindingsDialog from "./BookBindingsDialog.vue";

const component = Object.assign({}, BookBindingsDialog, {
  render: compileClientRender(
    new URL("./BookBindingsDialog.vue", import.meta.url)
  )
});

const { saveTeam, toastError, teamCatalog, snapshot } = vi.hoisted(() => ({
  saveTeam: vi.fn(),
  toastError: vi.fn(),
  teamCatalog: { value: null as unknown },
  snapshot: { value: {} as unknown }
}));
vi.mock("../composables/useBookAgentTeamBinding", async () => {
  const { ref } = await import("vue");
  return {
    saveBookAgentTeamBinding: saveTeam,
    useBookAgentTeamCatalog: () => ({
      catalog: ref(teamCatalog.value),
      loaded: ref(true)
    })
  };
});
vi.mock("../ui-feedback", () => ({
  uiMessage: { error: toastError, success: vi.fn() }
}));
vi.mock("../stores/catalogIndexStore", () => ({
  useCatalogIndexStore: () => ({ snapshot: snapshot.value })
}));
vi.mock("./BookBindingsPicker.vue", async (importOriginal) => {
  const { default: picker } =
    await importOriginal<typeof import("./BookBindingsPicker.vue")>();
  return {
    default: Object.assign({}, picker, {
      render: compileClientRender(
        new URL("./BookBindingsPicker.vue", import.meta.url)
      )
    })
  };
});
vi.mock("./PopupSelect.vue", () => ({
  default: defineComponent({ render: () => h("button") })
}));
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
    return find(this, (node) => node.props["aria-current"] === true);
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

function mount(initial: Partial<BookBindingsTarget> = {}) {
  vi.stubGlobal("document", { activeElement: null });
  const saveLibrary = vi.fn().mockResolvedValue(true);
  bookBindingsTarget.value = {
    bookId: "book-1",
    title: "示例作品",
    workspaceType: "short",
    saveLibrary,
    ...initial
  };
  const app = renderer.createApp({
    render() {
      const target = bookBindingsTarget.value;
      return target ? h(component, { target }) : null;
    }
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(new Node("root"));
  function element(key: string, value: unknown, parent = body) {
    const node = find(parent, (candidate) => candidate.props[key] === value);
    if (!node) throw new Error(`Missing ${key}=${value}`);
    return node;
  }
  function checkbox(title: string) {
    const row = element("title", title).parent?.parent;
    if (!row) throw new Error(`Missing row for ${title}`);
    return element("type", "checkbox", row);
  }
  return { app, saveLibrary, element, checkbox };
}

function invoke(node: Node, name: string) {
  return (node.props[name] as (event: object) => Promise<void> | void)({
    preventDefault() {}
  });
}

afterEach(() => {
  bookBindingsTarget.value = null;
  teamCatalog.value = null;
  snapshot.value = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const skill = {
  id: "lib-1",
  title: "风格技能库",
  skillKind: "style",
  entries: []
};
const material = {
  id: "material-1",
  title: "人物素材库",
  materialKind: "character",
  parentGenre: "",
  subGenre: "",
  entries: []
};

it("keeps selections when switching sections and saves only the changed one", async () => {
  snapshot.value = { skills: [skill] };
  const { app, saveLibrary, element, checkbox } = mount();
  try {
    const submit = element("type", "submit");
    expect(submit.props.disabled).toBe(true);
    invoke(checkbox(skill.title), "onChange");
    await nextTick();
    invoke(element("id", "book-bindings-tab-material"), "onClick");
    await nextTick();
    expect(
      element("id", "book-bindings-tab-material").props["aria-current"]
    ).toBe(true);
    expect(element("id", "book-bindings-tab-skill").props["aria-label"]).toBe(
      "技能库（未保存）"
    );
    expect(submit.props.disabled).toBe(false);

    await invoke(element("class", "book-bindings-form"), "onSubmit");
    expect(saveLibrary).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ domain: "skill", ids: ["lib-1"] })
    );
    expect(saveTeam).not.toHaveBeenCalled();
    expect(bookBindingsTarget.value).toBeNull();
  } finally {
    app.unmount();
  }
});

it("lists every binding at once and unbinds from the overview", async () => {
  snapshot.value = {
    skills: [{ id: "s1", title: "风格技能", skillKind: "style", entries: [] }],
    materials: [
      {
        id: "m1",
        title: "人物素材",
        materialKind: "character",
        parentGenre: "",
        subGenre: "",
        entries: []
      }
    ]
  };
  teamCatalog.value = {
    teams: [{ id: "t1", name: "写作团队", workspaceType: "short" }],
    enabledTeamIds: {},
    bookBindings: { "book-1": ["t1"] }
  };
  const { app, saveLibrary, element } = mount({
    initialSkillIds: ["s1", "gone"],
    initialMaterialIds: ["m1"]
  });
  try {
    for (const name of ["风格技能", "gone", "人物素材", "写作团队"])
      element("aria-label", `解除绑定 ${name}`);
    invoke(element("aria-label", "解除绑定 gone"), "onClick");
    invoke(element("aria-label", "解除绑定 写作团队"), "onClick");
    await nextTick();
    await invoke(element("class", "book-bindings-form"), "onSubmit");
    expect(saveLibrary).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ domain: "skill", ids: ["s1"] })
    );
    expect(saveTeam).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bookId: "book-1", teamIds: [] })
    );
  } finally {
    app.unmount();
  }
});

it("lists groups, whole skill libraries and loose skills separately", async () => {
  snapshot.value = {
    skills: [
      skill,
      { ...skill, id: "lib-2", title: "剧情技能库", skillKind: "plot" },
      {
        ...skill,
        id: "loose",
        title: "未绑定收纳区",
        isUnbound: true,
        entries: [{ id: "entry-1", title: "独立校对技能" }]
      }
    ],
    skillGroups: [
      { id: "group-1", title: "写作预设", memberIds: ["lib-1", "lib-2"] }
    ]
  };
  const { app, saveLibrary, element, checkbox } = mount({
    initialSkillIds: ["lib-1"]
  });
  try {
    const groups = element("aria-label", "分组");
    const libraries = element("aria-label", "技能库", groups.parent ?? body);
    const individuals = element("aria-label", "单个技能");
    expect(
      groups.parent?.children.filter((child) => child.tag === "div")
    ).toEqual([groups, libraries, individuals]);
    element("title", "写作预设", groups);
    element("title", "剧情技能库", libraries);
    element("title", "独立校对技能", individuals);
    expect(
      find(individuals, (node) => node.props.type === "checkbox")
    ).toBeUndefined();
    expect(
      find(body, (node) => node.props.title === "未绑定收纳区")
    ).toBeUndefined();

    const group = checkbox("写作预设");
    expect(group.props.indeterminate).toBe(true);
    invoke(group, "onChange");
    await nextTick();
    expect(group.props.checked).toBe(true);
    expect(checkbox("剧情技能库").props.checked).toBe(true);
    await invoke(element("class", "book-bindings-form"), "onSubmit");
    expect(saveLibrary).toHaveBeenCalledExactlyOnceWith({
      domain: "skill",
      ids: ["lib-1", "lib-2"],
      linksByKind: { general: [], plot: ["lib-2"], style: ["lib-1"], other: [] }
    });
  } finally {
    app.unmount();
  }
});

it("keeps a failed section dirty and retries it without saving the successful one again", async () => {
  snapshot.value = { skills: [skill], materials: [material] };
  const { app, saveLibrary, element, checkbox } = mount();
  try {
    saveLibrary.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    invoke(checkbox(skill.title), "onChange");
    invoke(element("id", "book-bindings-tab-material"), "onClick");
    await nextTick();
    invoke(checkbox(material.title), "onChange");
    await nextTick();
    const form = element("class", "book-bindings-form");
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
