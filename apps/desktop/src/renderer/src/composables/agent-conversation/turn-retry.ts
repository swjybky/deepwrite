import type { AgentConversationContext } from "./context";
import { cloneMessage } from "./clone";
import type {
  AgentRuntimeRef,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import type { AgentRetryMetadata, ChatMessage } from "../../types/conversation";
import { preserveLiveEditProposals } from "./attempt-state";
import type { AgentTurnCheckpoint } from "./types";
import { rememberBounded } from "./shared";

type TurnRetryContext = Pick<
  AgentConversationContext,
  | "ensureAssistantMessage"
  | "messages"
  | "runMessageIds"
  | "turnCheckpointByRun"
  | "seenTurnIds"
  | "assistantMessageForRun"
  | "restoreMessageCheckpoint"
  | "retryMetadata"
  | "conversationError"
>;
export function retryMetadata(
  ctx: TurnRetryContext,
  input: {
    state: AgentRetryMetadata["state"];
    turnId: string;
    attempt: number;
    maxAttempts: number;
    retryAt?: string;
    delayMs?: number;
    reason?: string;
  }
): AgentRetryMetadata {
  return {
    state: input.state,
    turnId: input.turnId,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    ...(input.retryAt ? { retryAt: input.retryAt } : {}),
    ...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  };
}
export function restoreMessageCheckpoint(
  ctx: TurnRetryContext,
  runId: string,
  messageId: string,
  checkpoint: AgentTurnCheckpoint,
  retry: AgentRetryMetadata,
  eventRuntime: AgentRuntimeRef,
  eventTimestamp: string
): ChatMessage | undefined {
  const current = ctx.ensureAssistantMessage(
    runId,
    messageId,
    eventRuntime,
    eventTimestamp
  );
  if (!current) return undefined;
  const index = ctx.messages.value.indexOf(current);
  if (index < 0) return undefined;
  const restored = checkpoint.message
    ? cloneMessage(checkpoint.message)
    : {
        id: current.id,
        role: "assistant" as const,
        content: "",
        createdAt: current.createdAt,
        runId,
        status: "streaming" as const,
        runtime: { ...eventRuntime }
      };
  preserveLiveEditProposals(current, restored);
  restored.status = "streaming";
  restored.runtime = { ...eventRuntime };
  restored.retry = retry;
  delete restored.errorMessage;
  delete restored.processingCompletedAt;
  ctx.messages.value.splice(index, 1, restored);
  ctx.runMessageIds.set(runId, restored.id);
  return restored;
}
export function handleTurnStarted(
  ctx: TurnRetryContext,
  event: Extract<
    SystemEventEnvelope,
    {
      type: "agent.turn_started";
    }
  >
): void {
  const {
    runId,
    messageId,
    turnId,
    attempt,
    maxAttempts,
    runtime: eventRuntime
  } = event.payload;
  const turnKey = `${runId}\u0000${turnId}`;
  let checkpoint = ctx.turnCheckpointByRun.get(runId);
  if (!checkpoint || checkpoint.turnId !== turnId) {
    if (ctx.seenTurnIds.has(turnKey)) return;
    const existing = ctx.assistantMessageForRun(runId);
    const snapshot = existing ? cloneMessage(existing) : null;
    if (snapshot?.retry) delete snapshot.retry;
    checkpoint = {
      turnId,
      messageId,
      attempt,
      maxAttempts,
      attemptStartedAt: event.timestamp,
      message: snapshot
    };
    ctx.turnCheckpointByRun.set(runId, checkpoint);
    rememberBounded(ctx.seenTurnIds, turnKey);
  } else {
    if (attempt <= checkpoint.attempt) return;
    checkpoint.attempt = attempt;
    checkpoint.maxAttempts = maxAttempts;
    checkpoint.attemptStartedAt = event.timestamp;
  }
  let message = ctx.ensureAssistantMessage(
    runId,
    messageId,
    eventRuntime,
    event.timestamp
  );
  if (!message) return;
  if (attempt > 1) {
    message = ctx.restoreMessageCheckpoint(
      runId,
      messageId,
      checkpoint,
      ctx.retryMetadata({
        state: "trying",
        turnId,
        attempt,
        maxAttempts
      }),
      eventRuntime,
      event.timestamp
    );
  }
  if (message) {
    message.status = "streaming";
    message.runtime = { ...eventRuntime };
    message.processingStartedAt ??= event.timestamp;
  }
}
export function handleRetryScheduled(
  ctx: TurnRetryContext,
  event: Extract<
    SystemEventEnvelope,
    {
      type: "agent.retry_scheduled";
    }
  >
): void {
  const {
    runId,
    messageId,
    turnId,
    failedAttempt,
    nextAttempt,
    maxAttempts,
    delayMs,
    retryAt,
    reason,
    runtime: eventRuntime
  } = event.payload;
  const checkpoint = ctx.turnCheckpointByRun.get(runId);
  if (
    !checkpoint ||
    checkpoint.turnId !== turnId ||
    checkpoint.attempt !== failedAttempt
  ) {
    return;
  }
  ctx.restoreMessageCheckpoint(
    runId,
    messageId,
    checkpoint,
    ctx.retryMetadata({
      state: "scheduled",
      turnId,
      attempt: nextAttempt,
      maxAttempts,
      retryAt,
      delayMs,
      reason
    }),
    eventRuntime,
    event.timestamp
  );
  ctx.conversationError.value = null;
}
export function acceptsRetryActivity(
  ctx: TurnRetryContext,
  runId: string,
  eventTimestamp: string
): boolean {
  const message = ctx.assistantMessageForRun(runId);
  if (!message?.retry) return true;
  if (message.retry.state === "scheduled") return false;
  const checkpoint = ctx.turnCheckpointByRun.get(runId);
  if (
    checkpoint &&
    Date.parse(eventTimestamp) < Date.parse(checkpoint.attemptStartedAt)
  ) {
    return false;
  }
  delete message.retry;
  return true;
}
