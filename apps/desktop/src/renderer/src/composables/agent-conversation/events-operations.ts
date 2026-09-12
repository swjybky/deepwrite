import type { SystemEventEnvelope } from "@deepwrite/contracts";
export interface EventsOperations {
  handleEvent(event: SystemEventEnvelope): void;
}
