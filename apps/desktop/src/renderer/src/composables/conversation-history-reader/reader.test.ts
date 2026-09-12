import { describe, expect, it } from "vitest";
import {
  createConversationHistoryReader,
  HistoryReadConflictError
} from "./index";
import { deferred, page, readApi, textChunk } from "./reader.test-support";
import type { ConversationHistoryMessagesResult } from "@deepwrite/contracts";

describe("bounded conversation history reads", () => {
  it("caches only projected bytes, keeps strings and container identities, and freezes the received data", async () => {
    const api = readApi();
    const source = page();
    api.messages.mockResolvedValue(source);
    const reader = createConversationHistoryReader(api, {
      maxCacheBytes: 4096
    });
    const session = reader.openSession("conversation-history:test", "session");
    expect(session.getCachedMessage("message-1")).toBeUndefined();
    const result = await session.readMessages();
    expect(result).toBe(source);
    expect(session.getCachedMessage("message-1")).toBe(source.messages[0]);
    expect(Object.isFrozen(result.messages[0]!.value)).toBe(true);
    expect(reader.stats().bytes).toBeLessThan(4096);
    expect(api.messages).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 1024 * 1024 })
    );
  });

  it("fixes one revision across message and turn pages and cancels other pending responses on conflict", async () => {
    const api = readApi();
    const waiting = deferred<ConversationHistoryMessagesResult>();
    api.messages
      .mockResolvedValueOnce(page())
      .mockImplementationOnce(() => waiting.promise);
    api.turns.mockResolvedValue({ revision: 2, turns: [], nextPosition: null });
    const reader = createConversationHistoryReader(api);
    const session = reader.openSession("conversation-history:test", "session");
    await session.readMessages();
    const oldRequest = session.readMessages({ afterPosition: 0 });
    const cancelled = expect(oldRequest).rejects.toMatchObject({
      name: "AbortError"
    });
    await expect(session.readTurns()).rejects.toBeInstanceOf(
      HistoryReadConflictError
    );
    await cancelled;
    waiting.resolve(page("stale-message"));
    await Promise.resolve();
    expect(reader.stats().entries).toBe(1);
  });

  it("rejects an explicitly bound stale revision before exposing or caching a page", async () => {
    const reader = createConversationHistoryReader(readApi());
    const session = reader.openSession(
      "conversation-history:test",
      "session",
      2
    );
    await expect(session.readMessages()).rejects.toBeInstanceOf(
      HistoryReadConflictError
    );
    expect(reader.stats().entries).toBe(0);
  });

  it("cancels promptly without letting a late response enter the cache", async () => {
    const api = readApi();
    const waiting = deferred<ConversationHistoryMessagesResult>();
    api.messages.mockReturnValue(waiting.promise);
    const reader = createConversationHistoryReader(api);
    const session = reader.openSession("conversation-history:test", "session");
    const cancellation = new AbortController();
    const pending = session.readMessages({}, cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    waiting.resolve(page());
    await Promise.resolve();
    expect(session.getCachedMessage("message-1")).toBeUndefined();
  });

  it("does not share data across sessions or revisions; errors have no write side effects", async () => {
    const api = readApi();
    const reader = createConversationHistoryReader(api);
    await reader.openSession("conversation-history:test", "one").readMessages();
    expect(
      reader
        .openSession("conversation-history:test", "two", 1)
        .getCachedMessage("message-1")
    ).toBeUndefined();
    const newer = reader.openSession("conversation-history:test", "one", 2);
    expect(newer.getCachedMessage("message-1")).toBeUndefined();
    api.messages.mockRejectedValue(new Error("unavailable"));
    await expect(newer.readMessages()).rejects.toThrow("unavailable");
    expect(reader.stats().entries).toBe(1);
  });

  it("reuses complete turn pages from one fixed revision", async () => {
    const api = readApi();
    const session = createConversationHistoryReader(api).openSession(
      "conversation-history:test",
      "one"
    );
    expect(await session.readTurns()).toBe(await session.readTurns());
    expect(api.turns).toHaveBeenCalledTimes(1);
  });

  it("reads metadata and root JSON details through their distinct API routes", async () => {
    const api = readApi();
    const session = createConversationHistoryReader(api).openSession(
      "conversation-history:test",
      "one",
      1
    );
    api.metadataDetail.mockResolvedValue({
      ...textChunk(),
      encoding: "json",
      chunk: '{"draft":"test"}',
      totalBytes: 16
    });
    const value = await session.readDetail({
      kind: "metadata",
      path: [],
      encoding: "json",
      byteLength: 16
    });
    expect(value).toEqual({ draft: "test" });
    expect(Object.isFrozen(value)).toBe(true);
    expect(api.metadataDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        path: [],
        expectedRevision: 1,
        maxBytes: 1024 * 1024
      })
    );
    expect(api.detail).not.toHaveBeenCalled();
  });
});
