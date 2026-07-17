import type {
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload
} from "./session";
import type {
  ModelConnectionTestResult,
  ModelSettings,
  ModelSettingsInput
} from "./models";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
  };
  models: {
    list(): Promise<ModelSettings>;
    save(settings: ModelSettingsInput): Promise<ModelSettings>;
    test(modelId: string): Promise<ModelConnectionTestResult>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
