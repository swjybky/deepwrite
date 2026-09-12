import type { ConversationPersistenceApi } from "@deepwrite/contracts";
import {
  mergeAgentConversationPersistenceSnapshots,
  isCompletePersistenceSnapshot
} from "../composables/agent-conversation/persistence-snapshot";
import type { ConversationPersistenceAdapter } from "../stores/conversationPersistenceTypes";
import {
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY
} from "./conversationPersistenceKeys";
import {
  AGENT_MODEL_SELECTION_STORAGE_KEY,
  AGENT_RUN_PREFERENCES_STORAGE_KEY,
  parseAgentModelSelection,
  parseAgentRunPreferences
} from "./agentRunPreferences";

import {
  HISTORY_PREFIX,
  conversationHistoryPersistenceKey,
  persistenceKeyFromLegacyStorageKey,
  type ConversationLegacyStorage,
  type ConversationPersistenceAdapterOptions
} from "./conversationPersistenceKeys";
export {
  conversationHistoryPersistenceKey,
  legacyConversationHistoryStorageKey,
  LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX
} from "./conversationPersistenceKeys";
export type {
  ConversationLegacyStorage,
  ConversationPersistenceAdapterOptions
} from "./conversationPersistenceKeys";
import { createBookConversationPreparation } from "./bookConversationPreparation";
import {
  conversationEnvelopeHasContent,
  isEmptyConversationEnvelope,
  saveConversationEnvelope
} from "./conversationEnvelopeSave";

function listStorageKeys(storage: ConversationLegacyStorage): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

function readStorageItem(
  storage: ConversationLegacyStorage,
  key: string
): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeStorageItem(
  storage: ConversationLegacyStorage,
  key: string
): void {
  try {
    storage.removeItem(key);
  } catch {
    // Quota / privacy-mode failures must not block the live adapter.
  }
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

async function migrateLegacyConversationEntry(
  api: ConversationPersistenceApi,
  persistenceKey: string,
  raw: string
): Promise<boolean> {
  const legacyValue = parseJsonValue(raw);
  if (!isCompletePersistenceSnapshot(legacyValue)) return false;
  const current = await api.load(persistenceKey);
  if (current !== undefined && !isCompletePersistenceSnapshot(current))
    return false;
  const merged = mergeAgentConversationPersistenceSnapshots(current, [
    legacyValue
  ]);
  if (!merged) return false;
  if (!sameJsonValue(current, merged)) {
    await api.save(persistenceKey, merged);
  }
  return true;
}

async function migrateLegacyModelSelection(
  api: ConversationPersistenceApi,
  raw: string
): Promise<boolean> {
  const legacy = parseAgentModelSelection(raw);
  if (!legacy) return false;
  const current = parseAgentModelSelection(
    jsonStringOrNull(await api.load(MODEL_SELECTION_PERSISTENCE_KEY))
  );
  if (!current) {
    await api.save(MODEL_SELECTION_PERSISTENCE_KEY, legacy);
  }
  return true;
}

async function migrateLegacyRunPreferences(
  api: ConversationPersistenceApi,
  raw: string
): Promise<boolean> {
  const legacy = parseAgentRunPreferences(raw);
  if (!Object.keys(legacy).length) return false;
  const current = parseAgentRunPreferences(
    jsonStringOrNull(await api.load(RUN_PREFERENCES_PERSISTENCE_KEY))
  );
  const merged = { ...legacy, ...current };
  if (!sameJsonValue(current, merged)) {
    await api.save(RUN_PREFERENCES_PERSISTENCE_KEY, merged);
  }
  return true;
}

function jsonStringOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function migrateLegacyConversationPersistence(
  api: ConversationPersistenceApi,
  storage: ConversationLegacyStorage
): Promise<void> {
  for (const storageKey of listStorageKeys(storage)) {
    const raw = readStorageItem(storage, storageKey);
    if (!raw) continue;
    try {
      let migrated = false;
      if (storageKey === AGENT_MODEL_SELECTION_STORAGE_KEY) {
        migrated = await migrateLegacyModelSelection(api, raw);
      } else if (storageKey === AGENT_RUN_PREFERENCES_STORAGE_KEY) {
        migrated = await migrateLegacyRunPreferences(api, raw);
      } else {
        const persistenceKey = persistenceKeyFromLegacyStorageKey(storageKey);
        if (!persistenceKey) continue;
        migrated = await migrateLegacyConversationEntry(
          api,
          persistenceKey,
          raw
        );
      }
      if (migrated) removeStorageItem(storage, storageKey);
    } catch {
      // Keep the localStorage copy when a single key cannot be written.
    }
  }
}

export function createConversationPersistenceAdapter(
  api: ConversationPersistenceApi | undefined,
  options: ConversationPersistenceAdapterOptions = {}
): ConversationPersistenceAdapter | null {
  if (!api) return null;
  const persistenceApi = api;
  const storage = options.storage;
  let migratePromise: Promise<void> | undefined;

  function migrateLegacy(): Promise<void> {
    if (!storage) return Promise.resolve();
    if (!migratePromise) {
      migratePromise = migrateLegacyConversationPersistence(
        persistenceApi,
        storage
      ).catch(() => undefined);
    }
    return migratePromise;
  }

  const preparation = createBookConversationPreparation(
    persistenceApi,
    migrateLegacy
  );

  return {
    ...(api.history ? { history: api.history } : {}),
    ...(api.onBeforeClose
      ? { onBeforeClose: api.onBeforeClose.bind(api) }
      : {}),
    prepareHistory: preparation.prepareHistory,
    async load(key) {
      await migrateLegacy();
      return preparation.load(key);
    },
    async save(key, value) {
      await migrateLegacy();
      value = await preparation.beforeSave(key, value);
      if (
        key.startsWith(HISTORY_PREFIX) &&
        isEmptyConversationEnvelope(value)
      ) {
        const current = await persistenceApi.load(key);
        if (conversationEnvelopeHasContent(current)) {
          return;
        }
      }
      if (key.startsWith(HISTORY_PREFIX)) {
        await saveConversationEnvelope(persistenceApi, key, value);
        return;
      }
      return persistenceApi.save(key, value);
    },
    async remove(key) {
      await migrateLegacy();
      await preparation.beforeRemove(key);
      await persistenceApi.remove(key);
      preparation.removed(key);
    }
  };
}

/**
 * Moves one logical conversation history into another without discarding a
 * destination that may already have been created by a newer build. The
 * operation is deliberately idempotent so startup may safely retry it.
 */
export async function migrateConversationHistoryKey(
  adapter: ConversationPersistenceAdapter | null,
  fromLogicalKey: string,
  toLogicalKey: string
): Promise<void> {
  if (!adapter || fromLogicalKey === toLogicalKey) return;
  const fromKey = conversationHistoryPersistenceKey(fromLogicalKey);
  const toKey = conversationHistoryPersistenceKey(toLogicalKey);
  const legacy = await adapter.load(fromKey);
  if (!legacy) return;
  const current = await adapter.load(toKey);
  const merged = mergeAgentConversationPersistenceSnapshots(current, [legacy]);
  if (!merged) return;
  if (!sameJsonValue(current, merged)) {
    await adapter.save(toKey, merged);
  }
  await adapter.remove?.(fromKey);
}
