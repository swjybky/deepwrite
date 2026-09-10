import {
  captureRunSettings,
  validModelSelection,
  normalizeRunPreferencesByScope
} from "./conversationPreferences";
import { createConversationPersistenceState } from "./conversationPersistenceState";
import { watchConversationCheckpoints } from "../composables/watchConversationCheckpoints";
import {
  conversationHistoryPersistenceKey,
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY
} from "../utils/conversationPersistenceKeys";
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
import {
  type AgentModelSelection,
  type AgentRunPreferences,
  type AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";

export interface DisposeConversationStoreOptions {
  flush?: boolean;
  clearControllerPersistence?: boolean;
}

interface PreferenceUpdateOptions {
  source?: AgentConversationController;
  persist?: boolean;
}

function rawValue<Value>(value: Value): Value {
  return typeof value === "object" && value !== null ? markRaw(value) : value;
}

export const useConversationStore = defineStore("conversation", () => {
  const controllers = shallowRef<Map<string, AgentConversationController>>(
    new Map()
  );
  const scopesByKey = shallowRef<Map<string, string>>(new Map());
  const checkpointWatchers = new Map<string, () => void>();
  const controllerRegistryRevision = ref(0);
  const sessionAgentModelSelection = shallowRef<AgentModelSelection>();
  const agentRunPreferences = shallowRef<AgentRunPreferencesByScope>({});

  const persistence = createConversationPersistenceState(async (flush) => {
    const { flushConversationsBeforeClose } =
      await import("./conversationClose");
    await flushConversationsBeforeClose(
      controllers.value,
      (key, snapshot) =>
        schedulePersistenceFactory(
          conversationHistoryPersistenceKey(key),
          snapshot
        ),
      flush
    );
  });

  const {
    persistenceCache,
    persistenceErrors,
    persistenceBusy,
    configurePersistenceAdapter,
    schedulePersistence,
    schedulePersistenceFactory,
    flushPersistence,
    loadPersistence,
    invalidatePersistenceCache,
    removePersistence
  } = persistence;

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

  function applyGlobalPreferences(
    controller: AgentConversationController,
    scope: string
  ): void {
    const selection = sessionAgentModelSelection.value;
    const preferences = agentRunPreferences.value[scope];
    if (!selection && !preferences) return;
    controller.applyRunSettings({
      ...captureRunSettings(controller),
      ...(selection ?? {}),
      ...(preferences ?? {})
    });
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

  function setSessionAgentModelSelection(
    selection: AgentModelSelection | undefined,
    options: PreferenceUpdateOptions = {}
  ): void {
    sessionAgentModelSelection.value = selection
      ? rawValue({ ...selection })
      : undefined;
    if (selection) {
      for (const controller of controllers.value.values()) {
        if (controller === options.source) continue;
        controller.applyRunSettings({
          ...captureRunSettings(controller),
          ...selection
        });
      }
      if (options.persist !== false) {
        schedulePersistence(MODEL_SELECTION_PERSISTENCE_KEY, { ...selection });
      }
    } else if (options.persist !== false) {
      schedulePersistence(MODEL_SELECTION_PERSISTENCE_KEY, null);
    }
  }

  function setAgentRunPreferences(
    scope: string,
    preferences: AgentRunPreferences,
    options: PreferenceUpdateOptions = {}
  ): void {
    const normalizedScope = scope.trim();
    if (!normalizedScope) throw new Error("会话 scope 不能为空。");
    agentRunPreferences.value = rawValue({
      ...agentRunPreferences.value,
      [normalizedScope]: { ...preferences }
    });
    for (const [key, controller] of controllers.value) {
      if (
        scopesByKey.value.get(key) !== normalizedScope ||
        controller === options.source
      ) {
        continue;
      }
      controller.applyRunSettings({
        ...captureRunSettings(controller),
        ...preferences
      });
    }
    if (options.persist !== false) {
      schedulePersistence(RUN_PREFERENCES_PERSISTENCE_KEY, {
        ...agentRunPreferences.value
      });
    }
  }

  function removeAgentRunPreferences(
    scope: string,
    options: { persist?: boolean } = {}
  ): boolean {
    if (!(scope in agentRunPreferences.value)) return false;
    const next = { ...agentRunPreferences.value };
    delete next[scope];
    agentRunPreferences.value = rawValue(next);
    if (options.persist !== false) {
      schedulePersistence(RUN_PREFERENCES_PERSISTENCE_KEY, { ...next });
    }
    return true;
  }

  async function hydratePreferences(): Promise<void> {
    const [selection, preferences] = await Promise.all([
      loadPersistence<AgentModelSelection>(MODEL_SELECTION_PERSISTENCE_KEY),
      loadPersistence<AgentRunPreferencesByScope>(
        RUN_PREFERENCES_PERSISTENCE_KEY
      )
    ]);
    if (validModelSelection(selection)) {
      setSessionAgentModelSelection(selection, { persist: false });
    }
    const normalizedPreferences = normalizeRunPreferencesByScope(preferences);
    if (normalizedPreferences) {
      agentRunPreferences.value = rawValue(
        Object.fromEntries(
          Object.entries(normalizedPreferences).map(([scope, preference]) => [
            scope,
            { ...preference }
          ])
        )
      );
      for (const [key, controller] of controllers.value) {
        applyGlobalPreferences(
          controller,
          scopesByKey.value.get(key) ?? "general"
        );
      }
    }
  }

  async function dispose(
    options: DisposeConversationStoreOptions = {}
  ): Promise<void> {
    persistence.stopScheduling();
    try {
      if (options.flush !== false) {
        await flushPersistence();
      } else {
        persistence.discardPendingPersistence();
      }
    } finally {
      disposeAllControllers(
        options.clearControllerPersistence === undefined
          ? {}
          : { clearPersistence: options.clearControllerPersistence }
      );
      persistence.disconnect();
    }
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
