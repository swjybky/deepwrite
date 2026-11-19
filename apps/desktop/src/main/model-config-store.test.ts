import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import {
  temporaryRoots,
  emptyCatalog,
  customModel
} from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const SITE_MODEL_ID = "deepwrite-site-official-writer";
const RETIRED_MODEL_ID = "retired-official-writer";
const encrypt = (key: string) => Buffer.from(key, "utf8").toString("base64");

function createStore(root: string): InstanceType<typeof ModelConfigStore> {
  return new ModelConfigStore(root, {
    freeModelCatalog: {
      initialize: async () => undefined,
      getCatalog: async () => emptyCatalog()
    }
  });
}

async function seedSettings(
  root: string,
  version: number,
  defaultModelId: string
) {
  const configDirectory = join(root, "config");
  await mkdir(configDirectory, { recursive: true });
  const encryptedApiKeys = {
    "deepwrite-official-token": encrypt("invalid-retired-shared-token"),
    [RETIRED_MODEL_ID]: encrypt("invalid-retired-model-key"),
    [SITE_MODEL_ID]: encrypt("invalid-site-model-key"),
    "deepwrite-site-official-disabled": encrypt("invalid-disabled-site-key"),
    "custom-writer": encrypt("invalid-custom-model-key")
  };
  await writeFile(
    join(configDirectory, "models.json"),
    JSON.stringify({
      version,
      defaultModelId,
      models: [
        {
          ...customModel(),
          id: RETIRED_MODEL_ID,
          managedBy: "deepwrite-official"
        },
        {
          ...customModel(),
          id: "deepwrite-site-official-disabled",
          enabled: false
        },
        { ...customModel(), id: SITE_MODEL_ID, enabled: true },
        customModel()
      ],
      disabledOfficialModelIds: [RETIRED_MODEL_ID],
      ...(version === 3 ? { encryptedApiKeys } : {})
    }),
    "utf8"
  );
  if (version !== 3) {
    await writeFile(
      join(configDirectory, "model-secrets.json"),
      JSON.stringify({ version: 1, encryptedApiKeys }),
      "utf8"
    );
  }
}

describe("ModelConfigStore retired official site migration", () => {
  it.each([
    [1, RETIRED_MODEL_ID],
    [2, RETIRED_MODEL_ID],
    [3, RETIRED_MODEL_ID],
    [1, SITE_MODEL_ID],
    [2, SITE_MODEL_ID],
    [3, SITE_MODEL_ID]
  ] as const)(
    "migrates v%s with default %s while retaining site and custom keys",
    async (version, defaultModelId) => {
      const root = await mkdtemp(join(tmpdir(), "deepwrite-model-retirement-"));
      temporaryRoots.push(root);
      await seedSettings(root, version, defaultModelId);
      const store = createStore(root);
      await store.initialize();

      const saved = await store.list();
      expect(saved.models.map((model) => model.id)).toEqual([
        "deepwrite-site-official-disabled",
        SITE_MODEL_ID,
        "custom-writer"
      ]);
      expect(saved.defaultModelId).toBe(SITE_MODEL_ID);
      expect(saved.models.every((model) => model.hasApiKey)).toBe(true);
      expect(saved.models[0]?.enabled).toBe(false);
      await expect(store.resolve(RETIRED_MODEL_ID)).rejects.toThrow(
        "所选模型不存在"
      );
      await expect(store.resolve(SITE_MODEL_ID)).resolves.toMatchObject({
        apiKey: "invalid-site-model-key"
      });
      await expect(store.resolve("custom-writer")).resolves.toMatchObject({
        apiKey: "invalid-custom-model-key"
      });

      const disk = JSON.parse(
        await readFile(join(root, "config", "models.json"), "utf8")
      ) as {
        version: number;
        encryptedApiKeys: Record<string, string>;
      };
      expect(disk.version).toBe(3);
      expect(disk).not.toHaveProperty("disabledOfficialModelIds");
      expect(Object.keys(disk.encryptedApiKeys)).toEqual([
        SITE_MODEL_ID,
        "deepwrite-site-official-disabled",
        "custom-writer"
      ]);

      await store.save({
        models: saved.models,
        defaultModelId: saved.defaultModelId
      });
      const restarted = createStore(root);
      await restarted.initialize();
      expect(await restarted.list()).toEqual(saved);
      await expect(restarted.resolve(SITE_MODEL_ID)).resolves.toMatchObject({
        apiKey: "invalid-site-model-key"
      });
    }
  );

  it("clears a retired-only default without creating an available model", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-retired-only-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "config"), { recursive: true });
    const retired = {
      ...customModel(),
      id: RETIRED_MODEL_ID,
      managedBy: "deepwrite-official"
    };
    await writeFile(
      join(root, "config", "models.json"),
      JSON.stringify({
        version: 3,
        models: [retired],
        defaultModelId: RETIRED_MODEL_ID,
        encryptedApiKeys: {
          "deepwrite-official-token": encrypt("invalid-retired-token")
        }
      }),
      "utf8"
    );

    const store = createStore(root);
    await store.initialize();
    expect(await store.list()).toMatchObject({
      models: [],
      defaultModelId: ""
    });
    await expect(store.resolve()).resolves.toBeUndefined();
    await expect(
      store.resolveDraft(retired as unknown as ModelConfigInput)
    ).rejects.toThrow();
  });
});

describe("ModelConfigStore disabled site models", () => {
  it.each([undefined, "invalid-disabled-site-key"])(
    "keeps a disabled-only catalog out of runtime selection across restart (key=%s)",
    async (apiKey) => {
      const root = await mkdtemp(join(tmpdir(), "deepwrite-model-disabled-"));
      temporaryRoots.push(root);
      const store = createStore(root);
      await store.save({
        models: [
          { ...customModel(), id: SITE_MODEL_ID, enabled: false, apiKey }
        ],
        defaultModelId: ""
      });
      await expect(store.resolve()).resolves.toBeUndefined();
      await expect(store.resolve(SITE_MODEL_ID)).resolves.toMatchObject({
        id: SITE_MODEL_ID,
        apiKey: apiKey ?? ""
      });

      const restarted = createStore(root);
      await restarted.initialize();
      expect((await restarted.list()).models).toHaveLength(1);
      await expect(restarted.resolve()).resolves.toBeUndefined();
      await expect(restarted.resolve(SITE_MODEL_ID)).resolves.toMatchObject({
        id: SITE_MODEL_ID,
        apiKey: apiKey ?? ""
      });
    }
  );

  it.each(["", SITE_MODEL_ID])(
    "falls back to the available custom model when the saved default is %s",
    async (defaultModelId) => {
      const root = await mkdtemp(join(tmpdir(), "deepwrite-model-fallback-"));
      temporaryRoots.push(root);
      const store = createStore(root);
      await store.save({
        models: [
          { ...customModel(), id: SITE_MODEL_ID, enabled: false },
          { ...customModel(), apiKey: "invalid-custom-fallback-key" }
        ],
        defaultModelId
      });
      await expect(store.resolve()).resolves.toMatchObject({
        id: "custom-writer",
        apiKey: "invalid-custom-fallback-key"
      });
    }
  );
});

describe("ModelConfigStore developer role fallback persistence", () => {
  it("persists supportsDeveloperRole=false only when the custom model has no explicit setting", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-dev-role-"));
    temporaryRoots.push(root);
    const store = createStore(root);
    await store.save({
      models: [
        customModel(),
        {
          ...customModel(),
          id: "explicit-true",
          supportsDeveloperRole: true
        }
      ],
      defaultModelId: "custom-writer"
    });

    const updated = await store.disableDeveloperRole("custom-writer");
    expect(
      updated?.models.find((model) => model.id === "custom-writer")
        ?.supportsDeveloperRole
    ).toBe(false);
    expect((await store.resolve("custom-writer"))?.supportsDeveloperRole).toBe(
      false
    );

    await expect(
      store.disableDeveloperRole("custom-writer")
    ).resolves.toBeUndefined();
    await expect(
      store.disableDeveloperRole("explicit-true")
    ).resolves.toBeUndefined();
    expect((await store.resolve("explicit-true"))?.supportsDeveloperRole).toBe(
      true
    );
    await expect(
      store.disableDeveloperRole("missing-model")
    ).resolves.toBeUndefined();
  });
});
