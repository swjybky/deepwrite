import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const temporaryRoots: string[] = [];

function managedModel(modelId: string): ModelConfigInput {
  return {
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
    managedBy: "deepwrite-free"
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("ModelConfigStore managed free models", () => {
  it("keeps the configured key in Main and resolves saved models through the latest catalog", async () => {
    vi.stubEnv("DEEPWRITE_FREE_OPENROUTER_API_KEY", "sk-or-v1-test-only");
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-"));
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1:free")]
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    const saved = await store.save({
      models: [managedModel("vendor/writer-v1:free")],
      defaultModelId: "deepwrite-free-writing"
    });
    expect(saved.models[0]).toMatchObject({
      modelId: "vendor/writer-v1:free",
      hasApiKey: true,
      managedBy: "deepwrite-free"
    });
    expect(saved.models[0]).not.toHaveProperty("apiKey");

    catalog.revision = "v2";
    catalog.models = [managedModel("vendor/writer-v2:free")];
    const resolved = await store.resolve("deepwrite-free-writing");
    expect(resolved).toMatchObject({
      modelId: "vendor/writer-v2:free",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1"
    });
    expect(resolved?.apiKey).toMatch(/^sk-or-v1-/u);

    const listed = await store.list();
    expect(listed.models[0]?.modelId).toBe("vendor/writer-v2:free");
    expect(listed.deepwriteFreeModels?.[0]?.hasApiKey).toBe(true);
    expect(listed.deepwriteFreeModels?.[0]).not.toHaveProperty("apiKey");
  });

  it("does not allow the embedded key to target a paid model", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-paid-"));
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async (): Promise<DeepWriteFreeModelCatalog> => ({
        revision: "",
        enabled: false,
        message: "",
        manifestAvailable: false,
        defaultModelId: "",
        models: []
      })
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    await expect(
      store.resolveDraft(managedModel("vendor/paid-model"))
    ).rejects.toThrow(/免费模型 ID/u);
  });
});
