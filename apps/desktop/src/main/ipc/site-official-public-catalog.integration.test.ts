import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  type ModelConfigInput
} from "@deepwrite/contracts";
import {
  refreshSiteOfficialModels,
  setSiteOfficialModelEnabled
} from "../../preload/site-official-models-api";
import {
  saveDeepWriteSiteOfficialModelInput,
  setDeepWriteSiteOfficialModelEnabledInput
} from "../deepwrite-site-official-model-config";
import {
  listRemoteModels,
  type ListRemoteModelsInput
} from "../list-remote-models";
import { ModelConfigStore } from "../model-config-store";
import {
  emptyCatalog,
  temporaryRoots
} from "../model-config-store.test-support";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({
  ipcRenderer: { invoke },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));
vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test",
  deepWritePublicDataUrl: (filename: string) =>
    `https://gateway.example.test/${filename}`,
  deepWritePublicDataHeaders: (headers: Record<string, string>) => headers
}));

describe("public official-site catalog through Main, preload and storage", () => {
  it("loads every protocol without a key, persists previews and prevents activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-public-site-models-"));
    temporaryRoots.push(root);
    const options = {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      }
    };
    const store = new ModelConfigStore(root, options);
    const resolveKey = vi.spyOn(store, "resolveDraftApiKey");
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.example.test/api/v1/public/models");
      const headers = new Headers(init?.headers);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("x-goog-api-key")).toBe(false);
      return Response.json({
        object: "list",
        data: [
          {
            id: "writer",
            sort: 0,
            api: "openai-responses",
            description: "写作模型",
            input: 1.25,
            output: 2.5,
            cache: 0.25
          },
          {
            id: "native",
            sort: 10,
            api: "google-generative-ai",
            label: "Native Model"
          }
        ]
      });
    });
    const ctx = {
      requireModelConfigStore: () => store,
      requireModelUsageStore: () => ({
        syncConfiguredModels: async () => undefined
      }),
      listRemoteModels: (input: ListRemoteModelsInput) =>
        listRemoteModels(input, fetcher)
    } as unknown as ModelCommandContext;
    invoke.mockImplementation(async (_channel, raw) =>
      handleModelCommands(ctx, CommandEnvelopeSchema.parse(raw))
    );
    const settings = await refreshSiteOfficialModels();
    expect(settings.defaultModelId).toBe("");
    expect(settings.models.map((model) => model.modelId)).toEqual([
      "writer",
      "native"
    ]);
    expect(settings.models).toHaveLength(2);
    expect(
      settings.models.every(
        (model) => !model.hasApiKey && model.enabled === false
      )
    ).toBe(true);
    const writer = settings.models.find((model) => model.modelId === "writer")!;
    const native = settings.models.find((model) => model.modelId === "native")!;
    expect(writer).toMatchObject({
      api: "openai-responses",
      description: "写作模型",
      input: 1.25,
      output: 2.5,
      cache: 0.25
    });
    expect(native).toMatchObject({
      api: "google-generative-ai",
      baseUrl: "https://gateway.example.test/v1beta"
    });
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await new ModelConfigStore(root, options).list()).models).toEqual(
      settings.models
    );
    await expect(setSiteOfficialModelEnabled(writer.id, true)).rejects.toThrow(
      "请先添加新官方小站模型密钥"
    );
  });

  it("syncs listed/delisted official models with no-store, preserves custom models/default/disabled flags, and recovers from failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-site-refresh-sync-"));
    temporaryRoots.push(root);
    const options = {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      }
    };
    const store = new ModelConfigStore(root, options);
    const customModel: ModelConfigInput = {
      id: "custom-writer",
      label: "Custom Writer",
      provider: "openai",
      modelId: "gpt-custom",
      api: "openai-completions",
      baseUrl: "https://models.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low"],
      temperatureOptions: [0.1, 0.7, 1],
      apiKey: "sk-custom-test-invalid"
    };
    const seeded = await store.save({
      defaultModelId: customModel.id,
      models: [customModel]
    });
    const withSite = await store.save(
      saveDeepWriteSiteOfficialModelInput(
        seeded,
        "dw_sk_test_only_invalid",
        {
          models: [
            { id: "model-a", sort: 1 },
            { id: "model-b", sort: 2 },
            { id: "model-c", sort: 3 }
          ],
          googleModels: []
        },
        "https://gateway.example.test"
      )
    );
    await store.save(
      setDeepWriteSiteOfficialModelEnabledInput(
        withSite,
        "deepwrite-site-official-model-c",
        false
      )
    );

    const fetcher = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(async (url, init) => {
        expect(url).toBe("https://gateway.example.test/api/v1/public/models");
        expect(init?.cache).toBe("no-store");
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        return Response.json({
          object: "list",
          data: [
            { id: "model-a", sort: 1 },
            { id: "model-d", sort: 2, label: "Model D" },
            { id: "model-c", sort: 3 }
          ]
        });
      })
      .mockImplementationOnce(
        async () => new Response("bad gateway", { status: 502 })
      )
      .mockImplementationOnce(async (_url, init) => {
        expect(init?.cache).toBe("no-store");
        return Response.json({
          object: "list",
          data: [{ id: "model-e", sort: 1, label: "Model E" }]
        });
      });

    const ctx = {
      requireModelConfigStore: () => store,
      requireModelUsageStore: () => ({
        syncConfiguredModels: async () => undefined
      }),
      listRemoteModels: (input: ListRemoteModelsInput) =>
        listRemoteModels(input, fetcher)
    } as unknown as ModelCommandContext;
    invoke.mockImplementation(async (_channel, raw) =>
      handleModelCommands(ctx, CommandEnvelopeSchema.parse(raw))
    );

    const first = await refreshSiteOfficialModels();
    expect(first.defaultModelId).toBe(customModel.id);
    expect(first.models.map((m) => [m.id, m.enabled, m.hasApiKey])).toEqual([
      [customModel.id, undefined, true],
      ["deepwrite-site-official-model-a", true, true],
      ["deepwrite-site-official-model-d", true, true],
      ["deepwrite-site-official-model-c", false, true]
    ]);

    await expect(refreshSiteOfficialModels()).rejects.toThrow("HTTP 502");
    const afterFailure = await store.list();
    expect(afterFailure.models.map((m) => m.id)).toEqual(
      first.models.map((m) => m.id)
    );

    const retried = await refreshSiteOfficialModels();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(retried.defaultModelId).toBe(customModel.id);
    expect(retried.models.map((m) => m.id)).toEqual([
      customModel.id,
      "deepwrite-site-official-model-e"
    ]);
  });
});
