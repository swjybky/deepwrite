import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  temporaryRoots,
  managedModel,
  customModel,
  type DeepWriteFreeModelCatalog
} from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

describe("ModelConfigStore managed free models", () => {
  it("stores a remotely configured key locally and resolves through the latest catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-"));
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "deepwrite-free-writing": "sk-test-only" }
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    const initial = await store.list();
    expect(initial.models).toEqual([]);
    expect(initial.deepwriteFreeEnabledModelIds).toEqual([]);

    const saved = await store.setFreeModelEnabled(
      "deepwrite-free-writing",
      true
    );
    expect(saved.models[0]).toMatchObject({
      modelId: "vendor/writer-v1",
      hasApiKey: true,
      managedBy: "deepwrite-free"
    });
    expect(saved.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(saved.models[0]).not.toHaveProperty("apiKey");

    catalog.revision = "v2";
    catalog.models = [
      managedModel("vendor/writer-v2", {
        provider: "deepseek",
        api: "openai-responses",
        baseUrl: "https://example.invalid/v1"
      })
    ];
    const resolved = await store.resolve("deepwrite-free-writing");
    expect(resolved).toMatchObject({
      modelId: "vendor/writer-v2",
      provider: "deepseek",
      api: "openai-responses",
      baseUrl: "https://example.invalid/v1"
    });
    expect(resolved?.apiKey).toBe("sk-test-only");
    const secrets = await readFile(join(root, "config", "models.json"), "utf8");
    expect(secrets).not.toContain("sk-test-only");

    const listed = await store.list();
    expect(listed.models[0]?.modelId).toBe("vendor/writer-v2");
    expect(listed.deepwriteFreeModels?.[0]?.hasApiKey).toBe(true);
    expect(listed.deepwriteFreeModels?.[0]).not.toHaveProperty("apiKey");
  });

  it("resolves a remotely configured model that is not an OpenRouter free id", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-paid-"));
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async (): Promise<DeepWriteFreeModelCatalog> => ({
        revision: "v1",
        enabled: true,
        message: "",
        manifestAvailable: true,
        canDeprecateMissingModels: true,
        defaultModelId: "deepwrite-free-writing",
        models: [
          managedModel("vendor/paid-model", {
            provider: "deepseek",
            baseUrl: "https://example.invalid/v1"
          })
        ],
        apiKeys: {}
      })
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    await expect(
      store.resolveDraft(managedModel("vendor/paid-model"))
    ).resolves.toMatchObject({
      modelId: "vendor/paid-model",
      provider: "deepseek",
      baseUrl: "https://example.invalid/v1",
      managedBy: "deepwrite-free"
    });
  });

  it("migrates v1 managed models as enabled into the atomic v3 layout", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-v1-")
    );
    temporaryRoots.push(root);
    const configDirectory = join(root, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "models.json"),
      `${JSON.stringify({
        version: 1,
        defaultModelId: "deepwrite-free-writing",
        models: [managedModel("vendor/writer-v1"), customModel()],
        disabledOfficialModelIds: []
      })}\n`,
      "utf8"
    );
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog)
      }
    });

    const settings = await store.list();
    expect(settings.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(settings.models.map((model) => model.id)).toEqual([
      "deepwrite-free-writing",
      "custom-writer"
    ]);
    expect(settings.defaultModelId).toBe("deepwrite-free-writing");

    const disk = JSON.parse(
      await readFile(join(configDirectory, "models.json"), "utf8")
    ) as Record<string, unknown>;
    expect(disk).toMatchObject({
      version: 3,
      enabledFreeModelIds: ["deepwrite-free-writing"]
    });
    expect(disk).toHaveProperty("knownFreeModels");
    expect(JSON.stringify(disk)).not.toContain("apiKey");
  });
});
