import { secureStorage as safeStorage } from "./secure-storage";
import {
  isDeepWriteSiteOfficialModel,
  ModelSettingsSchema,
  type ModelConfigInput,
  type ModelSettings
} from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
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
  freeCatalog: DeepWriteFreeModelCatalog
): ModelSettings {
  return ModelSettingsSchema.parse({
    defaultModelId: settings.defaultModelId,
    models: settings.models.map((model) => ({
      ...model,
      hasApiKey: Boolean(secrets.encryptedApiKeys[model.id])
    })),
    ...projectPublicFreeModelSettings(settings, freeCatalog, (modelId) =>
      Boolean(secrets.encryptedApiKeys[modelId])
    )
  });
}

export function synchronizeState(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: DeepWriteFreeModelCatalog
): [DiskModelSettings, DiskModelSecrets] {
  const nextSettings = synchronizeSettings(settings, freeCatalog);
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
  freeCatalog: DeepWriteFreeModelCatalog
): DiskModelSettings {
  const freeState = synchronizeFreeModelState(settings, freeCatalog);
  const freeModels = effectiveFreeModels(freeState, freeCatalog);
  const freeReservedIds = reservedFreeModelIds(freeState, freeCatalog);
  const customModels = settings.models
    .filter((model) => !model.managedBy && !freeReservedIds.has(model.id))
    .map(toDiskModel);
  const models = [...freeModels, ...customModels];
  const requestedDefaultModelId = settings.defaultModelId;
  const defaultModelId = models.some(
    (model) => model.id === requestedDefaultModelId
  )
    ? requestedDefaultModelId
    : (models.find(
        (model) =>
          !isDeepWriteSiteOfficialModel(model) || model.enabled !== false
      )?.id ?? "");
  return {
    version: 2,
    defaultModelId,
    models,
    ...freeState
  };
}

export function synchronizeManagedModel(
  model: ModelConfigInput,
  freeCatalog: DeepWriteFreeModelCatalog,
  enforceRemoteStatus = false
): ModelConfigInput {
  if (model.managedBy !== "deepwrite-free") {
    return model;
  }
  return resolveCurrentFreeModel(freeCatalog, model.id, enforceRemoteStatus);
}
