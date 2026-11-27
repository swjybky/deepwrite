import {
  ModelConfigInputSchema,
  type ModelConfigInput
} from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import { isRecord } from "@deepwrite/shared";

export type DiskModelConfig = Omit<
  ModelConfigInput,
  "apiKey" | "clearApiKey" | "sourceApiKeyId"
>;

export interface DiskModelSettings {
  version: 2;
  defaultModelId: string;
  models: DiskModelConfig[];
  enabledFreeModelIds: string[];
  knownFreeModels: DiskModelConfig[];
  deprecatedFreeModels: DiskModelConfig[];
}

export const EMPTY_DISK_MODEL_SETTINGS: DiskModelSettings = {
  version: 2,
  defaultModelId: "",
  models: [],
  enabledFreeModelIds: [],
  knownFreeModels: [],
  deprecatedFreeModels: []
};

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0 && id.length <= 120
      )
    )
  ].slice(0, 50);
}

export function toDiskModel(model: ModelConfigInput): DiskModelConfig {
  const {
    apiKey: _apiKey,
    clearApiKey: _clearApiKey,
    sourceApiKeyId: _sourceApiKeyId,
    ...identity
  } = model;
  return identity;
}

function normalizeModels(raw: unknown, maximum: number): DiskModelConfig[] {
  if (!Array.isArray(raw)) return [];
  const models = new Map<string, DiskModelConfig>();
  for (const candidate of raw.slice(0, maximum)) {
    const parsed = ModelConfigInputSchema.safeParse(candidate);
    if (!parsed.success || models.has(parsed.data.id)) continue;
    models.set(parsed.data.id, toDiskModel(parsed.data));
  }
  return [...models.values()];
}

function normalizeFreeModels(raw: unknown): DiskModelConfig[] {
  return normalizeModels(raw, 50).filter(
    (model) => model.managedBy === "deepwrite-free"
  );
}

/**
 * Reads both the legacy v1 layout and v2. A legacy managed free-model entry
 * means the user had already opted into it, so it migrates as enabled.
 */
export function normalizeDiskModelSettings(raw: unknown): DiskModelSettings {
  if (!isRecord(raw)) return structuredClone(EMPTY_DISK_MODEL_SETTINGS);

  const models = normalizeModels(raw.models, 100);
  const legacyFreeModels = models.filter(
    (model) => model.managedBy === "deepwrite-free"
  );
  const isV2 = raw.version === 2;
  const knownFreeModels = isV2
    ? normalizeFreeModels(raw.knownFreeModels)
    : legacyFreeModels;
  const enabledFreeModelIds = isV2
    ? normalizeIds(raw.enabledFreeModelIds)
    : legacyFreeModels.map((model) => model.id);

  return {
    version: 2,
    defaultModelId:
      typeof raw.defaultModelId === "string" && raw.defaultModelId.length <= 120
        ? raw.defaultModelId
        : "",
    models,
    enabledFreeModelIds,
    knownFreeModels,
    deprecatedFreeModels: isV2
      ? normalizeFreeModels(raw.deprecatedFreeModels)
      : []
  };
}

export function isFreeModelAvailable(model: ModelConfigInput): boolean {
  return model.status !== 1;
}

function byId(models: DiskModelConfig[]): Map<string, DiskModelConfig> {
  return new Map(models.map((model) => [model.id, model]));
}

/**
 * Reconciles opt-in state with the catalog. Only an authoritative live
 * manifest is allowed to create or clear deprecation records.
 */
export function synchronizeFreeModelState(
  settings: DiskModelSettings,
  catalog: DeepWriteFreeModelCatalog
): Pick<
  DiskModelSettings,
  "enabledFreeModelIds" | "knownFreeModels" | "deprecatedFreeModels"
> {
  const currentModels = byId(catalog.models.map((model) => toDiskModel(model)));
  const storedManagedModels = byId(
    settings.models.filter((model) => model.managedBy === "deepwrite-free")
  );
  const knownModels = byId(settings.knownFreeModels);
  const deprecatedModels = byId(settings.deprecatedFreeModels);
  const enabledIds = new Set(settings.enabledFreeModelIds);

  for (const id of enabledIds) {
    const snapshot = currentModels.get(id) ?? storedManagedModels.get(id);
    if (snapshot) knownModels.set(id, snapshot);
  }

  if (catalog.canDeprecateMissingModels) {
    for (const [id, current] of currentModels) {
      const reappeared = deprecatedModels.delete(id);
      knownModels.set(id, current);
      if (reappeared) enabledIds.delete(id);
    }
    for (const [id, snapshot] of [...knownModels]) {
      if (!currentModels.has(id)) {
        deprecatedModels.set(id, snapshot);
        knownModels.delete(id);
        enabledIds.delete(id);
      }
    }
  }

  return {
    enabledFreeModelIds: [...enabledIds].slice(0, 50),
    knownFreeModels: [...knownModels.values()].slice(0, 50),
    deprecatedFreeModels: [...deprecatedModels.values()].slice(0, 50)
  };
}

export function rememberEnabledFreeModel(
  settings: DiskModelSettings,
  model: ModelConfigInput
): DiskModelSettings {
  const enabledIds = new Set(settings.enabledFreeModelIds);
  enabledIds.add(model.id);
  const knownModels = byId(settings.knownFreeModels);
  knownModels.set(model.id, toDiskModel(model));
  const deprecatedModels = byId(settings.deprecatedFreeModels);
  deprecatedModels.delete(model.id);
  return {
    ...settings,
    enabledFreeModelIds: [...enabledIds].slice(0, 50),
    knownFreeModels: [...knownModels.values()].slice(0, 50),
    deprecatedFreeModels: [...deprecatedModels.values()].slice(0, 50)
  };
}

export function forgetEnabledFreeModel(
  settings: DiskModelSettings,
  modelId: string
): DiskModelSettings {
  return {
    ...settings,
    enabledFreeModelIds: settings.enabledFreeModelIds.filter(
      (id) => id !== modelId
    )
  };
}
