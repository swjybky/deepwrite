import type { AgentConversationController } from "../composables/useAgentConversation";

export function shortBookConversationKey(bookId: string): string {
  return `${bookId}:chat`;
}

export function longBookConversationKey(bookId: string): string {
  return `long:${encodeURIComponent(bookId)}:chat`;
}

/** Older workspace coordinators may still request historical stage keys. */
export function canonicalBookConversationKey(
  key: string,
  scope: string
): string {
  if (scope.startsWith("book:") && key.startsWith(`${scope.slice(5)}:`)) {
    return shortBookConversationKey(scope.slice(5));
  }
  if (
    scope.startsWith("long:") &&
    key.startsWith(`long:${encodeURIComponent(scope.slice(5))}:`)
  ) {
    return longBookConversationKey(scope.slice(5));
  }
  return key;
}

export function hasBusyBookConversation(
  entries: Iterable<
    readonly [string, Pick<AgentConversationController, "isBusy">]
  >,
  bookId: string
): boolean {
  for (const [key, conversation] of entries) {
    if (
      (key === shortBookConversationKey(bookId) ||
        key.startsWith(`${bookId}:expert_`)) &&
      conversation.isBusy.value
    )
      return true;
  }
  return false;
}
