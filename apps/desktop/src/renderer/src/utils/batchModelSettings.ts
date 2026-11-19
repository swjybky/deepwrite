import { createScopedTranslator } from "../i18n";
import { createId } from "@deepwrite/shared";
import {
  cloneDraftModel,
  type DraftModel
} from "../components/modelSettingsDraft";
import type { ModelEditorSavePayload } from "../composables/useModelEditor";
import { resolveSavedModelLabel } from "./customModelLabel";

const t = createScopedTranslator("workspace.batchModelSettings");

function withResolvedLabel(model: DraftModel, selectedCount = 1): DraftModel {
  return {
    ...model,
    label: resolveSavedModelLabel(model.label, model.modelId, selectedCount)
  };
}

/** Expand one editor configuration without replacing unselected existing models. */
export function applyBatchModelSettings(
  existing: DraftModel[],
  payload: ModelEditorSavePayload
): DraftModel[] {
  const selected = payload.selectedModels;
  const models = [...existing];
  if (!selected) {
    const model = withResolvedLabel(payload.model);
    const index = models.findIndex(
      (candidate) => candidate.id === (payload.originalId ?? model.id)
    );
    if (
      models.some(
        (candidate, candidateIndex) =>
          candidate.id === model.id && candidateIndex !== index
      )
    ) {
      throw new Error(t("modelConfigurationIdsMustBeUnique"));
    }
    if (index >= 0) models[index] = model;
    else models.push(model);
    return models;
  }
  if (!selected.length) throw new Error(t("selectAtLeastOneModelToSave"));
  const source = payload.model;
  const original = existing.find((model) => model.id === payload.originalId);
  const uniqueSelected = [
    ...new Map(selected.map((model) => [model.id, model])).values()
  ];
  const selectedCount = uniqueSelected.length;
  for (const remote of uniqueSelected) {
    const index = models.findIndex(
      (model) =>
        !model.managedBy &&
        model.provider === source.provider &&
        model.api === source.api &&
        model.baseUrl === source.baseUrl &&
        model.modelId === remote.id
    );
    const previous = models[index];
    const model: DraftModel = {
      ...cloneDraftModel(source),
      id: previous?.id ?? createId("model"),
      label: resolveSavedModelLabel(source.label, remote.id, selectedCount),
      modelId: remote.id,
      hasApiKey: Boolean(
        source.apiKey || (!source.clearApiKey && source.hasApiKey)
      )
    };
    // Routing and capacity overrides belong to a specific model, not the provider.
    if (original?.modelId !== remote.id) {
      delete model.requestModelId;
      delete model.contextWindow;
      delete model.maxTokens;
      delete model.supportsDeveloperRole;
      if (previous?.requestModelId)
        model.requestModelId = previous.requestModelId;
      if (previous?.contextWindow !== undefined)
        model.contextWindow = previous.contextWindow;
      if (previous?.maxTokens !== undefined)
        model.maxTokens = previous.maxTokens;
      if (previous?.supportsDeveloperRole !== undefined)
        model.supportsDeveloperRole = previous.supportsDeveloperRole;
    }
    delete model.sourceApiKeyId;
    if (
      !source.apiKey?.trim() &&
      !source.clearApiKey &&
      source.hasApiKey &&
      payload.originalId
    ) {
      model.sourceApiKeyId = payload.originalId;
    }
    if (index >= 0) models[index] = model;
    else models.push(model);
  }
  return models;
}
