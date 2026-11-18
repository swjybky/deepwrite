import { z } from "zod";

export const RENDERER_STATE_KEY_MAX_LENGTH = 240;
export const RENDERER_STATE_KEY_PREFIXES = [
  "conversation-history:",
  "conversation-preferences:"
] as const;

const RENDERER_STATE_KEY_PATTERN =
  /^(?:conversation-history:|conversation-preferences:)(?:[A-Za-z0-9!()*'._~:-]|%[0-9A-Fa-f]{2})+$/u;

export const RendererStateKeySchema = z
  .string()
  .max(RENDERER_STATE_KEY_MAX_LENGTH)
  .regex(
    RENDERER_STATE_KEY_PATTERN,
    "Renderer state key must use an allowed conversation prefix and encoded suffix."
  );
export type RendererStateKey = z.infer<typeof RendererStateKeySchema>;

const HISTORY_KEY_PREFIX = "conversation-history:";
const HASH_OFFSET = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;

function stableKeyHash(value: string): string {
  let hash = HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * HASH_PRIME) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Storage key of a logical conversation key. Long filesystem-derived identities keep a readable prefix plus a
 * stable suffix; ordinary keys stay fully reversible. Callers reject an empty key first.
 */
export function conversationHistoryKeyFor(logicalKey: string): string {
  const normalized = logicalKey.trim();
  const encoded = encodeURIComponent(normalized);
  const direct = `${HISTORY_KEY_PREFIX}${encoded}`;
  if (direct.length <= RENDERER_STATE_KEY_MAX_LENGTH) return direct;
  const suffix = `~${stableKeyHash(normalized)}`;
  const prefixLength =
    RENDERER_STATE_KEY_MAX_LENGTH - HISTORY_KEY_PREFIX.length - suffix.length;
  const prefix = encoded.slice(0, prefixLength).replace(/%[0-9A-Fa-f]?$/u, "");
  return `${HISTORY_KEY_PREFIX}${prefix}${suffix}`;
}

/** Logical conversation key of a synced work, as the workspace names it. */
export function bookConversationLogicalKey(syncKey: string): string | null {
  if (syncKey.startsWith("book:")) return `${syncKey.slice(5)}:chat`;
  if (syncKey.startsWith("long-book:"))
    return `long:${encodeURIComponent(syncKey.slice(10))}:chat`;
  if (syncKey.startsWith("mystery-book:"))
    return `mystery:${encodeURIComponent(syncKey.slice(13))}:chat`;
  return null;
}
