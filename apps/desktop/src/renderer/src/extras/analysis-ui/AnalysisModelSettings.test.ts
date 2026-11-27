// @vitest-environment deepwrite-renderer
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ref
} from "vue";
import type { ModelConfig, ThinkingLevel } from "@deepwrite/contracts/renderer";
import { thinkingLabel } from "../../components/modelSettingsDraft";
import { OFFICIAL_MODEL_REFRESH_CONTEXT_KEY } from "../../composables/officialModelRefreshContext";
import { resetFavoriteModelsForTest } from "../../utils/favoriteModels";
import AnalysisModelSettings from "./AnalysisModelSettings.vue";

vi.mock("../../components/AppIcon.vue", () => ({
  default: defineComponent({
    props: { name: String, size: Number },
    render() {
      return h("svg", { "data-icon": this.name });
    }
  })
}));

vi.mock("../../components/ModelProviderIcon.vue", () => ({
  default: defineComponent({
    props: {
      groupKey: String,
      provider: String,
      modelId: String,
      label: String,
      size: Number
    },
    render() {
      return h("svg", { "data-provider": this.provider ?? "generic" });
    }
  })
}));

class FakeEl {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  props: Record<string, unknown> = {};
  style: Record<string, string> = {};
  textContent = "";
  scrollTop = 0;
  scrollHeight = 400;
  clientHeight = 200;
  focusCalls = 0;

  constructor(readonly tag: string) {}

  focus(): void {
    this.focusCalls += 1;
    setFocusedEl(this);
  }

  get [Symbol.toStringTag]() {
    return "HTMLElement";
  }

  getAttribute(name: string): string | null {
    const val = this.props[name];
    return val === undefined || val === null ? null : String(val);
  }

  contains(target: unknown): boolean {
    let cursor = target as FakeEl | null;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  getBoundingClientRect() {
    const cls = String(this.props.class ?? "");
    if (cls.includes("analysis-model-panel")) {
      return {
        top: 84,
        bottom: 492,
        left: 364,
        right: 1000,
        width: 636,
        height: 408
      };
    }
    return {
      top: 40,
      bottom: 76,
      left: 900,
      right: 1000,
      width: 100,
      height: 36
    };
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    return walkEl(this, (el) => matchEl(el, selector));
  }
}

let activeFakeEl: FakeEl | null = null;
const cleanups: Array<() => void> = [];

function setFocusedEl(el: FakeEl): void {
  activeFakeEl = el;
}

function matchEl(el: FakeEl, selector: string): boolean {
  const classes = String(el.props.class ?? "").split(/\s+/);
  if (selector.startsWith(".")) {
    return selector
      .slice(1)
      .split(".")
      .every((name) => classes.includes(name));
  }
  if (selector === "[aria-controls]") {
    return el.props["aria-controls"] !== undefined;
  }
  if (selector === '[aria-label="关闭模型设置"]') {
    return el.props["aria-label"] === "关闭模型设置";
  }
  return false;
}

function walkEl(root: FakeEl, test: (el: FakeEl) => boolean): FakeEl[] {
  const hits: FakeEl[] = [];
  for (const child of root.children) {
    if (test(child)) hits.push(child);
    hits.push(...walkEl(child, test));
  }
  return hits;
}

function readElText(el: FakeEl): string {
  return `${el.textContent}${el.children.map(readElText).join("")}`;
}

function detachEl(node: FakeEl): void {
  if (!node.parent) return;
  const idx = node.parent.children.indexOf(node);
  if (idx >= 0) node.parent.children.splice(idx, 1);
  node.parent = null;
}

function setupFakeDom() {
  const body = new FakeEl("body");
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const emitDoc = (type: string, event: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  const noop = () => {};

  vi.stubGlobal("Node", FakeEl);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = noop;
      disconnect = noop;
    }
  );
  vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("getComputedStyle", () => ({
    transitionDuration: "0s",
    animationDuration: "0s"
  }));
  vi.stubGlobal("document", {
    body,
    get activeElement() {
      return activeFakeEl;
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: (event: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    getElementById(id: string) {
      return walkEl(body, (el) => el.props.id === id)[0] ?? null;
    }
  });
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: noop,
    removeEventListener: noop
  });

  const renderer = createRenderer<FakeEl, FakeEl>({
    patchProp: (el, key, _prev, value) => {
      el.props[key] = value;
    },
    insert(el, parent, anchor) {
      detachEl(el);
      el.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(idx >= 0 ? idx : parent.children.length, 0, el);
    },
    remove: detachEl,
    createElement: (tag) => new FakeEl(tag),
    createText: (text) =>
      Object.assign(new FakeEl("#text"), { textContent: text }),
    createComment: () => new FakeEl("#comment"),
    setText: (el, text) => {
      el.textContent = text;
    },
    setElementText: (el, text) => {
      el.children = [];
      el.textContent = text;
    },
    parentNode: (el) => el.parent,
    nextSibling: (el) => {
      const siblings = el.parent?.children;
      if (!siblings) return null;
      return siblings[siblings.indexOf(el) + 1] ?? null;
    },
    querySelector: (selector) => (selector === "body" ? body : null)
  });

  return { body, renderer, emitDoc };
}

const sampleModels: ModelConfig[] = [
  {
    id: "deepwrite-site-official-deepseek-flash",
    label: "Deepseek-v4.1-flash",
    provider: "deepwrite-site",
    modelId: "deepseek-v4.1-flash",
    api: "openai-completions",
    baseUrl: "https://official.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["off", "low", "high"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: false
  },
  {
    id: "custom-openai",
    label: "Custom GPT",
    provider: "openai",
    modelId: "gpt-test",
    api: "openai-completions",
    baseUrl: "https://custom.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["off", "medium", "high"],
    temperatureOptions: [0.2, 0.7, 1],
    hasApiKey: true
  }
];

function mountComponent(options?: {
  label?: string;
  disabled?: boolean;
  announcements?: readonly string[];
}) {
  const { body, renderer, emitDoc } = setupFakeDom();
  const root = new FakeEl("div");
  const props = reactive<{
    models: ModelConfig[];
    modelId: string;
    thinkingLevel: ThinkingLevel;
    disabled?: boolean;
    label?: string;
  }>({
    models: sampleModels,
    modelId: "deepwrite-site-official-deepseek-flash",
    thinkingLevel: "high",
    ...(options?.label !== undefined ? { label: options.label } : {}),
    ...(options?.disabled !== undefined ? { disabled: options.disabled } : {})
  });
  const onUpdateModelId = vi.fn((val: string) => {
    props.modelId = val;
  });
  const onUpdateThinkingLevel = vi.fn((val: ThinkingLevel) => {
    props.thinkingLevel = val;
  });
  const refresh = vi.fn(async () => {});
  const refreshing = ref(false);

  const app = renderer.createApp({
    render: () =>
      h(AnalysisModelSettings, {
        ...props,
        "onUpdate:modelId": onUpdateModelId,
        "onUpdate:thinkingLevel": onUpdateThinkingLevel
      })
  });
  app.provide(OFFICIAL_MODEL_REFRESH_CONTEXT_KEY, {
    refreshing: computed(() => refreshing.value),
    ...(options?.announcements
      ? { announcements: computed(() => options.announcements!) }
      : {}),
    refresh
  });
  app.mount(root);
  cleanups.push(() => app.unmount());

  const getTrigger = () => root.querySelector(".analysis-model-trigger")!;
  const getPanel = () =>
    body.querySelector(".analysis-model-panel.is-picker-panel");

  return {
    root,
    body,
    props,
    emitDoc,
    refresh,
    onUpdateModelId,
    onUpdateThinkingLevel,
    getTrigger,
    getPanel
  };
}

async function openPicker(ctx: ReturnType<typeof mountComponent>) {
  await (ctx.getTrigger().props.onClick as () => Promise<void>)();
  await nextTick();
  await nextTick();
}

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  activeFakeEl = null;
  resetFavoriteModelsForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnalysisModelSettings", () => {
  it("renders a headerless dialog with aria-label and no close button", async () => {
    const ctx = mountComponent();
    await openPicker(ctx);

    const panel = ctx.getPanel();
    expect(panel).not.toBeNull();
    expect(panel!.props.role).toBe("dialog");
    expect(panel!.props["aria-label"]).toBe("模型设置");
    expect(panel!.props["aria-labelledby"]).toBeUndefined();
    expect(panel!.children.filter((el) => el.tag === "header")).toHaveLength(0);
    expect(panel!.querySelector('[aria-label="关闭模型设置"]')).toBeNull();
    expect(ctx.getTrigger().props["aria-expanded"]).toBe(true);
    expect(ctx.getTrigger().props["aria-controls"]).toBe(panel!.props.id);
    expect(panel!.contains(activeFakeEl)).toBe(true);
  });

  it("uses custom label prop as dialog aria-label when provided", async () => {
    const ctx = mountComponent({ label: "拆书模型" });
    await openPicker(ctx);

    const panel = ctx.getPanel();
    expect(panel?.props["aria-label"]).toBe("拆书模型");
    expect(ctx.getTrigger().props["aria-label"]).toBe("拆书模型");
  });

  it("keeps official station refresh, model selection, and thinking selection working", async () => {
    const ctx = mountComponent();
    await openPicker(ctx);

    const panel = ctx.getPanel()!;
    expect(panel.querySelector(".model-picker-group-label")).toBeNull();
    const refreshBtn = panel.querySelector(".model-picker-group-refresh");
    expect(refreshBtn).not.toBeNull();

    (refreshBtn!.props.onClick as (event: { stopPropagation(): void }) => void)(
      {
        stopPropagation() {}
      }
    );
    await nextTick();
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.getPanel()).not.toBeNull();

    const allTab = walkEl(
      panel,
      (el) => el.props.role === "tab" && el.props["aria-label"] === "全部模型"
    )[0]!;
    (allTab.props.onClick as () => void)();
    await nextTick();

    const modelOption = walkEl(
      panel,
      (el) => el.props["data-model-value"] === "custom-openai"
    )[0]!;
    (modelOption.props.onClick as () => void)();
    await nextTick();
    expect(ctx.onUpdateModelId).toHaveBeenCalledWith("custom-openai");

    const mediumOption = walkEl(
      panel,
      (el) =>
        el.props.role === "option" &&
        readElText(el).trim() === thinkingLabel("medium")
    )[0]!;
    (mediumOption.props.onClick as () => void)();
    await nextTick();
    expect(ctx.onUpdateThinkingLevel).toHaveBeenCalledWith("medium");
  });

  it("renders single-line official model announcement with hover tooltip alongside the refresh button", async () => {
    const ctx = mountComponent({
      announcements: ["Gemini 模型逐渐恢复稳定，欢迎使用。"]
    });
    await openPicker(ctx);

    const panel = ctx.getPanel()!;
    const label = panel.querySelector(
      ".model-picker-group-label.is-announcement"
    );
    expect(label).not.toBeNull();
    expect(readElText(label!)).toBe("Gemini 模型逐渐恢复稳定，欢迎使用。");
    expect(label!.props.title).toBeUndefined();

    (label!.props.onMouseenter as (event: { currentTarget: FakeEl }) => void)({
      currentTarget: label!
    });
    await nextTick();
    await nextTick();
    const tooltip = ctx.body.querySelector(
      ".model-picker-announcement-tooltip"
    );
    expect(tooltip).not.toBeNull();
    expect(tooltip!.props.role).toBe("tooltip");
    expect(readElText(tooltip!)).toBe("Gemini 模型逐渐恢复稳定，欢迎使用。");

    (label!.props.onMouseleave as () => void)();
    await nextTick();
    expect(
      ctx.body.querySelector(".model-picker-announcement-tooltip")
    ).toBeNull();

    const refreshBtn = panel.querySelector(".model-picker-group-refresh");
    expect(refreshBtn).not.toBeNull();
    (refreshBtn!.props.onClick as (event: { stopPropagation(): void }) => void)(
      {
        stopPropagation() {}
      }
    );
    await nextTick();
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
  });

  it("closes on pointerdown or focusin outside, while staying open for inside pointerdown", async () => {
    const ctx = mountComponent();
    await openPicker(ctx);

    const panel = ctx.getPanel()!;
    const insideTarget = panel.querySelector(".model-picker-panel")!;
    expect(insideTarget).not.toBeNull();
    expect(panel.contains(insideTarget)).toBe(true);
    ctx.emitDoc("pointerdown", { target: insideTarget });
    await nextTick();
    expect(ctx.getPanel()).not.toBeNull();

    const outsideTarget = new FakeEl("div");
    ctx.emitDoc("pointerdown", { target: outsideTarget });
    await nextTick();
    expect(ctx.getPanel()).toBeNull();

    await openPicker(ctx);
    expect(ctx.getPanel()).not.toBeNull();
    ctx.emitDoc("focusin", { target: outsideTarget });
    await nextTick();
    expect(ctx.getPanel()).toBeNull();
  });

  it("closes on Escape, restores trigger focus, and closes when disabled becomes true", async () => {
    const ctx = mountComponent();
    await openPicker(ctx);

    const preventDefault = vi.fn();
    ctx.emitDoc("keydown", {
      key: "Escape",
      defaultPrevented: false,
      preventDefault
    });
    await nextTick();
    await nextTick();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(ctx.getPanel()).toBeNull();
    expect(ctx.getTrigger().focusCalls).toBe(1);
    expect(activeFakeEl).toBe(ctx.getTrigger());

    await openPicker(ctx);
    expect(ctx.getPanel()).not.toBeNull();
    ctx.props.disabled = true;
    await nextTick();
    expect(ctx.getPanel()).toBeNull();
  });

  it("applies compact height bounds across default and short viewports", async () => {
    const ctx = mountComponent();
    await openPicker(ctx);
    expect(
      (ctx.getPanel()!.props.style as Record<string, string>).maxHeight
    ).toBe("302px");

    // Short viewport clamps maxHeight safely without falling below 180px.
    (window as unknown as { innerHeight: number }).innerHeight = 320;
    const escapeEvent = {
      key: "Escape",
      defaultPrevented: false,
      preventDefault: vi.fn()
    };
    ctx.emitDoc("keydown", escapeEvent);
    await nextTick();
    await openPicker(ctx);
    expect(
      (ctx.getPanel()!.props.style as Record<string, string>).maxHeight
    ).toBe("228px");
  });
});
