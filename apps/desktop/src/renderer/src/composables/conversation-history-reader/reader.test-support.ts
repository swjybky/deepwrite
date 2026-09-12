import { vi } from "vitest";
import type {
  ConversationHistoryMessagesResult,
  ConversationHistoryDetailResult
} from "@deepwrite/contracts";
import type { HistoryReadApi } from "./types";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function page(
  messageId = "message-1",
  revision = 1
): ConversationHistoryMessagesResult {
  return {
    revision,
    generation: 0,
    nextPosition: null,
    messages: [
      {
        messageId,
        position: 0,
        value: { id: messageId, content: "test" },
        details: [],
        byteLength: 65 * 1024 * 1024
      }
    ]
  };
}
export function textChunk(
  chunk = "hello",
  nextOffset: number | null = null,
  totalBytes = 5,
  revision = 1
): ConversationHistoryDetailResult {
  return { revision, encoding: "text", chunk, nextOffset, totalBytes };
}
export function readApi() {
  const api = {
    messages: vi.fn<HistoryReadApi["messages"]>().mockResolvedValue(page()),
    turns: vi
      .fn<HistoryReadApi["turns"]>()
      .mockResolvedValue({ revision: 1, turns: [], nextPosition: null }),
    detail: vi.fn<HistoryReadApi["detail"]>().mockResolvedValue(textChunk()),
    metadataDetail: vi
      .fn<HistoryReadApi["metadataDetail"]>()
      .mockResolvedValue(textChunk())
  };
  return api;
}
