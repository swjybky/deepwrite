import { safeStorage } from "electron";
import type { ModelSettingsInput } from "@deepwrite/contracts";
import {
  DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID,
  isOfficialModelAvailable
} from "./deepwrite-official-model-config";
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
  const preservedIds = [
    DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID,
    ...managedFreeSecretIds(settings, freeCatalog)
  ];
  for (const id of preservedIds) {
    const encrypted = secrets.encryptedApiKeys[id];
    if (encrypted) encryptedApiKeys[id] = encrypted;
  }
  for (const model of input.models) {
    if (model.managedBy) continue;
    const apiKey = model.apiKey?.trim();
    if (apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "当前系统安全存储不可用，DeepWrite 不会把 API Key 以明文写入磁盘。"
        );
      }
      encryptedApiKeys[model.id] = safeStorage
        .encryptString(apiKey)
        .toString("base64");
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

export function changeOfficialToken(
  { settings, secrets }: ModelConfigSnapshot,
  apiKey: string | null
): ModelConfigState {
  const encryptedApiKeys = { ...secrets.encryptedApiKeys };
  if (apiKey === null) {
    delete encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "当前系统安全存储不可用，DeepWrite 不会把官方令牌以明文写入磁盘。"
      );
    }
    encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID] = safeStorage
      .encryptString(apiKey)
      .toString("base64");
  }
  return { settings, secrets: { version: 1, encryptedApiKeys } };
}

export function setOfficialModelEnabled(
  { settings, secrets, officialCatalog }: ModelConfigSnapshot,
  modelId: string,
  enabled: boolean
): ModelConfigState {
  const model = officialCatalog.models.find((entry) => entry.id === modelId);
  if (!model) throw new Error("这个 DeepWrite 官方模型已不再受支持。");
  if (enabled && !isOfficialModelAvailable(model)) {
    throw new Error("这个 DeepWrite 官方模型当前不可用。");
  }
  const disabled = new Set(settings.disabledOfficialModelIds);
  if (enabled) disabled.delete(modelId);
  else disabled.add(modelId);
  return {
    settings: { ...settings, disabledOfficialModelIds: [...disabled] },
    secrets
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
    state.freeCatalog,
    state.officialCatalog
  );
  return {
    settings: enabled
      ? rememberEnabledFreeModel(settings, model!)
      : forgetEnabledFreeModel(settings, modelId),
    secrets
  };
}
