import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { createRenderer, h, nextTick, reactive, ssrContextKey } from "vue";
import type { ModelConfig } from "@deepwrite/contracts/renderer";
import LongMaterialPackPage from "./LongMaterialPackPage.vue";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const model: ModelConfig = {
  id: "model_default",
  label: "Test model",
  provider: "test-provider",
  modelId: "test-model",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
  temperatureOptions: [0.1, 0.7, 1],
  hasApiKey: false
};
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
const page = Object.assign({}, LongMaterialPackPage, { render: () => null });
const unmounts: Array<() => void> = [];
let pinia: ReturnType<typeof createPinia>;

function mount(models: ModelConfig[] = [model], preferredModelId = model.id) {
  const props = reactive({ models, preferredModelId });
  const store = useLongMaterialPackStore();
  vi.spyOn(store, "loadBooks").mockResolvedValue();
  const app = renderer.createApp({ render: () => h(page, props) });
  app.use(pinia);
  // Vitest compiles SFC setup for SSR; keep its module bookkeeping available.
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  const unmount = () => app.unmount();
  unmounts.push(unmount);
  return { props, store, unmount };
}

describe("long material pack model settings", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });
  afterEach(() => {
    unmounts.splice(0).forEach((unmount) => unmount());
    disposePinia(pinia);
    vi.restoreAllMocks();
  });

  it.each(["off", "medium", "high", "xhigh"])(
    "starts with the preferred model's configured %s thinking level",
    (defaultThinkingLevel) => {
      const low = { ...model, id: "model_low", defaultThinkingLevel: "low" };
      const { store } = mount([low, { ...model, defaultThinkingLevel }]);
      expect(store.guideModelId).toBe(model.id);
      expect(store.guideThinkingLevel).toBe(defaultThinkingLevel);
    }
  );

  it("uses the new model's default even when the old level remains supported", async () => {
    const low = { ...model, id: "model_low", defaultThinkingLevel: "low" };
    const { store } = mount([model, low]);
    store.guideThinkingLevel = "medium";
    store.guideModelId = low.id;
    await nextTick();
    expect(store.guideThinkingLevel).toBe("low");
    store.guideModelId = model.id;
    await nextTick();
    expect(store.guideThinkingLevel).toBe("high");
  });

  it("applies the default when models arrive after the page opens", async () => {
    const { props, store } = mount([]);
    expect(store.guideModelId).toBe("");
    props.models = [model];
    await nextTick();
    expect(store.guideModelId).toBe(model.id);
    expect(store.guideThinkingLevel).toBe("high");
  });

  it("restores the default after an existing model is temporarily unavailable", async () => {
    const { store, unmount } = mount();
    unmount();
    unmounts.pop();
    const { props } = mount([]);
    props.models = [model];
    await nextTick();
    expect(store.guideModelId).toBe(model.id);
    expect(store.guideThinkingLevel).toBe("high");
  });

  it.each(["missing", "disabled"])(
    "uses an enabled model's default when the preferred model is %s",
    (preferred) => {
      const { store } = mount(
        [{ ...model, id: "disabled", enabled: false }, model],
        preferred
      );
      expect(store.guideModelId).toBe(model.id);
      expect(store.guideThinkingLevel).toBe("high");
    }
  );

  it.each(["off", "medium"])(
    "preserves a manual %s selection across refreshes and page visits",
    async (level) => {
      const { props, store, unmount } = mount();
      store.guideThinkingLevel = level;
      props.models = [{ ...model }];
      await nextTick();
      expect(store.guideThinkingLevel).toBe(level);
      unmount();
      unmounts.pop();
      mount();
      expect(store.guideThinkingLevel).toBe(level);
    }
  );

  it("resets unsupported levels and turns thinking off for non-reasoning models", async () => {
    const { props, store } = mount();
    store.guideThinkingLevel = "medium";
    props.models = [{ ...model, thinkingLevelOptions: ["high"] }];
    await nextTick();
    expect(store.guideThinkingLevel).toBe("high");
    props.models = [{ ...model, reasoning: false }];
    await nextTick();
    expect(store.guideThinkingLevel).toBe("off");
  });

  it("uses the replacement model's default when the selected model is disabled", async () => {
    const low = { ...model, id: "model_low", defaultThinkingLevel: "low" };
    const { props, store } = mount([model, low]);
    props.models = [{ ...model, enabled: false }, low];
    await nextTick();
    expect(store.guideModelId).toBe(low.id);
    expect(store.guideThinkingLevel).toBe("low");
    props.models = [];
    await nextTick();
    expect(store.guideModelId).toBe("");
    expect(store.guideThinkingLevel).toBe("off");
  });
});
