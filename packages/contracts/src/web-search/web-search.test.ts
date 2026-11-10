import { describe, expect, it } from "vitest";
import { createEnvelope } from "../envelope";
import { CommandEnvelopeSchema } from "../system";
import {
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_IDS,
  WebSearchRuntimeConfigSchema,
  WebSearchSettingsInputSchema,
  WebSearchSettingsSchema,
  isWebSearchUsable,
  matchesWebSearchKeyImport,
  type WebSearchKeyImportModel
} from "./index";

const rule = WEB_SEARCH_PROVIDERS.deepseek.keyImport;
// The host comes from the product rule, so no real service address sits in a test.
const [host] = rule.baseUrlHosts;

function model(
  overrides: Partial<WebSearchKeyImportModel> = {}
): WebSearchKeyImportModel {
  return {
    id: "model_a",
    provider: "deepseek",
    baseUrl: `https://${host}/v1`,
    hasApiKey: true,
    ...overrides
  };
}

describe("matchesWebSearchKeyImport", () => {
  it("accepts DeepSeek models whatever the API path or provider casing", () => {
    expect(matchesWebSearchKeyImport(model(), rule)).toBe(true);
    expect(
      matchesWebSearchKeyImport(
        model({
          provider: "  DeepSeek ",
          baseUrl: `https://${host!.toUpperCase()}/anthropic`
        }),
        rule
      )
    ).toBe(true);
  });

  it("rejects other providers, hosts and unusable base URLs", () => {
    for (const candidate of [
      model({ provider: "openai" }),
      model({ baseUrl: "https://relay.example.test/v1" }),
      model({ baseUrl: `https://${host}.relay.example.test/v1` }),
      model({ baseUrl: `https://relay.example.test/${host}` }),
      model({ baseUrl: "" }),
      model({ baseUrl: "not a url" })
    ]) {
      expect(matchesWebSearchKeyImport(candidate, rule)).toBe(false);
    }
  });

  it("rejects models without a key and managed or official-site models", () => {
    expect(matchesWebSearchKeyImport(model({ hasApiKey: false }), rule)).toBe(
      false
    );
    expect(
      matchesWebSearchKeyImport(model({ managedBy: "deepwrite-free" }), rule)
    ).toBe(false);
    expect(
      matchesWebSearchKeyImport(
        model({ id: "deepwrite-site-official-deepseek" }),
        rule
      )
    ).toBe(false);
  });
});

describe("isWebSearchUsable", () => {
  const profile = (hasApiKey: boolean) => ({
    providerId: "deepseek" as const,
    maxResults: 8,
    hasApiKey
  });
  const settings = (enabled: boolean, hasApiKey: boolean) => ({
    enabled,
    activeProviderId: "deepseek" as const,
    profiles: [profile(hasApiKey)]
  });

  it("needs search on and a key for the active provider", () => {
    expect(isWebSearchUsable(settings(true, true))).toBe(true);
    expect(isWebSearchUsable(settings(false, true))).toBe(false);
    expect(isWebSearchUsable(settings(true, false))).toBe(false);
    expect(isWebSearchUsable({ ...settings(true, true), profiles: [] })).toBe(
      false
    );
  });
});

describe("web search settings", () => {
  const settings = {
    enabled: true,
    activeProviderId: "deepseek",
    perRunCallLimit: 20,
    profiles: [{ providerId: "deepseek", maxResults: 8, hasApiKey: false }]
  };

  it("describes every provider once and keeps them in the ID list", () => {
    expect(Object.keys(WEB_SEARCH_PROVIDERS).sort()).toEqual(
      [...WEB_SEARCH_PROVIDER_IDS].sort()
    );
  });

  it("lets a provider that reads pages say how long an address may be", () => {
    for (const descriptor of Object.values(WEB_SEARCH_PROVIDERS))
      if (descriptor.supportsFetch)
        expect(descriptor.fetchUrlMaxChars).toBeGreaterThan(0);
    expect(WEB_SEARCH_PROVIDERS.deepseek).toMatchObject({
      supportsFetch: true,
      fetchUrlMaxChars: 8192
    });
  });

  it("checks limits and provider uniqueness", () => {
    expect(WebSearchSettingsSchema.safeParse(settings).success).toBe(true);
    for (const bad of [
      { ...settings, perRunCallLimit: 0 },
      { ...settings, perRunCallLimit: 101 },
      { ...settings, activeProviderId: "unknown" },
      {
        ...settings,
        profiles: [{ providerId: "deepseek", maxResults: 21, hasApiKey: false }]
      },
      { ...settings, profiles: [...settings.profiles, ...settings.profiles] }
    ]) {
      expect(WebSearchSettingsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("trims keys in the input and rejects fields the client must not send", () => {
    const profile = { providerId: "deepseek", maxResults: 8 };
    const parsed = WebSearchSettingsInputSchema.parse({
      ...settings,
      profiles: [{ ...profile, apiKey: "  invalid-test-key  " }]
    });
    expect(parsed.profiles[0]).toEqual({
      ...profile,
      apiKey: "invalid-test-key"
    });
    for (const extra of [
      { hasApiKey: true },
      { keySource: { kind: "manual" } }
    ])
      expect(
        WebSearchSettingsInputSchema.safeParse({
          ...settings,
          profiles: [{ ...profile, ...extra }]
        }).success
      ).toBe(false);
  });

  it("rejects secret-bearing settings", () => {
    expect(
      WebSearchSettingsSchema.safeParse({ ...settings, apiKey: "x" }).success
    ).toBe(false);
    expect(
      WebSearchSettingsSchema.safeParse({
        ...settings,
        profiles: [{ ...settings.profiles[0], apiKey: "x" }]
      }).success
    ).toBe(false);
  });

  it("requires a key in the runtime config", () => {
    const runtime = {
      providerId: "deepseek",
      baseUrl: "https://search.example.test",
      apiKey: "invalid-test-key",
      maxResults: 8,
      perRunCallLimit: 20
    };
    expect(WebSearchRuntimeConfigSchema.safeParse(runtime).success).toBe(true);
    expect(
      WebSearchRuntimeConfigSchema.safeParse({ ...runtime, apiKey: "" }).success
    ).toBe(false);
  });
});

describe("webSearch commands", () => {
  function parse(type: string, payload: unknown) {
    return CommandEnvelopeSchema.safeParse(
      createEnvelope(type, payload, { id: "cmd_test" })
    );
  }

  it("accepts each command with its payload", () => {
    for (const [type, payload] of [
      ["webSearch.getSettings", {}],
      ["webSearch.setEnabled", { enabled: false }],
      ["webSearch.test", { providerId: "deepseek", query: "DeepWrite" }],
      ["webSearch.listKeyImportCandidates", { providerId: "deepseek" }],
      [
        "webSearch.importKey",
        { providerId: "deepseek", sourceModelId: "model_a" }
      ]
    ] as const) {
      expect(parse(type, payload).success, type).toBe(true);
    }
  });

  it("rejects unknown payload fields and providers", () => {
    expect(parse("webSearch.getSettings", { extra: 1 }).success).toBe(false);
    expect(parse("webSearch.setEnabled", { enabled: true, x: 1 }).success).toBe(
      false
    );
    expect(parse("webSearch.test", { providerId: "unknown" }).success).toBe(
      false
    );
    expect(
      parse("webSearch.test", { providerId: "deepseek", query: " " }).success
    ).toBe(false);
  });
});

describe("custom search endpoint validation", () => {
  it.each([
    "http://example.test",
    "https://user:password@example.test",
    "https://example.test?key=invalid",
    "file:///tmp/search"
  ])("rejects %s", async (baseUrl) => {
    const { WebSearchProfileInputSchema } = await import("./settings");
    expect(
      WebSearchProfileInputSchema.safeParse({
        providerId: "tavily",
        maxResults: 5,
        baseUrl
      }).success
    ).toBe(false);
  });
});

it("requires an endpoint for keyless search and still requires keys for paid providers", () => {
  const settings = (baseUrl?: string, hasApiKey = false) => ({
    enabled: true,
    activeProviderId: "searxng" as const,
    profiles: [
      { providerId: "searxng" as const, maxResults: 8, hasApiKey, baseUrl }
    ]
  });
  expect(isWebSearchUsable(settings())).toBe(false);
  expect(isWebSearchUsable(settings(undefined, true))).toBe(false);
  expect(isWebSearchUsable(settings("http://localhost:8888"))).toBe(true);
  expect(
    isWebSearchUsable({ ...settings("https://example.test"), enabled: false })
  ).toBe(false);
});

it("accepts loopback endpoints and allows empty runtime keys only for keyless providers", async () => {
  const { WebSearchBaseUrlSchema, WebSearchRuntimeConfigSchema } =
    await import("./settings");
  for (const endpoint of [
    "http://localhost:8888",
    "http://127.0.0.1:8888",
    "http://[::1]:8888",
    "https://example.test/search-api"
  ])
    expect(WebSearchBaseUrlSchema.safeParse(endpoint).success).toBe(true);
  const config = {
    providerId: "searxng",
    baseUrl: "http://localhost:8888",
    apiKey: "",
    maxResults: 8,
    perRunCallLimit: 20
  };
  expect(WebSearchRuntimeConfigSchema.safeParse(config).success).toBe(true);
  expect(
    WebSearchRuntimeConfigSchema.safeParse({ ...config, providerId: "serper" })
      .success
  ).toBe(false);
});
