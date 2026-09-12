import type { SubagentEventEnvelope } from "./types";
export interface SubagentEventsOperations {
  handleSubagentEvent(event: SubagentEventEnvelope): void;
}
