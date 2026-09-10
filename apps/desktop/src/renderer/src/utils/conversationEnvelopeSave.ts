import type { ConversationPersistenceApi } from "@deepwrite/contracts";

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function conversationEnvelopeHasContent(value: unknown): boolean {
  if (!isPlainRecord(value) || !Array.isArray(value.conversations)) {
    return false;
  }
  return value.conversations.some((conversation) => {
    if (!isPlainRecord(conversation)) return false;
    if (typeof conversation.draft === "string" && conversation.draft.trim()) {
      return true;
    }
    return (
      Array.isArray(conversation.messages) && conversation.messages.length > 0
    );
  });
}

export function isEmptyConversationEnvelope(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.conversations) &&
    !conversationEnvelopeHasContent(value)
  );
}

function mapEnvelopeMessages(
  value: unknown,
  mapMessage: (message: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (!isPlainRecord(value) || !Array.isArray(value.conversations)) {
    return value;
  }
  let changed = false;
  const conversations = value.conversations.map((conversation) => {
    if (!isPlainRecord(conversation) || !Array.isArray(conversation.messages)) {
      return conversation;
    }
    const messages = conversation.messages.map((message) => {
      if (!isPlainRecord(message)) return message;
      const next = mapMessage(message);
      if (next !== message) changed = true;
      return next;
    });
    return changed ? { ...conversation, messages } : conversation;
  });
  return changed ? { ...value, conversations } : value;
}

function compactEvaluationToolSchemas(value: unknown): unknown {
  return mapEnvelopeMessages(value, (message) => {
    const snapshot = message.evaluationSnapshot;
    if (
      !isPlainRecord(snapshot) ||
      !Array.isArray(snapshot.tools) ||
      snapshot.tools.length === 0
    ) {
      return message;
    }
    return {
      ...message,
      evaluationSnapshot: {
        ...snapshot,
        tools: snapshot.tools.map((tool) => {
          if (!isPlainRecord(tool)) return tool;
          const { inputSchema: _inputSchema, ...rest } = tool;
          return rest;
        })
      }
    };
  });
}

function stripEvaluationSnapshots(value: unknown): unknown {
  return mapEnvelopeMessages(value, (message) => {
    if (!Object.prototype.hasOwnProperty.call(message, "evaluationSnapshot")) {
      return message;
    }
    const { evaluationSnapshot: _removed, ...rest } = message;
    return rest;
  });
}

export async function saveConversationEnvelope(
  api: ConversationPersistenceApi,
  key: string,
  value: unknown
): Promise<void> {
  try {
    await api.save(key, value);
    return;
  } catch (firstError) {
    const compacted = compactEvaluationToolSchemas(value);
    if (!sameJsonValue(compacted, value)) {
      try {
        await api.save(key, compacted);
        return;
      } catch {
        // Fall through and persist the conversation without evaluation snapshots.
      }
    }
    const stripped = stripEvaluationSnapshots(value);
    if (sameJsonValue(stripped, value)) throw firstError;
    await api.save(key, stripped);
  }
}
