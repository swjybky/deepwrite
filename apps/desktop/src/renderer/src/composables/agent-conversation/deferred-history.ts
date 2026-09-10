import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot
} from "./types";
import { mergeAgentConversationPersistenceSnapshots } from "./persistence-snapshot";

/** Keep loaded archives when new input prevents replacing the active conversation. */
export function preserveLoadedConversations(
  current: AgentConversationPersistenceSnapshot,
  loaded: AgentConversationPersistenceSnapshot
): AgentConversationPersistenceRecord[] {
  const merged = mergeAgentConversationPersistenceSnapshots(current, [loaded]);
  // Snapshot parsing already creates detached message records.
  return merged?.conversations ?? current.conversations;
}
