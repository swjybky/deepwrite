import {
  BUILT_IN_REASONING_LEVELS,
  type ModelConfig,
  type ShortAgentSubagentDefinition,
  type ShortAgentSubagentModelMode,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import type { PopupSelectOption } from "./PopupSelect.vue";
import { buildModelSelectOptions } from "../utils/modelSelectOptions";
import {
  agentTeamModelDefaults,
  agentTeamThinkingLabel
} from "./agentTeamSettingsEditorHelpers";

const t = createScopedTranslator("components.agentTeamSettingsEditorHelpers");

/** A member's own model choice, or the evaluator model of its draws. */
export type SubagentModelTarget = Pick<
  ShortAgentSubagentDefinition,
  "modelMode" | "modelId" | "thinkingLevel" | "temperature"
>;

/**
 * Model, reasoning and temperature rules shared by the short, script and
 * novel team editors. The editors only differ in which team they edit.
 */
export function useSubagentModelConfig(source: {
  models: () => readonly ModelConfig[];
  disabled: () => boolean;
}) {
  const modelById = computed(
    () => new Map(source.models().map((model) => [model.id, model]))
  );
  const modelOptions = computed(() => buildModelSelectOptions(source.models()));

  function modelOf(subagent: SubagentModelTarget) {
    return subagent.modelId ? modelById.value.get(subagent.modelId) : undefined;
  }

  function thinkingOptionsFor(
    subagent: SubagentModelTarget
  ): PopupSelectOption[] {
    const levels =
      modelOf(subagent)?.thinkingLevelOptions ?? BUILT_IN_REASONING_LEVELS;
    return [
      { value: "off", label: agentTeamThinkingLabel("off") },
      ...levels.map((value) => ({
        value,
        label: agentTeamThinkingLabel(value)
      }))
    ];
  }

  function temperatureOptionsFor(
    subagent: SubagentModelTarget
  ): PopupSelectOption[] {
    return (modelOf(subagent)?.temperatureOptions ?? [0.1, 0.7, 1]).map(
      (value) => ({ value, label: t("temperatureValue", { arg0: value }) })
    );
  }

  function applyModelRunDefaults(
    subagent: SubagentModelTarget,
    modelId: string | undefined
  ): void {
    const defaults = agentTeamModelDefaults(
      modelId ? modelById.value.get(modelId) : undefined
    );
    subagent.thinkingLevel = defaults.thinkingLevel;
    subagent.temperature = defaults.temperature;
  }

  function setModelMode(
    subagent: SubagentModelTarget,
    mode: ShortAgentSubagentModelMode
  ): void {
    if (source.disabled()) return;
    subagent.modelMode = mode;
    if (mode !== "custom") {
      delete subagent.modelId;
      delete subagent.thinkingLevel;
      delete subagent.temperature;
      return;
    }
    const firstModel = source.models()[0];
    if (!subagent.modelId && firstModel) subagent.modelId = firstModel.id;
    if (subagent.thinkingLevel === undefined) {
      applyModelRunDefaults(subagent, subagent.modelId);
    }
  }

  function setModelId(subagent: SubagentModelTarget, modelId: string): void {
    if (source.disabled()) return;
    subagent.modelId = modelId;
    applyModelRunDefaults(subagent, modelId);
  }

  function setThinkingLevel(
    subagent: SubagentModelTarget,
    rawLevel: string
  ): void {
    if (source.disabled()) return;
    const level = rawLevel as ThinkingLevel;
    subagent.thinkingLevel = level;
    if (level !== "off") return;
    const options = temperatureOptionsFor(subagent);
    const current = subagent.temperature;
    if (
      current === undefined ||
      !options.some((option) => Object.is(option.value, current))
    ) {
      subagent.temperature = Number(
        options[1]?.value ?? options[0]?.value ?? 0.7
      );
    }
  }

  function setTemperature(
    subagent: SubagentModelTarget,
    temperature: number
  ): void {
    if (source.disabled()) return;
    subagent.temperature = temperature;
  }

  function subagentModelSummary(subagent: SubagentModelTarget): string {
    if (subagent.modelMode !== "custom") return t("usePrimaryAgentModel");
    if (!subagent.modelId) return t("separateConfigurationNoModelSelected");
    const modelLabel =
      modelById.value.get(subagent.modelId)?.label ?? subagent.modelId;
    if (subagent.thinkingLevel === undefined) return modelLabel;
    if (
      subagent.thinkingLevel === "off" &&
      subagent.temperature !== undefined
    ) {
      return t("valueOffTemperatureValue", {
        arg0: modelLabel,
        arg1: subagent.temperature
      });
    }
    return `${modelLabel} · ${agentTeamThinkingLabel(subagent.thinkingLevel)}`;
  }

  return {
    modelOptions,
    thinkingOptionsFor,
    temperatureOptionsFor,
    setModelMode,
    setModelId,
    setThinkingLevel,
    setTemperature,
    subagentModelSummary
  };
}

export type SubagentModelConfig = ReturnType<typeof useSubagentModelConfig>;
