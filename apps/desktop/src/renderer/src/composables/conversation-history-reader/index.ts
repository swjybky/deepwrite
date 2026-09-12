import type {
  ConversationHistoryMessage,
  ConversationHistoryMessagesQuery,
  ConversationHistoryTurnsQuery,
  ConversationHistoryTurnsResult
} from "@deepwrite/contracts";
import { CONVERSATION_HISTORY_PAGE_BYTES } from "@deepwrite/contracts/renderer";
import { createHistoryCache, freezeHistory } from "./cache";
import { awaitHistoryResponse } from "./cancellation";
import { createHistoryDetailReader } from "./detail";
import {
  HistoryReadCancelledError,
  HistoryReadConflictError,
  type HistoryReadApi,
  type HistoryReaderOptions,
  type HistoryPinReason,
  type HistoryDetailTarget,
  type ImmutableHistory
} from "./types";

export * from "./types";

/** A read-only projection cache. Its results must never be passed to the mutation journal. */
export function createConversationHistoryReader(
  api: HistoryReadApi,
  options: HistoryReaderOptions = {}
) {
  const cache = createHistoryCache(
    options.maxCacheBytes ?? 16 * 1024 * 1024,
    options.maxCacheEntries ?? 2000
  );
  const maxMaterializedBytes =
    options.maxMaterializedDetailBytes ?? Math.min(256 * 1024, cache.maxBytes);
  if (
    !Number.isSafeInteger(maxMaterializedBytes) ||
    maxMaterializedBytes < 1 ||
    maxMaterializedBytes > CONVERSATION_HISTORY_PAGE_BYTES
  )
    throw new RangeError("Detail budget must be between 1 byte and 1 MiB.");

  function openSession(
    key: string,
    sessionId: string,
    expectedRevision?: number
  ) {
    const lifetime = new AbortController();
    const leases = new Set<() => void>();
    const scope = JSON.stringify([key, sessionId]);
    let revision = expectedRevision;
    let generation: number | undefined;

    function assertCurrent(signal?: AbortSignal) {
      if (lifetime.signal.aborted || signal?.aborted)
        throw new HistoryReadCancelledError();
    }
    function dispose() {
      lifetime.abort();
      for (const release of leases) release();
      leases.clear();
    }
    function acceptRevision(actual: number) {
      if (revision !== undefined && actual !== revision) {
        const expected = revision;
        dispose();
        throw new HistoryReadConflictError(expected, actual);
      }
      revision = actual;
    }
    function requireRevision() {
      assertCurrent();
      if (revision === undefined)
        throw new Error(
          "Read a message or turn page before requesting detail, or provide expectedRevision."
        );
      return revision;
    }
    function messageTag(messageId: string) {
      return JSON.stringify([scope, messageId]);
    }
    function resourceKey(kind: string, identity: unknown) {
      return JSON.stringify([scope, requireRevision(), kind, identity]);
    }
    function pinTag(tag: string, reason: HistoryPinReason) {
      assertCurrent();
      const unpin = cache.pin(tag, reason);
      const release = () => {
        unpin();
        leases.delete(release);
      };
      leases.add(release);
      return release;
    }
    function pinMessage(messageId: string, reason: HistoryPinReason) {
      return pinTag(messageTag(messageId), reason);
    }
    const detail = createHistoryDetailReader({
      cache,
      maxMaterializedBytes,
      assertCurrent,
      revision: requireRevision,
      acceptRevision,
      cacheKey: (target) =>
        resourceKey("detail", [
          target.kind === "metadata" ? "metadata" : "message",
          target.kind === "metadata" ? null : target.messageId,
          target.path
        ]),
      tag: (target) =>
        target.kind === "metadata" ? scope : messageTag(target.messageId),
      load: (target, offset, expected, signal) => {
        const query = {
          key,
          sessionId,
          path: target.path,
          offset,
          maxBytes: CONVERSATION_HISTORY_PAGE_BYTES,
          expectedRevision: expected
        };
        const request =
          target.kind === "metadata"
            ? api.metadataDetail(query)
            : api.detail({ ...query, messageId: target.messageId });
        return awaitHistoryResponse(request, [lifetime.signal, signal]);
      }
    });

    async function readMessages(
      query: Omit<
        ConversationHistoryMessagesQuery,
        "key" | "sessionId" | "maxBytes"
      > = {},
      signal?: AbortSignal
    ) {
      assertCurrent(signal);
      const result = await awaitHistoryResponse(
        api.messages({
          ...query,
          key,
          sessionId,
          maxBytes: CONVERSATION_HISTORY_PAGE_BYTES
        }),
        [lifetime.signal, signal]
      );
      assertCurrent(signal);
      acceptRevision(result.revision);
      if (generation !== undefined && generation !== result.generation) {
        dispose();
        throw new Error(
          "Conversation history generation changed within one revision."
        );
      }
      generation = result.generation;
      for (const message of result.messages) {
        cache.put(
          resourceKey("message", message.messageId),
          messageTag(message.messageId),
          message
        );
      }
      return freezeHistory(result) as ImmutableHistory<typeof result>;
    }
    async function readTurns(
      query: Omit<ConversationHistoryTurnsQuery, "key" | "sessionId"> = {},
      signal?: AbortSignal
    ) {
      assertCurrent(signal);
      // The turn API has no byte-budget parameter. 200 bounded previews/IDs fit under 1 MiB.
      const limit = Math.min(query.limit ?? 200, 200);
      const identity = [query.afterPosition ?? null, limit];
      if (revision !== undefined) {
        const cached = cache.get<
          ImmutableHistory<ConversationHistoryTurnsResult>
        >(resourceKey("turns", identity));
        if (cached) return cached;
      }
      const result = await awaitHistoryResponse(
        api.turns({ ...query, key, sessionId, limit }),
        [lifetime.signal, signal]
      );
      assertCurrent(signal);
      acceptRevision(result.revision);
      cache.put(resourceKey("turns", identity), scope, result);
      return result as ImmutableHistory<typeof result>;
    }
    function getCachedMessage(messageId: string) {
      assertCurrent();
      if (revision === undefined) return undefined;
      return cache.get<ImmutableHistory<ConversationHistoryMessage>>(
        resourceKey("message", messageId)
      );
    }
    return {
      readMessages,
      readTurns,
      getCachedMessage,
      pinMessage,
      dispose,
      pinMetadata: (reason: HistoryPinReason) => pinTag(scope, reason),
      readDetail: (target: HistoryDetailTarget, signal?: AbortSignal) =>
        awaitHistoryResponse(detail.readDetail(target, signal), [
          lifetime.signal,
          signal
        ]),
      streamDetail: detail.streamDetail,
      getCachedDetail: detail.getCachedDetail,
      get revision() {
        return revision;
      },
      get generation() {
        return generation;
      }
    };
  }
  return { openSession, stats: cache.stats };
}

export type ConversationHistoryReader = ReturnType<
  typeof createConversationHistoryReader
>;
export type ConversationHistoryReadSession = ReturnType<
  ConversationHistoryReader["openSession"]
>;
