import { safeStorage } from "electron";
import {
  AgentProviderRuntimeConfigSchema,
  type AgentProviderRuntimeConfig,
  type ModelConfigInput
} from "@deepwrite/contracts";
import { DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID } from "./deepwrite-official-model-config";
import type { DiskModelSecrets } from "./model-config-persistence";
import {
  synchronizeManagedModel,
  type ModelConfigSnapshot
} from "./model-config-state";

export function decryptModelKey(encrypted: string | undefined): string {
  if (!encrypted) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
  }
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
  }
}

function storedKey(model: ModelConfigInput, secrets: DiskModelSecrets): string {
  const id =
    model.managedBy === "deepwrite-official"
      ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
      : model.id;
  return decryptModelKey(secrets.encryptedApiKeys[id]);
}

export function resolveSavedModel(
  state: ModelConfigSnapshot,
  modelId?: string
): AgentProviderRuntimeConfig | undefined {
  if (state.settings.models.length === 0) {
    if (modelId) throw new Error("所选模型不存在，请刷新模型配置后重试。");
    return undefined;
  }
  const id =
    modelId || state.settings.defaultModelId || state.settings.models[0]!.id;
  const stored = state.settings.models.find((model) => model.id === id);
  if (!stored) throw new Error("所选模型不存在，请刷新模型配置后重试。");
  const model = synchronizeManagedModel(
    stored,
    state.freeCatalog,
    state.officialCatalog,
    true
  );
  return AgentProviderRuntimeConfigSchema.parse({
    ...model,
    apiKey: storedKey(model, state.secrets)
  });
}

export function resolveDraftModel(
  parsedModel: ModelConfigInput,
  state: ModelConfigSnapshot
): AgentProviderRuntimeConfig {
  const model = synchronizeManagedModel(
    parsedModel,
    state.freeCatalog,
    state.officialCatalog,
    true
  );
  let apiKey = model.managedBy ? "" : (model.apiKey ?? "");
  if (!apiKey && !model.clearApiKey) apiKey = storedKey(model, state.secrets);
  if (model.managedBy === "deepwrite-official" && !apiKey) {
    throw new Error("请先在“设置 → DeepWrite 官方模型”中添加官方令牌。");
  }
  const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
  return AgentProviderRuntimeConfigSchema.parse({ ...identity, apiKey });
}

export function officialTokenSuffix(
  secrets: DiskModelSecrets
): string | undefined {
  const encrypted =
    secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
  if (!encrypted) return undefined;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储当前不可用，无法查询当前 Key 的剩余用量。");
  }
  try {
    return safeStorage
      .decryptString(Buffer.from(encrypted, "base64"))
      .slice(-4);
  } catch {
    throw new Error("官方令牌解密失败，请重新填写并保存。");
  }
}
