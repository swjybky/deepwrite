import { isDeepStrictEqual } from "node:util";

/**
 * Applies only the entries changed by a stale full-settings snapshot. This
 * keeps edits to different agents from overwriting each other in the write
 * queue while preserving last-write-wins for the same agent.
 */
export function mergeSettingsById<T>(
  current: readonly T[],
  incoming: readonly T[],
  baseline: readonly T[],
  idOf: (entry: T) => string
): T[] {
  const currentById = new Map(current.map((entry) => [idOf(entry), entry]));
  const baselineById = new Map(baseline.map((entry) => [idOf(entry), entry]));
  const incomingIds = new Set(incoming.map(idOf));
  const removedIds = new Set(
    baseline.map(idOf).filter((id) => !incomingIds.has(id))
  );
  const changedIds = new Set(
    incoming
      .filter((entry) => {
        const baselineEntry = baselineById.get(idOf(entry));
        return (
          baselineEntry === undefined ||
          !isDeepStrictEqual(entry, baselineEntry)
        );
      })
      .map(idOf)
  );
  const merged = incoming.flatMap((entry) => {
    const id = idOf(entry);
    if (changedIds.has(id)) return [entry];
    const currentEntry = currentById.get(id);
    return currentEntry === undefined ? [] : [currentEntry];
  });
  const concurrentEntries = current.filter((entry) => {
    const id = idOf(entry);
    return !baselineById.has(id) && !incomingIds.has(id);
  });
  return [
    ...merged.filter((entry) => !removedIds.has(idOf(entry))),
    ...concurrentEntries
  ];
}

export function sameSettingsValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}
