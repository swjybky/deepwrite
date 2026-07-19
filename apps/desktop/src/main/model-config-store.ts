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
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    const configDirectory = join(userDataPath, "config");
    this.settingsPath = join(configDirectory, "models.json");
    this.secretsPath = join(configDirectory, "model-secrets.json");
  }

  async list(): Promise<ModelSettings> {
    await this.writeChain;
    const [settings, secrets] = await this.readState();
    return this.toPublicSettings(settings, secrets);
  }

  async save(rawInput: ModelSettingsInput): Promise<ModelSettings> {
    const input = ModelSettingsInputSchema.parse(rawInput);
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const [, existingSecrets] = await this.readState();
      const encryptedApiKeys: Record<string, string> = {};

      for (const model of input.models) {
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

      const models: DiskModelConfig[] = input.models.map(
        ({ apiKey: _apiKey, clearApiKey: _clear, ...model }) => model
      );
      const defaultModelId = input.defaultModelId || models[0]?.id || "";
      const nextSettings: DiskModelSettings = { version: 1, defaultModelId, models };
      const nextSecrets: DiskModelSecrets = { version: 1, encryptedApiKeys };

      // Extra encrypted secrets are harmless after a crash; missing metadata is not.
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(nextSettings, nextSecrets);
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
    const [settings, secrets] = await this.readState();
    if (settings.models.length === 0) {
      if (modelId) {
        throw new Error("所选模型不存在，请刷新模型配置后重试。");
      }
      return undefined;
    }

    const effectiveId = modelId || settings.defaultModelId || settings.models[0]!.id;
    const model = settings.models.find((candidate) => candidate.id === effectiveId);
    if (!model) {
      throw new Error("所选模型不存在，请刷新模型配置后重试。");
    }

    const encrypted = secrets.encryptedApiKeys[model.id];
    let apiKey = "";
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

    return AgentProviderRuntimeConfigSchema.parse({ ...model, apiKey });
  }

  async resolveDraft(rawModel: ModelConfigInput): Promise<AgentProviderRuntimeConfig> {
    const model = ModelConfigInputSchema.parse(rawModel);
    await this.writeChain;

    let apiKey = model.apiKey ?? "";
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
    secrets: DiskModelSecrets
  ): ModelSettings {
    return ModelSettingsSchema.parse({
      defaultModelId: settings.defaultModelId,
      models: settings.models.map((model) => ({
        ...model,
        hasApiKey: Boolean(secrets.encryptedApiKeys[model.id])
      }))
    });
  }
}
