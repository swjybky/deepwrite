import { describe, expect, it, vi } from "vitest";
import { conversationJsonChunks } from "./json-chunks";

describe("bounded conversation JSON encoding", () => {
  it("round trips UTF-8, escapes, surrogate pairs across slices and sparse arrays", () => {
    const fixture = {
      text: '文字\n"\\\t'.repeat(300) + "x".repeat(4095) + "😀" + "\ud800",
      missing: undefined,
      values: Object.assign(new Array<unknown>(7), {
        0: undefined,
        2: null,
        3: true,
        4: false,
        5: Infinity,
        6: -12.5
      }),
      nested: { 'quoted"key': "正文" }
    };
    const chunks = [...conversationJsonChunks(fixture, 256)];
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks)
      expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(
        256
      );
    expect(JSON.parse(chunks.join(""))).toEqual(
      JSON.parse(JSON.stringify(fixture))
    );
  });

  it("handles deep records iteratively and rejects cycles or unsupported primitives", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 20_000; depth += 1) nested = [nested];
    expect([...conversationJsonChunks(nested)].join("").length).toBe(40_006);
    const circular: unknown[] = [];
    circular.push(circular);
    expect(() => [...conversationJsonChunks(circular)]).toThrow("循环引用");
    expect(() => [...conversationJsonChunks({ bad: 1n })]).toThrow("无法导出");
  });

  it("encodes a field larger than 64 MiB without stringifying the whole field or record", () => {
    const large = "x".repeat(65 * 1024 * 1024);
    const original = JSON.stringify;
    const stringify = vi
      .spyOn(JSON, "stringify")
      .mockImplementation((value) => {
        if (typeof value !== "string" || value.length > 4096)
          throw new Error("Unexpected unbounded stringify");
        return original(value);
      });
    let bytes = 0;
    let max = 0;
    try {
      for (const chunk of conversationJsonChunks({ text: large })) {
        const length = new TextEncoder().encode(chunk).byteLength;
        bytes += length;
        max = Math.max(max, length);
      }
    } finally {
      stringify.mockRestore();
    }
    expect(bytes).toBe(large.length + 11);
    expect(max).toBeLessThanOrEqual(256 * 1024);
  });
});
