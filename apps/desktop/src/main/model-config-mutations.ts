import { secureStorage as safeStorage } from "./secure-storage";
import type { ModelSettingsInput } from "@deepwrite/contracts";
import {
  forgetEnabledFreeModel,
  rememberEnabledFreeModel,
  toDiskModel
} from "./free-model-settings-state";
import {
  managedFreeSecretIds,
  requireEnableableFreeModel
} from "./free-model-settings-projection";
import type { ModelConfigState } from "./model-config-persistence";
import {
  synchronizeState,
  type ModelConfigSnapshot
} from "./model-config-state";

export function editModelSettings(
  input: ModelSettingsInput,
  { settings, secrets, freeCatalog }: ModelConfigSnapshot
): ModelConfigState {
  const encryptedApiKeys: Record<string, string> = {};
  const preservedIds = managedFreeSecretIds(settings, freeCatalog);
  for (const id of preservedIds) {
    const encrypted = secrets.encryptedApiKeys[id];
    if (encrypted) encryptedApiKeys[id] = encrypted;
  }
  for (const model of input.models) {
    if (model.managedBy) continue;
    const apiKey = model.apiKey?.trim();
    if (apiKey) {
      encryptedApiKeys[model.id] = safeStorage
        .encryptString(apiKey)
        .toString("base64");
    } else if (!model.clearApiKey && model.sourceApiKeyId) {
      const source = settings.models.find(
        (entry) => entry.id === model.sourceApiKeyId
      );
      if (
        !source ||
        source.managedBy ||
        source.provider !== model.provider ||
        source.api !== model.api ||
        source.baseUrl !== model.baseUrl ||
        !secrets.encryptedApiKeys[source.id]
      ) {
        throw new Error("无法复用原模型密钥，请重新填写 API Key 后批量保存。");
      }
      encryptedApiKeys[model.id] = secrets.encryptedApiKeys[source.id]!;
    } else if (!model.clearApiKey && secrets.encryptedApiKeys[model.id]) {
      encryptedApiKeys[model.id] = secrets.encryptedApiKeys[model.id]!;
    }
  }
  return {
    settings: {
      ...settings,
      defaultModelId: input.defaultModelId,
      models: input.models.filter((model) => !model.managedBy).map(toDiskModel)
    },
    secrets: { version: 1, encryptedApiKeys }
  };
}

export function setFreeModelEnabled(
  state: ModelConfigSnapshot,
  modelId: string,
  enabled: boolean
): ModelConfigState {
  const model = enabled
    ? requireEnableableFreeModel(state.freeCatalog, modelId)
    : undefined;
  const [settings, secrets] = synchronizeState(
    state.settings,
    state.secrets,
    state.freeCatalog
  );
  return {
    settings: enabled
      ? rememberEnabledFreeModel(settings, model!)
      : forgetEnabledFreeModel(settings, modelId),
    secrets
  };
}
