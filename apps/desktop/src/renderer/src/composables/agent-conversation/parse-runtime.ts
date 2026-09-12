import type { AgentRuntimeRef, AgentUsage } from "@deepwrite/contracts";
import type { AgentToolTrace } from "../../types/conversation";
import { isRecord, nonnegativeInteger } from "./shared";
export function parseStoredRuntime(
  value: unknown
): AgentRuntimeRef | undefined {
  if (
    !isRecord(value) ||
    typeof value.provider !== "string" ||
    !value.provider ||
    typeof value.model !== "string" ||
    !value.model ||
    (value.mode !== "local-faux" && value.mode !== "provider") ||
    (value.configId !== undefined &&
      (typeof value.configId !== "string" || !value.configId.trim()))
  ) {
    return undefined;
  }
  return {
    provider: value.provider,
    model: value.model,
    mode: value.mode,
    ...(typeof value.configId === "string" ? { configId: value.configId } : {})
  };
}
export function parseStoredUsage(value: unknown): AgentUsage | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens"
  ] as const;
  if (!keys.every((key) => nonnegativeInteger(value[key]))) return undefined;
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheWriteTokens: value.cacheWriteTokens as number,
    totalTokens: value.totalTokens as number
  };
}
export function parseStoredToolTrace(
  value: unknown
): AgentToolTrace | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !["preparing", "running", "completed", "error"].includes(
      String(value.status)
    ) ||
    typeof value.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ...(typeof value.streamId === "string" ? { streamId: value.streamId } : {}),
    name: value.name,
    args: value.args,
    ...(typeof value.argumentsText === "string"
      ? { argumentsText: value.argumentsText }
      : {}),
    ...(typeof value.argumentsComplete === "boolean"
      ? { argumentsComplete: value.argumentsComplete }
      : {}),
    status: value.status as AgentToolTrace["status"],
    requestedAt: value.requestedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.resultSummary === "string"
      ? { resultSummary: value.resultSummary }
      : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {})
  };
}
