import { markRaw, shallowRef, type ShallowRef } from "vue";
import type { AgentConversationController } from "../composables/useAgentConversation";
import type {
  AgentModelSelection,
  AgentRunPreferences,
  AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";
import {
  captureRunSettings,
  validModelSelection,
  normalizeRunPreferencesByScope
} from "./conversationPreferences";
import {
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY
} from "../utils/conversationPersistenceKeys";
import type { createConversationPersistenceState } from "./conversationPersistenceState";
interface PreferenceUpdateOptions {
  source?: AgentConversationController;
  persist?: boolean;
}
function rawValue<Value>(value: Value): Value {
  return typeof value === "object" && value !== null ? markRaw(value) : value;
}
export function createConversationPreferenceState(
  controllers: ShallowRef<Map<string, AgentConversationController>>,
  scopesByKey: ShallowRef<Map<string, string>>,
  persistence: Pick<
    ReturnType<typeof createConversationPersistenceState>,
    "loadPersistence" | "schedulePersistence"
  >
) {
  const { loadPersistence, schedulePersistence } = persistence;
  const sessionAgentModelSelection = shallowRef<AgentModelSelection>();
  const agentRunPreferences = shallowRef<AgentRunPreferencesByScope>({});
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

  return {
    sessionAgentModelSelection,
    agentRunPreferences,
    applyGlobalPreferences,
    setSessionAgentModelSelection,
    setAgentRunPreferences,
    removeAgentRunPreferences,
    hydratePreferences
  };
}
