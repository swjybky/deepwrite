import { createConversationRegistryHistory } from "./conversationRegistryHistory";
import { canonicalBookConversationKey } from "../utils/bookConversationKey";
import type { ConversationRuntimeRegistryCoordinatorOptions } from "./conversationRuntimeRegistryTypes";
export type {
  ConversationRuntimeRegistryCoordinatorOptions,
  ConversationRuntimeRegistryStorePort,
  ConversationControllerPersistenceHooks
} from "./conversationRuntimeRegistryTypes";
import type { AgentConversationController } from "./useAgentConversation";
import { createConversationRegistryPreferences } from "./conversationRegistryPreferences";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistence";

/**
 * Owns the shared conversation-controller registry, persisted hydration, and
 * cross-controller run preferences. Workspace-specific conversation routing
 * remains outside and consumes this coordinator through `conversationForKey`.
 */
export function useConversationRuntimeRegistryCoordinator(
  options: ConversationRuntimeRegistryCoordinatorOptions
) {
  const inFlightHydrates = new Set<Promise<unknown>>();
  const failedHydrates = new Set<AgentConversationController>();
  const hydratingControllers = new WeakSet<AgentConversationController>();
  const histories = new WeakMap<
    AgentConversationController,
    ReturnType<typeof createConversationRegistryHistory>
  >();
  const persistenceEnabled = options.persistenceAdapter !== null;
  let disposed = false;
  let lifecycleGeneration = 0;
  let persistenceWarningShown = false;
  let disposePromise: Promise<void> | null = null;
  const {
    captureAgentRunSettings,
    captureAgentRunPreferences,
    applyAgentRunPreferences,
    applySessionAgentModelSelection,
    synchronizeSessionAgentModelSelection,
    persistAgentRunPreferences,
    removeAgentRunPreferences,
    synchronizeAgentRunPreferences,
    applyDefaultApprovalMode,
    applyModelSettingsToConversations
  } = createConversationRegistryPreferences(options, () => disposed);

  function warnPersistenceOnce(message: string): void {
    if (disposed || persistenceWarningShown) return;
    persistenceWarningShown = true;
    options.notifications.warning(message);
  }

  options.store.configurePersistenceAdapter(options.persistenceAdapter, {
    onError: () => {
      warnPersistenceOnce("历史对话暂时无法保存到本机，本次运行中仍可继续切换");
    }
  });

  function trackHydrate<Value>(operation: Promise<Value>): Promise<Value> {
    const tracked = operation.then(
      (value) => {
        inFlightHydrates.delete(tracked);
        return value;
      },
      (error: unknown) => {
        inFlightHydrates.delete(tracked);
        throw error;
      }
    );
    inFlightHydrates.add(tracked);
    return tracked;
  }

  function controllerIsCurrent(
    key: string,
    conversation: AgentConversationController,
    generation = lifecycleGeneration
  ): boolean {
    return (
      !disposed &&
      generation === lifecycleGeneration &&
      options.store.controllerForKey(key) === conversation
    );
  }

  function applyConversationRuntimeSettings(
    key: string,
    scope: string,
    conversation: AgentConversationController,
    generation = lifecycleGeneration
  ): void {
    if (!controllerIsCurrent(key, conversation, generation)) return;
    const settings = options.modelSettings.value;
    if (settings) conversation.applyModelSettings(settings);
    options.store.setControllerScope(key, scope);
    conversation.selectApprovalMode(options.permissionMode());
    queueMicrotask(() => {
      if (controllerIsCurrent(key, conversation, generation)) {
        options.resumeRecovered([conversation]);
      }
    });
  }

  async function hydrateConversation(
    key: string,
    scope: string,
    persistenceKey: string,
    conversation: AgentConversationController,
    generation: number
  ): Promise<void> {
    const retry = failedHydrates.has(conversation);
    hydratingControllers.add(conversation);
    let failed = false;
    try {
      try {
        await options.persistenceAdapter?.prepareHistory?.(key);
      } catch {
        failed = true;
        warnPersistenceOnce("历史对话迁移暂未完成，原始记录已保留");
      }
      if (!controllerIsCurrent(key, conversation, generation)) return;
      const history = histories.get(conversation);
      if (history && !failed) {
        const snapshot = await history.initialHistory(
          conversation.sessionId.value
        );
        if (!controllerIsCurrent(key, conversation, generation)) return;
        await conversation.restorePersistenceHistory(snapshot);
      } else {
        const snapshot = await options.store.loadPersistence(persistenceKey, {
          force: retry
        });
        if (!controllerIsCurrent(key, conversation, generation)) return;
        if (snapshot !== undefined) {
          const restored =
            await conversation.restorePersistenceSnapshot(snapshot);
          if (restored && options.persistenceAdapter?.history)
            conversation.initializePersistenceBaseline();
        }
      }
    } catch {
      failed = true;
      if (controllerIsCurrent(key, conversation, generation)) {
        warnPersistenceOnce("历史对话暂时无法读取，本次运行仍可正常使用");
      }
    } finally {
      hydratingControllers.delete(conversation);
      if (failed) failedHydrates.add(conversation);
      else failedHydrates.delete(conversation);
      conversation.releasePersistenceEmits();
      applyConversationRuntimeSettings(key, scope, conversation, generation);
    }
  }

  function conversationForKey(
    key: string,
    scope = "general"
  ): AgentConversationController {
    if (disposed) {
      throw new Error("会话运行时注册表已经关闭。");
    }
    key = canonicalBookConversationKey(key, scope);
    const existing = options.store.controllerForKey(key);
    if (existing) {
      if (options.store.scopeForKey(key) !== scope) {
        options.store.setControllerScope(key, scope);
      }
      existing.selectApprovalMode(options.permissionMode());
      if (failedHydrates.has(existing) && !hydratingControllers.has(existing)) {
        existing.holdPersistenceEmits();
        void trackHydrate(
          hydrateConversation(
            key,
            scope,
            conversationHistoryPersistenceKey(key),
            existing,
            lifecycleGeneration
          )
        );
      }
      return existing;
    }

    const persistenceKey = conversationHistoryPersistenceKey(key);
    function scheduleConversation(): void {
      if (!controllerIsCurrent(key, created)) return;
      if (options.store.scheduleControllerPersistence)
        options.store.scheduleControllerPersistence(persistenceKey, created);
      else
        options.store.schedulePersistenceFactory(
          persistenceKey,
          created.capturePersistenceSnapshot
        );
    }
    const history = options.persistenceAdapter?.history
      ? createConversationRegistryHistory(
          options.persistenceAdapter.history,
          persistenceKey
        )
      : undefined;
    const created = options.createController({
      ...history?.hooks,
      onPersistenceChange: scheduleConversation,
      ...(persistenceEnabled && options.store.flushPersistence
        ? {
            flushPersistence: async (flushOptions) => {
              scheduleConversation();
              await options.store.flushPersistence!(
                persistenceKey,
                flushOptions
              );
            }
          }
        : {}),
      onPersistenceRemove: () => options.store.removePersistence(persistenceKey)
    });
    if (history) histories.set(created, history);
    options.store.registerController(key, scope, created, {
      applyPreferences: false
    });
    if (persistenceEnabled) {
      const generation = lifecycleGeneration;
      created.holdPersistenceEmits();
      void trackHydrate(
        hydrateConversation(key, scope, persistenceKey, created, generation)
      );
    } else {
      applyConversationRuntimeSettings(key, scope, created);
    }
    return created;
  }

  function allConversations(): AgentConversationController[] {
    return options.store.listControllers();
  }

  function hydrateConversationPreferences(): Promise<void> {
    if (disposed) return Promise.resolve();
    return trackHydrate(options.store.hydratePreferences());
  }

  async function drain(): Promise<void> {
    while (inFlightHydrates.size > 0) {
      await Promise.allSettled([...inFlightHydrates]);
    }
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    lifecycleGeneration += 1;
    disposePromise = drain();
    return disposePromise;
  }

  return {
    allConversations,
    applyAgentRunPreferences,
    applyDefaultApprovalMode,
    applyModelSettingsToConversations,
    applySessionAgentModelSelection,
    captureAgentRunPreferences,
    captureAgentRunSettings,
    conversationForKey,
    dispose,
    drain,
    hydrateConversationPreferences,
    persistAgentRunPreferences,
    persistenceEnabled,
    removeAgentRunPreferences,
    synchronizeAgentRunPreferences,
    synchronizeSessionAgentModelSelection
  };
}

export type ConversationRuntimeRegistryCoordinator = ReturnType<
  typeof useConversationRuntimeRegistryCoordinator
>;
