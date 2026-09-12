import { createControllerPersistenceScheduler } from "./conversationControllerPersistence";
import { computed, markRaw, ref, shallowRef, triggerRef } from "vue";
import {
  createConversationPersistenceQueue,
  type ConversationPersistenceWork
} from "./conversationPersistenceQueue";
import type {
  ConversationPersistenceAdapter,
  ConversationPersistenceOptions
} from "./conversationPersistenceTypes";

function rawValue<Value>(value: Value): Value {
  return typeof value === "object" && value !== null ? markRaw(value) : value;
}

export function createConversationPersistenceState(
  flushBeforeClose: (flush: () => Promise<void>) => Promise<void> = (flush) =>
    flush()
) {
  let stopCloseListener: (() => void) | undefined;
  // This cache is the latest local view, including changes not yet acknowledged.
  const persistenceCache = shallowRef<Map<string, unknown>>(new Map());
  const persistenceErrors = shallowRef<Map<string, string>>(new Map());
  const persistenceStateVersion = ref(0);
  let persistenceAdapter: ConversationPersistenceAdapter | null = null;
  let persistenceErrorHandler:
    ((key: string, error: unknown) => void) | undefined;
  let persistenceAdapterEpoch = 0;
  const loadPromises = new Map<string, Promise<unknown | undefined>>();
  const loadEpochs = new Map<string, number>();

  function cachePersistenceValue(key: string, value: unknown): void {
    persistenceCache.value.set(key, rawValue(value));
    triggerRef(persistenceCache);
  }

  function clearPersistenceError(key: string): void {
    if (persistenceErrors.value.delete(key)) triggerRef(persistenceErrors);
  }

  const queue = createConversationPersistenceQueue({
    changed() {
      persistenceStateVersion.value += 1;
    },
    failed(key, error) {
      persistenceErrors.value.set(
        key,
        error instanceof Error ? error.message : "保存会话状态失败。"
      );
      triggerRef(persistenceErrors);
      persistenceErrorHandler?.(key, error);
    },
    confirmed: clearPersistenceError
  });
  const persistenceProgress = computed(() => {
    void persistenceStateVersion.value;
    return queue.progress();
  });
  const persistenceBusy = computed(() =>
    [...persistenceProgress.value.keys()].some(queue.hasPending)
  );

  function configurePersistenceAdapter(
    adapter: ConversationPersistenceAdapter | null,
    options: ConversationPersistenceOptions = {}
  ): void {
    stopCloseListener?.();
    persistenceAdapter = adapter;
    persistenceAdapterEpoch += 1;
    persistenceErrorHandler = options.onError;
    queue.configure(adapter, options.debounceMs);
    stopCloseListener = adapter?.onBeforeClose?.(() =>
      flushBeforeClose(queue.flush)
    );
  }

  function invalidateLoad(key: string): void {
    loadEpochs.set(key, (loadEpochs.get(key) ?? 0) + 1);
  }

  function schedulePersistenceWork(
    key: string,
    factory: () => ConversationPersistenceWork
  ): void {
    const normalizedKey = key.trim();
    queue.schedule(normalizedKey, factory);
    invalidateLoad(normalizedKey);
  }

  function schedulePersistence<Value>(key: string, value: Value): void {
    const normalizedKey = key.trim();
    schedulePersistenceWork(normalizedKey, () => ({
      save: (adapter) => adapter.save(normalizedKey, value)
    }));
    cachePersistenceValue(normalizedKey, value);
  }

  function schedulePersistenceFactory(
    key: string,
    valueFactory: () => unknown
  ): void {
    const normalizedKey = key.trim();
    schedulePersistenceWork(normalizedKey, () => {
      const value = valueFactory();
      cachePersistenceValue(normalizedKey, value);
      return { save: (adapter) => adapter.save(normalizedKey, value) };
    });
  }

  async function loadPersistence<Value>(
    key: string,
    options: { force?: boolean } = {}
  ): Promise<Value | undefined> {
    // A pending local write takes precedence over a stale asynchronous disk read.
    if (queue.hasPending(key)) await queue.flush(key);
    if (!options.force && persistenceCache.value.has(key))
      return persistenceCache.value.get(key) as Value;
    const existing = loadPromises.get(key);
    if (existing) return existing as Promise<Value | undefined>;
    if (!persistenceAdapter) return undefined;
    const epoch = loadEpochs.get(key) ?? 0;
    const adapterEpoch = persistenceAdapterEpoch;
    const pending = persistenceAdapter
      .load(key)
      .then((value) => {
        if (
          value !== undefined &&
          (loadEpochs.get(key) ?? 0) === epoch &&
          persistenceAdapterEpoch === adapterEpoch
        )
          cachePersistenceValue(key, value);
        return value;
      })
      .finally(() => {
        if (loadPromises.get(key) === pending) loadPromises.delete(key);
      });
    loadPromises.set(key, pending);
    return pending as Promise<Value | undefined>;
  }

  function invalidatePersistenceCache(key: string): void {
    invalidateLoad(key);
    loadPromises.delete(key);
    if (persistenceCache.value.delete(key)) triggerRef(persistenceCache);
  }

  async function removePersistence(key: string): Promise<void> {
    await queue.flush(key);
    // Keep the local recovery view and error if deleting on disk fails.
    await persistenceAdapter?.remove?.(key);
    await queue.remove(key);
    invalidatePersistenceCache(key);
    clearPersistenceError(key);
  }

  const scheduleControllerPersistence = createControllerPersistenceScheduler({
    supportsIncrementalHistory: () => Boolean(persistenceAdapter?.history),
    schedulePersistenceWork,
    schedulePersistenceFactory,
    invalidatePersistenceCache
  });

  return {
    scheduleControllerPersistence,
    persistenceCache,
    persistenceErrors,
    persistenceBusy,
    persistenceProgress,
    configurePersistenceAdapter,
    schedulePersistence,
    schedulePersistenceFactory,
    schedulePersistenceWork,
    flushPersistence: queue.flush,
    loadPersistence,
    invalidatePersistenceCache,
    removePersistence,
    discardPendingPersistence: queue.discard,
    stopScheduling: queue.stopScheduling,
    disconnect() {
      stopCloseListener?.();
      stopCloseListener = undefined;
      persistenceAdapter = null;
      persistenceAdapterEpoch += 1;
      queue.disconnect();
      loadPromises.clear();
    }
  };
}
