import { rm } from "node:fs/promises";
import { afterEach, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import type { DeepWriteOfficialModelCatalog } from "./deepwrite-official-model-config";

const temporaryRoots: string[] = [];

function managedModel(
  modelId: string,
  overrides: Partial<ModelConfigInput> = {}
): ModelConfigInput {
  return {
    id: "deepwrite-free-writing",
    label: "DeepWrite 免费模型",
    provider: "custom",
    modelId,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    managedBy: "deepwrite-free",
    ...overrides
  };
}

function emptyCatalog(): DeepWriteFreeModelCatalog {
  return {
    revision: "",
    enabled: false,
    message: "",
    manifestAvailable: false,
    canDeprecateMissingModels: false,
    defaultModelId: "",
    models: [],
    apiKeys: {}
  };
}

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

function officialModel(
  overrides: Partial<ModelConfigInput> = {}
): ModelConfigInput {
  return {
    id: "deepwrite-deepseek-v4-flash",
    label: "官方模型-DeepSeekFlash正式版本",
    provider: "deepseek-official",
    modelId: "deepseek-v4-flash-202605",
    api: "openai-completions",
    baseUrl: "https://official.example.test/v1",
    reasoning: true,
    supportsDeveloperRole: false,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "high", "max"],
    temperatureOptions: [0.7, 1, 1.5],
    managedBy: "deepwrite-official",
    ...overrides
  };
}

function officialCatalog(
  models: ModelConfigInput[] = [officialModel()]
): DeepWriteOfficialModelCatalog {
  return {
    revision: "remote-v1",
    enabled: true,
    message: "",
    manifestAvailable: true,
    defaultModelId: models[0]?.id ?? "",
    models
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

export {
  temporaryRoots,
  managedModel,
  emptyCatalog,
  customModel,
  officialModel,
  officialCatalog
};
export type { DeepWriteFreeModelCatalog };
