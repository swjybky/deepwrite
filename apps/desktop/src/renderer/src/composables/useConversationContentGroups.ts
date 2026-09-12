import { computed } from "vue";
import type { ChatMessage } from "../types/conversation";

export const CONVERSATION_RENDER_GROUP_SIZE = 16;
export const CONVERSATION_RENDER_GROUP_THRESHOLD = 512;

export function useConversationContentGroups(options: {
  messages: () => readonly ChatMessage[];
  enabled: () => boolean;
  pinnedIds: () => readonly string[];
}) {
  const protectedIds = computed(() => new Set(options.pinnedIds()));
  const groups = computed(() => {
    const messages = options.messages();
    // Keep parent nodes stable when crossing the optimization threshold so
    // existing native selections and focused editors are never reparented.
    const size = CONVERSATION_RENDER_GROUP_SIZE;
    const eligible =
      options.enabled() &&
      messages.length >= CONVERSATION_RENDER_GROUP_THRESHOLD;
    return Array.from(
      { length: Math.ceil(messages.length / size) },
      (_, index) => {
        const items = messages.slice(index * size, (index + 1) * size);
        return {
          id: items[0]!.id,
          messages: items,
          eligible
        };
      }
    );
  });

  function canDefer(group: {
    eligible: boolean;
    messages: readonly ChatMessage[];
  }): boolean {
    return (
      group.eligible &&
      !group.messages.some(
        (message) =>
          protectedIds.value.has(message.id) ||
          message.status === "streaming" ||
          message.subagentRuns?.some((run) => run.status === "running")
      )
    );
  }
  return { groups, canDefer };
}
