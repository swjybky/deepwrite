import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  temporaryRoots,
  emptyCatalog,
  customModel,
  officialModel,
  officialCatalog
} from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

describe("ModelConfigStore official models", () => {
  it("encrypts one official token, injects immutable models first, and removes them with the token", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-model-store-")
    );
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => emptyCatalog()
    };
    const remoteOfficialCatalog = officialCatalog();
    const officialModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(remoteOfficialCatalog),
      refreshCatalog: async () => structuredClone(remoteOfficialCatalog)
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog,
      officialModelCatalog
    });
    await store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });

    const saved = await store.saveOfficialToken("sk-official-test-only");
    expect(saved.deepwriteOfficialTokenConfigured).toBe(true);
    expect(saved.models.map((model) => model.id)).toEqual([
      "deepwrite-deepseek-v4-flash",
      "custom-writer"
    ]);
    expect(saved.defaultModelId).toBe("custom-writer");
    expect(saved.models[0]).toMatchObject({
      label: "官方模型-DeepSeekFlash正式版本",
      modelId: "deepseek-v4-flash-202605",
      baseUrl: "https://official.example.test/v1",
      supportsDeveloperRole: false,
      hasApiKey: true,
      managedBy: "deepwrite-official"
    });

    const resolved = await store.resolve("deepwrite-deepseek-v4-flash");
    expect(resolved).toMatchObject({
      modelId: "deepseek-v4-flash-202605",
      supportsDeveloperRole: false,
      apiKey: "sk-official-test-only"
    });
    const resaved = await store.save({
      models: [
        customModel(),
        {
          ...saved.models[0]!,
          label: "不应保存的名称",
          baseUrl: "https://invalid.example.test/v1"
        }
      ],
      defaultModelId: "deepwrite-deepseek-v4-flash"
    });
    expect(resaved.models[0]).toMatchObject({
      label: "官方模型-DeepSeekFlash正式版本",
      baseUrl: "https://official.example.test/v1"
    });
    expect(resaved.defaultModelId).toBe("deepwrite-deepseek-v4-flash");
    const secrets = await readFile(join(root, "config", "models.json"), "utf8");
    expect(secrets).not.toContain("sk-official-test-only");

    const cleared = await store.clearOfficialToken();
    expect(cleared.deepwriteOfficialTokenConfigured).toBe(false);
    expect(cleared.models.map((model) => model.id)).toEqual(["custom-writer"]);
    expect(cleared.defaultModelId).toBe("custom-writer");
    expect(cleared.deepwriteOfficialModels?.[0]).toMatchObject({
      modelId: "deepseek-v4-flash-202605",
      hasApiKey: false
    });
  });

  it("replaces the read-only official entries when the refreshed remote catalog changes", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-refresh-store-")
    );
    temporaryRoots.push(root);
    const remoteOfficialCatalog = officialCatalog();
    let refreshCount = 0;
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(remoteOfficialCatalog),
        refreshCatalog: async () => {
          refreshCount += 1;
          return structuredClone(remoteOfficialCatalog);
        }
      }
    });
    await store.saveOfficialToken("sk-official-refresh-test");
    await store.save({
      models: [officialModel(), customModel()],
      defaultModelId: "deepwrite-deepseek-v4-flash"
    });

    remoteOfficialCatalog.revision = "remote-v2";
    remoteOfficialCatalog.models = [
      officialModel({
        id: "deepwrite-deepseek-v4-flash-next",
        label: "远程更新后的官方模型",
        modelId: "deepseek-v4-flash-next"
      })
    ];
    remoteOfficialCatalog.defaultModelId = "deepwrite-deepseek-v4-flash-next";

    const refreshed = await store.refreshOfficialModels();
    expect(refreshCount).toBe(1);
    expect(refreshed.models.map((model) => model.id)).toEqual([
      "deepwrite-deepseek-v4-flash-next",
      "custom-writer"
    ]);
    expect(refreshed.models[0]?.label).toBe("远程更新后的官方模型");
    expect(refreshed.defaultModelId).toBe("deepwrite-deepseek-v4-flash-next");
  });

  it("persists per-model enablement and exposes only enabled official models in model settings", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-enabled-store-")
    );
    temporaryRoots.push(root);
    const first = officialModel();
    const second = officialModel({
      id: "deepwrite-second-official",
      label: "第二个官方模型",
      modelId: "second-official"
    });
    const unavailable = officialModel({
      id: "deepwrite-unavailable-official",
      label: "暂不可用官方模型",
      modelId: "unavailable-official",
      status: 1
    });
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([first, second, unavailable])
      }
    });

    const initial = await store.saveOfficialToken("sk-official-enabled-test");
    expect(initial.deepwriteOfficialModels?.map((model) => model.id)).toEqual([
      first.id,
      second.id,
      unavailable.id
    ]);
    expect(initial.deepwriteOfficialEnabledModelIds).toEqual([
      first.id,
      second.id
    ]);
    expect(initial.models.map((model) => model.id)).toEqual([
      first.id,
      second.id
    ]);
    await expect(
      store.setOfficialModelEnabled(unavailable.id, true)
    ).rejects.toThrow(/当前不可用/u);
    const disabled = await store.setOfficialModelEnabled(first.id, false);
    expect(disabled.deepwriteOfficialEnabledModelIds).toEqual([second.id]);
    expect(disabled.models.map((model) => model.id)).toEqual([second.id]);

    await store.save({
      models: disabled.models,
      defaultModelId: second.id
    });

    const reloaded = await store.list();
    expect(reloaded.models.map((model) => model.id)).toEqual([second.id]);
    expect(reloaded.defaultModelId).toBe(second.id);

    const restartedStore = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([first, second, unavailable])
      }
    });
    const afterRestart = await restartedStore.list();
    expect(afterRestart.defaultModelId).toBe(second.id);
    expect(afterRestart.models.map((model) => model.id)).toEqual([second.id]);

    const enabled = await store.setOfficialModelEnabled(first.id, true);
    expect(enabled.models.map((model) => model.id)).toEqual([
      first.id,
      second.id
    ]);
  });
});
