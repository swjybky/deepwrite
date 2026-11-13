import { t } from "../../i18n";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import { discardPendingAssistantMessage } from "./message-identity";
import type { AgentConversationState } from "./context";
import { isActiveSubagentRun } from "../../types/conversation";

/**
 * The Agent Utility owns the 5-minute model idle deadline and its retries. The
 * UI backstop waits one minute longer so the Agent's retry or terminal event
 * always arrives first; it only fires when the Agent itself went silent.
 */
export const IDLE_BACKSTOP_MS = 6 * 60_000;
/** Context compaction pauses the Agent deadline; one summary call caps at 10 min. */
export const COMPACTION_IDLE_BACKSTOP_MS = 11 * 60_000;

export interface IdleTimeoutScope {
  expectedEpoch: number;
  expectedSessionId: string;
  attemptId?: number;
  runId?: string;
  /** A longer wait for a phase the Agent bounds by itself, e.g. compaction. */
  minTimeoutMs?: number;
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

/**
 * The utility owns the child deadline; UI silence is expected during delegation.
 * Returns the run it failed, which the caller must also abort in the Agent.
 */
export function expireIdleConversation(
  state: IdleState,
  scope: IdleTimeoutScope,
  failRun: (runId: string, message: string, runtime?: AgentRuntimeRef) => void
): string | undefined {
  if (
    state.epoch !== scope.expectedEpoch ||
    state.sessionId.value !== scope.expectedSessionId
  )
    return undefined;
  const ownsRun =
    scope.runId !== undefined && state.activeRunId.value === scope.runId;
  const ownsAttempt =
    scope.attemptId !== undefined &&
    state.pendingAttemptId.value === scope.attemptId;
  if (!ownsRun && !ownsAttempt) return undefined;
  const runId = ownsRun ? scope.runId : state.activeRunId.value;
  if (
    runId &&
    state.messages.value.some(
      (message) =>
        message.runId === runId &&
        message.subagentRuns?.some(isActiveSubagentRun)
    )
  )
    return undefined;

  const message = t(
    "workspace.idleTimeout.theAgentHasNotReturnedNewEventsForAn"
  );
  if (scope.runId) {
    failRun(scope.runId, message, state.runtime.value ?? undefined);
    if (state.activeRunId.value === scope.runId) state.activeRunId.value = null;
  }
  if (ownsAttempt && scope.attemptId !== undefined) {
    state.pendingAttemptId.value = null;
    state.observedRunByAttempt.delete(scope.attemptId);
    state.approvalModeByAttempt.delete(scope.attemptId);
  }
  if (!scope.runId) {
    discardPendingAssistantMessage(state);
  }
  state.submitting.value = false;
  state.stopping.value = false;
  state.conversationError.value = message;
  return runId ?? undefined;
}
