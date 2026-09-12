import { describe, expect, it, vi } from "vitest";
import type { ConversationHistoryDetailResult } from "@deepwrite/contracts";
import {
  createConversationHistoryReader,
  HistoryDetailRequiresStreamingError
} from "./index";
import { deferred, readApi, textChunk } from "./reader.test-support";

const target = {
  messageId: "message",
  path: ["thinking"],
  byteLength: 5,
  encoding: "text" as const
};
const createSession = (api = readApi()) =>
  createConversationHistoryReader(api).openSession(
    "conversation-history:test",
    "one",
    1
  );

describe("complete detail cache and chunk streaming", () => {
  it("does not expose unfinished chunks and reuses the completed detail", async () => {
    const api = readApi();
    const tail = deferred<ConversationHistoryDetailResult>();
    api.detail
      .mockResolvedValueOnce(textChunk("he", 2))
      .mockReturnValueOnce(tail.promise);
    const session = createSession(api);
    const read = session.readDetail(target);
    await vi.waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
    expect(session.getCachedDetail(target)).toBeUndefined();
    tail.resolve(textChunk("llo"));
    expect(await read).toBe("hello");
    expect(await session.readDetail(target)).toBe("hello");
    expect(api.detail).toHaveBeenCalledTimes(2);
    expect(api.detail.mock.calls[1]![0]).toMatchObject({
      offset: 2,
      expectedRevision: 1,
      maxBytes: 1024 * 1024
    });
  });

  it("leaves no incomplete cache entry after a read fails and can retry", async () => {
    const api = readApi();
    api.detail
      .mockResolvedValueOnce(textChunk("he", 2))
      .mockRejectedValueOnce(new Error("read failed"));
    const session = createSession(api);
    await expect(session.readDetail(target)).rejects.toThrow("read failed");
    expect(session.getCachedDetail(target)).toBeUndefined();
    expect(await session.readDetail(target)).toBe("hello");
  });

  it("rejects 65 MiB materialization before any read, and streams one bounded chunk on demand", async () => {
    const api = readApi();
    const bytes = 65 * 1024 * 1024;
    const chunk = "a".repeat(1024 * 1024);
    api.detail.mockResolvedValue(textChunk(chunk, chunk.length, bytes));
    const reader = createConversationHistoryReader(api);
    const session = reader.openSession("conversation-history:test", "one", 1);
    const large = { ...target, byteLength: bytes };
    await expect(session.readDetail(large)).rejects.toBeInstanceOf(
      HistoryDetailRequiresStreamingError
    );
    expect(api.detail).not.toHaveBeenCalled();
    const stringify = vi.spyOn(JSON, "stringify");
    const iterator = session.streamDetail(large);
    const first = await iterator.next();
    expect(first.value?.chunk).toBe(chunk);
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
    await iterator.return();
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(reader.stats().entries).toBe(0);
  });

  it.each([
    { ...textChunk(), nextOffset: 0 },
    { ...textChunk(), nextOffset: 6 },
    { ...textChunk(), totalBytes: 7 },
    { ...textChunk(), chunk: "he" },
    { ...textChunk(), encoding: "json" as const }
  ])("rejects inconsistent chunk metadata without caching", async (result) => {
    const api = readApi();
    api.detail.mockResolvedValue(result);
    const session = createSession(api);
    await expect(session.readDetail(target)).rejects.toThrow(
      "inconsistent chunk"
    );
    expect(session.getCachedDetail(target)).toBeUndefined();
  });

  it("cancels streaming promptly and ignores late chunks", async () => {
    const api = readApi();
    const waiting = deferred<ConversationHistoryDetailResult>();
    api.detail.mockReturnValue(waiting.promise);
    const session = createSession(api);
    const abort = new AbortController();
    const iterator = session.streamDetail(target, abort.signal);
    const first = iterator.next();
    abort.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    waiting.reject(new Error("late transport failure"));
    await Promise.resolve();
    expect(session.getCachedDetail(target)).toBeUndefined();
  });

  it("accepts text references whose stored JSON byte count includes escaping", async () => {
    const api = readApi();
    api.detail.mockResolvedValue(textChunk("a\nb", null, 3));
    expect(
      await createSession(api).readDetail({ ...target, byteLength: 6 })
    ).toBe("a\nb");
  });

  it("locks the caller's requested path for the duration of the read", async () => {
    const api = readApi();
    const waiting = deferred<ConversationHistoryDetailResult>();
    api.detail.mockReturnValue(waiting.promise);
    const session = createSession(api);
    const request = { ...target, path: ["thinking"] };
    const pending = session.readDetail(request);
    request.path[0] = "content";
    waiting.resolve(textChunk());
    await pending;
    expect(api.detail.mock.calls[0]![0].path).toEqual(["thinking"]);
    expect(session.getCachedDetail(target)).toBe("hello");
    expect(session.getCachedDetail(request)).toBeUndefined();
  });
});
