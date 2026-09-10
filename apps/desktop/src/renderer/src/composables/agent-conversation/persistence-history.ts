import { cloneJsonRecord, cloneMessageForPersistence } from "./clone";
import type { AgentConversationContext } from "./context";
import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot
} from "./types";

type PersistenceHistoryContext = Pick<
  AgentConversationContext,
  | "sessionId"
  | "messages"
  | "draft"
  | "approvalMode"
  | "currentCreatedAt"
  | "currentUpdatedAt"
  | "temperature"
  | "storedConversations"
>;

export function currentStoredConversation(
  ctx: PersistenceHistoryContext
): AgentConversationPersistenceRecord {
  return {
    sessionId: ctx.sessionId.value,
    messages: ctx.messages.value.map(cloneMessageForPersistence),
    draft: ctx.draft.value,
    approvalMode: ctx.approvalMode.value,
    createdAt: ctx.currentCreatedAt.value,
    updatedAt: ctx.currentUpdatedAt.value,
    temperature: ctx.temperature.value
  };
}

export function hasConversationContent(
  ctx: PersistenceHistoryContext,
  conversation: AgentConversationPersistenceRecord
): boolean {
  return (
    conversation.messages.length > 0 || conversation.draft.trim().length > 0
  );
}

export function storeCurrentConversation(ctx: PersistenceHistoryContext): void {
  const current = currentStoredConversation(ctx);
  const next = ctx.storedConversations.value.filter(
    (conversation) => conversation.sessionId !== current.sessionId
  );
  if (hasConversationContent(ctx, current)) {
    next.push(current);
  }
  ctx.storedConversations.value = next.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
}

export function capturePersistenceSnapshot(
  ctx: PersistenceHistoryContext
): AgentConversationPersistenceSnapshot {
  storeCurrentConversation(ctx);
  return cloneJsonRecord({
    version: 1 as const,
    activeSessionId: ctx.sessionId.value,
    conversations: [...ctx.storedConversations.value]
  });
}
