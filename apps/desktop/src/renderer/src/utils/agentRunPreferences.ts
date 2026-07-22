import {
  resolveShortWorkspaceAgentIdForStage,
  type ThinkingLevel
} from "@deepwrite/contracts";
import type { AgentApprovalMode } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

export const AGENT_RUN_PREFERENCES_STORAGE_KEY =
  "deepwrite:agent-run-preferences:v1";

export interface AgentRunPreferences {
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  approvalMode: AgentApprovalMode;
}

export type AgentRunPreferencesByScope = Record<string, AgentRunPreferences>;

export function agentRunScopeForDocument(document: WorkspaceDocument): string {
  return document.workspaceId ? `book:${document.workspaceId}` : "general";
}

export function agentConversationKeyForDocument(
  document: WorkspaceDocument
): string {
  if (
    document.workspaceType !== "short" ||
    !document.workspaceId ||
    !document.stageId
  ) {
    return document.workspaceId ? `${document.workspaceId}:general` : "general";
  }
  const agentId =
    document.shortAgentId ?? resolveShortWorkspaceAgentIdForStage(document.stageId);
  return `${document.workspaceId}:${agentId}${
    document.expertSectionId
      ? `:${encodeURIComponent(document.expertSectionId)}`
      : ""
  }`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === "off" ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 64 &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value))
  );
}

function parseAgentRunPreference(value: unknown): AgentRunPreferences | undefined {
  if (
    !isRecord(value) ||
    typeof value.selectedModelId !== "string" ||
    value.selectedModelId.length > 120 ||
    !validThinkingLevel(value.thinkingLevel) ||
    typeof value.temperature !== "number" ||
    !Number.isFinite(value.temperature) ||
    value.temperature < 0 ||
    value.temperature > 2 ||
    (value.approvalMode !== "request-approval" &&
      value.approvalMode !== "auto-approve")
  ) {
    return undefined;
  }

  return {
    selectedModelId: value.selectedModelId,
    thinkingLevel: value.thinkingLevel,
    temperature: value.temperature,
    approvalMode: value.approvalMode
  };
}

export function parseAgentRunPreferences(
  storedValue: string | null
): AgentRunPreferencesByScope {
  if (!storedValue) return {};

  try {
    const value: unknown = JSON.parse(storedValue);
    if (!isRecord(value)) return {};

    return Object.fromEntries(
      Object.entries(value).flatMap(([scope, preference]) => {
        if (!scope.trim() || scope.length > 517) return [];
        const parsed = parseAgentRunPreference(preference);
        return parsed ? [[scope, parsed]] : [];
      })
    );
  } catch {
    return {};
  }
}
