import { createId } from "@deepwrite/shared";
import {
  conversationHistoryJsonBytes,
  type ConversationHistoryApi,
  type ConversationHistoryBatch,
  type ConversationHistoryCommitResult,
  type ConversationHistoryOperation,
  type ConversationHistorySession,
  type ConversationHistoryStage
} from "@deepwrite/contracts/renderer";
import type { ConversationPersistenceChanges } from "../composables/agent-conversation/persistence-changes";
import { prepareConversationMetadata } from "./conversationHistoryMetadataWriter";
import {
  prepareConversationOperation,
  type HistoryWriteStep,
  type HistoryWriteCursor
} from "./conversationHistoryWriterSteps";

const COMMIT_BUDGET = 1024 * 1024;
const savedCursors = new WeakMap<
  ConversationHistoryApi,
  Map<string, HistoryWriteCursor>
>();
function cursorCache(
  api: ConversationHistoryApi
): Map<string, HistoryWriteCursor> {
  let cache = savedCursors.get(api);
  if (!cache) {
    cache = new Map();
    savedCursors.set(api, cache);
  }
  return cache;
}

/** Explicit lifecycle changes invalidate only their affected writer cursor. */
export function invalidateConversationHistoryCursor(
  api: ConversationHistoryApi,
  key: string,
  sessionId: string
): void {
  cursorCache(api).delete(JSON.stringify([key, sessionId]));
}

/** A prepared write retains its cursor and request identity across uncertain replies. */
export function createConversationHistoryWrite(
  api: ConversationHistoryApi,
  key: string,
  changes: ConversationPersistenceChanges
): () => Promise<void> {
  function* requests(): Generator<HistoryWriteStep, void, unknown> {
    for (const conversation of changes.conversations) {
      const cache = cursorCache(api);
      const cacheKey = JSON.stringify([key, conversation.sessionId]);
      const known = cache.get(cacheKey);
      const session =
        known ??
        ((yield {
          method: "session",
          payload: { key, sessionId: conversation.sessionId }
        }) as ConversationHistorySession | null);
      const cursor: HistoryWriteCursor = {
        key,
        sessionId: conversation.sessionId,
        revision: session?.revision ?? 0,
        generation: session?.generation ?? 0,
        sequence: session?.sequence ?? 0
      };
      let operations: ConversationHistoryOperation[] = [];
      let bytes = 0;
      function* commit(): Generator<HistoryWriteStep, void, unknown> {
        if (!operations.length) return;
        const payload: ConversationHistoryBatch = {
          key,
          sessionId: conversation.sessionId,
          batchId: createId("history_batch"),
          expectedRevision: cursor.revision,
          generation: cursor.generation,
          sequence: cursor.sequence + 1,
          operations
        };
        const receipt = (yield {
          method: "commit",
          payload
        }) as ConversationHistoryCommitResult;
        cursor.revision = receipt.revision;
        cursor.generation = receipt.generation;
        cursor.sequence = receipt.sequence;
        cache.delete(cacheKey);
        cache.set(cacheKey, { ...cursor });
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
        operations = [];
        bytes = 0;
      }
      // Removals precede moved messages so an old ordinal cannot conflict with its replacement.
      const source = [
        ...conversation.operations.filter((op) => op.type === "removeMessages"),
        ...conversation.operations.filter((op) => op.type !== "removeMessages")
      ];
      const reordering = source.some(
        (operation) => operation.type === "moveMessage"
      );
      const bounded = source.flatMap(
        (operation): ConversationHistoryOperation[] =>
          operation.type === "patchMessage"
            ? operation.changes.map((change) => ({
                type: "patchMessage",
                messageId: operation.messageId,
                changes: [change]
              }))
            : [operation]
      );
      for (const operation of bounded) {
        // Stage references bind to this revision; flush before preparing the next operation.
        if (
          !reordering &&
          (bytes >= COMMIT_BUDGET / 2 || operations.length >= 512)
        )
          yield* commit();
        const prepared = yield* prepareConversationOperation(cursor, operation);
        operations.push(...prepared);
        for (const item of prepared)
          bytes += conversationHistoryJsonBytes(item, COMMIT_BUDGET);
      }
      if (!reordering && bytes >= COMMIT_BUDGET / 2) yield* commit();
      operations.push(
        ...(yield* prepareConversationMetadata(cursor, {
          ...conversation.metadata
        }))
      );
      // Earlier sessions are created before this selects the final active session.
      if (conversation.sessionId === changes.activeSessionId)
        operations.push({
          type: "setActive",
          sessionId: changes.activeSessionId
        });
      yield* commit();
    }
  }

  const iterator = requests();
  let step = iterator.next();
  let terminalError: unknown;
  return async () => {
    if (terminalError !== undefined) throw terminalError;
    while (!step.done) {
      const request = step.value;
      const result =
        request.method === "session"
          ? await api.session(request.payload)
          : request.method === "stage"
            ? await api.stage(request.payload)
            : await api.commit(request.payload);
      if (
        request.method === "commit" &&
        (result as ConversationHistoryCommitResult).batchId !==
          request.payload.batchId
      )
        throw new Error("会话保存确认编号不匹配。");
      if (request.method === "stage") {
        const receipt = result as {
          stageId: string;
          chunkId: string;
          sequence: number;
        };
        if (
          receipt.stageId !== request.payload.stageId ||
          receipt.chunkId !== request.payload.chunkId ||
          receipt.sequence !== request.payload.sequence
        )
          throw new Error("会话分块保存确认编号不匹配。");
      }
      try {
        step = iterator.next(result);
      } catch (error: unknown) {
        terminalError = error;
        throw error;
      }
    }
  };
}

export type ConversationHistoryWriteRequest =
  ConversationHistoryBatch | ConversationHistoryStage;
