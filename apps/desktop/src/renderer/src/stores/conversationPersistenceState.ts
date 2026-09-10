import { computed, markRaw, ref, shallowRef, triggerRef } from "vue";
import type {
  ConversationPersistenceAdapter,
  ConversationPersistenceOptions
} from "./conversationPersistenceTypes";

const MAX_PERSISTENCE_SAVE_WAIT_MS = 2_000;

interface PersistenceQueue {
  key: string;
  hasPending: boolean;
  pendingValue: unknown;
  pendingValueFactory: (() => unknown) | undefined;
  timer: number | undefined;
  queuedAt: number | undefined;
  inFlight: Promise<void> | undefined;
  lastError: unknown;
}

function rawValue<Value>(value: Value): Value {
  return typeof value === "object" && value !== null ? markRaw(value) : value;
}

export function createConversationPersistenceState(
  flushBeforeClose: (flush: () => Promise<void>) => Promise<void> = (flush) =>
    flush()
) {
  let stopCloseListener: (() => void) | undefined;
  const persistenceCache = shallowRef<Map<string, unknown>>(new Map());
  const persistenceErrors = shallowRef<Map<string, string>>(new Map());
  const persistenceStateVersion = ref(0);
  const persistenceBusy = computed(() => {
    void persistenceStateVersion.value;
    return [...persistenceQueues.values()].some(
      (queue) =>
        queue.hasPending ||
        queue.timer !== undefined ||
        queue.inFlight !== undefined
    );
  });

  let persistenceAdapter: ConversationPersistenceAdapter | null = null;
  let persistenceDebounceMs = 180;
  let persistenceErrorHandler:
    ((key: string, error: unknown) => void) | undefined;
  let persistenceAdapterEpoch = 0;
  let acceptsPersistenceSchedules = true;
  const persistenceQueues = new Map<string, PersistenceQueue>();
  const loadPromises = new Map<string, Promise<unknown | undefined>>();
  const loadEpochs = new Map<string, number>();

  function touchPersistenceState(): void {
    persistenceStateVersion.value += 1;
  }

  function cachePersistenceValue(key: string, value: unknown): void {
    persistenceCache.value.set(key, rawValue(value));
    triggerRef(persistenceCache);
  }

  function setPersistenceError(key: string, error: unknown): void {
    persistenceErrors.value.set(
      key,
      error instanceof Error ? error.message : "保存会话状态失败。"
    );
    triggerRef(persistenceErrors);
    persistenceErrorHandler?.(key, error);
  }

  function clearPersistenceError(key: string): void {
    if (persistenceErrors.value.delete(key)) triggerRef(persistenceErrors);
  }

  function configurePersistenceAdapter(
    adapter: ConversationPersistenceAdapter | null,
    options: ConversationPersistenceOptions = {}
  ): void {
    stopCloseListener?.();
    persistenceAdapter = adapter;
    persistenceAdapterEpoch += 1;
    persistenceDebounceMs = Math.max(0, Math.round(options.debounceMs ?? 180));
    persistenceErrorHandler = options.onError;
    acceptsPersistenceSchedules = true;
    stopCloseListener = adapter?.onBeforeClose?.(() =>
      flushBeforeClose(flushPersistence)
    );
    if (!adapter) return;
    for (const queue of persistenceQueues.values()) {
      if (queue.hasPending && queue.timer === undefined && !queue.inFlight) {
        scheduleQueueTimer(queue, 0);
      }
    }
    touchPersistenceState();
  }

  function queueForKey(key: string): PersistenceQueue {
    const existing = persistenceQueues.get(key);
    if (existing) return existing;
    const created: PersistenceQueue = {
      key,
      hasPending: false,
      pendingValue: undefined,
      pendingValueFactory: undefined,
      timer: undefined,
      queuedAt: undefined,
      inFlight: undefined,
      lastError: undefined
    };
    persistenceQueues.set(key, created);
    touchPersistenceState();
    return created;
  }

  function scheduleQueueTimer(queue: PersistenceQueue, delay: number): void {
    queue.queuedAt ??= Date.now();
    if (queue.timer !== undefined) {
      globalThis.clearTimeout(queue.timer);
    }
    queue.timer = globalThis.setTimeout(
      () => {
        queue.timer = undefined;
        touchPersistenceState();
        void startQueueSave(queue);
      },
      Math.min(
        delay,
        Math.max(
          0,
          MAX_PERSISTENCE_SAVE_WAIT_MS - (Date.now() - queue.queuedAt)
        )
      )
    );
    touchPersistenceState();
  }

  function startQueueSave(queue: PersistenceQueue): Promise<void> | undefined {
    if (queue.inFlight || !queue.hasPending || !persistenceAdapter) {
      return queue.inFlight;
    }
    const adapter = persistenceAdapter;
    const adapterEpoch = persistenceAdapterEpoch;
    const value = queue.pendingValue;
    const valueFactory = queue.pendingValueFactory;
    queue.pendingValue = undefined;
    queue.pendingValueFactory = undefined;
    queue.hasPending = false;
    queue.queuedAt = undefined;
    queue.lastError = undefined;
    clearPersistenceError(queue.key);

    const task = Promise.resolve()
      .then(() => {
        const resolvedValue = valueFactory ? valueFactory() : value;
        cachePersistenceValue(queue.key, resolvedValue);
        return adapter.save(queue.key, resolvedValue);
      })
      .then(() => {
        if (adapterEpoch === persistenceAdapterEpoch) {
          clearPersistenceError(queue.key);
        }
      })
      .catch((error: unknown) => {
        if (!queue.hasPending) {
          queue.pendingValue = value;
          queue.pendingValueFactory = valueFactory;
          queue.hasPending = true;
        }
        queue.lastError = error;
        if (adapterEpoch === persistenceAdapterEpoch) {
          setPersistenceError(queue.key, error);
        }
      })
      .finally(() => {
        if (queue.inFlight === task) {
          queue.inFlight = undefined;
        }
        touchPersistenceState();
        if (
          queue.hasPending &&
          queue.timer === undefined &&
          queue.lastError === undefined
        ) {
          void startQueueSave(queue);
        }
      });
    queue.inFlight = task;
    touchPersistenceState();
    return task;
  }

  function schedulePersistence<Value>(key: string, value: Value): void {
    if (!acceptsPersistenceSchedules) {
      throw new Error("会话持久化调度器已经关闭。");
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) throw new Error("持久化 key 不能为空。");
    // A local change wins over an older read that is still in flight. The
    // pending caller may inspect that stale value, but it can no longer
    // replace the newer shallow cache entry when it resolves.
    loadEpochs.set(normalizedKey, (loadEpochs.get(normalizedKey) ?? 0) + 1);
    const queue = queueForKey(normalizedKey);
    queue.pendingValue = rawValue(value);
    queue.pendingValueFactory = undefined;
    queue.hasPending = true;
    queue.lastError = undefined;
    cachePersistenceValue(normalizedKey, value);
    clearPersistenceError(normalizedKey);
    scheduleQueueTimer(queue, persistenceDebounceMs);
  }

  function schedulePersistenceFactory(
    key: string,
    valueFactory: () => unknown
  ): void {
    if (!acceptsPersistenceSchedules) {
      throw new Error("会话持久化调度器已经关闭。");
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) throw new Error("持久化 key 不能为空。");
    loadEpochs.set(normalizedKey, (loadEpochs.get(normalizedKey) ?? 0) + 1);
    const queue = queueForKey(normalizedKey);
    queue.pendingValue = undefined;
    queue.pendingValueFactory = valueFactory;
    queue.hasPending = true;
    queue.lastError = undefined;
    clearPersistenceError(normalizedKey);
    scheduleQueueTimer(queue, persistenceDebounceMs);
  }

  async function flushPersistenceKey(key: string): Promise<void> {
    const queue = persistenceQueues.get(key);
    if (!queue) return;
    if (queue.timer !== undefined) {
      globalThis.clearTimeout(queue.timer);
      queue.timer = undefined;
      touchPersistenceState();
    }
    while (queue.hasPending || queue.inFlight) {
      if (!queue.inFlight && queue.hasPending) {
        if (!persistenceAdapter) {
          throw new Error("会话持久化适配器尚未配置。");
        }
        startQueueSave(queue);
      }
      if (queue.inFlight) {
        await queue.inFlight;
      }
      if (queue.lastError !== undefined) throw queue.lastError;
    }
    if (queue.lastError !== undefined) {
      throw queue.lastError;
    }
  }

  async function flushPersistence(key?: string): Promise<void> {
    if (key) {
      await flushPersistenceKey(key);
      return;
    }
    const failures: unknown[] = [];
    for (const queueKey of persistenceQueues.keys()) {
      try {
        await flushPersistenceKey(queueKey);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }

  async function loadPersistence<Value>(
    key: string,
    options: { force?: boolean } = {}
  ): Promise<Value | undefined> {
    // Reopening a disposed controller must see its queued snapshot, not the
    // older cache entry from the last completed turn.
    const queue = persistenceQueues.get(key);
    if (queue?.hasPending || queue?.inFlight) await flushPersistenceKey(key);
    if (!options.force && persistenceCache.value.has(key)) {
      return persistenceCache.value.get(key) as Value;
    }
    const existing = loadPromises.get(key);
    if (existing) return existing as Promise<Value | undefined>;
    if (!persistenceAdapter) return undefined;

    const epoch = loadEpochs.get(key) ?? 0;
    const adapterEpoch = persistenceAdapterEpoch;
    const adapter = persistenceAdapter;
    const pending = adapter
      .load(key)
      .then((value) => {
        if (
          value !== undefined &&
          (loadEpochs.get(key) ?? 0) === epoch &&
          persistenceAdapterEpoch === adapterEpoch
        ) {
          cachePersistenceValue(key, value);
        }
        return value;
      })
      .finally(() => {
        if (loadPromises.get(key) === pending) {
          loadPromises.delete(key);
        }
      });
    loadPromises.set(key, pending);
    return pending as Promise<Value | undefined>;
  }

  function invalidatePersistenceCache(key: string): void {
    loadEpochs.set(key, (loadEpochs.get(key) ?? 0) + 1);
    loadPromises.delete(key);
    if (persistenceCache.value.delete(key)) triggerRef(persistenceCache);
  }

  async function removePersistence(key: string): Promise<void> {
    const queue = persistenceQueues.get(key);
    if (queue?.timer !== undefined) {
      globalThis.clearTimeout(queue.timer);
      queue.timer = undefined;
    }
    if (queue) {
      queue.hasPending = false;
      queue.queuedAt = undefined;
      queue.pendingValue = undefined;
      queue.pendingValueFactory = undefined;
      if (queue.inFlight) await queue.inFlight;
      persistenceQueues.delete(key);
      touchPersistenceState();
    }
    invalidatePersistenceCache(key);
    clearPersistenceError(key);
    await persistenceAdapter?.remove?.(key);
  }

  function discardPendingPersistence(): void {
    for (const queue of persistenceQueues.values()) {
      if (queue.timer !== undefined) {
        globalThis.clearTimeout(queue.timer);
      }
      queue.timer = undefined;
      queue.hasPending = false;
      queue.queuedAt = undefined;
      queue.pendingValue = undefined;
      queue.pendingValueFactory = undefined;
    }
    touchPersistenceState();
  }

  return {
    persistenceCache,
    persistenceErrors,
    persistenceBusy,
    configurePersistenceAdapter,
    schedulePersistence,
    schedulePersistenceFactory,
    flushPersistence,
    loadPersistence,
    invalidatePersistenceCache,
    removePersistence,
    discardPendingPersistence,
    stopScheduling() {
      acceptsPersistenceSchedules = false;
    },
    disconnect() {
      stopCloseListener?.();
      stopCloseListener = undefined;
      persistenceAdapter = null;
      persistenceAdapterEpoch += 1;
      loadPromises.clear();
    }
  };
}
