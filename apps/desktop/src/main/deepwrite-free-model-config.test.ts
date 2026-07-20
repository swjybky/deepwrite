import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEPWRITE_FREE_MODEL_REFRESH_INTERVAL_MS,
  DeepWriteFreeModelCatalogStore,
  parseDeepWriteFreeModelManifest
} from "./deepwrite-free-model-config";

const temporaryRoots: string[] = [];

function manifest(modelId = "openrouter/free"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: "2026-07-20.1",
    minAppVersion: "1.0.0",
    status: { enabled: true, message: "" },
    models: [
      {
        id: "deepwrite-free-writing",
        label: "DeepWrite 免费模型",
        provider: "openrouter",
        modelId,
        api: "openai-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
        temperatureOptions: [0.1, 0.7, 1],
        enabled: true,
        sort: 10
      }
    ],
    defaultModelId: "deepwrite-free-writing"
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("DeepWriteFreeModelCatalogStore", () => {
  it("refreshes at startup and again after one day", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-free-models-"));
    temporaryRoots.push(root);
    let now = 1_000;
    let modelId = "vendor/writer-v1:free";
    let requests = 0;
    const store = new DeepWriteFreeModelCatalogStore(root, {
      appVersion: "1.0.0",
      now: () => now,
      fetcher: async () => {
        requests += 1;
        return new Response(JSON.stringify(manifest(modelId)));
      }
    });

    await store.initialize();
    expect((await store.getCatalog()).models[0]?.modelId).toBe("vendor/writer-v1:free");
    expect(requests).toBe(1);

    modelId = "vendor/writer-v2:free";
    now += DEEPWRITE_FREE_MODEL_REFRESH_INTERVAL_MS - 1;
    expect((await store.getCatalog()).models[0]?.modelId).toBe("vendor/writer-v1:free");
    expect(requests).toBe(1);

    now += 1;
    expect((await store.getCatalog()).models[0]?.modelId).toBe("vendor/writer-v2:free");
    expect(requests).toBe(2);
  });

  it("keeps the last validated cache when a later startup cannot reach Gitee", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-free-models-cache-"));
    temporaryRoots.push(root);
    const first = new DeepWriteFreeModelCatalogStore(root, {
      appVersion: "1.0.0",
      fetcher: async () => new Response(JSON.stringify(manifest("vendor/cached:free")))
    });
    await first.initialize();

    const offline = new DeepWriteFreeModelCatalogStore(root, {
      appVersion: "1.0.0",
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    await offline.initialize();

    expect((await offline.getCatalog()).models[0]?.modelId).toBe("vendor/cached:free");
  });

  it("rejects redirected endpoints, embedded keys, and paid model ids", () => {
    const redirected = manifest();
    (redirected.models as Array<Record<string, unknown>>)[0]!.baseUrl =
      "https://example.invalid/v1";
    expect(() => parseDeepWriteFreeModelManifest(redirected, "1.0.0")).toThrow(
      /固定的 OpenRouter API 地址/u
    );

    const withKey = manifest();
    (withKey.models as Array<Record<string, unknown>>)[0]!.apiKey = "remote-secret";
    expect(() => parseDeepWriteFreeModelManifest(withKey, "1.0.0")).toThrow(
      /不得包含 API Key/u
    );

    expect(() =>
      parseDeepWriteFreeModelManifest(manifest("vendor/paid-model"), "1.0.0")
    ).toThrow(/免费模型 ID/u);
  });
});
