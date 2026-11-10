import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_IDS
} from "@deepwrite/contracts";
import {
  FIXED_NOW,
  SEARCH_KEY,
  settingsInput,
  setup,
  testSecureStorage
} from "./web-search-test-support";

const CONFIG = "config/web-search.json";

describe("WebSearchService settings", () => {
  it("starts enabled with DeepSeek defaults and no key", async () => {
    const { service } = await setup();
    expect(await service.getSettings()).toEqual({
      enabled: true,
      activeProviderId: "deepseek",
      perRunCallLimit: 20,
      profiles: WEB_SEARCH_PROVIDER_IDS.map((providerId) => ({
        providerId,
        maxResults: 8,
        hasApiKey: false
      }))
    });
    expect(await service.resolveRuntime()).toBeUndefined();
  });

  it("saves the key encrypted and reads it back after a restart", async () => {
    const { root, service, create } = await setup();
    const saved = await service.saveSettings(
      settingsInput({
        perRunCallLimit: 12,
        profiles: [
          { providerId: "deepseek", maxResults: 5, apiKey: SEARCH_KEY }
        ]
      })
    );
    expect(saved.profiles[0]).toEqual({
      providerId: "deepseek",
      maxResults: 5,
      hasApiKey: true,
      keySource: { kind: "manual" }
    });
    const file = await readFile(join(root, CONFIG), "utf8");
    expect(file).not.toContain(SEARCH_KEY);
    expect(file).not.toContain("apiKey");
    const reopened = create();
    expect(await reopened.getSettings()).toEqual(saved);
    expect(await reopened.resolveRuntime()).toEqual({
      providerId: "deepseek",
      baseUrl: WEB_SEARCH_PROVIDERS.deepseek.defaultBaseUrl,
      apiKey: SEARCH_KEY,
      maxResults: 5,
      perRunCallLimit: 12
    });
  });

  it("keeps the saved key on a blank key and drops it when cleared", async () => {
    const { service } = await setup();
    await service.saveSettings(settingsInput());
    const kept = await service.saveSettings(
      settingsInput({
        profiles: [{ providerId: "deepseek", maxResults: 6, apiKey: "  " }]
      })
    );
    expect(kept.profiles[0]).toMatchObject({
      maxResults: 6,
      hasApiKey: true,
      keySource: { kind: "manual" }
    });
    expect((await service.resolveRuntime())?.apiKey).toBe(SEARCH_KEY);
    const cleared = await service.saveSettings(
      settingsInput({
        profiles: [{ providerId: "deepseek", maxResults: 6, clearApiKey: true }]
      })
    );
    expect(cleared.profiles[0]).toEqual({
      providerId: "deepseek",
      maxResults: 6,
      hasApiKey: false
    });
    expect(await service.resolveRuntime()).toBeUndefined();
  });

  it("leaves providers missing from the input untouched", async () => {
    const { service } = await setup();
    await service.saveSettings(settingsInput());
    const next = await service.saveSettings(
      settingsInput({ enabled: false, profiles: [] })
    );
    expect(next.enabled).toBe(false);
    expect(next.profiles[0]).toMatchObject({ hasApiKey: true });
  });

  it("rejects invalid input without touching the file", async () => {
    const { root, service } = await setup();
    await service.saveSettings(settingsInput());
    const before = await readFile(join(root, CONFIG), "utf8");
    await expect(
      service.saveSettings(settingsInput({ perRunCallLimit: 0 }))
    ).rejects.toThrow("联网搜索配置无效");
    expect(await readFile(join(root, CONFIG), "utf8")).toBe(before);
  });

  it("refuses to save a key while secure storage is unavailable", async () => {
    const { root, service } = await setup({
      secureStorage: {
        ...testSecureStorage,
        isEncryptionAvailable: () => false
      }
    });
    await expect(service.saveSettings(settingsInput())).rejects.toThrow(
      "系统安全存储不可用"
    );
    await expect(readFile(join(root, CONFIG))).rejects.toThrow();
  });

  it("toggles the switch without touching the key", async () => {
    const { service } = await setup();
    await service.saveSettings(settingsInput());
    expect((await service.setEnabled(false)).enabled).toBe(false);
    expect(await service.resolveRuntime()).toBeUndefined();
    const enabled = await service.setEnabled(true);
    expect(enabled.profiles[0]).toMatchObject({ hasApiKey: true });
    expect((await service.resolveRuntime())?.apiKey).toBe(SEARCH_KEY);
  });

  it("serializes concurrent changes so none is lost", async () => {
    const { service } = await setup();
    await service.saveSettings(settingsInput());
    await Promise.all([
      service.setEnabled(false),
      service.saveSettings(
        settingsInput({
          enabled: false,
          perRunCallLimit: 33,
          profiles: [{ providerId: "deepseek", maxResults: 9 }]
        })
      ),
      service.setEnabled(false)
    ]);
    expect(await service.getSettings()).toMatchObject({
      enabled: false,
      perRunCallLimit: 33,
      profiles: expect.arrayContaining([
        expect.objectContaining({ maxResults: 9, hasApiKey: true })
      ])
    });
  });
});

describe("WebSearchService runtime resolution", () => {
  it("never stops a run on an unreadable file or key, nor logs the key", async () => {
    const { root, service, warnings } = await setup();
    await service.saveSettings(settingsInput());
    const file = join(root, CONFIG);

    await writeFile(file, `{ not json ${SEARCH_KEY}`);
    expect(await service.resolveRuntime()).toBeUndefined();
    await expect(service.getSettings()).rejects.toThrow("损坏");
    await expect(service.saveSettings(settingsInput())).rejects.toThrow("损坏");
    expect(await readFile(file, "utf8")).toBe(`{ not json ${SEARCH_KEY}`);

    const broken = await setup({
      secureStorage: {
        ...testSecureStorage,
        decryptString: () => {
          throw new Error(`native failure ${SEARCH_KEY}`);
        }
      }
    });
    await broken.service.saveSettings(settingsInput());
    expect(await broken.service.resolveRuntime()).toBeUndefined();

    expect(warnings.length + broken.warnings.length).toBe(2);
    expect([...warnings, ...broken.warnings].join("\n")).not.toContain(
      SEARCH_KEY
    );
  });

  it("rejects stored data with unknown providers instead of trusting it", async () => {
    const { root, service } = await setup();
    await service.saveSettings(settingsInput());
    const file = join(root, CONFIG);
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.settings.activeProviderId = "unknown";
    await writeFile(file, JSON.stringify(stored));
    expect(await service.resolveRuntime()).toBeUndefined();
    await expect(service.getSettings()).rejects.toThrow("损坏");
  });
});

describe("WebSearchService test search", () => {
  const samples = [1, 2, 3, 4].map((index) => ({
    title: `结果 ${index}`,
    url: `https://example.test/${index}`
  }));

  it("tests with the typed key before the saved one and caps the samples", async () => {
    const tester = vi.fn(async () => ({ resultCount: 10, samples }));
    let clock = FIXED_NOW;
    const { service } = await setup({
      tester,
      now: () => (clock += 600)
    });
    await service.saveSettings(settingsInput());
    const result = await service.test({
      providerId: "deepseek",
      apiKey: "invalid-test-typed-key"
    });
    expect(tester).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "deepseek",
        baseUrl: WEB_SEARCH_PROVIDERS.deepseek.defaultBaseUrl,
        apiKey: "invalid-test-typed-key",
        query: "DeepWrite",
        signal: expect.any(AbortSignal)
      })
    );
    expect(result.samples).toHaveLength(3);
    expect(result).toMatchObject({ resultCount: 10, elapsedMs: 600 });

    await service.test({ providerId: "deepseek", query: "改写测试" });
    expect(tester).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: SEARCH_KEY, query: "改写测试" })
    );
  });

  it("asks for a key when none is typed or saved", async () => {
    const tester = vi.fn(async () => ({ resultCount: 0, samples: [] }));
    const { service } = await setup({ tester });
    await expect(service.test({ providerId: "deepseek" })).rejects.toThrow(
      "请先填写联网搜索 API Key"
    );
    expect(tester).not.toHaveBeenCalled();
  });

  it("reports that testing is unavailable until a tester is wired", async () => {
    const { service } = await setup();
    await expect(
      service.test({ providerId: "deepseek", apiKey: SEARCH_KEY })
    ).rejects.toThrow("联网搜索测试暂不可用");
  });
});

describe("search provider profiles", () => {
  it("keeps independent encrypted keys and endpoints across switching and restarting", async () => {
    const tester = vi.fn(async () => ({ resultCount: 0, samples: [] }));
    const { service, create, root } = await setup({ tester });
    for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
      await service.saveSettings(
        settingsInput({
          activeProviderId: providerId,
          profiles: [
            {
              providerId,
              maxResults: 4,
              apiKey: `invalid-${providerId}-key`,
              baseUrl: `https://${providerId}.example.test/gateway`
            }
          ]
        })
      );
    }
    const reopened = create();
    for (const providerId of WEB_SEARCH_PROVIDER_IDS) {
      await reopened.saveSettings(
        settingsInput({ activeProviderId: providerId, profiles: [] })
      );
      expect(await reopened.resolveRuntime()).toMatchObject({
        providerId,
        apiKey: `invalid-${providerId}-key`,
        baseUrl: `https://${providerId}.example.test/gateway`,
        maxResults: 4
      });
      await service.test({ providerId });
      expect(tester).toHaveBeenLastCalledWith(
        expect.objectContaining({
          providerId,
          baseUrl: `https://${providerId}.example.test/gateway`
        })
      );
    }
    await service.test({
      providerId: "tavily",
      baseUrl: "https://typed.example.test"
    });
    expect(tester).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: "https://typed.example.test" })
    );
    const file = await readFile(join(root, CONFIG), "utf8");
    for (const id of WEB_SEARCH_PROVIDER_IDS)
      expect(file).not.toContain(`invalid-${id}-key`);
  });
});

it("enables a keyless SearXNG instance after an endpoint is configured and survives reopening", async () => {
  const tester = vi.fn(async () => ({ resultCount: 0, samples: [] }));
  const { service, create } = await setup({ tester });
  await service.saveSettings(
    settingsInput({ activeProviderId: "searxng", profiles: [] })
  );
  expect(await service.resolveRuntime()).toBeUndefined();
  await expect(service.test({ providerId: "searxng" })).rejects.toThrow(
    "接口地址"
  );
  await service.saveSettings(
    settingsInput({
      activeProviderId: "searxng",
      profiles: [
        {
          providerId: "searxng",
          maxResults: 8,
          baseUrl: "http://127.0.0.1:8888"
        }
      ]
    })
  );
  const reopened = create();
  expect(await reopened.resolveRuntime()).toMatchObject({
    providerId: "searxng",
    baseUrl: "http://127.0.0.1:8888",
    apiKey: ""
  });
  await reopened.test({ providerId: "searxng" });
  expect(tester).toHaveBeenLastCalledWith(
    expect.objectContaining({ baseUrl: "http://127.0.0.1:8888", apiKey: "" })
  );
  await reopened.setEnabled(false);
  expect(await reopened.resolveRuntime()).toBeUndefined();
});
