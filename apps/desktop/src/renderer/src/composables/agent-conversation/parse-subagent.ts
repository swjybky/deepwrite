import type {
  AgentSubagentProcessingStep,
  AgentSubagentRun,
  AgentToolTrace
} from "../../types/conversation";
import { isRecord, validDate } from "./shared";
import {
  parseStoredRuntime,
  parseStoredUsage,
  parseStoredToolTrace
} from "./parse-runtime";
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
    !["running", "completed", "error", "stopped", "interrupted"].includes(
      String(value.status)
    ) ||
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

  const restoredWhileRunning = value.status === "running";
  const restoredAt = new Date().toISOString();
  const normalizedToolCalls = restoredWhileRunning
    ? toolCalls.map((toolCall) =>
        toolCall.status === "preparing" || toolCall.status === "running"
          ? {
              ...toolCall,
              status: "error" as const,
              completedAt: restoredAt,
              resultSummary:
                toolCall.resultSummary ?? "会话恢复时子任务已停止。",
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
    status:
      restoredWhileRunning || value.status === "interrupted"
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
      : restoredWhileRunning
        ? { completedAt: restoredAt }
        : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : restoredWhileRunning
        ? { errorMessage: "应用关闭或对话恢复时，子任务仍在运行。" }
        : {}),
    ...(usage ? { usage } : {})
  };
}
