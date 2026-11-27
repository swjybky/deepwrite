import { compileClientRender } from "../../../test-utils/vueClientRender.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey,
  type Ref
} from "vue";
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import { OFFICIAL_MODEL_REFRESH_CONTEXT_KEY } from "../composables/officialModelRefreshContext";
import { resetFavoriteModelsForTest } from "../utils/favoriteModels";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import ConversationModelConfigSelect from "./ConversationModelConfigSelect.vue";

vi.mock("./AppIcon.vue", () => ({
  default: defineComponent({
    props: { name: String, size: Number },
    render() {
      return h("svg", { "data-app-icon": this.name });
    }
  })
}));

vi.mock("./ModelProviderIcon.vue", () => ({
  default: defineComponent({
    props: {
      groupKey: String,
      provider: String,
      modelId: String,
      label: String,
      size: Number
    },
    render() {
      return h("svg", {
        "data-provider-icon": this.provider ?? this.groupKey ?? "generic"
      });
    }
  })
}));

vi.mock("./ModelPickerPanel.vue", async (importOriginal) => {
  const { default: panel } =
    await importOriginal<typeof import("./ModelPickerPanel.vue")>();
  return {
    default: Object.assign({}, panel, {
      render: compileClientRender(
        new URL("./ModelPickerPanel.vue", import.meta.url)
      )
    })
  };
});

const CompiledSelect = Object.assign({}, ConversationModelConfigSelect, {
  render: compileClientRender(
    new URL("./ConversationModelConfigSelect.vue", import.meta.url)
  )
});

class TestNode {
  parent: TestNode | null = null;
  children: TestNode[] = [];
  props: Record<string, unknown> = {};
  style: Record<string, string> = {};
  classList = {
    add: () => {},
    remove: () => {}
  };
  textContent = "";
  scrollTop = 0;
  scrollHeight = 400;
  clientHeight = 200;
  focus = vi.fn(() => {
    setActiveTestNode(this);
  });

  constructor(readonly tag: string) {}

  get ownerDocument() {
    return document;
  }

  getAttribute(name: string): string | null {
    const val = this.props[name];
    return val === undefined || val === null ? null : String(val);
  }

  addEventListener() {}
  removeEventListener() {}

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.children.some((child) => child.contains(other));
  }

  getBoundingClientRect() {
    return {
      top: 400,
      bottom: 430,
      left: 100,
      right: 260,
      width: 160,
      height: 30
    };
  }

  querySelector(selector: string): TestNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestNode[] {
    const matches: TestNode[] = [];
    const visit = (node: TestNode) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  closest(selector: string): TestNode | null {
    if (matchesSelector(this, selector)) return this;
    let cursor: TestNode | null = this.parent;
    while (cursor) {
      if (matchesSelector(cursor, selector)) return cursor;
      cursor = cursor.parent;
    }
    return null;
  }

  dispatchEvent(event: Event) {
    if (
      event.type === "keydown" &&
      typeof this.props.onKeydown === "function"
    ) {
      (this.props.onKeydown as (event: Event) => void)(event);
    }
    return true;
  }
}

let currentActiveElement: TestNode | null = null;

function setActiveTestNode(node: TestNode): void {
  currentActiveElement = node;
}

function hasClass(node: TestNode, name: string): boolean {
  return String(node.props.class ?? "")
    .split(/\s+/)
    .includes(name);
}

function matchesSelector(node: TestNode, selector: string): boolean {
  if (selector === "[aria-controls]") {
    return node.props["aria-controls"] !== undefined;
  }
  if (selector === '[aria-expanded="true"]') {
    return node.props["aria-expanded"] === true;
  }
  if (selector.startsWith(".")) {
    return hasClass(node, selector.slice(1));
  }
  return false;
}

function collectText(node: TestNode): string {
  return `${node.textContent}${node.children.map(collectText).join("")}`;
}

function findAll(
  root: TestNode,
  predicate: (node: TestNode) => boolean
): TestNode[] {
  const result: TestNode[] = [];
  const visit = (node: TestNode) => {
    for (const child of node.children) {
      if (predicate(child)) result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

function detach(node: TestNode | null | undefined) {
  if (!node) return;
  if (node.parent) {
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
  }
  node.parent = null;
}

function createBodyAndGlobals() {
  const body = Object.assign(new TestNode("body"), { offsetHeight: 0 });
  const docTarget = new EventTarget();
  const winTarget = new EventTarget();
  const storageMap = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, value);
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    }
  } as unknown as Storage;

  const getComputedStyleStub = () => ({
    transitionDelay: "0s",
    transitionDuration: "0s",
    animationDelay: "0s",
    animationDuration: "0s"
  });
  vi.stubGlobal("Node", TestNode);
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("getComputedStyle", getComputedStyleStub);
  vi.stubGlobal("document", {
    body,
    get activeElement() {
      return currentActiveElement;
    },
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget),
    dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
    getElementById(id: string) {
      return findAll(body, (node) => node.props.id === id)[0] ?? null;
    }
  });
  vi.stubGlobal(
    "window",
    Object.assign(winTarget, {
      innerWidth: 1280,
      innerHeight: 800,
      localStorage: storage,
      getComputedStyle: getComputedStyleStub
    })
  );

  const renderer = createRenderer<TestNode, TestNode>({
    patchProp: (node, key, _prev, value) => {
      node.props[key] = value;
    },
    insert(node, parent, anchor) {
      detach(node);
      node.parent = parent;
      parent.children.splice(
        anchor ? parent.children.indexOf(anchor) : parent.children.length,
        0,
        node
      );
    },
    remove: detach,
    createElement: (tag) => new TestNode(tag),
    createText: (text) => {
      const n = new TestNode("#text");
      n.textContent = text;
      return n;
    },
    createComment: () => new TestNode("#comment"),
    setText: (node, text) => {
      node.textContent = text;
    },
    setElementText: (node, text) => {
      node.textContent = text;
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    querySelector: () => body
  });

  return { body, docTarget, renderer };
}

const sampleModels: ModelSelectOption[] = [
  {
    value: "official-claude",
    label: "Claude Opus 5.5",
    provider: "deepwrite-site",
    modelId: "claude-opus-5-5",
    group: { key: "official", label: "官方小站" }
  },
  {
    value: "openai-gpt",
    label: "GPT-6.1 Sol",
    provider: "openai",
    modelId: "gpt-6.1-sol",
    group: { key: "custom:openai", label: "OpenAI" }
  },
  {
    value: "deepseek-chat",
    label: "DeepSeek V4",
    provider: "deepseek",
    modelId: "deepseek-v4",
    group: { key: "custom:deepseek", label: "DeepSeek" }
  }
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  currentActiveElement = null;
  resetFavoriteModelsForTest();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mountSelect(
  overrides: {
    selectedModelId?: string;
    modelOptions?: Ref<ModelSelectOption[]> | ModelSelectOption[];
    thinkingLevel?: ThinkingLevel;
    thinkingOptions?: Array<{ value: ThinkingLevel; label: string }>;
    showsTemperature?: boolean;
    temperature?: number;
    temperatureOptions?: Array<{ value: number; label: string }>;
    hidesWebSearch?: boolean;
    webSearchEnabled?: boolean;
    webSearchAvailable?: boolean;
    withFooter?: boolean;
    officialRefresh?: {
      refreshing: Ref<boolean>;
      announcements?: Ref<readonly string[]>;
      refresh: () => Promise<void>;
    };
  } = {}
) {
  const { body, docTarget, renderer } = createBodyAndGlobals();
  const selectedModelId = ref(overrides.selectedModelId ?? "openai-gpt");
  const modelOptions = ref<ModelSelectOption[]>(
    Array.isArray(overrides.modelOptions)
      ? overrides.modelOptions
      : (overrides.modelOptions?.value ?? sampleModels)
  );
  const resolvedModelOptions =
    overrides.modelOptions && !Array.isArray(overrides.modelOptions)
      ? overrides.modelOptions
      : modelOptions;
  const thinkingLevel = ref<ThinkingLevel>(overrides.thinkingLevel ?? "medium");
  const showsTemperature = ref(overrides.showsTemperature ?? false);
  const temperature = ref(overrides.temperature ?? 0.7);
  const webSearchEnabled = ref(overrides.webSearchEnabled ?? false);
  const onSelectModel = vi.fn((id: string) => {
    selectedModelId.value = id;
  });
  const onSelectThinking = vi.fn((level: ThinkingLevel) => {
    thinkingLevel.value = level;
  });
  const onSelectTemperature = vi.fn((val: number) => {
    temperature.value = val;
  });
  const onToggleWebSearch = vi.fn((val: boolean) => {
    webSearchEnabled.value = val;
  });

  const root = new TestNode("root");
  const app = renderer.createApp({
    render() {
      return h(
        CompiledSelect,
        {
          selectedModelId: selectedModelId.value,
          modelOptions: resolvedModelOptions.value,
          thinkingLevel: thinkingLevel.value,
          thinkingOptions: overrides.thinkingOptions ?? [
            { value: "off", label: "关闭" },
            { value: "medium", label: "标准" },
            { value: "high", label: "深度" }
          ],
          showsTemperature: showsTemperature.value,
          temperature: temperature.value,
          temperatureOptions: overrides.temperatureOptions ?? [
            { value: 0.1, label: "0.1" },
            { value: 0.7, label: "0.7" },
            { value: 1, label: "1" }
          ],
          hidesWebSearch: overrides.hidesWebSearch ?? false,
          webSearchEnabled: webSearchEnabled.value,
          webSearchAvailable: overrides.webSearchAvailable ?? true,
          onSelectModel,
          onSelectThinking,
          onSelectTemperature,
          onToggleWebSearch
        },
        overrides.withFooter
          ? {
              footer: () =>
                h("button", {
                  type: "button",
                  "aria-controls": "nested-popup-menu",
                  "aria-label": "选择正文修改权限"
                })
            }
          : undefined
      );
    }
  });
  app.provide(ssrContextKey, { modules: new Set() });
  if (overrides.officialRefresh) {
    const refreshContext = overrides.officialRefresh;
    app.provide(OFFICIAL_MODEL_REFRESH_CONTEXT_KEY, {
      refreshing: computed(() => refreshContext.refreshing.value),
      ...(refreshContext.announcements
        ? { announcements: computed(() => refreshContext.announcements!.value) }
        : {}),
      refresh: refreshContext.refresh
    });
  }
  app.mount(root);
  cleanups.push(() => app.unmount());

  return {
    root,
    body,
    docTarget,
    selectedModelId,
    modelOptions: resolvedModelOptions,
    thinkingLevel,
    showsTemperature,
    temperature,
    webSearchEnabled,
    onSelectModel,
    onSelectThinking,
    onSelectTemperature,
    onToggleWebSearch
  };
}

describe("ConversationModelConfigSelect", () => {
  it("opens on the active model's provider rail, searches across groups, favorites, and sets parameters directly", async () => {
    const ctx = mountSelect({ selectedModelId: "openai-gpt" });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(menu).toBeDefined();

    // Defaults to OpenAI category (selected model's group), with visible provider text labels in rail.
    const railTabs = findAll(menu, (node) => node.props.role === "tab");
    expect(railTabs.map((node) => collectText(node).trim())).toEqual([
      "收藏",
      "全部模型",
      "官方小站",
      "OpenAI",
      "DeepSeek"
    ]);
    expect(railTabs.map((node) => node.props["aria-label"])).toEqual([
      "收藏",
      "全部模型",
      "官方小站",
      "OpenAI",
      "DeepSeek"
    ]);
    const activeTab = railTabs.find(
      (node) => node.props["aria-selected"] === true
    )!;
    expect(activeTab.props["aria-label"]).toBe("OpenAI");

    let modelRows = findAll(menu, (node) =>
      hasClass(node, "model-picker-option")
    );
    expect(modelRows.map((n) => n.props["data-model-value"])).toEqual([
      "openai-gpt"
    ]);

    // Switch to all models.
    const allTab = findAll(
      menu,
      (node) =>
        node.props.role === "tab" && node.props["aria-label"] === "全部模型"
    )[0]!;
    (allTab.props.onClick as () => void)();
    await nextTick();
    modelRows = findAll(menu, (node) => hasClass(node, "model-picker-option"));
    expect(modelRows).toHaveLength(3);

    // Favorite DeepSeek and switch to Favorites tab.
    const starBtn = findAll(
      menu,
      (node) => node.props["aria-label"] === "收藏模型"
    )[2]!;
    (starBtn.props.onClick as (e: object) => void)({ stopPropagation() {} });
    await nextTick();

    const favTab = findAll(
      menu,
      (node) => node.props.role === "tab" && node.props["aria-label"] === "收藏"
    )[0]!;
    (favTab.props.onClick as () => void)();
    await nextTick();
    modelRows = findAll(menu, (node) => hasClass(node, "model-picker-option"));
    expect(modelRows.map((n) => n.props["data-model-value"])).toEqual([
      "deepseek-chat"
    ]);

    // Search across all models while on Favorites tab.
    const searchInput = findAll(
      menu,
      (node) => node.props.type === "search"
    )[0]!;
    (searchInput.props.onInput as (e: object) => void)({
      target: { value: "claude" }
    });
    await nextTick();
    modelRows = findAll(menu, (node) => hasClass(node, "model-picker-option"));
    expect(modelRows.map((n) => n.props["data-model-value"])).toEqual([
      "official-claude"
    ]);

    // Select model, direct thinking option, and web search.
    (modelRows[0]!.props.onClick as () => void)();
    await nextTick();
    expect(ctx.onSelectModel).toHaveBeenCalledWith("official-claude");
    // Stays open because right pane is visible.
    expect(
      findAll(
        ctx.body,
        (node) => node.props.class === "conversation-model-config-menu"
      )
    ).toHaveLength(1);

    const highThinking = findAll(
      menu,
      (node) =>
        node.props.role === "option" &&
        hasClass(node, "model-picker-param-option")
    )[2]!;
    (highThinking.props.onClick as () => void)();
    expect(ctx.onSelectThinking).toHaveBeenCalledWith("high");

    const networkBtn = findAll(
      menu,
      (node) => node.props["aria-label"] === "联网"
    )[0]!;
    (networkBtn.props.onClick as () => void)();
    expect(ctx.onToggleWebSearch).toHaveBeenCalledWith(true);

    // Show temperature options when thinking is off.
    ctx.showsTemperature.value = true;
    await nextTick();
    const tempBtns = findAll(menu, (node) =>
      hasClass(node, "model-picker-temp-option")
    );
    expect(tempBtns).toHaveLength(3);
    (tempBtns[0]!.props.onClick as () => void)();
    expect(ctx.onSelectTemperature).toHaveBeenCalledWith(0.1);
  });

  it("hides right pane and closes on model select when no parameters or web search exist", async () => {
    const ctx = mountSelect({
      selectedModelId: "openai-gpt",
      thinkingOptions: [],
      hidesWebSearch: true
    });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-params"))
    ).toHaveLength(0);

    const option = findAll(menu, (node) =>
      hasClass(node, "model-picker-option")
    )[0]!;
    (option.props.onClick as () => void)();
    await nextTick();
    await nextTick();
    expect(ctx.onSelectModel).toHaveBeenCalledWith("openai-gpt");
    expect(
      findAll(
        ctx.body,
        (node) => node.props.class === "conversation-model-config-menu"
      )
    ).toHaveLength(0);
    expect(trigger.focus).toHaveBeenCalled();
  });

  it("keeps menu open when interacting with nested footer teleported controls and closes on Escape", async () => {
    const ctx = mountSelect({ withFooter: true });
    const nestedPopup = new TestNode("div");
    nestedPopup.props.id = "nested-popup-menu";
    const nestedOption = new TestNode("button");
    nestedPopup.children.push(nestedOption);
    nestedOption.parent = nestedPopup;
    ctx.body.children.push(nestedPopup);
    nestedPopup.parent = ctx.body;

    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    // Pointerdown inside nested teleported menu should NOT close outer model picker.
    const pointerDownEvent = new Event("pointerdown");
    Object.defineProperty(pointerDownEvent, "target", { value: nestedOption });
    ctx.docTarget.dispatchEvent(pointerDownEvent);
    await nextTick();
    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0];
    expect(menu).toBeDefined();

    // Pressing Escape closes the menu and restores trigger focus.
    const escapeEvent = Object.assign(new Event("keydown"), {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    (menu!.props.onKeydown as (e: Event) => void)(escapeEvent);
    await nextTick();
    await nextTick();
    expect(
      findAll(
        ctx.body,
        (node) => node.props.class === "conversation-model-config-menu"
      )
    ).toHaveLength(0);
    expect(trigger.focus).toHaveBeenCalled();
  });

  it("renders a refresh button only on the official-site group when refresh context is provided", async () => {
    const refreshing = ref(false);
    const refresh = vi.fn(async () => undefined);
    const ctx = mountSelect({
      selectedModelId: "official-claude",
      officialRefresh: { refreshing, refresh }
    });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;

    // Single official tab still renders its group header with the refresh button.
    const refreshBtns = findAll(menu, (node) =>
      hasClass(node, "model-picker-group-refresh")
    );
    expect(refreshBtns).toHaveLength(1);
    expect(refreshBtns[0]!.props["aria-label"]).toBe("刷新官方小站模型");
    expect(refreshBtns[0]!.props.title).toBe("刷新官方小站模型");
    expect(
      findAll(
        refreshBtns[0]!,
        (node) => node.props["data-app-icon"] === "refresh"
      )
    ).toHaveLength(1);

    // Custom provider tab has no refresh button.
    const openaiTab = findAll(
      menu,
      (node) =>
        node.props.role === "tab" && node.props["aria-label"] === "OpenAI"
    )[0]!;
    (openaiTab.props.onClick as () => void)();
    await nextTick();
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-group-refresh"))
    ).toHaveLength(0);

    // All-models tab renders one refresh button exclusively on the official group header.
    const allTab = findAll(
      menu,
      (node) =>
        node.props.role === "tab" && node.props["aria-label"] === "全部模型"
    )[0]!;
    (allTab.props.onClick as () => void)();
    await nextTick();
    const groups = findAll(menu, (node) =>
      hasClass(node, "model-picker-group")
    );
    expect(groups.map((g) => g.props["aria-label"])).toEqual([
      "官方小站",
      "OpenAI",
      "DeepSeek"
    ]);
    expect(
      findAll(groups[0]!, (node) =>
        hasClass(node, "model-picker-group-refresh")
      )
    ).toHaveLength(1);
    expect(
      findAll(groups[1]!, (node) =>
        hasClass(node, "model-picker-group-refresh")
      )
    ).toHaveLength(0);
    expect(
      findAll(groups[2]!, (node) =>
        hasClass(node, "model-picker-group-refresh")
      )
    ).toHaveLength(0);
  });

  it("omits the refresh button when no official refresh context is provided", async () => {
    const ctx = mountSelect({ selectedModelId: "official-claude" });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-group-refresh"))
    ).toHaveLength(0);
  });

  it("refreshes listed/delisted official models in-place, prevents duplicate clicks, keeps custom models, and recovers after failure", async () => {
    const modelOptions = ref<ModelSelectOption[]>([...sampleModels]);
    const refreshing = ref(false);
    let resolvePending: (() => void) | undefined;
    let shouldFail = false;

    const refresh = vi.fn(async () => {
      if (refreshing.value) return;
      refreshing.value = true;
      try {
        await new Promise<void>((resolve) => {
          resolvePending = resolve;
        });
        if (shouldFail) {
          throw new Error("refresh failed");
        }
        modelOptions.value = [
          {
            value: "official-new",
            label: "Gemini 4 Argon",
            provider: "deepwrite-site",
            modelId: "gemini-4-argon",
            group: { key: "official", label: "官方小站" }
          },
          sampleModels[1]!,
          sampleModels[2]!
        ];
      } finally {
        refreshing.value = false;
      }
    });

    const ctx = mountSelect({
      selectedModelId: "official-claude",
      modelOptions,
      officialRefresh: { refreshing, refresh }
    });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    const refreshBtn = () =>
      findAll(menu, (node) => hasClass(node, "model-picker-group-refresh"))[0]!;

    // First click enters refreshing state and blocks duplicate invocations.
    (refreshBtn().props.onClick as (e: object) => void)({
      stopPropagation() {}
    });
    await nextTick();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshBtn().props.disabled).toBe(true);
    expect(refreshBtn().props["aria-busy"]).toBe(true);
    expect(refreshBtn().props["aria-label"]).toBe("正在刷新官方小站模型…");
    expect(ctx.onSelectModel).not.toHaveBeenCalled();

    // Duplicate click while refreshing is ignored.
    (refreshBtn().props.onClick as (e: object) => void)({
      stopPropagation() {}
    });
    await nextTick();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Failed refresh retains the already-displayed catalog and re-enables retry.
    shouldFail = true;
    resolvePending?.();
    await nextTick();
    await nextTick();
    await nextTick();
    expect(refreshBtn().props.disabled).toBe(false);
    expect(refreshBtn().props["aria-busy"]).toBe(false);
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-option")).map(
        (n) => n.props["data-model-value"]
      )
    ).toEqual(["official-claude"]);

    // Retry succeeds: delisted official model is removed, newly listed model appears, custom models remain.
    shouldFail = false;
    (refreshBtn().props.onClick as (e: object) => void)({
      stopPropagation() {}
    });
    await nextTick();
    resolvePending?.();
    await nextTick();
    await nextTick();
    await nextTick();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refreshBtn().props.disabled).toBe(false);
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-option")).map(
        (n) => n.props["data-model-value"]
      )
    ).toEqual(["official-new"]);
    // Trigger falls back to placeholder when previously selected official model was delisted.
    expect(collectText(trigger)).toContain("选择模型");

    // Custom models remain intact under All Models.
    const allTab = findAll(
      menu,
      (node) =>
        node.props.role === "tab" && node.props["aria-label"] === "全部模型"
    )[0]!;
    (allTab.props.onClick as () => void)();
    await nextTick();
    expect(
      findAll(menu, (node) => hasClass(node, "model-picker-option")).map(
        (n) => n.props["data-model-value"]
      )
    ).toEqual(["official-new", "openai-gpt", "deepseek-chat"]);
  });

  it("positions a compact popover and clamps/scales across viewport and font sizes", async () => {
    // 1) 3-column with footer at default 14px font size
    const withFooter = mountSelect({ withFooter: true });
    let trigger = findAll(
      withFooter.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();
    let menu = findAll(
      withFooter.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(menu.props.style).toMatchObject({
      width: "500px",
      height: "336px"
    });

    // 2) 3-column without footer
    const withoutFooter = mountSelect();
    trigger = findAll(
      withoutFooter.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();
    menu = findAll(
      withoutFooter.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(menu.props.style).toMatchObject({
      width: "500px",
      height: "302px"
    });

    // 3) 2-column without right pane
    const twoPane = mountSelect({
      thinkingOptions: [],
      hidesWebSearch: true
    });
    trigger = findAll(
      twoPane.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();
    menu = findAll(
      twoPane.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(menu.props.style).toMatchObject({
      width: "362px",
      height: "302px"
    });

    // 4) Scaled font (18px -> capped at 1.15x => 575x386 with footer)
    const scaled = mountSelect({ withFooter: true });
    (window as unknown as { innerHeight: number }).innerHeight = 900;
    (document as unknown as { documentElement: object }).documentElement = {};
    vi.stubGlobal("getComputedStyle", () => ({
      transitionDelay: "0s",
      transitionDuration: "0s",
      animationDelay: "0s",
      animationDuration: "0s",
      fontSize: "18px"
    }));
    trigger = findAll(
      scaled.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();
    menu = findAll(
      scaled.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(menu.props.style).toMatchObject({
      width: "575px",
      height: "386px"
    });

    // 5) Clamped cleanly on a narrow/short viewport (420x460 with trigger at y=240..270)
    trigger.getBoundingClientRect = () => ({
      top: 240,
      bottom: 270,
      left: 100,
      right: 260,
      width: 160,
      height: 30
    });
    (
      window as unknown as { innerWidth: number; innerHeight: number }
    ).innerWidth = 420;
    (
      window as unknown as { innerWidth: number; innerHeight: number }
    ).innerHeight = 460;
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    const clampedStyle = menu.props.style as Record<string, string>;
    expect(clampedStyle.width).toBe("404px");
    expect(clampedStyle.height).toBe("226px");
    expect(clampedStyle.top).toBe("8px");
    expect(Number.parseFloat(clampedStyle.left!)).toBeGreaterThanOrEqual(8);
    expect(
      Number.parseFloat(clampedStyle.top!) +
        Number.parseFloat(clampedStyle.height!)
    ).toBeLessThanOrEqual(460 - 8);
  });

  it("shows single-line official model announcements with hover tooltip without altering rail, non-official groups, or refresh", async () => {
    const refreshing = ref(false);
    const refresh = vi.fn(async () => undefined);
    const announcements = ref<readonly string[]>([
      "  Gemini 模型逐渐恢复稳定，\n欢迎使用。 ",
      "   ",
      "支持自建渠道"
    ]);
    const ctx = mountSelect({
      selectedModelId: "official-claude",
      officialRefresh: { refreshing, announcements, refresh }
    });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;

    const railTabs = findAll(menu, (node) => node.props.role === "tab");
    expect(railTabs.map((node) => collectText(node).trim())).toContain(
      "官方小站"
    );

    const officialGroup = findAll(menu, (node) =>
      hasClass(node, "model-picker-group")
    )[0]!;
    expect(officialGroup.props["aria-label"]).toBe("官方小站");

    const officialLabel = findAll(officialGroup, (node) =>
      hasClass(node, "model-picker-group-label")
    )[0]!;
    expect(hasClass(officialLabel, "is-announcement")).toBe(true);
    expect(collectText(officialLabel)).toBe(
      "Gemini 模型逐渐恢复稳定， 欢迎使用。 · 支持自建渠道"
    );
    expect(officialLabel.props.title).toBeUndefined();
    expect(
      findAll(ctx.body, (node) => node.props.role === "tooltip")
    ).toHaveLength(0);

    // Hovering displays the full announcement in a floating tooltip.
    (officialLabel.props.onMouseenter as (e: object) => void)({
      currentTarget: officialLabel
    });
    await nextTick();
    await nextTick();

    const tooltips = findAll(ctx.body, (node) => node.props.role === "tooltip");
    expect(tooltips).toHaveLength(1);
    expect(hasClass(tooltips[0]!, "model-picker-announcement-tooltip")).toBe(
      true
    );
    expect(collectText(tooltips[0]!)).toBe(
      "Gemini 模型逐渐恢复稳定，\n欢迎使用。\n支持自建渠道"
    );
    expect(officialLabel.props["aria-describedby"]).toBe(tooltips[0]!.props.id);

    (officialLabel.props.onMouseleave as () => void)();
    await nextTick();
    expect(
      findAll(ctx.body, (node) => node.props.role === "tooltip")
    ).toHaveLength(0);
    expect(officialLabel.props["aria-describedby"]).toBeUndefined();

    const refreshBtn = findAll(officialGroup, (node) =>
      hasClass(node, "model-picker-group-refresh")
    )[0]!;
    (refreshBtn.props.onClick as (e: object) => void)({
      stopPropagation() {}
    });
    await nextTick();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Non-official groups keep their provider labels under All Models.
    const allTab = findAll(
      menu,
      (node) =>
        node.props.role === "tab" && node.props["aria-label"] === "全部模型"
    )[0]!;
    (allTab.props.onClick as () => void)();
    await nextTick();

    const groups = findAll(menu, (node) =>
      hasClass(node, "model-picker-group")
    );
    const labels = groups.map(
      (group) =>
        findAll(group, (node) => hasClass(node, "model-picker-group-label"))[0]!
    );
    expect(labels.map((node) => collectText(node))).toEqual([
      "Gemini 模型逐渐恢复稳定， 欢迎使用。 · 支持自建渠道",
      "OpenAI",
      "DeepSeek"
    ]);
    expect(hasClass(labels[1]!, "is-announcement")).toBe(false);
    expect(hasClass(labels[2]!, "is-announcement")).toBe(false);

    // Single-line announcement opens tooltip only when truncated by layout width.
    announcements.value = ["仅一条官方模型公告"];
    await nextTick();
    expect(collectText(labels[0]!)).toBe("仅一条官方模型公告");

    Object.assign(labels[0]!, { clientWidth: 200, scrollWidth: 100 });
    (labels[0]!.props.onMouseenter as (e: object) => void)({
      currentTarget: labels[0]!
    });
    await nextTick();
    expect(
      findAll(ctx.body, (node) => node.props.role === "tooltip")
    ).toHaveLength(0);

    Object.assign(labels[0]!, { clientWidth: 180, scrollWidth: 320 });
    (labels[0]!.props.onMouseenter as (e: object) => void)({
      currentTarget: labels[0]!
    });
    await nextTick();
    await nextTick();
    const truncatedTooltip = findAll(
      ctx.body,
      (node) => node.props.role === "tooltip"
    );
    expect(truncatedTooltip).toHaveLength(1);
    expect(collectText(truncatedTooltip[0]!)).toBe("仅一条官方模型公告");

    (labels[0]!.props.onMouseleave as () => void)();
    await nextTick();
    expect(
      findAll(ctx.body, (node) => node.props.role === "tooltip")
    ).toHaveLength(0);
  });

  it("hides the official group label silently when announcements are empty, whitespace-only, or omitted while keeping refresh pinned", async () => {
    const refreshing = ref(false);
    const refresh = vi.fn(async () => undefined);
    const announcements = ref<readonly string[]>(["线上官方公告"]);
    const ctx = mountSelect({
      selectedModelId: "official-claude",
      officialRefresh: { refreshing, announcements, refresh }
    });
    const trigger = findAll(
      ctx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (trigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const menu = findAll(
      ctx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    const labelNodes = () =>
      findAll(menu, (node) => hasClass(node, "model-picker-group-label"));
    const refreshBtn = () =>
      findAll(menu, (node) => hasClass(node, "model-picker-group-refresh"))[0]!;

    expect(labelNodes()).toHaveLength(1);
    expect(hasClass(labelNodes()[0]!, "is-announcement")).toBe(true);
    expect(collectText(labelNodes()[0]!)).toBe("线上官方公告");

    announcements.value = ["  ", "\n\t"];
    await nextTick();
    expect(labelNodes()).toHaveLength(0);
    expect(
      findAll(ctx.body, (node) => node.props.role === "tooltip")
    ).toHaveLength(0);
    expect(refreshBtn()).toBeDefined();

    announcements.value = [];
    await nextTick();
    expect(labelNodes()).toHaveLength(0);
    expect(refreshBtn()).toBeDefined();
    (refreshBtn().props.onClick as (e: object) => void)({
      stopPropagation() {}
    });
    await nextTick();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Omitted announcements (e.g. fetch failed / offline) also omit the official label.
    const noAnnounceCtx = mountSelect({
      selectedModelId: "official-claude",
      officialRefresh: { refreshing, refresh }
    });
    const noAnnounceTrigger = findAll(
      noAnnounceCtx.root,
      (node) => node.props.class === "conversation-model-config-trigger"
    )[0]!;
    (noAnnounceTrigger.props.onClick as () => void)();
    await nextTick();
    await nextTick();

    const noAnnounceMenu = findAll(
      noAnnounceCtx.body,
      (node) => node.props.class === "conversation-model-config-menu"
    )[0]!;
    expect(
      findAll(noAnnounceMenu, (node) =>
        hasClass(node, "model-picker-group-label")
      )
    ).toHaveLength(0);
    expect(
      findAll(noAnnounceMenu, (node) =>
        hasClass(node, "model-picker-group-refresh")
      )
    ).toHaveLength(1);
  });
});
