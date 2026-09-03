import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const {
  DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
  clearDeepWriteSiteOfficialModelInput,
  saveDeepWriteSiteOfficialModelInput
} = await import("./deepwrite-site-official-model-config");

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("DeepWrite site official model storage", () => {
  it("registers the model only after a user key is encrypted and removes both together", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-site-model-store-"));
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => ({
        revision: "",
        enabled: false,
        message: "",
        manifestAvailable: false,
        canDeprecateMissingModels: false,
        defaultModelId: "",
        models: [],
        apiKeys: {}
      })
    };
    const officialModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => ({
        revision: "",
        enabled: false,
        message: "",
        manifestAvailable: false,
        defaultModelId: "",
        models: []
      })
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog,
      officialModelCatalog
    });
    const initial = await store.list();
    expect(initial.models).toEqual([]);

    const plaintextKey = "dw_sk_test_only_invalid";
    const saved = await store.save(
      saveDeepWriteSiteOfficialModelInput(
        initial,
        plaintextKey,
        {
          models: [{ id: "deepseek-v4-flash" }, { id: "gemini-3.7-flash" }],
          googleModels: [{ id: "gemini-3.7-flash" }]
        },
        "https://gateway.example.test"
      )
    );
    expect(saved.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: DEEPWRITE_SITE_OFFICIAL_MODEL_ID,
          hasApiKey: true
        }),
        expect.objectContaining({
          id: "deepwrite-site-official-gemini-3.7-flash",
          hasApiKey: true
        })
      ])
    );
    expect(saved.models).toHaveLength(2);
    expect(saved.models[0]).not.toHaveProperty("apiKey");
    expect(saved.models[1]).not.toHaveProperty("apiKey");
    await expect(
      store.resolve(DEEPWRITE_SITE_OFFICIAL_MODEL_ID)
    ).resolves.toMatchObject({
      apiKey: plaintextKey,
      baseUrl: "https://gateway.example.test/v1"
    });
    await expect(
      store.resolve("deepwrite-site-official-gemini-3.7-flash")
    ).resolves.toMatchObject({
      api: "google-generative-ai",
      apiKey: plaintextKey,
      baseUrl: "https://gateway.example.test/v1beta"
    });

    const settingsFile = await readFile(
      join(root, "config", "models.json"),
      "utf8"
    );
    const secretsFile = await readFile(
      join(root, "config", "model-secrets.json"),
      "utf8"
    );
    expect(settingsFile).not.toContain(plaintextKey);
    expect(secretsFile).not.toContain(plaintextKey);

    const cleared = await store.save(
      clearDeepWriteSiteOfficialModelInput(saved)
    );
    expect(cleared.models).toEqual([]);
    await expect(
      store.resolve(DEEPWRITE_SITE_OFFICIAL_MODEL_ID)
    ).rejects.toThrow("所选模型不存在");
  });
});
