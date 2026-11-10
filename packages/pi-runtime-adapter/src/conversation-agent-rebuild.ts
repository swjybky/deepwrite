import type { AgentRunInput } from "./runtime-types";

interface CachedConversationAgent {
  state: {
    isStreaming: boolean;
  };
}

export function conversationAgentKey(input: AgentRunInput): string {
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const subagentAuthoring = input.workspaceContext?.subagentAuthoring;
  return `${input.sessionId}:${
    subagentAuthoring
      ? `subagent-authoring:${subagentAuthoring.parentAgentId}`
      : input.libraryAgentProfile && libraryWorkspace
        ? `library:${input.libraryAgentProfile.domain}`
        : input.scriptAgentProfile
          ? `script:${input.scriptAgentProfile.id}`
          : input.longAgentProfile && longWorkspace
            ? `long:${input.longAgentProfile.id}:${longWorkspace.bookId}`
            : (input.agentProfile?.id ?? "default")
  }`;
}

/** Selects the reusable agent, or forces a fresh agent for a linear rewrite. */
export function selectConversationAgentForRun<
  AgentType extends CachedConversationAgent
>(
  agents: Map<string, AgentType>,
  agentKey: string,
  historyMode: "replace" | undefined
): AgentType | undefined {
  const cachedAgent = agents.get(agentKey);
  if (historyMode === "replace") {
    if (cachedAgent?.state.isStreaming) {
      throw new Error("The selected conversation agent is already running.");
    }
    agents.delete(agentKey);
    return undefined;
  }
  return cachedAgent;
}

/** Refreshes LRU order and atomically swaps out a discarded conversation agent. */
export function cacheConversationAgent<AgentType>(
  agents: Map<string, AgentType>,
  agentKey: string,
  agent: AgentType
): void {
  agents.delete(agentKey);
  agents.set(agentKey, agent);
}
