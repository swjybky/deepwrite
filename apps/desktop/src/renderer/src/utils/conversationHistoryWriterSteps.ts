import { createId } from "@deepwrite/shared";
import {
  conversationHistoryJsonBytes,
  type ConversationHistoryBatch,
  type ConversationHistoryChange,
  type ConversationHistoryOperation,
  type ConversationHistoryRecord,
  type ConversationHistorySessionQuery,
  type ConversationHistoryStage
} from "@deepwrite/contracts/renderer";
import { conversationRecordChanges } from "./conversationHistoryUpload";

const INLINE_BYTES = 128 * 1024;
export interface HistoryWriteCursor {
  key: string;
  sessionId: string;
  revision: number;
  generation: number;
  sequence: number;
}
export type HistoryWriteStep =
  | { method: "session"; payload: ConversationHistorySessionQuery }
  | { method: "stage"; payload: ConversationHistoryStage }
  | { method: "commit"; payload: ConversationHistoryBatch };

export function* stageConversationValue(
  cursor: HistoryWriteCursor,
  messageId: string | undefined,
  value: ConversationHistoryRecord
): Generator<HistoryWriteStep, string, unknown> {
  const stageId = createId("history_stage");
  let sequence = 0;
  let changes: ConversationHistoryChange[] = [];
  let bytes = 0;
  function* send(): Generator<HistoryWriteStep, void, unknown> {
    sequence += 1;
    yield {
      method: "stage",
      payload: {
        key: cursor.key,
        sessionId: cursor.sessionId,
        ...(messageId === undefined
          ? { target: "metadata" as const }
          : { messageId }),
        stageId,
        chunkId: createId("history_chunk"),
        expectedRevision: cursor.revision,
        generation: cursor.generation,
        sequence,
        ...(sequence === 1 ? { value: {} } : {}),
        ...(changes.length ? { changes } : {})
      }
    };
    changes = [];
    bytes = 0;
  }
  for (const change of conversationRecordChanges(value)) {
    const size = conversationHistoryJsonBytes(change, 512 * 1024);
    if (changes.length && (bytes + size > 512 * 1024 || changes.length >= 512))
      yield* send();
    changes.push(change);
    bytes += size;
  }
  if (changes.length || sequence === 0) yield* send();
  return stageId;
}

export function* prepareConversationOperation(
  cursor: HistoryWriteCursor,
  operation: ConversationHistoryOperation
): Generator<HistoryWriteStep, ConversationHistoryOperation[], unknown> {
  if (
    operation.type === "putMessage" &&
    conversationHistoryJsonBytes(operation.value, INLINE_BYTES) > INLINE_BYTES
  ) {
    const stageId = yield* stageConversationValue(
      cursor,
      operation.messageId,
      operation.value
    );
    return [
      {
        type: "putStagedMessage",
        stageId,
        messageId: operation.messageId,
        position: operation.position
      }
    ];
  }
  if (operation.type !== "patchMessage") return [operation];
  const result: ConversationHistoryOperation[] = [];
  let changes: ConversationHistoryChange[] = [];
  let bytes = 0;
  const flush = () => {
    if (changes.length)
      result.push({
        type: "patchMessage",
        messageId: operation.messageId,
        changes
      });
    changes = [];
    bytes = 0;
  };
  for (const change of operation.changes) {
    if (
      change.op === "set" &&
      conversationHistoryJsonBytes(change.value, INLINE_BYTES) > INLINE_BYTES
    ) {
      flush();
      const stageId = yield* stageConversationValue(
        cursor,
        operation.messageId,
        {
          value: change.value
        }
      );
      result.push({
        type: "setStagedField",
        stageId,
        messageId: operation.messageId,
        path: change.path
      });
    } else {
      const size = conversationHistoryJsonBytes(change, 512 * 1024);
      if (bytes + size > 512 * 1024 || changes.length >= 512) flush();
      changes.push(change);
      bytes += size;
    }
  }
  flush();
  return result;
}
