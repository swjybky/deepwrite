import { createScopedTranslator } from "../../i18n";
import type {
  AgentSubagentProcessingStep,
  AgentSubagentRun,
  AgentToolTrace
} from "../../types/conversation";
import { validDate } from "./shared";
import {
  parseStoredRuntime,
  parseStoredUsage,
  parseStoredToolTrace
} from "./parse-runtime";
import { parseStoredDrawRef } from "./parse-subagent-draw";
import { isRecord } from "@deepwrite/shared";

const t = createScopedTranslator("workspace.parseSubagent");
export function parseStoredSubagentStep(
  value: unknown
): AgentSubagentProcessingStep | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  if (value.type === "thinking" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "thinking",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "response" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "response",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "tool" && typeof value.toolCallId === "string") {
    return {
      id: value.id,
      type: "tool",
      toolCallId: value.toolCallId,
      createdAt: value.createdAt
    };
  }
  return undefined;
}
export function parseStoredSubagentRun(
  value: unknown
): AgentSubagentRun | undefined {
  if (
    !isRecord(value) ||
    typeof value.parentToolCallId !== "string" ||
    typeof value.subagentRunId !== "string" ||
    typeof value.subagentId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.task !== "string" ||
    ![
      "queued",
      "running",
      "completed",
      "error",
      "stopped",
      "skipped",
      "interrupted"
    ].includes(String(value.status)) ||
    !validDate(value.startedAt) ||
    !Array.isArray(value.toolCalls) ||
    !Array.isArray(value.processingSteps)
  ) {
    return undefined;
  }
  const runtime = parseStoredRuntime(value.runtime);
  if (!runtime) return undefined;
  const toolCalls = value.toolCalls
    .map(parseStoredToolTrace)
    .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  const processingSteps = value.processingSteps
    .map(parseStoredSubagentStep)
    .filter((step): step is AgentSubagentProcessingStep => step !== undefined);
  if (
    toolCalls.length !== value.toolCalls.length ||
    processingSteps.length !== value.processingSteps.length
  ) {
    return undefined;
  }

  const restoredWhileQueued = value.status === "queued";
  const restoredWhileRunning = value.status === "running";
  const batchTask = parseStoredBatchTask(value.batchTask);
  const draw = parseStoredDrawRef(value.draw);
  const restoredAt = new Date().toISOString();
  const normalizedToolCalls = restoredWhileRunning
    ? toolCalls.map((toolCall) =>
        toolCall.status === "preparing" || toolCall.status === "running"
          ? {
              ...toolCall,
              status: "error" as const,
              completedAt: restoredAt,
              resultSummary:
                toolCall.resultSummary ??
                t("theSubtaskWasStoppedWhenTheConversationWasRestored"),
              isError: true
            }
          : toolCall
      )
    : toolCalls;
  const usage = parseStoredUsage(value.usage);
  return {
    parentToolCallId: value.parentToolCallId,
    subagentRunId: value.subagentRunId,
    subagentId: value.subagentId,
    name: value.name,
    task: value.task,
    status: restoredWhileQueued
      ? "skipped"
      : restoredWhileRunning || value.status === "interrupted"
        ? "stopped"
        : (value.status as AgentSubagentRun["status"]),
    runtime,
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    toolCalls: normalizedToolCalls,
    processingSteps,
    startedAt: value.startedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : restoredWhileRunning || restoredWhileQueued
        ? { completedAt: restoredAt }
        : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : restoredWhileRunning
        ? {
            errorMessage: t("theSubtaskWasStillRunningWhenTheAppClosed")
          }
        : restoredWhileQueued
          ? {
              errorMessage: t("theSubtaskHadNotStartedWhenTheAppClosed")
            }
          : {}),
    ...(usage ? { usage } : {}),
    ...(batchTask ? { batchTask } : {}),
    ...(draw ? { draw } : {}),
    ...(Number.isSafeInteger(value.drawCount)
      ? { drawCount: value.drawCount as number }
      : {})
  };
}

function parseStoredBatchTask(
  value: unknown
): AgentSubagentRun["batchTask"] | undefined {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.index) ||
    (value.index as number) < 0 ||
    typeof value.key !== "string" ||
    !value.key ||
    !Array.isArray(value.dependsOn) ||
    value.dependsOn.some((key) => typeof key !== "string")
  ) {
    return undefined;
  }
  return {
    index: value.index as number,
    key: value.key,
    dependsOn: [...(value.dependsOn as string[])]
  };
}
