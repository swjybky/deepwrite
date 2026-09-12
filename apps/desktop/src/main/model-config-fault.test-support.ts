import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";

export type ModelConfigFaultStage =
  | "write"
  | "sync"
  | "rename"
  | "after-rename"
  | "directory-sync"
  | "legacy-cleanup";
const fault = vi.hoisted(() => ({ stage: "" as ModelConfigFaultStage | "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  function fail(stage: ModelConfigFaultStage) {
    if (fault.stage !== stage) return;
    fault.stage = "";
    throw Object.assign(new Error("Injected model configuration I/O failure"), {
      code: "EIO"
    });
  }
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      if (args[1] === "wx" && String(args[0]).includes(".models-")) {
        const write = handle.writeFile.bind(handle);
        const sync = handle.sync.bind(handle);
        handle.writeFile = async (
          ...values: Parameters<typeof handle.writeFile>
        ) => {
          if (fault.stage === "write") {
            await write('{"version":3,');
            fail("write");
          }
          return write(...values);
        };
        handle.sync = async () => {
          fail("sync");
          return sync();
        };
      } else if (args[1] === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          fail("directory-sync");
          return sync();
        };
      }
      return handle;
    },
    async rename(...args: Parameters<typeof actual.rename>) {
      if (String(args[1]).endsWith("models.json")) {
        fail("rename");
        await actual.rename(...args);
        fail("after-rename");
      } else await actual.rename(...args);
    },
    async rm(...args: Parameters<typeof actual.rm>) {
      if (String(args[0]).endsWith("model-secrets.json"))
        fail("legacy-cleanup");
      return actual.rm(...args);
    }
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const { ModelConfigPersistence } = await import("./model-config-persistence");
const roots: string[] = [];
export const oldKey = "invalid-old-key-for-test";
export const newKey = "invalid-new-key-for-test";
export const oldModel = {
  id: "test-writer",
  label: "测试模型",
  modelId: "writer-v1",
  provider: "custom" as const,
  api: "openai-completions" as const,
  baseUrl: "https://old.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off" as const,
  thinkingLevelOptions: ["high" as const],
  temperatureOptions: [0.1, 0.7, 1]
} satisfies ModelConfigInput;
export const newModel = {
  ...oldModel,
  modelId: "writer-v2",
  baseUrl: "https://new.example.test/v1"
};
export const initialInput = {
  models: [{ ...oldModel, apiKey: oldKey }],
  defaultModelId: oldModel.id
};
export const replacementInput = {
  models: [{ ...newModel, apiKey: newKey }],
  defaultModelId: newModel.id
};

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-model-atomic-"));
  roots.push(root);
  const reader = {
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
  const createStore = () =>
    new ModelConfigStore(root, {
      freeModelCatalog: reader,
      officialModelCatalog: reader
    });
  const configDirectory = join(root, "config");
  await mkdir(configDirectory);
  return {
    root,
    configDirectory,
    createStore,
    state: new ModelConfigPersistence(root),
    modelsPath: join(configDirectory, "models.json"),
    secretsPath: join(configDirectory, "model-secrets.json")
  };
}

export async function writeLegacy(
  context: Awaited<ReturnType<typeof fixture>>,
  version = 2
) {
  await writeFile(
    context.modelsPath,
    JSON.stringify({ version, models: [oldModel], defaultModelId: oldModel.id })
  );
  await writeFile(
    context.secretsPath,
    JSON.stringify({
      version: 1,
      encryptedApiKeys: {
        [oldModel.id]: Buffer.from(oldKey).toString("base64")
      }
    })
  );
}

afterEach(async () => {
  fault.stage = "";
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

export { fault };
