import {
  conversationHistoryJsonBytes,
  type ConversationHistoryOperation,
  type ConversationHistoryRecord
} from "@deepwrite/contracts/renderer";
import {
  stageConversationValue,
  type HistoryWriteCursor,
  type HistoryWriteStep
} from "./conversationHistoryWriterSteps";

const INLINE_BYTES = 128 * 1024;

/** Drafts are user data too; they use the same durable chunks as large messages. */
export function* prepareConversationMetadata(
  cursor: HistoryWriteCursor,
  metadata: ConversationHistoryRecord
): Generator<HistoryWriteStep, ConversationHistoryOperation[], unknown> {
  if (conversationHistoryJsonBytes(metadata, INLINE_BYTES) <= INLINE_BYTES)
    return [{ type: "setMetadata", value: metadata }];
  const operations: ConversationHistoryOperation[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (conversationHistoryJsonBytes(value, INLINE_BYTES) <= INLINE_BYTES) {
      operations.push({ type: "setMetadata", value: { [key]: value } });
      continue;
    }
    const stageId = yield* stageConversationValue(cursor, undefined, { value });
    operations.push({ type: "setStagedMetadata", stageId, path: [key] });
  }
  return operations;
}
