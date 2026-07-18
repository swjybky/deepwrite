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
import type {
  ShortWorkspaceAgentId,
  ShortWorkspaceAgentSettings,
  ShortWorkspaceAgentSettingsInput
} from "./workspace";

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
  workspaceAgents: {
    list(workspaceType: "short"): Promise<ShortWorkspaceAgentSettings>;
    save(settings: ShortWorkspaceAgentSettingsInput): Promise<ShortWorkspaceAgentSettings>;
    reset(
      workspaceType: "short",
      agentId?: ShortWorkspaceAgentId
    ): Promise<ShortWorkspaceAgentSettings>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
