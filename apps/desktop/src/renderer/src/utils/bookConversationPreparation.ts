import type { ConversationPersistenceApi } from "@deepwrite/contracts";
import {
  mergeAgentConversationPersistenceSnapshots,
  isCompletePersistenceSnapshot
} from "../composables/agent-conversation/persistence-snapshot";
import { migrateBookConversationHistory } from "./bookConversationMigration";
import { saveConversationEnvelope } from "./conversationEnvelopeSave";
import {
  conversationHistoryPersistenceKey,
  HISTORY_PREFIX
} from "./conversationPersistenceKeys";

interface Preparation {
  logicalKey: string;
  pending: Promise<void>;
  failed: boolean;
  snapshot?: unknown;
}

/** Keeps readable history available and prevents incomplete hydration from replacing it. */
export function createBookConversationPreparation(
  api: ConversationPersistenceApi,
  migrateLegacy: () => Promise<void>
) {
  const preparations = new Map<string, Preparation>();
  const preserveOnSave = new Set<string>();

  function requireReadableHistory(key: string, value: unknown): void {
    if (
      key.startsWith(HISTORY_PREFIX) &&
      value !== undefined &&
      !isCompletePersistenceSnapshot(value)
    ) {
      throw new Error("历史记录暂时无法完整读取，原始记录已保留。");
    }
  }

  function prepareHistory(logicalKey: string): Promise<void> {
    const key = conversationHistoryPersistenceKey(logicalKey);
    const existing = preparations.get(key);
    if (existing && !existing.failed) return existing.pending;
    const state: Preparation = {
      logicalKey,
      pending: Promise.resolve(),
      failed: false
    };
    preparations.set(key, state);
    state.pending = migrateLegacy()
      .then(() =>
        migrateBookConversationHistory(
          api,
          logicalKey,
          saveConversationEnvelope,
          (snapshot) => {
            state.snapshot = snapshot;
          }
        )
      )
      .then(() => {
        state.snapshot = undefined;
      })
      .catch((error: unknown) => {
        state.failed = true;
        preserveOnSave.add(key);
        throw error;
      });
    return state.pending;
  }

  async function load(key: string): Promise<unknown | undefined> {
    const state = preparations.get(key);
    // A failed write must not prevent restoring the already-read source records.
    await state?.pending.catch(() => undefined);
    if (state?.failed && state.snapshot !== undefined) return state.snapshot;
    try {
      const value = await api.load(key);
      requireReadableHistory(key, value);
      if (!state?.failed) preserveOnSave.delete(key);
      return value;
    } catch (error) {
      preserveOnSave.add(key);
      throw error;
    }
  }

  async function beforeSave(key: string, value: unknown): Promise<unknown> {
    const state = preparations.get(key);
    if (state?.failed) await prepareHistory(state.logicalKey);
    else await state?.pending;
    if (!preserveOnSave.has(key) || !key.startsWith(HISTORY_PREFIX))
      return value;
    // Retry the disk read on every save until a successful hydration has delivered
    // these records to the controller. One successful save alone cannot clear this guard.
    const stored = await api.load(key);
    requireReadableHistory(key, stored);
    return mergeAgentConversationPersistenceSnapshots(value, [stored]) ?? value;
  }

  async function beforeRemove(key: string): Promise<void> {
    const state = preparations.get(key);
    if (state?.failed) await prepareHistory(state.logicalKey);
    else await state?.pending;
  }

  return {
    prepareHistory,
    load,
    beforeSave,
    beforeRemove,
    removed(key: string) {
      preparations.delete(key);
      preserveOnSave.delete(key);
    }
  };
}
