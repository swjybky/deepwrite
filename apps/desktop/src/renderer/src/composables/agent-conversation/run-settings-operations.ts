import type {
  AgentTeamRunMode,
  ModelSettings,
  ThinkingLevel
} from "@deepwrite/contracts";
import type { AgentApprovalMode } from "../../types/conversation";
import type { AgentRunSettings } from "./types";
export interface RunSettingsOperations {
  applyRunSettings(settings: AgentRunSettings): void;
  applyModelSettings(settings: ModelSettings): void;
  selectModel(modelId: string): void;
  selectThinkingLevel(level: ThinkingLevel): void;
  selectWebSearchEnabled(enabled: boolean): void;
  selectTemperature(value: number): void;
  selectApprovalMode(mode: AgentApprovalMode): void;
  selectAgentTeamMode(mode: AgentTeamRunMode): void;
}
