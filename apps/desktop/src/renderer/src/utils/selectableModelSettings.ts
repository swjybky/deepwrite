import type { ModelConfig, ModelSettings } from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";

export function selectableModels(
  models: readonly ModelConfig[]
): ModelConfig[] {
  return models.filter(
    (model) => !isDeepWriteSiteOfficialModel(model) || model.enabled !== false
  );
}

export function selectableModelSettings(
  settings: ModelSettings
): ModelSettings {
  const models = selectableModels(settings.models);
  if (models.length === settings.models.length) return settings;
  return {
    ...settings,
    models,
    defaultModelId: models.some((model) => model.id === settings.defaultModelId)
      ? settings.defaultModelId
      : (models[0]?.id ?? "")
  };
}
