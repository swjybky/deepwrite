import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLifecycleCoordinator } from "./useWorkspaceLifecycleCoordinator";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeWindowTarget {
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as EventListener;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ) {
    this.listeners.get(type)?.delete(listener as EventListener);
  }

  dispatch(type: string, event: Event = new Event(type)) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0
    );
  }
}

function createHarness(overrides: Record<string, unknown> = {}) {
  const windowTarget = new FakeWindowTarget();
  const activeFeature = ref("conversation");
  const stopSystemEvents = vi.fn();
  const draftRecovery = {
    load: vi.fn(async () => 2),
    beforeUnload: vi.fn(),
    dispose: vi.fn(async () => undefined)
  };
  const options = {
    windowTarget: windowTarget as unknown as Window,
    activeFeature,
    desktopAvailable: vi.fn(() => true),
    handleKeydown: vi.fn(),
    reconcileLayout: vi.fn(),
    draftRecovery,
    hydrateConversationPreferences: vi.fn(async () => undefined),
    loadGeneralSettings: vi.fn(async () => undefined),
    startSystemEvents: vi.fn(() => stopSystemEvents),
    startDesktopSideEffects: vi.fn(async () => undefined),
    loadCatalog: vi.fn(async () => undefined),
    ensureFeatureDependencies: vi.fn(async () => undefined),
    scheduleDirtyDraftAutoSave: vi.fn(),
    loadLongBookList: vi.fn(async () => undefined),
    refreshOnFocus: vi.fn(async () => undefined),
    onDraftRecoveryLoaded: vi.fn(),
    notifyRecoveredDrafts: vi.fn(),
    cleanupBeforeDraftRecovery: [] as Array<() => void | Promise<void>>,
    cleanup: [] as Array<() => void | Promise<void>>,
    onError: vi.fn(),
    ...overrides
  };
  const coordinator = useWorkspaceLifecycleCoordinator(options);
  return {
    activeFeature,
    coordinator,
    draftRecovery,
    options,
    stopSystemEvents,
    windowTarget
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace lifecycle coordinator", () => {
  it("starts once, preserves local initialization order, and watches features", async () => {
    const order: string[] = [];
    const harness = createHarness({
      draftRecovery: {
        load: vi.fn(async () => {
          order.push("drafts");
          return 3;
        }),
        beforeUnload: vi.fn(),
        dispose: vi.fn(async () => undefined)
      },
      hydrateConversationPreferences: vi.fn(async () => {
        order.push("preferences");
      }),
      loadGeneralSettings: vi.fn(async () => {
        order.push("general");
      })
    });

    await Promise.all([
      harness.coordinator.start(),
      harness.coordinator.start()
    ]);

    expect(order).toEqual(["drafts", "preferences", "general"]);
    expect(harness.options.startSystemEvents).toHaveBeenCalledOnce();
    expect(harness.options.loadCatalog).toHaveBeenCalledOnce();
    expect(harness.options.ensureFeatureDependencies).toHaveBeenCalledWith(
      "conversation"
    );
    expect(harness.options.onDraftRecoveryLoaded).toHaveBeenCalledWith(3);
    expect(harness.options.notifyRecoveredDrafts).toHaveBeenCalledOnce();
    expect(harness.windowTarget.listenerCount()).toBe(4);

    harness.activeFeature.value = "directory";
    await Promise.resolve();
    expect(harness.options.ensureFeatureDependencies).toHaveBeenCalledWith(
      "directory"
    );
  });

  it("cancels the remaining startup stages when disposed during draft loading", async () => {
    const pendingLoad = deferred<number>();
    const cleanupAfterFailure = vi.fn();
    const harness = createHarness({
      draftRecovery: {
        load: vi.fn(() => pendingLoad.promise),
        beforeUnload: vi.fn(),
        dispose: vi.fn(async () => undefined)
      },
      cleanup: [
        () => {
          throw new Error("cleanup-failed");
        },
        cleanupAfterFailure
      ]
    });

    const starting = harness.coordinator.start();
    const disposing = harness.coordinator.dispose();
    pendingLoad.resolve(1);
    await Promise.all([starting, disposing]);
    await harness.coordinator.dispose();

    expect(
      harness.options.hydrateConversationPreferences
    ).not.toHaveBeenCalled();
    expect(harness.options.loadCatalog).not.toHaveBeenCalled();
    expect(harness.stopSystemEvents).toHaveBeenCalledOnce();
    expect(harness.windowTarget.listenerCount()).toBe(0);
    expect(cleanupAfterFailure).toHaveBeenCalledOnce();
    expect(harness.options.onError).toHaveBeenCalledWith(
      expect.any(Error),
      "cleanup"
    );
  });

  it("loads both catalogs before accepting focus refreshes", async () => {
    const catalog = deferred<void>();
    const longBooks = deferred<void>();
    const harness = createHarness({
      loadCatalog: vi.fn(() => catalog.promise),
      loadLongBookList: vi.fn(() => longBooks.promise)
    });
    const starting = harness.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    harness.windowTarget.dispatch("focus");
    expect(harness.options.refreshOnFocus).not.toHaveBeenCalled();
    expect(harness.options.loadCatalog).toHaveBeenCalledOnce();
    expect(harness.options.loadLongBookList).toHaveBeenCalledOnce();
    catalog.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.coordinator.ready.value).toBe(false);

    longBooks.resolve();
    await starting;
    expect(harness.coordinator.ready.value).toBe(true);
    harness.windowTarget.dispatch("focus");
    expect(harness.options.refreshOnFocus).toHaveBeenCalledOnce();
    await harness.coordinator.dispose();
  });

  it("runs one focus refresh at a time with at most one trailing refresh", async () => {
    let currentTime = 10_000;
    const firstRefresh = deferred<void>();
    const secondRefresh = deferred<void>();
    const refreshOnFocus = vi
      .fn()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    const harness = createHarness({
      refreshOnFocus,
      now: () => currentTime,
      focusRefreshIntervalMs: 1_200
    });
    await harness.coordinator.start();

    harness.windowTarget.dispatch("focus");
    harness.windowTarget.dispatch("focus");
    harness.windowTarget.dispatch("focus");
    expect(refreshOnFocus).toHaveBeenCalledOnce();

    firstRefresh.resolve();
    await Promise.resolve();
    await Promise.resolve();
    currentTime += 1_200;
    await vi.advanceTimersByTimeAsync(1_200);
    expect(refreshOnFocus).toHaveBeenCalledTimes(2);

    secondRefresh.resolve();
    await Promise.resolve();
  });

  it("keeps browser-only startup local and releases listeners symmetrically", async () => {
    const harness = createHarness({
      desktopAvailable: vi.fn(() => false)
    });

    await harness.coordinator.start();
    harness.windowTarget.dispatch("beforeunload");
    await harness.coordinator.dispose();

    expect(harness.options.startSystemEvents).not.toHaveBeenCalled();
    expect(harness.options.loadCatalog).not.toHaveBeenCalled();
    expect(harness.draftRecovery.beforeUnload).toHaveBeenCalledOnce();
    expect(harness.windowTarget.listenerCount()).toBe(0);
    expect(harness.coordinator.ready.value).toBe(false);
  });

  it("stops event ingress and drains writers before flushing recovery stores", async () => {
    const order: string[] = [];
    const firstDrain = deferred<void>();
    const harness = createHarness({
      startSystemEvents: vi.fn(() => () => {
        order.push("events-stopped");
      }),
      cleanupBeforeDraftRecovery: [
        async () => {
          order.push("proposal-drain-started");
          await firstDrain.promise;
          order.push("proposal-drained");
        },
        () => {
          order.push("persistence-drained");
        }
      ],
      draftRecovery: {
        load: vi.fn(async () => 0),
        beforeUnload: vi.fn(),
        dispose: vi.fn(async () => {
          order.push("draft-recovery-flushed");
        })
      },
      cleanup: [
        () => {
          order.push("stores-disposed");
        }
      ]
    });
    await harness.coordinator.start();

    const disposing = harness.coordinator.dispose();
    await Promise.resolve();
    expect(order).toEqual(["events-stopped", "proposal-drain-started"]);

    firstDrain.resolve();
    await disposing;
    expect(order).toEqual([
      "events-stopped",
      "proposal-drain-started",
      "proposal-drained",
      "persistence-drained",
      "draft-recovery-flushed",
      "stores-disposed"
    ]);
  });
});
