import type {
  ConversationHistoryDetailResult,
  ConversationHistoryJson
} from "@deepwrite/contracts";
import { CONVERSATION_HISTORY_PAGE_BYTES } from "@deepwrite/contracts/renderer";
import type { HistoryCache } from "./cache";
import {
  HistoryDetailRequiresStreamingError,
  type HistoryDetailTarget,
  type ImmutableHistory
} from "./types";

export interface HistoryDetailPort {
  cache: HistoryCache;
  maxMaterializedBytes: number;
  assertCurrent(signal?: AbortSignal): void;
  revision(): number;
  cacheKey(target: HistoryDetailTarget): string;
  tag(target: HistoryDetailTarget): string;
  load(
    target: HistoryDetailTarget,
    offset: number,
    expectedRevision: number,
    signal?: AbortSignal
  ): Promise<ConversationHistoryDetailResult>;
  acceptRevision(revision: number): void;
}

function invalidDetail(): never {
  throw new Error(
    "Conversation history detail returned an inconsistent chunk."
  );
}

export function createHistoryDetailReader(port: HistoryDetailPort) {
  async function* streamDetail(
    target: HistoryDetailTarget,
    signal?: AbortSignal
  ) {
    port.assertCurrent(signal);
    const revision = port.revision();
    // Caller-owned paths may change while an IPC request is pending.
    const stableTarget = { ...target, path: [...target.path] };
    let offset = 0;
    let totalBytes: number | undefined;
    let receivedBytes = 0;
    do {
      port.assertCurrent(signal);
      const result = await port.load(stableTarget, offset, revision, signal);
      port.assertCurrent(signal);
      port.acceptRevision(result.revision);
      const chunkBytes = new TextEncoder().encode(result.chunk).byteLength;
      receivedBytes += chunkBytes;
      if (
        result.encoding !== stableTarget.encoding ||
        (totalBytes !== undefined && totalBytes !== result.totalBytes) ||
        result.totalBytes > stableTarget.byteLength ||
        (stableTarget.encoding === "json" &&
          result.totalBytes !== stableTarget.byteLength) ||
        result.chunk.length > CONVERSATION_HISTORY_PAGE_BYTES ||
        chunkBytes > CONVERSATION_HISTORY_PAGE_BYTES ||
        receivedBytes > result.totalBytes ||
        (result.nextOffset === null && receivedBytes !== result.totalBytes) ||
        (result.nextOffset !== null &&
          (result.chunk.length === 0 ||
            result.nextOffset !== offset + result.chunk.length))
      )
        invalidDetail();
      totalBytes = result.totalBytes;
      // Nothing is accumulated or cached here; the consumer controls backpressure.
      yield Object.freeze(result);
      if (result.nextOffset === null) return;
      offset = result.nextOffset;
    } while (true);
  }

  function getCachedDetail(target: HistoryDetailTarget) {
    port.assertCurrent();
    return port.cache.get<ImmutableHistory<ConversationHistoryJson>>(
      port.cacheKey(target)
    );
  }

  async function readDetail(target: HistoryDetailTarget, signal?: AbortSignal) {
    port.assertCurrent(signal);
    target = { ...target, path: [...target.path] };
    if (target.byteLength > port.maxMaterializedBytes) {
      throw new HistoryDetailRequiresStreamingError(
        target.byteLength,
        port.maxMaterializedBytes
      );
    }
    const key = port.cacheKey(target);
    const cached =
      port.cache.get<ImmutableHistory<ConversationHistoryJson>>(key);
    if (cached !== undefined) return cached;
    const chunks: string[] = [];
    let units = 0;
    for await (const result of streamDetail(target, signal)) {
      units += result.chunk.length;
      if (
        units > port.maxMaterializedBytes ||
        result.totalBytes > port.maxMaterializedBytes
      ) {
        throw new HistoryDetailRequiresStreamingError(
          result.totalBytes,
          port.maxMaterializedBytes
        );
      }
      chunks.push(result.chunk);
    }
    port.assertCurrent(signal);
    const text = chunks.length === 1 ? chunks[0]! : chunks.join("");
    const value: ConversationHistoryJson =
      target.encoding === "text" ? text : JSON.parse(text);
    // Pending, failed and partially read values never become cache entries.
    port.cache.put(key, port.tag(target), value);
    return value as ImmutableHistory<ConversationHistoryJson>;
  }
  return { streamDetail, readDetail, getCachedDetail };
}
