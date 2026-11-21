import type { AgentConversationController } from "../composables/useAgentConversation";

export type AgentActivityStatus = "running" | "completed" | "error" | "stopped";

export interface AgentActivityDescriptor {
  conversationKey: string;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
  /** Long-form chapter card that was active when the run started. */
  chapterCardId?: string;
  chapterCardView?: "card";
}

export interface AgentActivityItem extends AgentActivityDescriptor {
  status: AgentActivityStatus;
  updatedAt: number;
}

export interface CurrentAgentActivityView {
  controller: AgentConversationController;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
  chapterCardId?: string;
  chapterCardView?: "card";
}
