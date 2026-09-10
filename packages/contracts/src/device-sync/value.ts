import type { SyncClock, SyncItem } from "./schemas";

export function syncKey(item: Pick<SyncItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}
export function stableSyncJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSyncJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSyncJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function syncEqual(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined
    ? left === right
    : stableSyncJson(left) === stableSyncJson(right);
}
export function clockIncludes(a: SyncClock, b: SyncClock): boolean {
  return Object.entries(b).every(([id, n]) => (a[id] ?? 0) >= n);
}
export function mergeSyncClocks(clocks: SyncClock[]): SyncClock {
  const result: SyncClock = {};
  for (const clock of clocks)
    for (const [id, n] of Object.entries(clock))
      result[id] = Math.max(result[id] ?? 0, n);
  return result;
}
export function safeSyncFile(path: string): boolean {
  return (
    !path
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") ||
          part.includes(".tmp-") ||
          part.includes(".corrupt-") ||
          [
            "agent",
            "transactions",
            "conversation.json",
            "agent-resources.json",
            "mobile-legacy",
            "mobile-reference-migration.json"
          ].includes(part)
      ) &&
    (path.endsWith(".md") ||
      path === "deepwrite.json" ||
      path === "long/index.json" ||
      /^long\/ledger\/[a-zA-Z0-9_-]+\.json$/.test(path))
  );
}
/** Device revisions and derived timestamps are not cross-device content versions. */
function canonicalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !["revision", "projectRevision", "updatedAt"].includes(key)
      )
      .map(([key, entry]) => [key, canonicalMetadata(entry)])
  );
}
export function syncContent(item: SyncItem | null): unknown {
  if (!item) return null;
  return {
    ...item,
    files: Object.fromEntries(
      Object.entries(item.files).map(([path, content]) => [
        path,
        path.endsWith(".json")
          ? canonicalMetadata(JSON.parse(content))
          : content
      ])
    )
  };
}
export function sameSyncContent(
  a: SyncItem | null,
  b: SyncItem | null
): boolean {
  return syncEqual(syncContent(a), syncContent(b));
}
