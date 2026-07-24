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
