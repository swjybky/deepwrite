import type {
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload
} from "./session";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
