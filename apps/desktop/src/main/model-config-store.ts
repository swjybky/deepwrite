import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import {
  AgentProviderRuntimeConfigSchema,
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  type AgentProviderRuntimeConfig,
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import {
  DeepWriteFreeModelCatalogStore,
  getDeepWriteFreeOpenRouterApiKey,
  type DeepWriteFreeModelCatalog
} from "./deepwrite-free-model-config";

interface DiskModelConfig {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  api: ModelConfig["api"];
  baseUrl: string;
  reasoning: boolean;
  defaultThinkingLevel: ModelConfig["defaultThinkingLevel"];
  thinkingLevelOptions: ModelConfig["thinkingLevelOptions"];
  temperatureOptions: ModelConfig["temperatureOptions"];
  managedBy?: ModelConfig["managedBy"];
}

interface DiskModelSettings {
  version: 1;
  defaultModelId: string;
  models: DiskModelConfig[];
}

interface DiskModelSecrets {
  version: 1;
  encryptedApiKeys: Record<string, string>;
}

const EMPTY_SETTINGS: DiskModelSettings = {
  version: 1,
  defaultModelId: "",
  models: []
};

const EMPTY_SECRETS: DiskModelSecrets = {
  version: 1,
  encryptedApiKeys: {}
};

interface FreeModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteFreeModelCatalog>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDiskSettings(raw: unknown): DiskModelSettings {
  if (!isRecord(raw)) {
    return structuredClone(EMPTY_SETTINGS);
  }
  const parsed = ModelSettingsInputSchema.safeParse({
    models: raw.models,
    defaultModelId: raw.defaultModelId
  });
  if (!parsed.success) {
    return structuredClone(EMPTY_SETTINGS);
  }
  return {
    version: 1,
    defaultModelId: parsed.data.defaultModelId,
    models: parsed.data.models.map(({ apiKey: _apiKey, clearApiKey: _clear, ...model }) => model)
  };
}

function normalizeDiskSecrets(raw: unknown): DiskModelSecrets {
  if (!isRecord(raw) || !isRecord(raw.encryptedApiKeys)) {
    return structuredClone(EMPTY_SECRETS);
  }
  const encryptedApiKeys: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw.encryptedApiKeys)) {
    if (typeof value === "string" && value.length > 0) {
      encryptedApiKeys[id] = value;
    }
  }
  return { version: 1, encryptedApiKeys };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export class ModelConfigStore {
  private readonly settingsPath: string;
  private readonly secretsPath: string;
  private readonly freeModelCatalog: FreeModelCatalogReader;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, options: ModelConfigStoreOptions = {}) {
    const configDirectory = join(userDataPath, "config");
    this.settingsPath = join(configDirectory, "models.json");
    this.secretsPath = join(configDirectory, "model-secrets.json");
    this.freeModelCatalog =
      options.freeModelCatalog ??
      new DeepWriteFreeModelCatalogStore(
        userDataPath,
        options.appVersion ? { appVersion: options.appVersion } : {}
      );
  }

  async initialize(): Promise<void> {
    await this.freeModelCatalog.initialize();
  }

  async list(): Promise<ModelSettings> {
    await this.writeChain;
    const [[settings, secrets], catalog] = await Promise.all([
      this.readState(),
      this.freeModelCatalog.getCatalog()
    ]);
    return this.toPublicSettings(this.synchronizeSettings(settings, catalog), secrets, catalog);
  }

  async save(rawInput: ModelSettingsInput): Promise<ModelSettings> {
    const input = ModelSettingsInputSchema.parse(rawInput);
    const catalog = await this.freeModelCatalog.getCatalog();
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const [, existingSecrets] = await this.readState();
      const encryptedApiKeys: Record<string, string> = {};

      for (const model of input.models) {
        if (model.managedBy === "deepwrite-free") {
          continue;
        }
        const apiKey = model.apiKey?.trim();
        if (apiKey) {
          if (!safeStorage.isEncryptionAvailable()) {
            throw new Error(
              "当前系统安全存储不可用，DeepWrite 不会把 API Key 以明文写入磁盘。"
            );
          }
          encryptedApiKeys[model.id] = safeStorage.encryptString(apiKey).toString("base64");
          continue;
        }
        if (model.clearApiKey) {
          continue;
        }
        const previous = existingSecrets.encryptedApiKeys[model.id];
        if (previous) {
          encryptedApiKeys[model.id] = previous;
        }
      }

      const models: DiskModelConfig[] = input.models.map((model) =>
        this.toDiskModel(this.synchronizeManagedModel(model, catalog))
      );
      const defaultModelId = input.defaultModelId || models[0]?.id || "";
      const nextSettings: DiskModelSettings = { version: 1, defaultModelId, models };
      const nextSecrets: DiskModelSecrets = { version: 1, encryptedApiKeys };

      // Extra encrypted secrets are harmless after a crash; missing metadata is not.
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(nextSettings, nextSecrets, catalog);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async resolve(modelId?: string): Promise<AgentProviderRuntimeConfig | undefined> {
    await this.writeChain;
    const [[settings, secrets], catalog] = await Promise.all([
      this.readState(),
      this.freeModelCatalog.getCatalog()
    ]);
    if (settings.models.length === 0) {
      if (modelId) {
        throw new Error("所选模型不存在，请刷新模型配置后重试。");
      }
      return undefined;
    }

    const effectiveId = modelId || settings.defaultModelId || settings.models[0]!.id;
    const storedModel = settings.models.find((candidate) => candidate.id === effectiveId);
    const model = storedModel
      ? this.synchronizeManagedModel(storedModel, catalog, true)
      : undefined;
    if (!model) {
      throw new Error("所选模型不存在，请刷新模型配置后重试。");
    }

    const encrypted = secrets.encryptedApiKeys[model.id];
    let apiKey =
      model.managedBy === "deepwrite-free" ? getDeepWriteFreeOpenRouterApiKey() : "";
    if (!apiKey && encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
      }
      try {
        apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
      }
    }

    return AgentProviderRuntimeConfigSchema.parse({ ...model, apiKey });
  }

  async resolveDraft(rawModel: ModelConfigInput): Promise<AgentProviderRuntimeConfig> {
    const parsedModel = ModelConfigInputSchema.parse(rawModel);
    await this.writeChain;
    const catalog = await this.freeModelCatalog.getCatalog();
    const model = this.synchronizeManagedModel(parsedModel, catalog, true);

    let apiKey =
      model.managedBy === "deepwrite-free"
        ? getDeepWriteFreeOpenRouterApiKey()
        : model.apiKey ?? "";
    if (!apiKey && !model.clearApiKey) {
      const [, secrets] = await this.readState();
      const encrypted = secrets.encryptedApiKeys[model.id];
      if (encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
        }
        try {
          apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        } catch {
          throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
        }
      }
    }

    const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
    return AgentProviderRuntimeConfigSchema.parse({ ...identity, apiKey });
  }

  private async readState(): Promise<[DiskModelSettings, DiskModelSecrets]> {
    const [settings, secrets] = await Promise.all([
      readJson(this.settingsPath),
      readJson(this.secretsPath)
    ]);
    return [normalizeDiskSettings(settings), normalizeDiskSecrets(secrets)];
  }

  private toPublicSettings(
    settings: DiskModelSettings,
    secrets: DiskModelSecrets,
    catalog: DeepWriteFreeModelCatalog
  ): ModelSettings {
    return ModelSettingsSchema.parse({
      defaultModelId: settings.defaultModelId,
      models: settings.models.map((model) => ({
        ...model,
        hasApiKey:
          model.managedBy === "deepwrite-free" ||
          Boolean(secrets.encryptedApiKeys[model.id])
      })),
      deepwriteFreeModels: catalog.models.map((model) => ({
        ...model,
        hasApiKey: true
      })),
      ...(catalog.defaultModelId
        ? { deepwriteFreeDefaultModelId: catalog.defaultModelId }
        : {}),
      ...(catalog.message ? { deepwriteFreeMessage: catalog.message } : {})
    });
  }

  private synchronizeSettings(
    settings: DiskModelSettings,
    catalog: DeepWriteFreeModelCatalog
  ): DiskModelSettings {
    return {
      ...settings,
      models: settings.models.map((model) =>
        this.toDiskModel(this.synchronizeManagedModel(model, catalog))
      )
    };
  }

  private synchronizeManagedModel(
    model: ModelConfigInput,
    catalog: DeepWriteFreeModelCatalog,
    enforceRemoteStatus = false
  ): ModelConfigInput {
    if (model.managedBy !== "deepwrite-free") {
      return model;
    }
    if (enforceRemoteStatus && catalog.manifestAvailable && !catalog.enabled) {
      throw new Error(catalog.message || "DeepWrite 免费模型当前已暂停使用。");
    }
    const remoteModel =
      catalog.models.find((candidate) => candidate.id === model.id) ??
      catalog.models.find((candidate) => candidate.id === catalog.defaultModelId);
    const synchronized = remoteModel
      ? { ...remoteModel, id: model.id }
      : {
          ...model,
          provider: "openrouter",
          api: "openai-completions" as const,
          baseUrl: "https://openrouter.ai/api/v1"
        };
    if (
      synchronized.modelId !== "openrouter/free" &&
      !synchronized.modelId.endsWith(":free")
    ) {
      throw new Error("DeepWrite 免费模型只能使用 OpenRouter 的免费模型 ID。");
    }
    return {
      ...synchronized,
      provider: "openrouter",
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      managedBy: "deepwrite-free"
    };
  }

  private toDiskModel(model: ModelConfigInput): DiskModelConfig {
    const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
    return identity;
  }
}
