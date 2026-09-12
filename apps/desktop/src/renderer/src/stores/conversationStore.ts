import { createConversationPreferenceState } from "./conversationPreferenceState";
import { createConversationPersistenceState } from "./conversationPersistenceState";
import { flushConversationsBeforeClose } from "./conversationClose";
import { watchConversationCheckpoints } from "../composables/watchConversationCheckpoints";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistenceKeys";
export {
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY
} from "../utils/conversationPersistenceKeys";
export type {
  ConversationPersistenceAdapter,
  ConversationPersistenceOptions
} from "./conversationPersistenceTypes";
import {
  computed,
  markRaw,
  onScopeDispose,
  ref,
  shallowRef,
  triggerRef,
  type ShallowRef
} from "vue";
import { defineStore } from "pinia";
import type { AgentConversationController } from "../composables/useAgentConversation";

export interface DisposeConversationStoreOptions {
  flush?: boolean;
  clearControllerPersistence?: boolean;
}

export const useConversationStore = defineStore("conversation", () => {
  const controllers = shallowRef<Map<string, AgentConversationController>>(
    new Map()
  );
  const scopesByKey = shallowRef<Map<string, string>>(new Map());
  const checkpointWatchers = new Map<string, () => void>();
  const controllerRegistryRevision = ref(0);

  const persistence = createConversationPersistenceState(async (flush) => {
    // Closing must still save when the development server or lazy assets are gone.
    await flushConversationsBeforeClose(
      controllers.value,
      (key, snapshot) => {
        const controller = controllers.value.get(key);
        if (controller)
          persistence.scheduleControllerPersistence(
            conversationHistoryPersistenceKey(key),
            controller
          );
        else
          persistence.schedulePersistenceFactory(
            conversationHistoryPersistenceKey(key),
            snapshot
          );
      },
      flush
    );
  });

  const {
    persistenceCache,
    persistenceErrors,
    persistenceBusy,
    persistenceProgress,
    scheduleControllerPersistence,
    configurePersistenceAdapter,
    schedulePersistence,
    schedulePersistenceFactory,
    flushPersistence,
    loadPersistence,
    invalidatePersistenceCache,
    removePersistence
  } = persistence;

  const {
    sessionAgentModelSelection,
    agentRunPreferences,
    applyGlobalPreferences,
    setSessionAgentModelSelection,
    setAgentRunPreferences,
    removeAgentRunPreferences,
    hydratePreferences
  } = createConversationPreferenceState(controllers, scopesByKey, persistence);

  const controllerCount = computed(() => controllers.value.size);
  function replaceMapEntry<Key, Value>(
    target: ShallowRef<Map<Key, Value>>,
    key: Key,
    value: Value
  ): void {
    // Keep the Map identity stable so coordinators can retain the shallow
    // registry without retaining an obsolete snapshot after registration.
    target.value.set(key, value);
    triggerRef(target);
  }

  function deleteMapEntry<Key, Value>(
    target: ShallowRef<Map<Key, Value>>,
    key: Key
  ): void {
    if (!target.value.has(key)) return;
    target.value.delete(key);
    triggerRef(target);
  }

  function registerController(
    key: string,
    scope: string,
    controller: AgentConversationController,
    options: { applyPreferences?: boolean } = {}
  ): AgentConversationController {
    const normalizedKey = key.trim();
    const normalizedScope = scope.trim();
    if (!normalizedKey) throw new Error("会话 key 不能为空。");
    if (!normalizedScope) throw new Error("会话 scope 不能为空。");
    const existing = controllers.value.get(normalizedKey);
    checkpointWatchers.get(normalizedKey)?.();
    if (existing && existing !== controller) {
      existing.dispose();
    }
    replaceMapEntry(controllers, normalizedKey, markRaw(controller));
    replaceMapEntry(scopesByKey, normalizedKey, normalizedScope);
    checkpointWatchers.set(
      normalizedKey,
      watchConversationCheckpoints(controller, () =>
        flushPersistence(conversationHistoryPersistenceKey(normalizedKey))
      )
    );
    controllerRegistryRevision.value += 1;
    if (options.applyPreferences !== false) {
      applyGlobalPreferences(controller, normalizedScope);
    }
    return controller;
  }

  function controllerForKey(
    key: string
  ): AgentConversationController | undefined {
    return controllers.value.get(key);
  }

  function scopeForKey(key: string): string | undefined {
    return scopesByKey.value.get(key);
  }

  function controllersForScope(scope: string): AgentConversationController[] {
    return [...controllers.value.entries()].flatMap(([key, controller]) =>
      scopesByKey.value.get(key) === scope ? [controller] : []
    );
  }

  function listControllers(): AgentConversationController[] {
    return [...controllers.value.values()];
  }

  function setControllerScope(key: string, scope: string): boolean {
    const controller = controllers.value.get(key);
    const normalizedScope = scope.trim();
    if (!controller || !normalizedScope) return false;
    replaceMapEntry(scopesByKey, key, normalizedScope);
    applyGlobalPreferences(controller, normalizedScope);
    return true;
  }

  function removeController(
    key: string,
    options: { dispose?: boolean; clearPersistence?: boolean } = {}
  ): AgentConversationController | undefined {
    const controller = controllers.value.get(key);
    if (!controller) return undefined;
    checkpointWatchers.get(key)?.();
    checkpointWatchers.delete(key);
    deleteMapEntry(controllers, key);
    deleteMapEntry(scopesByKey, key);
    controllerRegistryRevision.value += 1;
    if (options.dispose !== false) {
      controller.dispose(
        options.clearPersistence === undefined
          ? undefined
          : { clearPersistence: options.clearPersistence }
      );
    }
    return controller;
  }

  function disposeAllControllers(
    options: { clearPersistence?: boolean } = {}
  ): void {
    const existing = [...controllers.value.values()];
    for (const stop of checkpointWatchers.values()) stop();
    checkpointWatchers.clear();
    controllers.value.clear();
    scopesByKey.value.clear();
    triggerRef(controllers);
    triggerRef(scopesByKey);
    if (existing.length) controllerRegistryRevision.value += 1;
    for (const controller of existing) {
      controller.dispose(
        options.clearPersistence === undefined
          ? undefined
          : { clearPersistence: options.clearPersistence }
      );
    }
  }

  async function dispose(
    options: DisposeConversationStoreOptions = {}
  ): Promise<void> {
    // A failed flush leaves the live controllers and recovery queue available.
    if (options.flush !== false) await flushPersistence();
    else persistence.discardPendingPersistence();
    persistence.stopScheduling();
    disposeAllControllers(
      options.clearControllerPersistence === undefined
        ? {}
        : { clearPersistence: options.clearControllerPersistence }
    );
    persistence.disconnect();
  }

  onScopeDispose(() => {
    persistence.stopScheduling();
    persistence.discardPendingPersistence();
    disposeAllControllers();
    persistence.disconnect();
  });

  return {
    controllers,
    scopesByKey,
    controllerCount,
    controllerRegistryRevision,
    persistenceCache,
    persistenceErrors,
    persistenceBusy,
    persistenceProgress,
    scheduleControllerPersistence,
    sessionAgentModelSelection,
    agentRunPreferences,
    registerController,
    controllerForKey,
    scopeForKey,
    controllersForScope,
    listControllers,
    setControllerScope,
    removeController,
    disposeAllControllers,
    setSessionAgentModelSelection,
    setAgentRunPreferences,
    removeAgentRunPreferences,
    configurePersistenceAdapter,
    schedulePersistence,
    schedulePersistenceFactory,
    flushPersistence,
    loadPersistence,
    invalidatePersistenceCache,
    removePersistence,
    hydratePreferences,
    dispose
  };
});
