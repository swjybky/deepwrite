import type { AgentConversationContext } from "./context";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentSubagentRun, ChatMessage } from "../../types/conversation";
import type { SubagentEventPayload } from "./types";
import { isRecord } from "./shared";

type SubagentIdentityContext = Pick<
  AgentConversationContext,
  "earlierTimestamp"
>;
export function subagentTurnKey(
  ctx: SubagentIdentityContext,
  runId: string,
  subagentRunId: string
): string {
  return `${runId}\u0000${subagentRunId}`;
}
export function earlierTimestamp(
  ctx: SubagentIdentityContext,
  current: string,
  candidate: string
): string {
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(currentTime)) return candidate;
  if (!Number.isFinite(candidateTime)) return current;
  return candidateTime < currentTime ? candidate : current;
}
export function ensurePendingSubagentRunForTool(
  ctx: SubagentIdentityContext,
  message: ChatMessage,
  toolCallId: string,
  args: unknown,
  eventRuntime: AgentRuntimeRef,
  eventTimestamp: string
): void {
  if (
    message.subagentRuns?.some((run) => run.parentToolCallId === toolCallId)
  ) {
    return;
  }
  const record = isRecord(args) ? args : {};
  const subagentId =
    typeof record.subagent_id === "string" && record.subagent_id.trim()
      ? record.subagent_id.trim()
      : "subagent";
  const task =
    typeof record.task === "string" && record.task.trim()
      ? record.task.trim()
      : "正在接收子任务…";
  (message.subagentRuns ??= []).push({
    parentToolCallId: toolCallId,
    subagentRunId: `pending:${toolCallId}`,
    subagentId,
    name: subagentId,
    task,
    status: "running",
    runtime: { ...eventRuntime },
    toolCalls: [],
    processingSteps: [],
    startedAt: eventTimestamp
  });
}
export function ensureSubagentRun(
  ctx: SubagentIdentityContext,
  message: ChatMessage,
  payload: SubagentEventPayload,
  eventTimestamp: string,
  task?: string
): AgentSubagentRun {
  let run = message.subagentRuns?.find(
    (candidate) => candidate.subagentRunId === payload.subagentRunId
  );
  run ??= message.subagentRuns?.find(
    (candidate) =>
      candidate.parentToolCallId === payload.parentToolCallId &&
      candidate.subagentRunId.startsWith("pending:")
  );
  if (!run) {
    run = {
      parentToolCallId: payload.parentToolCallId,
      subagentRunId: payload.subagentRunId,
      subagentId: payload.subagentId,
      name: payload.name,
      task: task ?? "正在接收子任务…",
      status: "running",
      runtime: { ...payload.runtime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp
    };
    (message.subagentRuns ??= []).push(run);
    return run;
  }
  run.subagentRunId = payload.subagentRunId;
  run.parentToolCallId = payload.parentToolCallId;
  run.subagentId = payload.subagentId;
  run.name = payload.name;
  run.runtime = { ...payload.runtime };
  run.startedAt = ctx.earlierTimestamp(run.startedAt, eventTimestamp);
  if (task !== undefined) {
    run.task = task;
  }
  return run;
}
