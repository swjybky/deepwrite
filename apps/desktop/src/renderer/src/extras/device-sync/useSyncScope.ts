import { computed, reactive, type ComputedRef, type Ref } from "vue";
import type {
  SyncConfig,
  SyncResponse,
  SyncStatus
} from "@deepwrite/contracts/renderer";

/** Clicks within this window are saved together. */
export const SYNC_SCOPE_SAVE_DELAY_MS = 400;

/**
 * Scope switches show at once and are saved together a moment later, so a click never waits for Main or
 * disables the page. Main allows one operation at a time: a change made while one runs is saved after it.
 */
function useScopeDraft<
  Item extends { key: string; included: boolean }
>(options: {
  source: () => Item[];
  /** Settles when the operation running now has finished. */
  idle(): Promise<unknown>;
  /** Saves the changed inclusions; resolves without a request when nothing changes. */
  save(changes: ReadonlyMap<string, boolean>): Promise<unknown>;
  /** Shows Main's authoritative state after a failed save. */
  restore(error: unknown): Promise<void>;
}) {
  const intents = reactive(new Map<string, boolean>());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<boolean> = Promise.resolve(true);

  const items: ComputedRef<Item[]> = computed(() =>
    options.source().map((item) => {
      const included = intents.get(item.key);
      return included === undefined || included === item.included
        ? item
        : { ...item, included };
    })
  );

  async function save(): Promise<boolean> {
    const sent = new Map(intents);
    // Only drop intents still equal to what this save sent; later clicks wait for the next save.
    const settle = () => {
      for (const [key, included] of sent)
        if (intents.get(key) === included) intents.delete(key);
    };
    if (!sent.size) return true;
    try {
      await options.save(sent);
      settle();
      return true;
    } catch (error) {
      settle();
      await options.restore(error);
      return false;
    }
  }
  /** Saves pending changes now; resolves false when Main rejected them. */
  function flush(): Promise<boolean> {
    clearTimeout(timer);
    timer = undefined;
    saving = saving.then(save);
    return saving;
  }
  function schedule(delay: number): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void options.idle().then(flush);
    }, delay);
  }
  function toggle(keys: string[], included: boolean): void {
    for (const key of keys) intents.set(key, included);
    schedule(SYNC_SCOPE_SAVE_DELAY_MS);
  }
  /** Leaving the page keeps the choice: save it without waiting for the delay. */
  function dispose(): void {
    if (timer !== undefined || intents.size) schedule(0);
  }
  return { items, toggle, flush, dispose };
}

function sameKeys(next: Set<string>, current: readonly string[]): boolean {
  return next.size === current.length && current.every((key) => next.has(key));
}

export function useSyncScope(options: {
  status: Ref<SyncStatus | null>;
  idle(): Promise<unknown>;
  configure(config: SyncConfig): Promise<SyncResponse>;
  restore(error: unknown): Promise<void>;
}) {
  return useScopeDraft({
    source: () => options.status.value?.items ?? [],
    idle: options.idle,
    restore: options.restore,
    async save(changes) {
      const config = options.status.value?.config;
      if (!config) return;
      const excluded = new Set(config.excludedKeys);
      for (const [key, included] of changes) {
        if (included) excluded.delete(key);
        else excluded.add(key);
      }
      if (sameKeys(excluded, config.excludedKeys)) return;
      await options.configure({ ...config, excludedKeys: [...excluded] });
    }
  });
}
