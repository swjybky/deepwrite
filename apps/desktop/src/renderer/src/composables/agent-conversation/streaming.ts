import { expireIdleConversation, type IdleTimeoutScope } from "./idle-timeout";
import type { AgentConversationContext } from "./context";
import {
  invalidateAttemptForRun,
  markRunError,
  ensureAssistantMessage
} from "./retry-subagent";
import { STREAM_PRESENTATION_FALLBACK_MS } from "./shared";
import type {
  AgentTextDeltaEventEnvelope,
  PendingAgentTextDelta
} from "./types";

export function clearIdleTimer(ctx: AgentConversationContext): void {
  if (ctx.idleTimer !== undefined) {
    globalThis.clearTimeout(ctx.idleTimer);
    ctx.idleTimer = undefined;
  }
}

export function scheduleIdleTimeout(
  ctx: AgentConversationContext,
  scope: IdleTimeoutScope
): void {
  clearIdleTimer(ctx);
  ctx.idleTimer = globalThis.setTimeout(
    () => {
      ctx.idleTimer = undefined;
      expireIdleConversation(ctx, scope, (runId, message, runtime) => {
        markRunError(ctx, runId, message, runtime);
        invalidateAttemptForRun(ctx, runId);
      });
    },
    ctx.options.idleTimeoutMs ?? 5 * 60_000
  );
}

export function clearStreamPresentationSchedule(
  ctx: AgentConversationContext
): void {
  if (ctx.streamPresentationFrame !== undefined) {
    globalThis.cancelAnimationFrame?.(ctx.streamPresentationFrame);
    ctx.streamPresentationFrame = undefined;
  }
  if (ctx.streamPresentationFallbackTimer !== undefined) {
    globalThis.clearTimeout(ctx.streamPresentationFallbackTimer);
    ctx.streamPresentationFallbackTimer = undefined;
  }
}

export function applyAgentTextDelta(
  ctx: AgentConversationContext,
  pending: PendingAgentTextDelta
): void {
  const delta = pending.chunks.join("");
  const message = ensureAssistantMessage(
    ctx,
    pending.runId,
    pending.messageId,
    pending.runtime,
    pending.createdAt
  );
  if (!message) return;

  message.processingStartedAt ??= pending.createdAt;
  const lastStep = message.processingSteps?.at(-1);
  if (pending.type === "agent.message_delta") {
    message.content += delta;
    if (lastStep?.type === "response") {
      lastStep.content += delta;
    } else {
      (message.processingSteps ??= []).push({
        id: pending.eventId,
        type: "response",
        content: delta,
        createdAt: pending.createdAt
      });
    }
    return;
  }

  if (lastStep?.type === "thinking") {
    lastStep.content += delta;
    message.thinking = `${message.thinking ?? ""}${delta}`;
  } else {
    (message.processingSteps ??= []).push({
      id: pending.eventId,
      type: "thinking",
      content: delta,
      createdAt: pending.createdAt
    });
    message.thinking = message.thinking
      ? `${message.thinking}\n\n${delta}`
      : delta;
  }
}

export function flushPendingAgentTextDelta(
  ctx: AgentConversationContext
): void {
  clearStreamPresentationSchedule(ctx);
  const pending = ctx.pendingAgentTextDelta;
  ctx.pendingAgentTextDelta = undefined;
  if (pending) applyAgentTextDelta(ctx, pending);
}

export function scheduleStreamPresentation(
  ctx: AgentConversationContext
): void {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    flushPendingAgentTextDelta(ctx);
    return;
  }
  if (
    ctx.streamPresentationFrame !== undefined ||
    ctx.streamPresentationFallbackTimer !== undefined
  ) {
    return;
  }

  ctx.streamPresentationFrame = globalThis.requestAnimationFrame(() => {
    ctx.streamPresentationFrame = undefined;
    if (ctx.streamPresentationFallbackTimer !== undefined) {
      globalThis.clearTimeout(ctx.streamPresentationFallbackTimer);
      ctx.streamPresentationFallbackTimer = undefined;
    }
    flushPendingAgentTextDelta(ctx);
  });
  // requestAnimationFrame is paused for hidden Electron windows. Keep a
  // bounded fallback so the complete stream still reaches state/persistence.
  ctx.streamPresentationFallbackTimer = globalThis.setTimeout(() => {
    ctx.streamPresentationFallbackTimer = undefined;
    if (ctx.streamPresentationFrame !== undefined) {
      globalThis.cancelAnimationFrame(ctx.streamPresentationFrame);
      ctx.streamPresentationFrame = undefined;
    }
    flushPendingAgentTextDelta(ctx);
  }, STREAM_PRESENTATION_FALLBACK_MS);
}

export function queueAgentTextDelta(
  ctx: AgentConversationContext,
  event: AgentTextDeltaEventEnvelope
): void {
  const { runId, messageId, runtime: eventRuntime, delta } = event.payload;
  const pending = ctx.pendingAgentTextDelta;
  const sharesPendingStep =
    pending?.type === event.type &&
    pending.runId === runId &&
    pending.messageId === messageId;
  if (!sharesPendingStep) {
    flushPendingAgentTextDelta(ctx);
    ctx.pendingAgentTextDelta = {
      type: event.type,
      runId,
      messageId,
      runtime: eventRuntime,
      eventId: event.id,
      createdAt: event.timestamp,
      chunks: [delta]
    };
  } else if (pending) {
    pending.chunks.push(delta);
    pending.runtime = eventRuntime;
  }
  scheduleStreamPresentation(ctx);
}

export function resetTransientConversationState(
  ctx: AgentConversationContext
): void {
  ctx.epoch += 1;
  clearIdleTimer(ctx);
  ctx.submitting.value = false;
  ctx.stopping.value = false;
  ctx.pendingAttemptId.value = null;
  ctx.activeRunId.value = null;
  ctx.runtime.value = null;
  ctx.conversationError.value = null;
  ctx.handledEventIds.clear();
  ctx.finishedRunIds.clear();
  ctx.runMessageIds.clear();
  ctx.turnCheckpointByRun.clear();
  ctx.subagentTurnCheckpointByRun.clear();
  ctx.seenTurnIds.clear();
  ctx.seenSubagentTurnIds.clear();
  ctx.observedRunByAttempt.clear();
  ctx.approvalModeByAttempt.clear();
  ctx.approvalModeByRun.clear();
}
