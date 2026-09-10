export const HISTORY_PREFIX = "conversation-history:";
export const MODEL_SELECTION_PERSISTENCE_KEY =
  "conversation-preferences:model-selection:v1";
export const RUN_PREFERENCES_PERSISTENCE_KEY =
  "conversation-preferences:run-options:v1";
export const LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX =
  "deepwrite:agent-conversations:v1:";
const MAX_PERSISTENCE_KEY_LENGTH = 240;
const HASH_OFFSET = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;
const HASHED_KEY_SUFFIX = /~[a-f0-9]{16}$/u;

export type ConversationLegacyStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "key" | "length"
>;

export interface ConversationPersistenceAdapterOptions {
  storage?: ConversationLegacyStorage;
}

function stableKeyHash(value: string): string {
  let hash = HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * HASH_PRIME) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Converts an in-memory conversation identity into a contract-safe key.
 * Long filesystem-derived identities retain a readable prefix plus a stable
 * suffix, while ordinary keys remain fully reversible in diagnostics.
 */
export function conversationHistoryPersistenceKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("会话 key 不能为空。");
  const encoded = encodeURIComponent(normalized);
  const direct = `${HISTORY_PREFIX}${encoded}`;
  if (direct.length <= MAX_PERSISTENCE_KEY_LENGTH) return direct;

  const hash = stableKeyHash(normalized);
  const suffix = `~${hash}`;
  const prefixLength =
    MAX_PERSISTENCE_KEY_LENGTH - HISTORY_PREFIX.length - suffix.length;
  const prefix = encoded.slice(0, prefixLength).replace(/%[0-9A-Fa-f]?$/u, "");
  return `${HISTORY_PREFIX}${prefix}${suffix}`;
}

export function legacyConversationHistoryStorageKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("会话 key 不能为空。");
  return `${LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX}${encodeURIComponent(normalized)}`;
}

function decodePersistenceSuffix(encoded: string): string | undefined {
  const hashed = HASHED_KEY_SUFFIX.exec(encoded)?.[0];
  const reversible = hashed ? encoded.slice(0, -hashed.length) : encoded;
  if (!reversible) return undefined;
  try {
    return decodeURIComponent(reversible);
  } catch {
    return reversible;
  }
}

export function persistenceKeyFromLegacyStorageKey(
  storageKey: string
): string | undefined {
  if (storageKey.startsWith(LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX)) {
    const encoded = storageKey.slice(
      LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX.length
    );
    const logicalKey = decodePersistenceSuffix(encoded);
    if (!logicalKey?.trim()) return undefined;
    try {
      return conversationHistoryPersistenceKey(logicalKey);
    } catch {
      return undefined;
    }
  }
  if (
    storageKey.startsWith(HISTORY_PREFIX) &&
    storageKey.length <= MAX_PERSISTENCE_KEY_LENGTH
  ) {
    const encoded = storageKey.slice(HISTORY_PREFIX.length);
    if (HASHED_KEY_SUFFIX.test(encoded)) return storageKey;
    const logicalKey = decodePersistenceSuffix(encoded);
    if (!logicalKey?.trim()) return undefined;
    try {
      return conversationHistoryPersistenceKey(logicalKey);
    } catch {
      return storageKey;
    }
  }
  return undefined;
}
