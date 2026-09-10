import type { ChatMessage } from "../../types/conversation";
import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot,
  ConversationStorage
} from "./types";
import { isRecord, validDate } from "./shared";
import { parseStoredMessage } from "./parse";

/** Destructive migration is allowed only when every original record is readable. */
export function isCompletePersistenceSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.activeSessionId === "string" &&
    Array.isArray(value.conversations) &&
    value.conversations.every(
      (record) => parsePersistenceRecord(record) !== undefined
    )
  );
}

export function parsePersistenceRecord(
  value: unknown
): AgentConversationPersistenceRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !Array.isArray(value.messages) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt) ||
    (value.approvalMode !== undefined &&
      value.approvalMode !== "request-approval" &&
      value.approvalMode !== "auto-approve") ||
    (value.draft !== undefined && typeof value.draft !== "string") ||
    (value.temperature !== undefined &&
      (typeof value.temperature !== "number" ||
        !Number.isFinite(value.temperature)))
  ) {
    return undefined;
  }
  const messages = value.messages
    .map(parseStoredMessage)
    .filter((message): message is ChatMessage => message !== undefined);
  if (messages.length !== value.messages.length) return undefined;
  return {
    sessionId: value.sessionId,
    messages,
    draft: typeof value.draft === "string" ? value.draft : "",
    approvalMode:
      value.approvalMode === "auto-approve"
        ? "auto-approve"
        : "request-approval",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    temperature:
      typeof value.temperature === "number" &&
      Number.isFinite(value.temperature)
        ? value.temperature
        : 0.7
  };
}

export function parseAgentConversationPersistenceSnapshot(
  value: unknown
): AgentConversationPersistenceSnapshot | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.activeSessionId !== "string" ||
    !Array.isArray(value.conversations)
  ) {
    return undefined;
  }
  const conversations = value.conversations
    .map(parsePersistenceRecord)
    .filter(
      (conversation): conversation is AgentConversationPersistenceRecord =>
        conversation !== undefined
    );
  if (!conversations.length && value.conversations.length > 0) {
    return undefined;
  }
  const sorted = conversations.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
  const activeSessionId = sorted.some(
    (conversation) => conversation.sessionId === value.activeSessionId
  )
    ? value.activeSessionId
    : (sorted[0]?.sessionId ?? value.activeSessionId);
  return {
    version: 1,
    activeSessionId,
    conversations: sorted
  };
}

export function mergeAgentConversationPersistenceSnapshots(
  targetValue: unknown,
  sourceValues: readonly unknown[]
): AgentConversationPersistenceSnapshot | undefined {
  const target = parseAgentConversationPersistenceSnapshot(targetValue);
  const sources = sourceValues
    .map(parseAgentConversationPersistenceSnapshot)
    .filter(
      (envelope): envelope is AgentConversationPersistenceSnapshot =>
        envelope !== undefined && envelope.conversations.length > 0
    );
  if (!sources.length) return target;

  const conversationBySessionId = new Map<
    string,
    AgentConversationPersistenceRecord
  >();
  for (const envelope of [...(target ? [target] : []), ...sources]) {
    for (const conversation of envelope.conversations) {
      const existing = conversationBySessionId.get(conversation.sessionId);
      if (
        !existing ||
        Date.parse(conversation.updatedAt) > Date.parse(existing.updatedAt)
      ) {
        conversationBySessionId.set(conversation.sessionId, conversation);
      }
    }
  }
  const conversations = [...conversationBySessionId.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
  if (!conversations.length) return undefined;
  const activeSessionId =
    target &&
    conversations.some(
      (conversation) => conversation.sessionId === target.activeSessionId
    )
      ? target.activeSessionId
      : conversations[0]!.sessionId;
  return { version: 1, activeSessionId, conversations };
}

/**
 * @deprecated Text-storage migration belongs in the persistence adapter. This
 * compatibility export remains temporarily so callers can migrate without a
 * flag day; it deliberately performs no synchronous reads or writes.
 */
export function mergeStoredConversationHistories(
  _storage: ConversationStorage,
  _targetKey: string,
  _sourceKeys: readonly string[]
): boolean {
  return false;
}
