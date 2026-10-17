import { secureStorage as safeStorage } from "./secure-storage";
import {
  AgentProviderRuntimeConfigSchema,
  isDeepWriteSiteOfficialModel,
  type AgentProviderRuntimeConfig,
  type ModelConfigInput
} from "@deepwrite/contracts";
import type { DiskModelSecrets } from "./model-config-persistence";
import {
  synchronizeManagedModel,
  type ModelConfigSnapshot
} from "./model-config-state";

export function decryptModelKey(encrypted: string | undefined): string {
  if (!encrypted) return "";
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
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
  if (!stored) throw new Error("所选模型不存在，请刷新模型配置后重试。");
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
