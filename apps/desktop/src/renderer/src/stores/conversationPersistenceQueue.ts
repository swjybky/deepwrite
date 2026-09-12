import type { ConversationPersistenceAdapter } from "./conversationPersistenceTypes";

const DEFAULT_SAVE_DELAY_MS = 2_000;
const MAX_SAVE_WAIT_MS = 2_000;

export interface ConversationPersistenceWork {
  save(adapter: ConversationPersistenceAdapter): Promise<void>;
  /** Incremental batches keep their identity after an uncertain acknowledgement. */
  retainOnFailure?: boolean;
  confirmed?(): void;
  /** Saved sessions can be acknowledged while an isolated session remains unresolved. */
  deferredError?: Error;
}

export interface ConversationPersistenceFlushOptions {
  allowDeferred?: boolean;
}

export interface ConversationPersistenceProgress {
  status: "pending" | "saving" | "saved" | "error";
  requested: number;
  confirmed: number;
}

interface Queue {
  key: string;
  pending?: (() => ConversationPersistenceWork) | undefined;
  retry?: { work: ConversationPersistenceWork; requested: number } | undefined;
  timer?: ReturnType<typeof setTimeout> | undefined;
  queuedAt?: number | undefined;
  inFlight?: Promise<void> | undefined;
  lastError?: unknown;
  deferredError?: Error | undefined;
  requested: number;
  confirmed: number;
}

interface QueueHooks {
  changed(): void;
  failed(key: string, error: unknown): void;
  confirmed(key: string): void;
}

export function createConversationPersistenceQueue(hooks: QueueHooks) {
  const queues = new Map<string, Queue>();
  let adapter: ConversationPersistenceAdapter | null = null;
  let epoch = 0;
  let debounceMs = DEFAULT_SAVE_DELAY_MS;
  let accepting = true;

  function clearTimer(queue: Queue): void {
    if (queue.timer !== undefined) globalThis.clearTimeout(queue.timer);
    queue.timer = undefined;
  }

  function start(queue: Queue): Promise<void> | undefined {
    if (queue.inFlight || (!queue.pending && !queue.retry) || !adapter)
      return queue.inFlight;
    const currentAdapter = adapter;
    const currentEpoch = epoch;
    const factory = queue.pending;
    let work = queue.retry?.work;
    const requested = queue.retry?.requested ?? queue.requested;
    if (!work) queue.pending = undefined;
    queue.retry = undefined;
    queue.queuedAt = undefined;
    queue.lastError = undefined;
    const task = Promise.resolve()
      .then(async () => {
        work ??= factory!();
        await work.save(currentAdapter);
        work.confirmed?.();
        queue.deferredError = work.deferredError;
        if (!work.deferredError) {
          queue.confirmed = Math.max(queue.confirmed, requested);
          if (currentEpoch === epoch) hooks.confirmed(queue.key);
        }
      })
      .catch((error: unknown) => {
        if (work?.retainOnFailure) queue.retry = { work, requested };
        else queue.pending ??= factory;
        queue.lastError = error;
        if (currentEpoch === epoch) hooks.failed(queue.key, error);
      })
      .finally(() => {
        if (queue.inFlight === task) queue.inFlight = undefined;
        hooks.changed();
        if (
          (queue.pending || queue.retry) &&
          queue.timer === undefined &&
          queue.lastError === undefined
        )
          void start(queue);
      });
    queue.inFlight = task;
    hooks.changed();
    return task;
  }

  function scheduleTimer(queue: Queue, delay: number): void {
    queue.queuedAt ??= Date.now();
    clearTimer(queue);
    queue.timer = globalThis.setTimeout(
      () => {
        queue.timer = undefined;
        hooks.changed();
        void start(queue);
      },
      Math.min(
        delay,
        Math.max(0, MAX_SAVE_WAIT_MS - (Date.now() - queue.queuedAt))
      )
    );
    hooks.changed();
  }

  function schedule(
    key: string,
    factory: () => ConversationPersistenceWork
  ): void {
    if (!accepting) throw new Error("会话持久化调度器已经关闭。");
    if (!key.trim()) throw new Error("持久化 key 不能为空。");
    let queue = queues.get(key);
    if (!queue) {
      queue = { key, requested: 0, confirmed: 0 };
      queues.set(key, queue);
    }
    queue.pending = factory;
    queue.requested += 1;
    // Scheduling and retrying are not evidence that an earlier failure recovered.
    scheduleTimer(queue, debounceMs);
  }

  async function flushKey(
    key: string,
    options: ConversationPersistenceFlushOptions = {}
  ): Promise<void> {
    const queue = queues.get(key);
    if (!queue) return;
    clearTimer(queue);
    hooks.changed();
    while (queue.pending || queue.retry || queue.inFlight) {
      if (!queue.inFlight) {
        if (!adapter) throw new Error("会话持久化适配器尚未配置。");
        start(queue);
      }
      await queue.inFlight;
      if (queue.lastError !== undefined) throw queue.lastError;
    }
    if (queue.lastError !== undefined) throw queue.lastError;
    if (queue.deferredError && !options.allowDeferred)
      throw queue.deferredError;
  }

  async function flush(
    key?: string,
    options: ConversationPersistenceFlushOptions = {}
  ): Promise<void> {
    if (key) return flushKey(key, options);
    const failures: unknown[] = [];
    for (const queueKey of queues.keys()) {
      try {
        await flushKey(queueKey, options);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }

  function discard(): void {
    for (const queue of queues.values()) {
      clearTimer(queue);
      queue.pending = undefined;
      queue.retry = undefined;
      queue.deferredError = undefined;
      queue.queuedAt = undefined;
    }
    hooks.changed();
  }

  return {
    schedule,
    flush,
    discard,
    configure(
      next: ConversationPersistenceAdapter | null,
      delay = DEFAULT_SAVE_DELAY_MS
    ) {
      adapter = next;
      epoch += 1;
      debounceMs = Math.max(0, Math.round(delay));
      accepting = true;
      if (adapter)
        for (const queue of queues.values()) {
          if ((queue.pending || queue.retry) && !queue.inFlight)
            scheduleTimer(queue, 0);
        }
      hooks.changed();
    },
    hasPending(key: string) {
      const queue = queues.get(key);
      return Boolean(
        queue &&
        (queue.pending || queue.retry || queue.inFlight || queue.deferredError)
      );
    },
    progress(): Map<string, ConversationPersistenceProgress> {
      return new Map(
        [...queues].map(([key, queue]) => [
          key,
          {
            status:
              queue.lastError !== undefined
                ? "error"
                : queue.inFlight
                  ? "saving"
                  : queue.pending || queue.retry || queue.deferredError
                    ? "pending"
                    : "saved",
            requested: queue.requested,
            confirmed: queue.confirmed
          }
        ])
      );
    },
    async remove(key: string) {
      const queue = queues.get(key);
      if (!queue) return;
      clearTimer(queue);
      queue.pending = undefined;
      queue.retry = undefined;
      await queue.inFlight;
      queues.delete(key);
      hooks.changed();
    },
    stopScheduling() {
      accepting = false;
    },
    disconnect() {
      adapter = null;
      epoch += 1;
    }
  };
}
