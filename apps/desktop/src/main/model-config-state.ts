import { safeStorage } from "electron";
import {
  ModelSettingsSchema,
  type ModelConfigInput,
  type ModelSettings
} from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import {
  DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID,
  isOfficialModelAvailable,
  type DeepWriteOfficialModelCatalog
} from "./deepwrite-official-model-config";
import {
  synchronizeFreeModelState,
  toDiskModel,
  type DiskModelSettings
} from "./free-model-settings-state";
import {
  effectiveFreeModels,
  projectPublicFreeModelSettings,
  removeDeprecatedFreeSecrets,
  reservedFreeModelIds,
  resolveCurrentFreeModel
} from "./free-model-settings-projection";
import type {
  DiskModelSecrets,
  ModelConfigState
} from "./model-config-persistence";

export interface ModelConfigCatalogs {
  freeCatalog: DeepWriteFreeModelCatalog;
  officialCatalog: DeepWriteOfficialModelCatalog;
}
export type ModelConfigSnapshot = ModelConfigState & ModelConfigCatalogs;

export function withDeepWriteFreeApiKeys(
  catalog: DeepWriteFreeModelCatalog,
  secrets: DiskModelSecrets
): DiskModelSecrets {
  const currentIds = new Set(catalog.models.map((model) => model.id));
  const entries = Object.entries(catalog.apiKeys).filter(
    ([id, apiKey]) => currentIds.has(id) && Boolean(apiKey)
  );
  if (entries.length > 0 && !safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "当前系统安全存储不可用，DeepWrite 不会把远程免费模型 API Key 以明文写入磁盘。"
    );
  }
  const encryptedApiKeys = { ...secrets.encryptedApiKeys };
  if (catalog.canDeprecateMissingModels) {
    for (const id of currentIds) delete encryptedApiKeys[id];
  }
  for (const [id, apiKey] of entries) {
    encryptedApiKeys[id] = safeStorage.encryptString(apiKey).toString("base64");
  }
  return { version: 1, encryptedApiKeys };
}

export function toPublicSettings(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: DeepWriteFreeModelCatalog,
  officialCatalog: DeepWriteOfficialModelCatalog
): ModelSettings {
  return ModelSettingsSchema.parse({
    defaultModelId: settings.defaultModelId,
    models: settings.models.map((model) => ({
      ...model,
      hasApiKey: Boolean(
        secrets.encryptedApiKeys[
          model.managedBy === "deepwrite-official"
            ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
            : model.id
        ]
      )
    })),
    ...projectPublicFreeModelSettings(settings, freeCatalog, (modelId) =>
      Boolean(secrets.encryptedApiKeys[modelId])
    ),
    deepwriteOfficialModels: officialCatalog.models.map((model) => ({
      ...model,
      hasApiKey: Boolean(
        secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
      )
    })),
    deepwriteOfficialEnabledModelIds: officialCatalog.models
      .filter(
        (model) =>
          isOfficialModelAvailable(model) &&
          !settings.disabledOfficialModelIds.includes(model.id)
      )
      .map((model) => model.id),
    deepwriteOfficialTokenConfigured: Boolean(
      secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
    )
  });
}

export function synchronizeState(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: DeepWriteFreeModelCatalog,
  officialCatalog: DeepWriteOfficialModelCatalog
): [DiskModelSettings, DiskModelSecrets] {
  const nextSettings = synchronizeSettings(
    settings,
    secrets,
    freeCatalog,
    officialCatalog
  );
  return [
    nextSettings,
    {
      version: 1,
      encryptedApiKeys: removeDeprecatedFreeSecrets(
        secrets.encryptedApiKeys,
        nextSettings
      )
    }
  ];
}

function synchronizeSettings(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: DeepWriteFreeModelCatalog,
  officialCatalog: DeepWriteOfficialModelCatalog
): DiskModelSettings {
  const freeState = synchronizeFreeModelState(settings, freeCatalog);
  const officialModelIds = new Set(
    officialCatalog.models.map((model) => model.id)
  );
  const disabledOfficialModelIds = new Set(settings.disabledOfficialModelIds);
  const officialModels = secrets.encryptedApiKeys[
    DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
  ]
    ? officialCatalog.models
        .filter(
          (model) =>
            isOfficialModelAvailable(model) &&
            !disabledOfficialModelIds.has(model.id)
        )
        .map(toDiskModel)
    : [];
  const freeModels = effectiveFreeModels(freeState, freeCatalog);
  const freeReservedIds = reservedFreeModelIds(freeState, freeCatalog);
  const reservedModelIds = new Set([...officialModelIds, ...freeReservedIds]);
  const customModels = settings.models
    .filter((model) => !model.managedBy && !reservedModelIds.has(model.id))
    .map(toDiskModel);
  const models = [...officialModels, ...freeModels, ...customModels];
  const requestedDefaultModelId = settings.defaultModelId;
  const defaultModelId = models.some(
    (model) => model.id === requestedDefaultModelId
  )
    ? requestedDefaultModelId
    : (models[0]?.id ?? "");
  return {
    version: 2,
    defaultModelId,
    models,
    disabledOfficialModelIds: [...disabledOfficialModelIds].filter((id) =>
      officialModelIds.has(id)
    ),
    ...freeState
  };
}

export function synchronizeManagedModel(
  model: ModelConfigInput,
  freeCatalog: DeepWriteFreeModelCatalog,
  officialCatalog: DeepWriteOfficialModelCatalog,
  enforceRemoteStatus = false
): ModelConfigInput {
  if (model.managedBy === "deepwrite-official") {
    if (
      enforceRemoteStatus &&
      officialCatalog.manifestAvailable &&
      !officialCatalog.enabled
    ) {
      throw new Error(
        officialCatalog.message || "DeepWrite 官方模型当前已暂停使用。"
      );
    }
    const officialModel = officialCatalog.models.find(
      (candidate) =>
        candidate.id === model.id && isOfficialModelAvailable(candidate)
    );
    if (!officialModel) {
      throw new Error("这个 DeepWrite 官方模型已不再受支持。");
    }
    return structuredClone(officialModel);
  }
  if (model.managedBy !== "deepwrite-free") {
    return model;
  }
  return resolveCurrentFreeModel(freeCatalog, model.id, enforceRemoteStatus);
}
