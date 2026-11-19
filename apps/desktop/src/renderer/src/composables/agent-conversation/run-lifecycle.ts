import { createScopedTranslator } from "../../i18n";
import type { AgentConversationContext } from "./context";
import {
  expireIdleConversation,
  IDLE_BACKSTOP_MS,
  type IdleTimeoutScope
} from "./idle-timeout";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import {
  isActiveSubagentRun,
  type ChatMessage
} from "../../types/conversation";
import { claimPendingActivityPlaceholder } from "./message-identity";
import { finalizeUnfinishedMessageTools } from "./attempt-state";
import { finalizeOpenSubagentDraws } from "./subagent-draw-events";
import { id, rememberBounded } from "./shared";

const t = createScopedTranslator("workspace.runLifecycle");

type RunLifecycleContext = Pick<
  AgentConversationContext,
  | "idleTimer"
  | "turnCheckpointByRun"
  | "assistantMessageForRun"
  | "subagentTurnCheckpointByRun"
  | "subagentTurnKey"
  | "flushPendingAgentTextDelta"
  | "runMessageIds"
  | "messages"
  | "finalizeRunningSubagents"
  | "clearRetryStateForRun"
  | "finishedRunIds"
  | "observedRunByAttempt"
  | "approvalModeByAttempt"
  | "pendingAttemptId"
  | "clearIdleTimer"
  | "epoch"
  | "sessionId"
  | "activeRunId"
  | "runtime"
  | "submitting"
  | "stopping"
  | "conversationError"
  | "markRunError"
  | "invalidateAttemptForRun"
  | "options"
  | "userInput"
>;
export function clearIdleTimer(ctx: RunLifecycleContext): void {
  if (ctx.idleTimer !== undefined) {
    globalThis.clearTimeout(ctx.idleTimer);
    ctx.idleTimer = undefined;
  }
}
export function clearRetryStateForRun(
  ctx: RunLifecycleContext,
  runId: string
): void {
  ctx.turnCheckpointByRun.delete(runId);
  const message = ctx.assistantMessageForRun(runId);
  if (message?.retry) delete message.retry;
  for (const run of message?.subagentRuns ?? []) {
    if (run.retry) delete run.retry;
    ctx.subagentTurnCheckpointByRun.delete(
      ctx.subagentTurnKey(runId, run.subagentRunId)
    );
  }
}
export function finalizeRunningSubagents(
  ctx: RunLifecycleContext,
  message: ChatMessage,
  status: "error" | "stopped",
  completedAt: string,
  reason: string
): void {
  finalizeOpenSubagentDraws(message, completedAt, reason);
  for (const run of message.subagentRuns ?? []) {
    if (!isActiveSubagentRun(run)) continue;
    run.status = status;
    run.completedAt = completedAt;
    run.errorMessage = reason;
    for (const toolCall of run.toolCalls) {
      if (toolCall.status !== "preparing" && toolCall.status !== "running") {
        continue;
      }
      toolCall.status = "error";
      toolCall.completedAt = completedAt;
      toolCall.resultSummary ??= reason;
      toolCall.isError = true;
    }
  }
}
export function markRunError(
  ctx: RunLifecycleContext,
  runId: string,
  messageText: string,
  eventRuntime?: AgentRuntimeRef
): void {
  ctx.flushPendingAgentTextDelta();
  claimPendingActivityPlaceholder(ctx, runId, eventRuntime);
  const messageId = ctx.runMessageIds.get(runId) ?? `${runId}_assistant`;
  let message = ctx.messages.value.find(
    (item) =>
      item.id === messageId && item.role === "assistant" && item.runId === runId
  );
  if (!message) {
    message = {
      id: ctx.messages.value.some((item) => item.id === messageId)
        ? `${messageId}_${id("error")}`
        : messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      runId,
      status: "error",
      errorMessage: messageText,
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    ctx.messages.value.push(message);
    message = ctx.messages.value.find((item) => item.id === messageId)!;
    ctx.runMessageIds.set(runId, message.id);
  }
  message.status = "error";
  message.errorMessage = messageText;
  const completedAt = new Date().toISOString();
  ctx.finalizeRunningSubagents(message, "error", completedAt, messageText);
  finalizeUnfinishedMessageTools(message, completedAt, messageText);
  if (message.processingStartedAt) {
    message.processingCompletedAt = completedAt;
  }
  ctx.clearRetryStateForRun(runId);
  rememberBounded(ctx.finishedRunIds, runId);
}
export function markRunStopped(
  ctx: RunLifecycleContext,
  runId: string,
  eventRuntime?: AgentRuntimeRef
): void {
  ctx.flushPendingAgentTextDelta();
  claimPendingActivityPlaceholder(ctx, runId, eventRuntime);
  const messageId = ctx.runMessageIds.get(runId) ?? `${runId}_assistant`;
  let message = ctx.messages.value.find(
    (item) =>
      item.id === messageId && item.role === "assistant" && item.runId === runId
  );
  if (!message) {
    message = {
      id: ctx.messages.value.some((item) => item.id === messageId)
        ? `${messageId}_${id("stopped")}`
        : messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      runId,
      status: "stopped",
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    ctx.messages.value.push(message);
    message = ctx.messages.value.find((item) => item.id === messageId)!;
    ctx.runMessageIds.set(runId, message.id);
  }
  message.status = "stopped";
  const completedAt = new Date().toISOString();
  ctx.finalizeRunningSubagents(
    message,
    "stopped",
    completedAt,
    t("theParentAgentStoppedSubtasksWereAlsoStopped")
  );
  finalizeUnfinishedMessageTools(
    message,
    completedAt,
    t("theAgentStoppedBeforeToolCallsReturnedTheirFinal")
  );
  if (message.processingStartedAt) {
    message.processingCompletedAt = completedAt;
  }
  ctx.clearRetryStateForRun(runId);
  rememberBounded(ctx.finishedRunIds, runId);
}
export function invalidateAttemptForRun(
  ctx: RunLifecycleContext,
  runId: string
): void {
  for (const [attemptId, observedRunId] of ctx.observedRunByAttempt) {
    if (observedRunId !== runId) {
      continue;
    }
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    if (ctx.pendingAttemptId.value === attemptId) {
      ctx.pendingAttemptId.value = null;
    }
  }
}
export function scheduleIdleTimeout(
  ctx: RunLifecycleContext,
  scope: IdleTimeoutScope
): void {
  ctx.clearIdleTimer();
  ctx.idleTimer = globalThis.setTimeout(
    () => {
      ctx.idleTimer = undefined;
      const expiredRunId = expireIdleConversation(
        {
          epoch: ctx.epoch,
          sessionId: ctx.sessionId,
          activeRunId: ctx.activeRunId,
          pendingAttemptId: ctx.pendingAttemptId,
          messages: ctx.messages,
          runtime: ctx.runtime,
          observedRunByAttempt: ctx.observedRunByAttempt,
          approvalModeByAttempt: ctx.approvalModeByAttempt,
          submitting: ctx.submitting,
          stopping: ctx.stopping,
          conversationError: ctx.conversationError
        },
        scope,
        (runId, message, eventRuntime) => {
          ctx.markRunError(runId, message, eventRuntime);
          ctx.invalidateAttemptForRun(runId);
        }
      );
      // A run the UI gave up on must not keep retrying in the background: it
      // would hold the session and the provider's concurrency.
      if (expiredRunId) {
        ctx.userInput.clear(expiredRunId);
        void ctx.options
          .api()
          ?.session.abort({
            sessionId: scope.expectedSessionId,
            runId: expiredRunId
          })
          .catch(() => undefined);
      }
    },
    Math.max(
      ctx.options.idleTimeoutMs ?? IDLE_BACKSTOP_MS,
      scope.minTimeoutMs ?? 0
    )
  );
}
export function failProtocol(
  ctx: RunLifecycleContext,
  runId: string,
  messageText: string,
  eventRuntime?: AgentRuntimeRef
): void {
  ctx.markRunError(runId, messageText, eventRuntime);
  ctx.invalidateAttemptForRun(runId);
  if (ctx.activeRunId.value === runId) {
    ctx.activeRunId.value = null;
  }
  ctx.submitting.value = false;
  ctx.stopping.value = false;
  ctx.conversationError.value = messageText;
  ctx.userInput.clear(runId);
  ctx.clearIdleTimer();
}
export function finishRun(ctx: RunLifecycleContext, runId: string): void {
  ctx.clearRetryStateForRun(runId);
  rememberBounded(ctx.finishedRunIds, runId);
  if (ctx.activeRunId.value === runId) {
    ctx.activeRunId.value = null;
  }
  ctx.submitting.value = false;
  ctx.stopping.value = false;
  ctx.userInput.clear(runId);
  ctx.clearIdleTimer();
}
