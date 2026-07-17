import type { AgentRuntimeRef, AgentUsage } from "@deepwrite/contracts";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  runId?: string;
  thinking?: string;
  status?: "streaming" | "completed" | "error";
  errorMessage?: string;
  runtime?: AgentRuntimeRef;
  usage?: AgentUsage;
}
