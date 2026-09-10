import type {
  AgentConversationController,
  AgentRunSettings
} from "../composables/useAgentConversation";
import {
  normalizeAgentRunPreferences,
  type AgentModelSelection,
  type AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";

export function captureRunSettings(
  controller: AgentConversationController
): AgentRunSettings {
  return {
    selectedModelId: controller.selectedModelId.value,
    thinkingLevel: controller.thinkingLevel.value,
    temperature: controller.temperature.value,
    approvalMode: controller.approvalMode.value,
    agentTeamMode: controller.agentTeamMode.value,
    webSearchEnabled: controller.webSearchEnabled.value
  };
}

export function validModelSelection(
  value: unknown
): value is AgentModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.selectedModelId === "string" &&
    candidate.selectedModelId.length <= 120 &&
    typeof candidate.thinkingLevel === "string" &&
    candidate.thinkingLevel.length > 0 &&
    candidate.thinkingLevel.length <= 64 &&
    (candidate.webSearchEnabled === undefined ||
      typeof candidate.webSearchEnabled === "boolean")
  );
}

export function normalizeRunPreferencesByScope(
  value: unknown
): AgentRunPreferencesByScope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const normalized = normalizeAgentRunPreferences(value);
  return Object.keys(normalized).length === Object.keys(value).length
    ? normalized
    : undefined;
}
