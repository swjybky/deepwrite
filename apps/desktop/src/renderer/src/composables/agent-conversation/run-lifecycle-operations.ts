import { type IdleTimeoutScope } from "./idle-timeout";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { ChatMessage } from "../../types/conversation";
export interface RunLifecycleOperations {
  clearIdleTimer(): void;
  clearRetryStateForRun(runId: string): void;
  finalizeRunningSubagents(
    message: ChatMessage,
    status: "error" | "stopped",
    completedAt: string,
    reason: string
  ): void;
  markRunError(
    runId: string,
    messageText: string,
    eventRuntime?: AgentRuntimeRef
  ): void;
  markRunStopped(runId: string, eventRuntime?: AgentRuntimeRef): void;
  invalidateAttemptForRun(runId: string): void;
  scheduleIdleTimeout(scope: IdleTimeoutScope): void;
  failProtocol(
    runId: string,
    messageText: string,
    eventRuntime?: AgentRuntimeRef
  ): void;
  finishRun(runId: string): void;
}
