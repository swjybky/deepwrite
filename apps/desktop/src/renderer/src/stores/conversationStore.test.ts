import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { isReactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "../composables/useAgentConversation";
import {
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY,
  useConversationStore,
  type ConversationPersistenceAdapter
} from "./conversationStore";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controller(name: string) {
  const selectedModelId = ref(`${name}-model`);
  const thinkingLevel = ref<"medium" | "high">("medium");
  const temperature = ref(0.7);
  const approvalMode = ref<"request-approval" | "auto-approve">(
    "request-approval"
  );
  const agentTeamMode = ref<"normal" | "team">("normal");
  const webSearchEnabled = ref(false);
  const applyRunSettings = vi.fn((settings) => {
    selectedModelId.value = settings.selectedModelId;
    thinkingLevel.value = settings.thinkingLevel as "medium" | "high";
    temperature.value = settings.temperature;
    approvalMode.value = settings.approvalMode;
    agentTeamMode.value = settings.agentTeamMode ?? "normal";
    webSearchEnabled.value = settings.webSearchEnabled === true;
  });
  const dispose = vi.fn();
  return {
    sessionId: ref(name),
    messages: ref([]),
    isBusy: ref(false),
    selectedModelId,
    thinkingLevel,
    temperature,
    approvalMode,
    agentTeamMode,
    webSearchEnabled,
    applyRunSettings,
    dispose
  } as unknown as AgentConversationController & {
    applyRunSettings: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("conversation store", () => {
  it("registers controllers by key and scope without deep proxying them", () => {
    const store = useConversationStore();
    const first = controller("first");
    const replacement = controller("replacement");
    const stableRegistry = store.controllers;

    store.registerController("book:one", "scope:one", first);
    expect(store.controllers).toBe(stableRegistry);
    expect(store.controllerForKey("book:one")).toBe(first);
    expect(store.scopeForKey("book:one")).toBe("scope:one");
    expect(store.controllersForScope("scope:one")).toEqual([first]);
    expect(store.controllerCount).toBe(1);
    expect(isReactive(storeToRefs(store).controllers.value)).toBe(false);
    expect(isReactive(store.controllerForKey("book:one"))).toBe(false);

    store.registerController("book:one", "scope:two", replacement);
    expect(store.controllers).toBe(stableRegistry);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(store.controllerForKey("book:one")).toBe(replacement);
    expect(store.controllersForScope("scope:two")).toEqual([replacement]);

    expect(store.removeController("book:one")).toBe(replacement);
    expect(replacement.dispose).toHaveBeenCalledOnce();
    expect(store.controllerCount).toBe(0);
  });

  it("applies global model selection and scope-specific run preferences", () => {
    const store = useConversationStore();
    const first = controller("first");
    const second = controller("second");
    store.registerController("first", "book:one", first);
    store.registerController("second", "book:two", second);

    store.setSessionAgentModelSelection(
      {
        selectedModelId: "global-model",
        thinkingLevel: "high",
        webSearchEnabled: true
      },
      { persist: false }
    );
    expect(first.selectedModelId.value).toBe("global-model");
    expect(second.selectedModelId.value).toBe("global-model");
    expect(first.webSearchEnabled.value).toBe(true);
    expect(second.webSearchEnabled.value).toBe(true);

    store.setAgentRunPreferences(
      "book:one",
      {
        temperature: 1.1,
        approvalMode: "auto-approve",
        agentTeamMode: "team"
      },
      { persist: false }
    );
    expect(first.temperature.value).toBe(1.1);
    expect(first.approvalMode.value).toBe("auto-approve");
    expect(first.agentTeamMode.value).toBe("team");
    expect(second.temperature.value).toBe(0.7);
    expect(store.agentRunPreferences["book:one"]).toEqual({
      temperature: 1.1,
      approvalMode: "auto-approve",
      agentTeamMode: "team"
    });

    const hydrating = controller("hydrating");
    store.registerController("hydrating", "book:one", hydrating, {
      applyPreferences: false
    });
    expect(hydrating.selectedModelId.value).toBe("hydrating-model");
    expect(hydrating.temperature.value).toBe(0.7);
  });

  it("deduplicates asynchronous loads and caches large history snapshots shallowly", async () => {
    const store = useConversationStore();
    const pending = deferred<unknown>();
    const adapter: ConversationPersistenceAdapter = {
      load: vi.fn(() => pending.promise),
      save: vi.fn(async () => undefined)
    };
    store.configurePersistenceAdapter(adapter);

    const first = store.loadPersistence<{ history: string[] }>("history:one");
    const second = store.loadPersistence<{ history: string[] }>("history:one");
    expect(adapter.load).toHaveBeenCalledOnce();
    const snapshot = { history: ["第一条"] };
    pending.resolve(snapshot);

    await expect(first).resolves.toBe(snapshot);
    await expect(second).resolves.toBe(snapshot);
    await store.loadPersistence("history:one");
    expect(adapter.load).toHaveBeenCalledOnce();
    expect(store.persistenceCache.get("history:one")).toBe(snapshot);
    expect(isReactive(store.persistenceCache)).toBe(false);
    expect(isReactive(snapshot)).toBe(false);
  });

  it("keeps a local snapshot when an older asynchronous load resolves late", async () => {
    const store = useConversationStore();
    const pending = deferred<unknown>();
    const adapter: ConversationPersistenceAdapter = {
      load: vi.fn(() => pending.promise),
      save: vi.fn(async () => undefined)
    };
    store.configurePersistenceAdapter(adapter, { debounceMs: 10_000 });

    const loading = store.loadPersistence("history:late");
    const local = { version: 1, conversations: ["本地新状态"] };
    store.schedulePersistence("history:late", local);
    pending.resolve({ version: 1, conversations: ["磁盘旧状态"] });

    await loading;
    expect(store.persistenceCache.get("history:late")).toBe(local);
    await store.flushPersistence("history:late");
    expect(adapter.save).toHaveBeenCalledWith("history:late", local);
  });

  it("debounces writes and saves only the latest value before a write starts", async () => {
    vi.useFakeTimers();
    const saved: unknown[] = [];
    const store = useConversationStore();
    store.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async (_key, value) => {
          saved.push(value);
        }
      },
      { debounceMs: 50 }
    );

    store.schedulePersistence("history:one", { revision: 1 });
    expect(store.persistenceBusy).toBe(true);
    await vi.advanceTimersByTimeAsync(30);
    store.schedulePersistence("history:one", { revision: 2 });
    await vi.advanceTimersByTimeAsync(49);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await store.flushPersistence("history:one");

    expect(saved).toEqual([{ revision: 2 }]);
    expect(store.persistenceBusy).toBe(false);
  });

  it("defers an expensive snapshot factory and collapses hot-path changes", async () => {
    vi.useFakeTimers();
    const store = useConversationStore();
    const save = vi.fn(async () => undefined);
    store.configurePersistenceAdapter(
      { load: async () => undefined, save },
      { debounceMs: 180 }
    );
    let revision = 1;
    const capture = vi.fn(() => ({ revision }));

    for (revision = 1; revision <= 50; revision += 1) {
      store.schedulePersistenceFactory("history:hot", capture);
    }
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(179);
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await store.flushPersistence("history:hot");

    expect(capture).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("history:hot", { revision: 51 });
  });

  it("serializes a key and collapses concurrent updates to one latest tail", async () => {
    vi.useFakeTimers();
    const firstSave = deferred<void>();
    const saved: unknown[] = [];
    const store = useConversationStore();
    const adapter: ConversationPersistenceAdapter = {
      load: async () => undefined,
      save: vi.fn(async (_key, value) => {
        saved.push(value);
        if (saved.length === 1) await firstSave.promise;
      })
    };
    store.configurePersistenceAdapter(adapter, { debounceMs: 0 });

    store.schedulePersistence("history:one", { revision: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual([{ revision: 1 }]);

    store.schedulePersistence("history:one", { revision: 2 });
    store.schedulePersistence("history:one", { revision: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.save).toHaveBeenCalledOnce();

    const flushing = store.flushPersistence("history:one");
    firstSave.resolve();
    await flushing;

    expect(saved).toEqual([{ revision: 1 }, { revision: 3 }]);
    expect(adapter.save).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed save and allows the next latest value to retry", async () => {
    const store = useConversationStore();
    let attempts = 0;
    store.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("暂时无法保存");
        }
      },
      { debounceMs: 10_000 }
    );

    store.schedulePersistence("history:one", { revision: 1 });
    await expect(store.flushPersistence("history:one")).rejects.toThrow(
      "暂时无法保存"
    );
    expect(store.persistenceErrors.get("history:one")).toBe("暂时无法保存");

    store.schedulePersistence("history:one", { revision: 2 });
    await expect(
      store.flushPersistence("history:one")
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(store.persistenceErrors.has("history:one")).toBe(false);
  });

  it("hydrates preference objects through the adapter without text serialization", async () => {
    const store = useConversationStore();
    const first = controller("first");
    store.registerController("first", "book:one", first);
    const values = new Map<string, unknown>([
      [
        MODEL_SELECTION_PERSISTENCE_KEY,
        { selectedModelId: "restored-model", thinkingLevel: "high" }
      ],
      [
        RUN_PREFERENCES_PERSISTENCE_KEY,
        {
          "book:one": {
            temperature: 1.2,
            approvalMode: "auto-approve"
          }
        }
      ]
    ]);
    store.configurePersistenceAdapter({
      load: async (key) => values.get(key),
      save: async () => undefined
    });

    await store.hydratePreferences();

    expect(store.sessionAgentModelSelection).toEqual({
      selectedModelId: "restored-model",
      thinkingLevel: "high"
    });
    expect(first.selectedModelId.value).toBe("restored-model");
    expect(first.temperature.value).toBe(1.2);
    expect(first.approvalMode.value).toBe("auto-approve");
  });

  it("flushes pending values and disposes every controller", async () => {
    const saved: unknown[] = [];
    const store = useConversationStore();
    const first = controller("first");
    const second = controller("second");
    store.registerController("first", "scope", first);
    store.registerController("second", "scope", second);
    store.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async (_key, value) => {
          saved.push(value);
        }
      },
      { debounceMs: 10_000 }
    );
    store.schedulePersistence("history:one", { revision: 4 });

    await store.dispose({ flush: true });

    expect(saved).toEqual([{ revision: 4 }]);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(store.controllerCount).toBe(0);
    expect(() =>
      store.schedulePersistence("history:one", { revision: 5 })
    ).toThrow("会话持久化调度器已经关闭");
  });

  it("keeps controllers and recovery data available when disposal cannot save", async () => {
    const store = useConversationStore();
    const active = controller("recoverable");
    store.registerController("recoverable", "scope", active);
    let unavailable = true;
    const saved: unknown[] = [];
    store.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async (_key, value) => {
          if (unavailable) throw new Error("模拟磁盘不可写");
          saved.push(value);
        }
      },
      { debounceMs: 10_000 }
    );
    store.schedulePersistence("history:recoverable", {
      draft: "尚未确认的内容"
    });

    await expect(store.dispose()).rejects.toThrow("模拟磁盘不可写");
    expect(store.controllerForKey("recoverable")).toBe(active);
    expect(active.dispose).not.toHaveBeenCalled();
    expect(store.persistenceErrors.get("history:recoverable")).toContain(
      "模拟磁盘不可写"
    );

    unavailable = false;
    await store.dispose();
    expect(saved).toEqual([{ draft: "尚未确认的内容" }]);
    expect(active.dispose).toHaveBeenCalledOnce();
  });
});
