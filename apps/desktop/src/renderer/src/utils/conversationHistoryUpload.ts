import {
  CONVERSATION_HISTORY_TEXT_CHUNK_SIZE,
  conversationHistoryJsonBytes,
  type ConversationHistoryChange,
  type ConversationHistoryJson
} from "@deepwrite/contracts/renderer";

const INLINE_BYTES = 128 * 1024;

/** Produces bounded field writes without serializing a large message as one string. */
export function* conversationValueChanges(
  path: (string | number)[],
  value: ConversationHistoryJson
): Generator<ConversationHistoryChange> {
  if (conversationHistoryJsonBytes(value, INLINE_BYTES) <= INLINE_BYTES) {
    yield { op: "set", path, value };
    return;
  }
  if (typeof value === "string") {
    yield { op: "set", path, value: "" };
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(
        value.length,
        offset + CONVERSATION_HISTORY_TEXT_CHUNK_SIZE
      );
      const previous = value.charCodeAt(end - 1);
      if (end < value.length && previous >= 0xd800 && previous <= 0xdbff)
        end -= 1;
      yield { op: "append", path, text: value.slice(offset, end) };
      offset = end;
    }
    return;
  }
  if (Array.isArray(value)) {
    yield { op: "set", path, value: [] };
    for (let index = 0; index < value.length; index += 1)
      yield* conversationValueChanges([...path, index], value[index]!);
    return;
  }
  if (value !== null && typeof value === "object") {
    yield { op: "set", path, value: {} };
    for (const [key, child] of Object.entries(value))
      yield* conversationValueChanges([...path, key], child);
    return;
  }
  throw new Error("无法分块保存此会话字段。");
}

export function* conversationRecordChanges(
  value: Record<string, ConversationHistoryJson>
): Generator<ConversationHistoryChange> {
  for (const [key, child] of Object.entries(value))
    yield* conversationValueChanges([key], child);
}
