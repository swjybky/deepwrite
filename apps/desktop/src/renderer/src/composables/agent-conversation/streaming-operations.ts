import type {
  AgentTextDeltaEventEnvelope,
  PendingAgentTextDelta
} from "./types";
export interface StreamingOperations {
  clearStreamPresentationSchedule(): void;
  applyAgentTextDelta(pending: PendingAgentTextDelta): void;
  flushPendingAgentTextDelta(): void;
  scheduleStreamPresentation(): void;
  queueAgentTextDelta(event: AgentTextDeltaEventEnvelope): void;
}
