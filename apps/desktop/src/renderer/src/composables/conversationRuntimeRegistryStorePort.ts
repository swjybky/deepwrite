import { storeToRefs } from "pinia";
import type { useConversationStore } from "../stores/conversationStore";
import type { ConversationRuntimeRegistryStorePort } from "./conversationRuntimeRegistryTypes";

export function conversationRuntimeRegistryStorePort(
  store: ReturnType<typeof useConversationStore>
): ConversationRuntimeRegistryStorePort {
  const { sessionAgentModelSelection, agentRunPreferences } =
    storeToRefs(store);
  return {
    sessionAgentModelSelection,
    agentRunPreferences,
    configurePersistenceAdapter: store.configurePersistenceAdapter,
    registerController: store.registerController,
    controllerForKey: store.controllerForKey,
    scopeForKey: store.scopeForKey,
    setControllerScope: store.setControllerScope,
    listControllers: store.listControllers,
    controllerEntries: () => store.controllers.entries(),
    setSessionAgentModelSelection: store.setSessionAgentModelSelection,
    setAgentRunPreferences: store.setAgentRunPreferences,
    removeAgentRunPreferences: store.removeAgentRunPreferences,
    schedulePersistence: store.schedulePersistence,
    schedulePersistenceFactory: store.schedulePersistenceFactory,
    scheduleControllerPersistence: store.scheduleControllerPersistence,
    flushPersistence: store.flushPersistence,
    loadPersistence: store.loadPersistence,
    removePersistence: store.removePersistence,
    hydratePreferences: store.hydratePreferences
  };
}
