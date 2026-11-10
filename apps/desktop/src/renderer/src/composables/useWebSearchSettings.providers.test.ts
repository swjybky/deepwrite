import { afterEach, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type {
  WebSearchSettings,
  WebSearchSettingsInput
} from "@deepwrite/contracts/renderer";
import { useWebSearchStatusStore } from "../stores/webSearchStatus";
import { useWebSearchSettings } from "./useWebSearchSettings";

afterEach(() => vi.unstubAllGlobals());

it("switches providers with independent endpoints and tests unsaved endpoint edits", async () => {
  setActivePinia(createPinia());
  let snapshot: WebSearchSettings = {
    enabled: true,
    activeProviderId: "deepseek",
    perRunCallLimit: 20,
    profiles: [
      { providerId: "deepseek", maxResults: 8, hasApiKey: true },
      {
        providerId: "tavily",
        maxResults: 5,
        hasApiKey: true,
        baseUrl: "https://relay.example.test/api"
      }
    ]
  };
  const api = {
    getSettings: vi.fn(async () => snapshot),
    saveSettings: vi.fn(async (input: WebSearchSettingsInput) => {
      snapshot = {
        ...snapshot,
        activeProviderId: input.activeProviderId,
        profiles: snapshot.profiles.map((profile) => {
          const update = input.profiles.find(
            (entry) => entry.providerId === profile.providerId
          );
          return update
            ? {
                providerId: update.providerId,
                maxResults: update.maxResults,
                baseUrl: update.baseUrl,
                hasApiKey: true
              }
            : profile;
        })
      };
      return snapshot;
    }),
    test: vi.fn(async () => ({ resultCount: 0, elapsedMs: 1, samples: [] }))
  };
  vi.stubGlobal("window", { deepwrite: { webSearch: api } });
  const scope = effectScope();
  const c = scope.run(() => useWebSearchSettings())!;
  try {
    await c.load();
    await c.selectProvider("tavily");
    expect(c.draft.baseUrl).toBe("https://relay.example.test/api");
    expect(c.draft.maxResults).toBe(5);
    expect(c.canImport.value).toBe(false);
    c.draft.baseUrl = "https://edited.example.test";
    await c.test();
    expect(api.test).toHaveBeenLastCalledWith({
      providerId: "tavily",
      baseUrl: "https://edited.example.test"
    });
    await c.save();
    await c.selectProvider("deepseek");
    expect(c.draft.baseUrl).toBe("");
    expect(c.draft.maxResults).toBe(8);
    await c.selectProvider("tavily");
    expect(c.draft.baseUrl).toBe("https://edited.example.test");
    c.draft.baseUrl = "";
    await c.save();
    expect(
      snapshot.profiles.find((profile) => profile.providerId === "tavily")
        ?.baseUrl
    ).toBeUndefined();
  } finally {
    scope.stop();
  }
});

it("offers keyless search when a self-hosted endpoint is saved", async () => {
  setActivePinia(createPinia());
  const snapshot: WebSearchSettings = {
    enabled: true,
    activeProviderId: "searxng",
    perRunCallLimit: 20,
    profiles: [
      {
        providerId: "searxng",
        maxResults: 8,
        hasApiKey: false,
        baseUrl: "http://localhost:8888"
      }
    ]
  };
  const api = {
    getSettings: vi.fn(async () => snapshot),
    test: vi.fn(async () => ({ resultCount: 0, elapsedMs: 1, samples: [] }))
  };
  vi.stubGlobal("window", { deepwrite: { webSearch: api } });
  const scope = effectScope();
  const c = scope.run(() => useWebSearchSettings())!;
  try {
    await c.load();
    expect(c.hasUsableKey.value).toBe(true);
    expect(useWebSearchStatusStore().usable).toBe(true);
    expect(c.statusText.value).toContain("SearXNG");
    await c.test();
    expect(api.test).toHaveBeenCalledWith({
      providerId: "searxng",
      baseUrl: "http://localhost:8888"
    });
  } finally {
    scope.stop();
  }
});
