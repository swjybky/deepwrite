import { createScopedTranslator } from "../i18n";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelConfig,
  type ModelConfigInput,
  type TemperatureOptions,
  type ThinkingLevel,
  type ThinkingLevelOptions
} from "@deepwrite/contracts";

const t = createScopedTranslator("components.modelSettingsDraft");

export interface DraftModel extends ModelConfig {
  apiKey?: string;
  clearApiKey?: boolean;
  sourceApiKeyId?: string;
  customThinkingLevel?: string;
  originalId?: string;
}

export type ModelConfigRow =
  | { key: string; type: "model"; model: DraftModel }
  | { key: string; type: "editor" };

export const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  get minimal() {
    return t("minimal");
  },
  get low() {
    return t("low");
  },
  get medium() {
    return t("medium");
  },
  get high() {
    return t("high");
  },
  get xhigh() {
    return t("extraHigh");
  },
  get max() {
    return t("maximum");
  }
};

export function isBuiltInThinkingLevel(
  level: string
): level is BuiltInReasoningLevel {
  return BUILT_IN_REASONING_LEVELS.some((candidate) => candidate === level);
}

export function findCustomThinkingLevel(options: ThinkingLevelOptions): string {
  return options.find((level) => !isBuiltInThinkingLevel(level)) ?? "";
}

export function cloneTemperatureOptions(
  options: TemperatureOptions
): TemperatureOptions {
  return [options[0], options[1], options[2]];
}

export function cloneThinkingLevelOptions(
  options: ThinkingLevelOptions
): ThinkingLevelOptions {
  return [...options];
}

export function cloneDraftModel(model: DraftModel): DraftModel {
  return {
    ...model,
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    customThinkingLevel: findCustomThinkingLevel(model.thinkingLevelOptions)
  };
}

export function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") return t("off");
  return isBuiltInThinkingLevel(level)
    ? builtInThinkingLabels[level]
    : t("customValue", { arg0: level });
}

export function toModelInput(model: DraftModel): ModelConfigInput {
  return {
    id: model.id,
    label: model.label.trim(),
    provider: model.provider.trim().toLowerCase(),
    modelId: model.modelId.trim(),
    ...(model.requestModelId ? { requestModelId: model.requestModelId } : {}),
    ...(model.supportsDeveloperRole !== undefined
      ? { supportsDeveloperRole: model.supportsDeveloperRole }
      : {}),
    ...(model.toolSchemaProfile
      ? { toolSchemaProfile: model.toolSchemaProfile }
      : {}),
    api: model.api,
    baseUrl: model.baseUrl.trim(),
    reasoning: model.reasoning,
    defaultThinkingLevel: model.reasoning ? model.defaultThinkingLevel : "off",
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    ...(model.modelKind === "jev" ? { modelKind: "jev" as const } : {}),
    ...(model.managedBy ? { managedBy: model.managedBy } : {}),
    ...(model.status !== undefined ? { status: model.status } : {}),
    ...(model.discount !== undefined ? { discount: model.discount } : {}),
    ...(model.input !== undefined ? { input: model.input } : {}),
    ...(model.output !== undefined ? { output: model.output } : {}),
    ...(model.cache !== undefined ? { cache: model.cache } : {}),
    ...(model.contextWindow !== undefined
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.apiKey?.trim() ? { apiKey: model.apiKey.trim() } : {}),
    ...(model.clearApiKey ? { clearApiKey: true } : {}),
    ...(model.sourceApiKeyId ? { sourceApiKeyId: model.sourceApiKeyId } : {})
  };
}
