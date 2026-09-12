import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const temporaryRoots: string[] = [];

function customModel(): ModelConfigInput {
  return {
    id: "custom-writer",
    label: "自定义写作模型",
    provider: "custom",
    modelId: "writer-v1",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1]
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

function createStore(root: string) {
  const catalog = {
    revision: "",
    enabled: false,
    message: "",
    manifestAvailable: false,
    canDeprecateMissingModels: false,
    defaultModelId: "",
    models: [],
    apiKeys: {}
  };
  const reader = {
    initialize: async () => undefined,
    getCatalog: async () => catalog
  };
  return new ModelConfigStore(root, {
    freeModelCatalog: reader,
    officialModelCatalog: reader
  });
}

describe("ModelConfigStore draft API keys", () => {
  it("persists and resolves an explicit portable tool schema profile", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-tool-schema-")
    );
    temporaryRoots.push(root);
    const store = createStore(root);
    const saved = await store.save({
      models: [
        {
          ...customModel(),
          toolSchemaProfile: "portable",
          apiKey: "sk-portable-test-only"
        }
      ],
      defaultModelId: "custom-writer"
    });

    expect(saved.models[0]).toMatchObject({
      id: "custom-writer",
      toolSchemaProfile: "portable"
    });
    await expect(store.resolve("custom-writer")).resolves.toMatchObject({
      toolSchemaProfile: "portable"
    });
  });

  it("persists custom context window and max output tokens into runtime config", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-capacity-")
    );
    temporaryRoots.push(root);
    const store = createStore(root);
    const saved = await store.save({
      models: [
        {
          ...customModel(),
          contextWindow: 32_000,
          maxTokens: 4_096,
          apiKey: "sk-capacity-test-only"
        }
      ],
      defaultModelId: "custom-writer"
    });

    expect(saved.models[0]).toMatchObject({
      id: "custom-writer",
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    await expect(store.resolve("custom-writer")).resolves.toMatchObject({
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    await expect(
      store.resolveDraft({
        ...customModel(),
        contextWindow: 16_000,
        maxTokens: 2_048
      })
    ).resolves.toMatchObject({
      contextWindow: 16_000,
      maxTokens: 2_048
    });
  });

  it("reuses a saved key when the draft key field is blank", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-draft-key-")
    );
    temporaryRoots.push(root);
    const store = createStore(root);
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-saved-test-only" }],
      defaultModelId: "custom-writer"
    });

    await expect(
      store.resolveDraftApiKey({ id: "custom-writer" })
    ).resolves.toBe("sk-saved-test-only");
    await expect(
      store.resolveDraftApiKey({
        id: "custom-writer",
        apiKey: "sk-typed-test-only"
      })
    ).resolves.toBe("sk-typed-test-only");
    await expect(
      store.resolveDraftApiKey({ id: "custom-writer", clearApiKey: true })
    ).resolves.toBe("");
  });
});
