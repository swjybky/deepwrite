import { ref, watch, type Ref } from "vue";

export interface WorkspaceDraftRecoveryLifecycle {
  load(): Promise<number>;
  beforeUnload(): void;
  dispose(): Promise<void>;
}

export interface WorkspaceLifecycleCoordinatorOptions<Feature> {
  windowTarget: Window;
  activeFeature: Readonly<Ref<Feature>>;
  desktopAvailable(): boolean;
  handleKeydown(event: KeyboardEvent): void;
  reconcileLayout(): void;
  draftRecovery: WorkspaceDraftRecoveryLifecycle;
  hydrateConversationPreferences(): Promise<void>;
  loadGeneralSettings(): Promise<void>;
  startSystemEvents(): () => void;
  startDesktopSideEffects(): void | Promise<void>;
  loadCatalog(): Promise<unknown>;
  ensureFeatureDependencies(feature: Feature): Promise<void>;
  scheduleDirtyDraftAutoSave(): void;
  loadLongBookList(): Promise<unknown>;
  refreshOnFocus(): Promise<void>;
  onDraftRecoveryLoaded(count: number): void;
  notifyRecoveredDrafts(): void;
  cleanupBeforeDraftRecovery?: readonly (() => void | Promise<void>)[];
  cleanup: readonly (() => void | Promise<void>)[];
  onError(error: unknown, operation: string): void;
  focusRefreshIntervalMs?: number;
  now?: () => number;
}

export interface WorkspaceLifecycleCoordinator {
  ready: Ref<boolean>;
  start(): Promise<void>;
  requestFocusRefresh(): void;
  dispose(): Promise<void>;
}

const DEFAULT_FOCUS_REFRESH_INTERVAL_MS = 1_200;

/** Coordinates the one renderer window lifecycle and its async startup gates. */
export function useWorkspaceLifecycleCoordinator<Feature>(
  options: WorkspaceLifecycleCoordinatorOptions<Feature>
): WorkspaceLifecycleCoordinator {
  const ready = ref(false);
  const focusRefreshIntervalMs =
    options.focusRefreshIntervalMs ?? DEFAULT_FOCUS_REFRESH_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let generation = 0;
  let startPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let stopFeatureWatch: (() => void) | undefined;
  let stopSystemEvents: (() => void) | undefined;
  let listenersInstalled = false;
  let disposed = false;
  let lastFocusRefreshStartedAt = 0;
  let hasStartedFocusRefresh = false;
  let focusRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let focusRefreshPromise: Promise<void> | null = null;
  let trailingFocusRefreshRequested = false;

  function report(error: unknown, operation: string): void {
    try {
      options.onError(error, operation);
    } catch {
      // Lifecycle diagnostics must never prevent remaining cleanup or startup.
    }
  }

  async function settle(
    operation: string,
    task: () => void | Promise<unknown>
  ): Promise<void> {
    try {
      await task();
    } catch (error: unknown) {
      report(error, operation);
    }
  }

  function cancelFocusRefreshTimer(): void {
    if (focusRefreshTimer === undefined) return;
    clearTimeout(focusRefreshTimer);
    focusRefreshTimer = undefined;
  }

  function runFocusRefresh(): void {
    cancelFocusRefreshTimer();
    if (disposed || !listenersInstalled || !options.desktopAvailable()) return;
    if (focusRefreshPromise) {
      trailingFocusRefreshRequested = true;
      return;
    }

    trailingFocusRefreshRequested = false;
    lastFocusRefreshStartedAt = now();
    hasStartedFocusRefresh = true;
    let operation: Promise<void>;
    try {
      operation = Promise.resolve(options.refreshOnFocus());
    } catch (error: unknown) {
      report(error, "focus-refresh");
      operation = Promise.resolve();
    }
    focusRefreshPromise = operation;
    void operation
      .catch((error: unknown) => {
        report(error, "focus-refresh");
      })
      .finally(() => {
        if (focusRefreshPromise !== operation) return;
        focusRefreshPromise = null;
        if (disposed || !trailingFocusRefreshRequested) return;
        trailingFocusRefreshRequested = false;
        requestFocusRefresh();
      });
  }

  function requestFocusRefresh(): void {
    if (disposed || !listenersInstalled || !options.desktopAvailable()) return;
    if (focusRefreshPromise) {
      trailingFocusRefreshRequested = true;
      return;
    }
    const delay = hasStartedFocusRefresh
      ? Math.max(0, lastFocusRefreshStartedAt + focusRefreshIntervalMs - now())
      : 0;
    if (delay === 0) {
      runFocusRefresh();
      return;
    }
    trailingFocusRefreshRequested = true;
    if (focusRefreshTimer === undefined) {
      focusRefreshTimer = setTimeout(runFocusRefresh, delay);
    }
  }

  function refreshAfterWindowFocus(): void {
    if (ready.value) requestFocusRefresh();
  }

  function installWindowListeners(): void {
    if (listenersInstalled) return;
    listenersInstalled = true;
    options.windowTarget.addEventListener("keydown", options.handleKeydown);
    options.windowTarget.addEventListener("resize", options.reconcileLayout);
    options.windowTarget.addEventListener("focus", refreshAfterWindowFocus);
    options.windowTarget.addEventListener(
      "beforeunload",
      options.draftRecovery.beforeUnload
    );
  }

  function removeWindowListeners(): void {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    options.windowTarget.removeEventListener("keydown", options.handleKeydown);
    options.windowTarget.removeEventListener("resize", options.reconcileLayout);
    options.windowTarget.removeEventListener("focus", refreshAfterWindowFocus);
    options.windowTarget.removeEventListener(
      "beforeunload",
      options.draftRecovery.beforeUnload
    );
  }

  async function start(): Promise<void> {
    if (disposed) return;
    if (startPromise) return startPromise;
    const currentGeneration = ++generation;

    const operation = (async () => {
      installWindowListeners();
      options.reconcileLayout();
      stopFeatureWatch = watch(options.activeFeature, (feature) => {
        if (!options.desktopAvailable() || disposed) return;
        void settle("feature-dependencies", () =>
          options.ensureFeatureDependencies(feature)
        );
      });

      if (options.desktopAvailable()) {
        try {
          stopSystemEvents = options.startSystemEvents();
        } catch (error: unknown) {
          report(error, "system-events-start");
        }
      }

      const recoveredCount = await options.draftRecovery.load();
      if (disposed || currentGeneration !== generation) return;
      await settle("draft-recovery-publish", () =>
        options.onDraftRecoveryLoaded(recoveredCount)
      );
      await settle("conversation-preferences", () =>
        options.hydrateConversationPreferences()
      );
      if (disposed || currentGeneration !== generation) return;
      await settle("general-settings", () => options.loadGeneralSettings());
      if (disposed || currentGeneration !== generation) return;

      if (!options.desktopAvailable()) {
        await settle("draft-recovery-notification", () =>
          options.notifyRecoveredDrafts()
        );
        if (!disposed) ready.value = true;
        return;
      }

      void settle("desktop-side-effects", () =>
        options.startDesktopSideEffects()
      );
      const longBookList = settle("long-book-list", () =>
        options.loadLongBookList()
      );
      await Promise.all([
        settle("catalog-load", () => options.loadCatalog()),
        settle("feature-dependencies", () =>
          options.ensureFeatureDependencies(options.activeFeature.value)
        )
      ]);
      if (disposed || currentGeneration !== generation) return;

      options.scheduleDirtyDraftAutoSave();
      await settle("draft-recovery-notification", () =>
        options.notifyRecoveredDrafts()
      );
      await longBookList;
      if (!disposed) ready.value = true;
    })();

    startPromise = operation;
    await operation;
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return;

    const operation = (async () => {
      disposed = true;
      generation += 1;
      ready.value = false;
      trailingFocusRefreshRequested = false;
      cancelFocusRefreshTimer();

      try {
        stopSystemEvents?.();
      } catch (error: unknown) {
        report(error, "system-events-stop");
      }
      stopSystemEvents = undefined;
      stopFeatureWatch?.();
      stopFeatureWatch = undefined;
      removeWindowListeners();

      const activeFocusRefresh = focusRefreshPromise;
      if (activeFocusRefresh) {
        await settle("focus-refresh-drain", () => activeFocusRefresh);
      }

      for (const cleanup of options.cleanupBeforeDraftRecovery ?? []) {
        await settle("cleanup-before-draft-recovery", cleanup);
      }
      await settle("draft-recovery-dispose", () =>
        options.draftRecovery.dispose()
      );
      for (const cleanup of options.cleanup) {
        await settle("cleanup", cleanup);
      }
    })();
    disposePromise = operation;
    await operation;
  }

  return {
    ready,
    start,
    requestFocusRefresh,
    dispose
  };
}
