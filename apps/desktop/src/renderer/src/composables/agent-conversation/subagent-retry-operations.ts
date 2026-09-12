import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type {
  AgentRetryMetadata,
  AgentSubagentRun
} from "../../types/conversation";
import type {
  SubagentTurnCheckpoint,
  SubagentActivityEventEnvelope
} from "./types";
export interface SubagentRetryOperations {
  restoreSubagentCheckpoint(
    run: AgentSubagentRun,
    checkpoint: SubagentTurnCheckpoint,
    retry: AgentRetryMetadata,
    eventRuntime: AgentRuntimeRef
  ): void;
  handleSubagentTurnStarted(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun,
    activity: Extract<
      SubagentActivityEventEnvelope["payload"]["activity"],
      {
        type: "turn_started";
      }
    >
  ): void;
  handleSubagentRetryScheduled(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun,
    activity: Extract<
      SubagentActivityEventEnvelope["payload"]["activity"],
      {
        type: "retry_scheduled";
      }
    >
  ): void;
  acceptsSubagentRetryActivity(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun
  ): boolean;
}
