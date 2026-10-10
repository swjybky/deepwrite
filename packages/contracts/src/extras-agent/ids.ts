import { z } from "zod";
import type { ModelUsageModule } from "../model-usage";

/**
 * Agents behind "更多功能". They run through `extrasAgent.run`, never through the
 * creation-space `session.prompt` payload.
 */
export const EXTRAS_AGENT_IDS = [
  "book-title-design",
  "book-synopsis-design",
  "book-cover-design",
  "revision-analysis",
  "short-book-analysis",
  "long-book-analysis",
  "long-book-decomposition",
  "long-material-guide",
  "style-comparison",
  "chat-normal",
  "chat-project",
  "chat-roleplay"
] as const;
export const ExtrasAgentIdSchema = z.enum(EXTRAS_AGENT_IDS);
export type ExtrasAgentId = z.infer<typeof ExtrasAgentIdSchema>;

/**
 * Agents that hold a multi-turn conversation: every run carries the user's
 * message and history, and the Agent Utility keeps the conversation cached.
 * The other agents run one self-contained task per run.
 */
export const EXTRAS_CONVERSATION_AGENT_IDS = [
  "chat-normal",
  "chat-project",
  "chat-roleplay"
] as const satisfies readonly ExtrasAgentId[];
export type ExtrasConversationAgentId =
  (typeof EXTRAS_CONVERSATION_AGENT_IDS)[number];

export function isExtrasConversationAgent(
  agentId: ExtrasAgentId
): agentId is ExtrasConversationAgentId {
  return (EXTRAS_CONVERSATION_AGENT_IDS as readonly string[]).includes(agentId);
}

export const EXTRAS_AGENT_USAGE_MODULES = {
  "book-title-design": "book-identity",
  "book-synopsis-design": "book-identity",
  "book-cover-design": "book-identity",
  "revision-analysis": "revision-analysis",
  "short-book-analysis": "short-book-analysis",
  "long-book-analysis": "long-book-analysis",
  "long-book-decomposition": "long-book-decomposition",
  "long-material-guide": "long-material-pack",
  "style-comparison": "style-comparison",
  "chat-normal": "assistant-chat",
  "chat-project": "assistant-chat",
  "chat-roleplay": "assistant-chat"
} as const satisfies Record<ExtrasAgentId, ModelUsageModule>;

export const ExtrasAgentProfileIdSchema = z.string().trim().min(1).max(120);
