import { safeStorage } from "electron";
import {
  AgentProviderRuntimeConfigSchema,
  isDeepWriteSiteOfficialModel,
  type AgentProviderRuntimeConfig,
  type ModelConfigInput
} from "@deepwrite/contracts";
import type { DiskModelSecrets } from "./model-config-persistence";
import { ModelNotFoundError } from "./model-config-errors";
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
  return decryptModelKey(secrets.encryptedApiKeys[model.id]);
}

export function resolveSavedModel(
  state: ModelConfigSnapshot,
  modelId?: string
): AgentProviderRuntimeConfig | undefined {
  const enabledModels = state.settings.models.filter(
    (model) => !isDeepWriteSiteOfficialModel(model) || model.enabled !== false
  );
  const id =
    modelId ||
    (enabledModels.some((model) => model.id === state.settings.defaultModelId)
      ? state.settings.defaultModelId
      : enabledModels[0]?.id);
  if (!id) return undefined;
  const stored = state.settings.models.find((model) => model.id === id);
  if (!stored) throw new ModelNotFoundError();
  const model = synchronizeManagedModel(stored, state.freeCatalog, true);
  return AgentProviderRuntimeConfigSchema.parse({
    ...model,
    apiKey: storedKey(model, state.secrets)
  });
}

export function resolveDraftModel(
  parsedModel: ModelConfigInput,
  state: ModelConfigSnapshot
): AgentProviderRuntimeConfig {
  const model = synchronizeManagedModel(parsedModel, state.freeCatalog, true);
  let apiKey = model.managedBy ? "" : (model.apiKey ?? "");
  if (!apiKey && !model.clearApiKey) apiKey = storedKey(model, state.secrets);
  const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
  return AgentProviderRuntimeConfigSchema.parse({ ...identity, apiKey });
}
