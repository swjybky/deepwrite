import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentConversationState } from "./context";

export interface IdleTimeoutScope {
  expectedEpoch: number;
  expectedSessionId: string;
  attemptId?: number;
  runId?: string;
}

type IdleState = Pick<
  AgentConversationState,
  | "epoch"
  | "sessionId"
  | "activeRunId"
  | "pendingAttemptId"
  | "messages"
  | "runtime"
  | "observedRunByAttempt"
  | "approvalModeByAttempt"
  | "submitting"
  | "stopping"
  | "conversationError"
>;

/** The utility owns the child deadline; UI silence is expected during delegation. */
export function expireIdleConversation(
  state: IdleState,
  scope: IdleTimeoutScope,
  failRun: (runId: string, message: string, runtime?: AgentRuntimeRef) => void
): void {
  if (
    state.epoch !== scope.expectedEpoch ||
    state.sessionId.value !== scope.expectedSessionId
  )
    return;
  const ownsRun =
    scope.runId !== undefined && state.activeRunId.value === scope.runId;
  const ownsAttempt =
    scope.attemptId !== undefined &&
    state.pendingAttemptId.value === scope.attemptId;
  if (!ownsRun && !ownsAttempt) return;
  const runId = ownsRun ? scope.runId : state.activeRunId.value;
  if (
    runId &&
    state.messages.value.some(
      (message) =>
        message.runId === runId &&
        message.subagentRuns?.some((child) => child.status === "running")
    )
  )
    return;

  const message = "智能体长时间没有返回新事件，请稍后重试。";
  if (scope.runId) {
    failRun(scope.runId, message, state.runtime.value ?? undefined);
    if (state.activeRunId.value === scope.runId) state.activeRunId.value = null;
  }
  if (ownsAttempt && scope.attemptId !== undefined) {
    state.pendingAttemptId.value = null;
    state.observedRunByAttempt.delete(scope.attemptId);
    state.approvalModeByAttempt.delete(scope.attemptId);
  }
  state.submitting.value = false;
  state.stopping.value = false;
  state.conversationError.value = message;
}
