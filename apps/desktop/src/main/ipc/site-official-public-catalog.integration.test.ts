import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommandEnvelopeSchema } from "@deepwrite/contracts";
import {
  refreshSiteOfficialModels,
  setSiteOfficialModelEnabled
} from "../../preload/site-official-models-api";
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
});
