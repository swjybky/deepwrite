import type { AgentConversationContext } from "./context";
import type {
  AgentTextDeltaEventEnvelope,
  PendingAgentTextDelta
} from "./types";
import { STREAM_PRESENTATION_FALLBACK_MS } from "./shared";

type StreamingContext = Pick<
  AgentConversationContext,
  | "streamPresentationFrame"
  | "streamPresentationFallbackTimer"
  | "ensureAssistantMessage"
  | "messageMutations"
  | "clearStreamPresentationSchedule"
  | "pendingAgentTextDelta"
  | "applyAgentTextDelta"
  | "flushPendingAgentTextDelta"
  | "scheduleStreamPresentation"
>;
export function clearStreamPresentationSchedule(ctx: StreamingContext): void {
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
  ctx: StreamingContext,
  pending: PendingAgentTextDelta
): void {
  const delta = pending.chunks.join("");
  const message = ctx.ensureAssistantMessage(
    pending.runId,
    pending.messageId,
    pending.runtime,
    pending.createdAt
  );
  if (!message) return;
  message.processingStartedAt ??= pending.createdAt;
  const lastStep = message.processingSteps?.at(-1);
  if (pending.type === "agent.message_delta") {
    ctx.messageMutations.appendText(message, "content", delta);
    if (lastStep?.type === "response") {
      ctx.messageMutations.appendText(lastStep, "content", delta);
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
    ctx.messageMutations.appendText(lastStep, "content", delta);
    ctx.messageMutations.appendText(message, "thinking", delta);
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
export function flushPendingAgentTextDelta(ctx: StreamingContext): void {
  ctx.clearStreamPresentationSchedule();
  const pending = ctx.pendingAgentTextDelta;
  ctx.pendingAgentTextDelta = undefined;
  if (pending) ctx.applyAgentTextDelta(pending);
}
export function scheduleStreamPresentation(ctx: StreamingContext): void {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    ctx.flushPendingAgentTextDelta();
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
    ctx.flushPendingAgentTextDelta();
  });
  // requestAnimationFrame is paused for hidden Electron windows. Keep a
  // bounded fallback so the complete stream still reaches state/persistence.
  ctx.streamPresentationFallbackTimer = globalThis.setTimeout(() => {
    ctx.streamPresentationFallbackTimer = undefined;
    if (ctx.streamPresentationFrame !== undefined) {
      globalThis.cancelAnimationFrame(ctx.streamPresentationFrame);
      ctx.streamPresentationFrame = undefined;
    }
    ctx.flushPendingAgentTextDelta();
  }, STREAM_PRESENTATION_FALLBACK_MS);
}
export function queueAgentTextDelta(
  ctx: StreamingContext,
  event: AgentTextDeltaEventEnvelope
): void {
  const { runId, messageId, runtime: eventRuntime, delta } = event.payload;
  const pending = ctx.pendingAgentTextDelta;
  const sharesPendingStep =
    pending?.type === event.type &&
    pending.runId === runId &&
    pending.messageId === messageId;
  if (!sharesPendingStep) {
    ctx.flushPendingAgentTextDelta();
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
  ctx.scheduleStreamPresentation();
}
