import type { AgentConversationController } from "../composables/useAgentConversation";

export function createBookConversationEntries(
  entries: () => Iterable<[string, AgentConversationController]>,
  scopes: ReadonlyMap<string, string>
) {
  return (bookId: string): [string, AgentConversationController][] => {
    const scope = `book:${bookId}`;
    return [...entries()].filter(
      ([key]) => key.startsWith(`${bookId}:`) || scopes.get(key) === scope
    );
  };
}
