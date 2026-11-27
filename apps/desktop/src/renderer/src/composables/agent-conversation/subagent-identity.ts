import { createScopedTranslator } from "../../i18n";
import type { AgentConversationContext } from "./context";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentSubagentRun, ChatMessage } from "../../types/conversation";
import type { SubagentEventPayload } from "./types";
import { isRecord } from "@deepwrite/shared";

const t = createScopedTranslator("workspace.subagentIdentity");

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
function stringField(record: Record<string, unknown>, name: string) {
  const value = record[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function plannedTasks(args: unknown): Record<string, unknown>[] {
  const record = isRecord(args) ? args : {};
  if (!Array.isArray(record.tasks)) return [record];
  return record.tasks.map((task) => (isRecord(task) ? task : {}));
}

function plannedDependencies(task: Record<string, unknown>): string[] {
  return Array.isArray(task.depends_on)
    ? task.depends_on.filter(
        (key): key is string => typeof key === "string" && key.trim() !== ""
      )
    : [];
}

/**
 * Shows the delegation before its first child event. A multi-task call gets
 * one queued card per task; the scheduler later reports the final order.
 */
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
  const tasks = plannedTasks(args);
  const batch = tasks.length > 1;
  tasks.forEach((task, index) => {
    const subagentId = stringField(task, "subagent_id") ?? "subagent";
    (message.subagentRuns ??= []).push({
      parentToolCallId: toolCallId,
      subagentRunId: batch
        ? `pending:${toolCallId}:${index}`
        : `pending:${toolCallId}`,
      subagentId,
      name: subagentId,
      task: stringField(task, "task") ?? t("receivingSubtask"),
      status: batch ? "queued" : "running",
      runtime: { ...eventRuntime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp,
      ...(batch
        ? {
            batchTask: {
              index,
              key: stringField(task, "key") ?? `t${index + 1}`,
              dependsOn: plannedDependencies(task)
            }
          }
        : {})
    });
  });
}
export function ensureSubagentRun(
  ctx: SubagentIdentityContext,
  message: ChatMessage,
  payload: SubagentEventPayload,
  eventTimestamp: string,
  task?: string
): AgentSubagentRun {
  const batchTask =
    "batchTask" in payload && payload.batchTask
      ? { ...payload.batchTask, dependsOn: [...payload.batchTask.dependsOn] }
      : undefined;
  let run = message.subagentRuns?.find(
    (candidate) => candidate.subagentRunId === payload.subagentRunId
  );
  run ??= message.subagentRuns?.find(
    (candidate) =>
      candidate.parentToolCallId === payload.parentToolCallId &&
      candidate.subagentRunId.startsWith("pending:") &&
      (batchTask
        ? candidate.batchTask?.index === batchTask.index
        : !candidate.batchTask)
  );
  if (!run) {
    run = {
      parentToolCallId: payload.parentToolCallId,
      subagentRunId: payload.subagentRunId,
      subagentId: payload.subagentId,
      name: payload.name,
      task: task ?? t("receivingSubtask"),
      status: "running",
      runtime: { ...payload.runtime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp,
      ...(batchTask ? { batchTask } : {}),
      ...(payload.draw ? { draw: { ...payload.draw } } : {})
    };
    (message.subagentRuns ??= []).push(run);
    return run;
  }
  if (payload.draw) run.draw = { ...payload.draw };
  run.subagentRunId = payload.subagentRunId;
  run.parentToolCallId = payload.parentToolCallId;
  run.subagentId = payload.subagentId;
  run.name = payload.name;
  run.runtime = { ...payload.runtime };
  if (batchTask) run.batchTask = batchTask;
  if (run.status === "queued" && task !== undefined) {
    // A queued card was created at request time; its run starts now.
    run.status = "running";
    run.startedAt = eventTimestamp;
  } else {
    run.startedAt = ctx.earlierTimestamp(run.startedAt, eventTimestamp);
  }
  if (task !== undefined) {
    run.task = task;
  }
  return run;
}
