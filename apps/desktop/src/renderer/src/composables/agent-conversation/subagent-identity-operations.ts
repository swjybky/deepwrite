import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentSubagentRun, ChatMessage } from "../../types/conversation";
import type { SubagentEventPayload } from "./types";
export interface SubagentIdentityOperations {
  subagentTurnKey(runId: string, subagentRunId: string): string;
  earlierTimestamp(current: string, candidate: string): string;
  ensurePendingSubagentRunForTool(
    message: ChatMessage,
    toolCallId: string,
    args: unknown,
    eventRuntime: AgentRuntimeRef,
    eventTimestamp: string
  ): void;
  ensureSubagentRun(
    message: ChatMessage,
    payload: SubagentEventPayload,
    eventTimestamp: string,
    task?: string
  ): AgentSubagentRun;
}
