import { canonicalBookConversationKey } from "../utils/bookConversationKey";
import type { ConversationRuntimeRegistryCoordinatorOptions } from "./conversationRuntimeRegistryTypes";
export type {
  ConversationRuntimeRegistryCoordinatorOptions,
  ConversationRuntimeRegistryStorePort,
  ConversationControllerPersistenceHooks
} from "./conversationRuntimeRegistryTypes";
import type {
  GeneralPermissionMode,
  ModelSettings
} from "@deepwrite/contracts";

import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";

import { RUN_PREFERENCES_PERSISTENCE_KEY } from "../stores/conversationStore";
import type {
  AgentModelSelection,
  AgentRunPreferences,
  AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";
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
  const persistenceEnabled = options.persistenceAdapter !== null;
  let disposed = false;
  let lifecycleGeneration = 0;
  let persistenceWarningShown = false;
  let disposePromise: Promise<void> | null = null;

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

  function captureAgentRunSettings(
    conversation: AgentConversationController
  ): AgentRunSettings {
    return {
      selectedModelId: conversation.selectedModelId.value,
      thinkingLevel: conversation.thinkingLevel.value,
      temperature: conversation.temperature.value,
      approvalMode: conversation.approvalMode.value,
      agentTeamMode: conversation.agentTeamMode.value,
      webSearchEnabled: conversation.webSearchEnabled.value
    };
  }

  function captureAgentRunPreferences(
    conversation: AgentConversationController
  ): AgentRunPreferences {
    return {
      temperature: conversation.temperature.value,
      approvalMode: conversation.approvalMode.value,
      agentTeamMode: conversation.agentTeamMode.value
    };
  }

  function applyAgentRunPreferences(
    conversation: AgentConversationController,
    preferences: AgentRunPreferences
  ): void {
    conversation.applyRunSettings({
      ...captureAgentRunSettings(conversation),
      ...preferences
    });
  }

  function applySessionAgentModelSelection(
    selection: AgentModelSelection,
    source?: AgentConversationController
  ): void {
    if (disposed) return;
    options.store.setSessionAgentModelSelection(selection, {
      ...(source ? { source } : {}),
      persist: false
    });
  }

  function synchronizeSessionAgentModelSelection(
    source: AgentConversationController
  ): void {
    if (disposed) return;
    options.store.setSessionAgentModelSelection(
      {
        selectedModelId: source.selectedModelId.value,
        thinkingLevel: source.thinkingLevel.value,
        webSearchEnabled: source.webSearchEnabled.value
      },
      { source }
    );
  }

  function persistAgentRunPreferences(
    scope: string,
    preferences: AgentRunPreferences
  ): void {
    if (disposed) return;
    options.store.setAgentRunPreferences(scope, preferences);
  }

  function removeAgentRunPreferences(scope: string): void {
    if (disposed) return;
    options.store.removeAgentRunPreferences(scope);
  }

  function synchronizeAgentRunPreferences(
    scope: string,
    source: AgentConversationController
  ): void {
    if (disposed) return;
    options.store.setAgentRunPreferences(
      scope,
      captureAgentRunPreferences(source),
      { source }
    );
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
      const snapshot = await options.store.loadPersistence(persistenceKey, {
        force: retry
      });
      if (!controllerIsCurrent(key, conversation, generation)) return;
      if (snapshot !== undefined) {
        await conversation.restorePersistenceSnapshot(snapshot);
        if (!controllerIsCurrent(key, conversation, generation)) return;
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
    const created = options.createController({
      onPersistenceChange: () => {
        if (!controllerIsCurrent(key, created)) return;
        options.store.schedulePersistenceFactory(
          persistenceKey,
          created.capturePersistenceSnapshot
        );
      },
      onPersistenceRemove: () => options.store.removePersistence(persistenceKey)
    });
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

  function applyDefaultApprovalMode(
    permissionMode: GeneralPermissionMode
  ): void {
    if (disposed) return;
    const nextPreferences: AgentRunPreferencesByScope = Object.fromEntries(
      Object.entries(options.store.agentRunPreferences.value).map(
        ([scope, preference]) => [
          scope,
          { ...preference, approvalMode: permissionMode }
        ]
      )
    );
    for (const [key, conversation] of options.store.controllerEntries()) {
      conversation.selectApprovalMode(permissionMode);
      const scope = options.store.scopeForKey(key) ?? "general";
      nextPreferences[scope] = {
        ...captureAgentRunPreferences(conversation),
        approvalMode: permissionMode
      };
    }
    for (const [scope, preferences] of Object.entries(nextPreferences)) {
      options.store.setAgentRunPreferences(scope, preferences, {
        persist: false
      });
    }
    options.store.schedulePersistence(RUN_PREFERENCES_PERSISTENCE_KEY, {
      ...nextPreferences
    });
  }

  function applyModelSettingsToConversations(settings: ModelSettings): void {
    if (disposed) return;
    const entries = [...options.store.controllerEntries()];
    const conversations = entries.map(([, conversation]) => conversation);
    for (const conversation of conversations) {
      conversation.applyModelSettings(settings);
    }

    const defaultModel =
      settings.models.find(({ id }) => id === settings.defaultModelId) ??
      settings.models[0];
    const selection =
      options.store.sessionAgentModelSelection.value ??
      (defaultModel
        ? {
            selectedModelId: defaultModel.id,
            thinkingLevel: defaultModel.defaultThinkingLevel
          }
        : undefined);
    if (selection) {
      applySessionAgentModelSelection(selection);
      const representative = conversations[0];
      if (representative) {
        options.store.setSessionAgentModelSelection(
          {
            selectedModelId: representative.selectedModelId.value,
            thinkingLevel: representative.thinkingLevel.value,
            webSearchEnabled: representative.webSearchEnabled.value
          },
          { persist: false }
        );
      }
    }
    for (const [key, conversation] of entries) {
      const scope = options.store.scopeForKey(key) ?? "general";
      const preferences = options.store.agentRunPreferences.value[scope];
      if (preferences) {
        applyAgentRunPreferences(conversation, preferences);
      }
    }
    applyDefaultApprovalMode(options.permissionMode());
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
