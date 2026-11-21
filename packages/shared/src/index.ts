export function nowIso(): string {
  return new Date().toISOString();
}

/** 8-character lowercase hex from 4 random bytes. */
export function randomHex8(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/** Prefixed ID using underscore, e.g. evt_a1b2c3d4. */
export function createId(prefix: string): string {
  return `${prefix}_${randomHex8()}`;
}

/** Prefixed resource ID using hyphen, e.g. book-a1b2c3d4. */
export function createCatalogId(prefix: string): string {
  return `${prefix}-${randomHex8()}`;
}

/** Freezes a plain object graph in place, so a value shared by reference cannot be changed by a reader. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

export function reorderItemsByAnchor<T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  anchorId: string,
  position: "before" | "after"
): { items: T[]; moved: boolean } {
  if (sourceId === anchorId) {
    return { items: [...items], moved: false };
  }
  const sourceIndex = items.findIndex(({ id }) => id === sourceId);
  const anchorIndex = items.findIndex(({ id }) => id === anchorId);
  if (sourceIndex < 0 || anchorIndex < 0) {
    return { items: [...items], moved: false };
  }
  const next = items.filter(({ id }) => id !== sourceId);
  const nextAnchorIndex = next.findIndex(({ id }) => id === anchorId);
  next.splice(
    nextAnchorIndex + (position === "after" ? 1 : 0),
    0,
    items[sourceIndex]!
  );
  const moved = next.some((item, index) => item.id !== items[index]?.id);
  return { items: next, moved };
}
