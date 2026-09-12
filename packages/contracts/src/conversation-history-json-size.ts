/** Counts JSON transport bytes, stopping as soon as the caller's budget is exceeded. */
export function conversationHistoryJsonBytes(
  value: unknown,
  budget: number
): number {
  const pending: unknown[] = [value];
  const encoder = new TextEncoder();
  let bytes = 0;
  while (pending.length && bytes <= budget) {
    const current = pending.pop();
    if (typeof current === "string") {
      // UTF-8 JSON cannot be shorter than the UTF-16 string. Avoid encoding giant inputs.
      if (current.length > budget - bytes) return budget + 1;
      bytes += encoder.encode(JSON.stringify(current)).byteLength;
    } else if (current !== null && typeof current === "object") {
      const entries = Array.isArray(current)
        ? current
        : Object.entries(current);
      bytes += 2 + Math.max(0, entries.length - 1);
      if (Array.isArray(current))
        for (const child of current) pending.push(child);
      else
        for (const [key, child] of entries as [string, unknown][]) {
          if (child === undefined) continue;
          bytes += 1;
          pending.push(key, child);
        }
    } else {
      bytes += JSON.stringify(current)?.length ?? 0;
    }
  }
  return bytes;
}
