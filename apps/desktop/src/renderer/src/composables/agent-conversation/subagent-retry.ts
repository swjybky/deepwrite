import type { AgentConversationContext } from "./context";
import { cloneSubagentRun } from "./clone";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type {
  AgentRetryMetadata,
  AgentSubagentRun
} from "../../types/conversation";
import type {
  SubagentTurnCheckpoint,
  SubagentActivityEventEnvelope
} from "./types";
import { rememberBounded } from "./shared";

type SubagentRetryContext = Pick<
  AgentConversationContext,
  | "subagentTurnKey"
  | "subagentTurnCheckpointByRun"
  | "seenSubagentTurnIds"
  | "restoreSubagentCheckpoint"
  | "retryMetadata"
>;
export function restoreSubagentCheckpoint(
  ctx: SubagentRetryContext,
  run: AgentSubagentRun,
  checkpoint: SubagentTurnCheckpoint,
  retry: AgentRetryMetadata,
  eventRuntime: AgentRuntimeRef
): void {
  const restored = cloneSubagentRun(checkpoint.run);
  for (const key of [
    "thinking",
    "output",
    "completedAt",
    "summary",
    "errorMessage",
    "usage",
    "retry"
  ] as const) {
    delete run[key];
  }
  Object.assign(run, restored);
  run.status = "running";
  run.runtime = { ...eventRuntime };
  run.retry = retry;
}
export function handleSubagentTurnStarted(
  ctx: SubagentRetryContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun,
  activity: Extract<
    SubagentActivityEventEnvelope["payload"]["activity"],
    {
      type: "turn_started";
    }
  >
): void {
  const key = ctx.subagentTurnKey(
    event.payload.runId,
    event.payload.subagentRunId
  );
  const seenKey = `${key}\u0000${activity.turnId}`;
  let checkpoint = ctx.subagentTurnCheckpointByRun.get(key);
  if (!checkpoint || checkpoint.turnId !== activity.turnId) {
    if (ctx.seenSubagentTurnIds.has(seenKey)) return;
    const snapshot = cloneSubagentRun(run);
    if (snapshot.retry) delete snapshot.retry;
    checkpoint = {
      turnId: activity.turnId,
      attempt: activity.attempt,
      maxAttempts: activity.maxAttempts,
      attemptStartedAt: event.timestamp,
      run: snapshot
    };
    ctx.subagentTurnCheckpointByRun.set(key, checkpoint);
    rememberBounded(ctx.seenSubagentTurnIds, seenKey);
  } else {
    if (activity.attempt <= checkpoint.attempt) return;
    checkpoint.attempt = activity.attempt;
    checkpoint.maxAttempts = activity.maxAttempts;
    checkpoint.attemptStartedAt = event.timestamp;
  }
  if (activity.attempt > 1) {
    ctx.restoreSubagentCheckpoint(
      run,
      checkpoint,
      ctx.retryMetadata({
        state: "trying",
        turnId: activity.turnId,
        attempt: activity.attempt,
        maxAttempts: activity.maxAttempts
      }),
      event.payload.runtime
    );
  }
}
export function handleSubagentRetryScheduled(
  ctx: SubagentRetryContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun,
  activity: Extract<
    SubagentActivityEventEnvelope["payload"]["activity"],
    {
      type: "retry_scheduled";
    }
  >
): void {
  const key = ctx.subagentTurnKey(
    event.payload.runId,
    event.payload.subagentRunId
  );
  const checkpoint = ctx.subagentTurnCheckpointByRun.get(key);
  if (
    !checkpoint ||
    checkpoint.turnId !== activity.turnId ||
    checkpoint.attempt !== activity.failedAttempt
  ) {
    return;
  }
  ctx.restoreSubagentCheckpoint(
    run,
    checkpoint,
    ctx.retryMetadata({
      state: "scheduled",
      turnId: activity.turnId,
      attempt: activity.nextAttempt,
      maxAttempts: activity.maxAttempts,
      retryAt: activity.retryAt,
      delayMs: activity.delayMs,
      reason: activity.reason
    }),
    event.payload.runtime
  );
}
export function acceptsSubagentRetryActivity(
  ctx: SubagentRetryContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun
): boolean {
  if (!run.retry) return true;
  if (run.retry.state === "scheduled") return false;
  const checkpoint = ctx.subagentTurnCheckpointByRun.get(
    ctx.subagentTurnKey(event.payload.runId, event.payload.subagentRunId)
  );
  if (
    checkpoint &&
    Date.parse(event.timestamp) < Date.parse(checkpoint.attemptStartedAt)
  ) {
    return false;
  }
  delete run.retry;
  return true;
}
