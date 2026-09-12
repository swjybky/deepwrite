import { handleToolEvent } from "./tool-events";
import type { AgentConversationContext } from "./context";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { AgentEvaluationSnapshotSchema } from "@deepwrite/contracts/renderer";
import { finalizeUnfinishedMessageTools } from "./attempt-state";
import { rememberBounded } from "./shared";
import { isAgentEvent, isSubagentEvent } from "./event-kinds";

type EventsContext = Pick<
  AgentConversationContext,
  | "sessionId"
  | "handledEventIds"
  | "finishedRunIds"
  | "messages"
  | "activeRunId"
  | "pendingAttemptId"
  | "observedRunByAttempt"
  | "failProtocol"
  | "runtime"
  | "approvalModeByAttempt"
  | "rememberRunApprovalMode"
  | "submitting"
  | "scheduleIdleTimeout"
  | "epoch"
  | "flushPendingAgentTextDelta"
  | "handleSubagentEvent"
  | "userInput"
  | "clearIdleTimer"
  | "ensureAssistantMessage"
  | "handleTurnStarted"
  | "handleRetryScheduled"
  | "acceptsRetryActivity"
  | "queueAgentTextDelta"
  | "finalizeRunningSubagents"
  | "finishRun"
  | "markRunStopped"
  | "conversationError"
  | "markRunError"
> &
  Parameters<typeof handleToolEvent>[0];
export function handleEvent(
  ctx: EventsContext,
  event: SystemEventEnvelope
): void {
  if (!isAgentEvent(event) || event.payload.sessionId !== ctx.sessionId.value) {
    return;
  }
  if (ctx.handledEventIds.has(event.id)) {
    return;
  }
  const runId = event.payload.runId;
  const subagentEvent = isSubagentEvent(event);
  const lateSubagentEvent =
    subagentEvent &&
    ctx.finishedRunIds.has(runId) &&
    ctx.messages.value.some(
      (message) => message.role === "assistant" && message.runId === runId
    );
  const lateEvaluationSnapshot =
    event.type === "agent.evaluation_snapshot" &&
    ctx.finishedRunIds.has(runId) &&
    ctx.messages.value.some(
      (message) => message.role === "assistant" && message.runId === runId
    );
  if (
    ctx.finishedRunIds.has(runId) &&
    !lateSubagentEvent &&
    !lateEvaluationSnapshot
  ) {
    return;
  }
  if (
    ctx.activeRunId.value &&
    ctx.activeRunId.value !== runId &&
    !lateSubagentEvent &&
    !lateEvaluationSnapshot
  ) {
    return;
  }
  if (!ctx.activeRunId.value && !lateSubagentEvent && !lateEvaluationSnapshot) {
    if (ctx.pendingAttemptId.value === null) {
      return;
    }
    const observedRunId = ctx.observedRunByAttempt.get(
      ctx.pendingAttemptId.value
    );
    if (observedRunId && observedRunId !== runId) {
      ctx.failProtocol(
        observedRunId,
        "同一次请求收到了多个运行标识。",
        ctx.runtime.value ?? undefined
      );
      return;
    }
    ctx.observedRunByAttempt.set(ctx.pendingAttemptId.value, runId);
    const pendingMode = ctx.approvalModeByAttempt.get(
      ctx.pendingAttemptId.value
    );
    if (pendingMode) ctx.rememberRunApprovalMode(runId, pendingMode);
    ctx.activeRunId.value = runId;
  }
  rememberBounded(ctx.handledEventIds, event.id);
  if (!lateSubagentEvent && !lateEvaluationSnapshot) {
    ctx.submitting.value = false;
    ctx.scheduleIdleTimeout({
      expectedEpoch: ctx.epoch,
      expectedSessionId: ctx.sessionId.value,
      runId
    });
  }
  if (
    event.type !== "agent.message_delta" &&
    event.type !== "agent.thinking_delta"
  ) {
    // Terminal, retry, tool, and subagent events are ordering boundaries.
    // Settle every preceding text fragment before applying that event.
    ctx.flushPendingAgentTextDelta();
  }
  if (subagentEvent) {
    ctx.handleSubagentEvent(event);
    return;
  }
  if (event.type === "agent.user_input_requested") {
    ctx.userInput.receive(event.payload);
    ctx.clearIdleTimer();
    return;
  }
  if (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed"
  ) {
    ctx.userInput.clearSubmitted(runId);
  }
  if (event.type === "agent.evaluation_snapshot") {
    const message = ctx.ensureAssistantMessage(
      runId,
      event.payload.messageId,
      event.payload.runtime,
      event.timestamp
    );
    if (message) {
      const parsedEvaluation = AgentEvaluationSnapshotSchema.safeParse(
        event.payload.snapshot
      );
      if (parsedEvaluation.success) {
        message.evaluationSnapshot = parsedEvaluation.data;
      }
    }
    return;
  }
  if (event.type === "agent.turn_started") {
    ctx.handleTurnStarted(event);
    return;
  }
  if (event.type === "agent.retry_scheduled") {
    ctx.handleRetryScheduled(event);
    return;
  }
  if (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta"
  ) {
    if (!ctx.acceptsRetryActivity(runId, event.timestamp)) return;
    ctx.queueAgentTextDelta(event);
    return;
  }
  if (
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed"
  ) {
    handleToolEvent(ctx, event);
    return;
  }
  if (event.type === "agent.message_completed") {
    if (!ctx.acceptsRetryActivity(runId, event.timestamp)) return;
    const message = ctx.ensureAssistantMessage(
      runId,
      event.payload.messageId,
      event.payload.runtime,
      event.timestamp
    );
    if (!message) {
      return;
    }
    message.content = event.payload.content;
    if (event.payload.thinking?.trim() && !message.thinking) {
      message.thinking = event.payload.thinking;
      (message.processingSteps ??= []).push({
        id: `${event.id}_thinking`,
        type: "thinking",
        content: event.payload.thinking,
        createdAt: event.timestamp
      });
    }
    const lastStep = message.processingSteps?.at(-1);
    if (event.payload.content) {
      if (lastStep?.type === "response") {
        // The terminal payload contains the final assistant turn only. Earlier
        // response turns may have been followed by tools, so keep them as
        // separate chronological steps and replace only the final turn.
        lastStep.content = event.payload.content;
      } else {
        (message.processingSteps ??= []).push({
          id: `${event.id}_response`,
          type: "response",
          content: event.payload.content,
          createdAt: event.timestamp
        });
      }
    }
    ctx.finalizeRunningSubagents(
      message,
      "error",
      event.timestamp,
      "父智能体运行已完成，但子任务未返回完整终态。"
    );
    finalizeUnfinishedMessageTools(
      message,
      event.timestamp,
      "智能体运行已完成，但工具调用未返回完整终态。"
    );
    message.status = "completed";
    message.activityOnly = false;
    if (message.processingStartedAt) {
      message.processingCompletedAt = event.timestamp;
    }
    message.runtime = event.payload.runtime;
    if (event.payload.usage !== undefined) {
      message.usage = event.payload.usage;
    }
    ctx.finishRun(runId);
    return;
  }
  if (event.type !== "agent.error") {
    return;
  }
  if (event.payload.code === "pi_agent.aborted") {
    ctx.markRunStopped(runId, event.payload.runtime);
    ctx.conversationError.value = null;
    ctx.finishRun(runId);
    return;
  }
  ctx.markRunError(runId, event.payload.message, event.payload.runtime);
  ctx.conversationError.value = event.payload.message;
  ctx.finishRun(runId);
}
