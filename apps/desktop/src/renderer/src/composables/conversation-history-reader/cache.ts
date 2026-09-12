import { HistoryCacheCapacityError, type HistoryPinReason } from "./types";

interface Entry {
  value: unknown;
  bytes: number;
  tag: string;
}

/** Memory estimate: UTF-16 strings plus containers; no serialization or string copy. */
export function historyMemoryBytes(
  value: unknown,
  budget = Number.MAX_SAFE_INTEGER
): number {
  const pending: unknown[] = [value];
  let bytes = 0;
  while (pending.length && bytes <= budget) {
    const current = pending.pop();
    if (typeof current === "string") bytes += current.length * 2;
    else if (current && typeof current === "object") {
      bytes += 32;
      for (const key of Object.keys(current)) {
        bytes += 16 + key.length * 2;
        pending.push((current as Record<string, unknown>)[key]);
      }
    } else bytes += 8;
  }
  return bytes;
}

/** Freeze received containers in place. Strings remain the transport's immutable values. */
export function freezeHistory<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeHistory(child);
    Object.freeze(value);
  }
  return value;
}

export function createHistoryCache(maxBytes: number, maxEntries: number) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1
  ) {
    throw new RangeError(
      "Conversation history cache budgets must be positive integers."
    );
  }
  const entries = new Map<string, Entry>();
  const pins = new Map<string, Map<HistoryPinReason, number>>();
  let bytes = 0;
  function pinned(tag: string) {
    return (pins.get(tag)?.size ?? 0) > 0;
  }
  return {
    maxBytes,
    get<T>(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value as T;
    },
    put(key: string, tag: string, value: unknown) {
      const size = historyMemoryBytes(value, maxBytes);
      const previous = entries.get(key);
      let nextBytes = bytes - (previous?.bytes ?? 0) + size;
      let nextCount = entries.size + (previous ? 0 : 1);
      const victims: string[] = [];
      for (const [candidate, entry] of entries) {
        if (nextBytes <= maxBytes && nextCount <= maxEntries) break;
        if (candidate === key || pinned(entry.tag)) continue;
        victims.push(candidate);
        nextBytes -= entry.bytes;
        nextCount--;
      }
      // Capacity failure is atomic: existing usable entries and pins remain untouched.
      if (nextBytes > maxBytes || nextCount > maxEntries)
        throw new HistoryCacheCapacityError();
      for (const victim of victims) entries.delete(victim);
      entries.delete(key);
      entries.set(key, { value: freezeHistory(value), bytes: size, tag });
      bytes = nextBytes;
    },
    pin(tag: string, reason: HistoryPinReason): () => void {
      const reasons = pins.get(tag) ?? new Map<HistoryPinReason, number>();
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      pins.set(tag, reasons);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = reasons.get(reason) ?? 0;
        if (count > 1) reasons.set(reason, count - 1);
        else reasons.delete(reason);
        if (reasons.size === 0) pins.delete(tag);
      };
    },
    stats() {
      return {
        bytes,
        entries: entries.size,
        pinnedEntries: [...entries.values()].filter((entry) =>
          pinned(entry.tag)
        ).length
      };
    }
  };
}
export type HistoryCache = ReturnType<typeof createHistoryCache>;
