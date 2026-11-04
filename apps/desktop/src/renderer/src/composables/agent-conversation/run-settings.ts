import type { AgentConversationContext } from "./context";
import type {
  AgentTeamRunMode,
  ModelSettings,
  ThinkingLevel
} from "@deepwrite/contracts";
import type { AgentApprovalMode } from "../../types/conversation";
import type { AgentRunSettings } from "./types";

type RunSettingsContext = Pick<
  AgentConversationContext,
  | "hasRunSettingsPreference"
  | "approvalMode"
  | "agentTeamMode"
  | "configuredModels"
  | "modelSettingsApplied"
  | "selectedModelId"
  | "thinkingLevel"
  | "temperature"
  | "webSearchEnabled"
  | "defaultModelId"
  | "applyRunSettings"
>;
export function applyRunSettings(
  ctx: RunSettingsContext,
  settings: AgentRunSettings
): void {
  ctx.hasRunSettingsPreference = true;
  ctx.approvalMode.value = settings.approvalMode;
  ctx.agentTeamMode.value = settings.agentTeamMode ?? "team";
  if (ctx.configuredModels.value.length === 0) {
    if (ctx.modelSettingsApplied) {
      ctx.selectedModelId.value = "";
      ctx.thinkingLevel.value = "medium";
      ctx.temperature.value = 0.7;
      ctx.webSearchEnabled.value = false;
    } else {
      ctx.selectedModelId.value = settings.selectedModelId;
      ctx.thinkingLevel.value = settings.thinkingLevel;
      ctx.temperature.value = settings.temperature;
      ctx.webSearchEnabled.value = settings.webSearchEnabled === true;
    }
    return;
  }
  const preferredModel = ctx.configuredModels.value.find(
    (model) => model.id === settings.selectedModelId
  );
  const selected =
    preferredModel ??
    ctx.configuredModels.value.find(
      (model) => model.id === ctx.defaultModelId.value
    ) ??
    ctx.configuredModels.value[0];
  if (!selected) return;
  ctx.selectedModelId.value = selected.id;
  ctx.thinkingLevel.value =
    preferredModel &&
    (settings.thinkingLevel === "off" ||
      selected.thinkingLevelOptions.includes(settings.thinkingLevel))
      ? settings.thinkingLevel
      : selected.defaultThinkingLevel;
  ctx.temperature.value =
    preferredModel && selected.temperatureOptions.includes(settings.temperature)
      ? settings.temperature
      : (selected.temperatureOptions[1] ?? 0.7);
  ctx.webSearchEnabled.value =
    settings.webSearchEnabled ?? ctx.webSearchEnabled.value;
}
export function applyModelSettings(
  ctx: RunSettingsContext,
  settings: ModelSettings
): void {
  const currentRunSettings: AgentRunSettings = {
    selectedModelId: ctx.selectedModelId.value,
    thinkingLevel: ctx.thinkingLevel.value,
    temperature: ctx.temperature.value,
    approvalMode: ctx.approvalMode.value,
    agentTeamMode: ctx.agentTeamMode.value,
    webSearchEnabled: ctx.webSearchEnabled.value
  };
  ctx.configuredModels.value = settings.models;
  ctx.defaultModelId.value = settings.defaultModelId;
  ctx.modelSettingsApplied = true;
  if (settings.models.length === 0) {
    ctx.selectedModelId.value = "";
    ctx.thinkingLevel.value = "medium";
    ctx.temperature.value = 0.7;
    ctx.webSearchEnabled.value = false;
    return;
  }
  if (ctx.hasRunSettingsPreference) {
    ctx.applyRunSettings(currentRunSettings);
    return;
  }
  const selected =
    settings.models.find((model) => model.id === settings.defaultModelId) ??
    settings.models[0];
  ctx.selectedModelId.value = selected?.id ?? "";
  ctx.thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
  ctx.temperature.value = selected?.temperatureOptions[1] ?? 0.7;
  ctx.webSearchEnabled.value = false;
  ctx.hasRunSettingsPreference = true;
}
export function selectModel(ctx: RunSettingsContext, modelId: string): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === modelId
  );
  if (!selected) {
    return;
  }
  ctx.selectedModelId.value = selected.id;
  ctx.thinkingLevel.value = selected.defaultThinkingLevel;
  ctx.temperature.value = selected.temperatureOptions[1];
}
export function selectThinkingLevel(
  ctx: RunSettingsContext,
  level: ThinkingLevel
): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === ctx.selectedModelId.value
  );
  if (!selected) {
    ctx.thinkingLevel.value = level;
    return;
  }
  if (level !== "off" && !selected.thinkingLevelOptions.includes(level)) {
    return;
  }
  ctx.thinkingLevel.value = level;
}
export function selectWebSearchEnabled(
  ctx: RunSettingsContext,
  enabled: boolean
): void {
  // Whether search can be turned on is the settings' call; the switch only
  // offers it while they allow it, and Main checks again when the run starts.
  ctx.webSearchEnabled.value = enabled;
}
export function selectTemperature(
  ctx: RunSettingsContext,
  value: number
): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === ctx.selectedModelId.value
  );
  if (
    !selected ||
    ctx.thinkingLevel.value !== "off" ||
    !selected.temperatureOptions.includes(value)
  ) {
    return;
  }
  ctx.temperature.value = value;
}
export function selectApprovalMode(
  ctx: RunSettingsContext,
  mode: AgentApprovalMode
): void {
  if (mode === "request-approval" || mode === "auto-approve") {
    ctx.approvalMode.value = mode;
  }
}
export function selectAgentTeamMode(
  ctx: RunSettingsContext,
  mode: AgentTeamRunMode
): void {
  if (mode === "normal" || mode === "team") {
    ctx.agentTeamMode.value = mode;
  }
}
