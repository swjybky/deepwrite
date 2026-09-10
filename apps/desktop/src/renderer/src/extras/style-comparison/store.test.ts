import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useStyleComparisonStore } from "./store";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
} from "./method";

const METHOD_KEY = "deepwrite.style-comparison.method.v1";
let storage: Map<string, string>;
let store: ReturnType<typeof useStyleComparisonStore> | undefined;

beforeEach(() => {
  setActivePinia(createPinia());
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  });
});

afterEach(() => {
  store?.$dispose();
  store = undefined;
  vi.unstubAllGlobals();
});

describe("文风比对方法保存", () => {
  it("upgrades and persists the previous default across store recreation", () => {
    storage.set(METHOD_KEY, PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD);
    store = useStyleComparisonStore();
    expect(store.method).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
    expect(storage.get(METHOD_KEY)).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
    store.$dispose();
    setActivePinia(createPinia());
    store = useStyleComparisonStore();
    expect(store.method).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
  });

  it("preserves a user's custom method, including an intentional empty value", () => {
    for (const method of ["重点比较对白节奏，保留我的权重。", ""]) {
      storage.set(METHOD_KEY, method);
      setActivePinia(createPinia());
      store = useStyleComparisonStore();
      expect(store.method).toBe(method);
      expect(storage.get(METHOD_KEY)).toBe(method);
      store.$dispose();
    }
  });

  it("persists the new default for a fresh configuration", () => {
    store = useStyleComparisonStore();
    expect(store.method).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
    expect(storage.get(METHOD_KEY)).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
  });
});
