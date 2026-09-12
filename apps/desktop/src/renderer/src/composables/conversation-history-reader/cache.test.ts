import { describe, expect, it } from "vitest";
import { createHistoryCache, historyMemoryBytes } from "./cache";
import { HistoryCacheCapacityError, type HistoryPinReason } from "./types";

describe("history cache budgets and pin leases", () => {
  it("evicts by least recent use at the entry and byte budgets", () => {
    const cache = createHistoryCache(12, 2);
    cache.put("a", "a", "aa");
    cache.put("b", "b", "bb");
    expect(cache.get("a")).toBe("aa");
    cache.put("c", "c", "ccc");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.stats()).toEqual({ bytes: 10, entries: 2, pinnedEntries: 0 });
    cache.put("d", "d", "dddddd");
    expect(cache.stats()).toEqual({ bytes: 12, entries: 1, pinnedEntries: 0 });
  });

  it.each<HistoryPinReason>([
    "active",
    "editing",
    "pending-approval",
    "expanded",
    "unsaved"
  ])("protects %s data even when pinned before loading", (reason) => {
    const cache = createHistoryCache(10, 1);
    const release = cache.pin("message", reason);
    cache.put("a", "message", "hello");
    expect(() => cache.put("b", "other", "other")).toThrow(
      HistoryCacheCapacityError
    );
    expect(cache.get("a")).toBe("hello");
    release();
    release();
    cache.put("b", "other", "other");
    expect(cache.get("a")).toBeUndefined();
  });

  it("reference counts leases and keeps capacity failures atomic", () => {
    const cache = createHistoryCache(10, 2);
    const release = cache.pin("same", "editing");
    const otherRelease = cache.pin("same", "editing");
    cache.put("a", "same", "aa");
    cache.put("b", "other", "bb");
    release();
    expect(() => cache.put("large", "other", "llllll")).toThrow(
      HistoryCacheCapacityError
    );
    expect(cache.stats()).toEqual({ bytes: 8, entries: 2, pinnedEntries: 1 });
    otherRelease();
    cache.put("c", "new", "ccccc");
    expect(cache.stats()).toEqual({ bytes: 10, entries: 1, pinnedEntries: 0 });
  });

  it("counts huge immutable strings without encoding or serializing them", () => {
    const value = "a".repeat(65 * 1024 * 1024);
    expect(historyMemoryBytes(value, 1024)).toBe(value.length * 2);
  });
});
