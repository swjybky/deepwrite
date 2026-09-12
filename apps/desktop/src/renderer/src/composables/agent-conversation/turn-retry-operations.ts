import type {
  AgentRuntimeRef,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import type { AgentRetryMetadata, ChatMessage } from "../../types/conversation";
import type { AgentTurnCheckpoint } from "./types";
export interface TurnRetryOperations {
  retryMetadata(input: {
    state: AgentRetryMetadata["state"];
    turnId: string;
    attempt: number;
    maxAttempts: number;
    retryAt?: string;
    delayMs?: number;
    reason?: string;
  }): AgentRetryMetadata;
  restoreMessageCheckpoint(
    runId: string,
    messageId: string,
    checkpoint: AgentTurnCheckpoint,
    retry: AgentRetryMetadata,
    eventRuntime: AgentRuntimeRef,
    eventTimestamp: string
  ): ChatMessage | undefined;
  handleTurnStarted(
    event: Extract<
      SystemEventEnvelope,
      {
        type: "agent.turn_started";
      }
    >
  ): void;
  handleRetryScheduled(
    event: Extract<
      SystemEventEnvelope,
      {
        type: "agent.retry_scheduled";
      }
    >
  ): void;
  acceptsRetryActivity(runId: string, eventTimestamp: string): boolean;
}
