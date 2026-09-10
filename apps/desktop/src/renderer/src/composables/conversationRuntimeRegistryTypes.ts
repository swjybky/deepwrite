import type {
  GeneralPermissionMode,
  ModelSettings
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import type { AgentConversationController } from "./useAgentConversation";
import type {
  ConversationPersistenceAdapter,
  ConversationPersistenceOptions
} from "../stores/conversationStore";
import type {
  AgentModelSelection,
  AgentRunPreferences,
  AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";

interface ConversationRuntimeRegistryNotifications {
  warning(message: string): void;
}

export interface ConversationControllerPersistenceHooks {
  onPersistenceChange(): void | Promise<void>;
  onPersistenceRemove(): void | Promise<void>;
}

export interface ConversationRuntimeRegistryStorePort {
  sessionAgentModelSelection: Readonly<Ref<AgentModelSelection | undefined>>;
  agentRunPreferences: Readonly<Ref<AgentRunPreferencesByScope>>;
  configurePersistenceAdapter(
    adapter: ConversationPersistenceAdapter | null,
    options?: ConversationPersistenceOptions
  ): void;
  registerController(
    key: string,
    scope: string,
    controller: AgentConversationController,
    options?: { applyPreferences?: boolean }
  ): AgentConversationController;
  controllerForKey(key: string): AgentConversationController | undefined;
  scopeForKey(key: string): string | undefined;
  setControllerScope(key: string, scope: string): boolean;
  listControllers(): AgentConversationController[];
  controllerEntries(): Iterable<readonly [string, AgentConversationController]>;
  setSessionAgentModelSelection(
    selection: AgentModelSelection | undefined,
    options?: {
      source?: AgentConversationController;
      persist?: boolean;
    }
  ): void;
  setAgentRunPreferences(
    scope: string,
    preferences: AgentRunPreferences,
    options?: {
      source?: AgentConversationController;
      persist?: boolean;
    }
  ): void;
  removeAgentRunPreferences(
    scope: string,
    options?: { persist?: boolean }
  ): boolean;
  schedulePersistence<Value>(key: string, value: Value): void;
  schedulePersistenceFactory(key: string, valueFactory: () => unknown): void;
  loadPersistence<Value>(
    key: string,
    options?: { force?: boolean }
  ): Promise<Value | undefined>;
  removePersistence(key: string): Promise<void>;
  hydratePreferences(): Promise<void>;
}

export interface ConversationRuntimeRegistryCoordinatorOptions {
  store: ConversationRuntimeRegistryStorePort;
  persistenceAdapter: ConversationPersistenceAdapter | null;
  modelSettings: Readonly<Ref<ModelSettings | null>>;
  permissionMode(): GeneralPermissionMode;
  createController(
    hooks: ConversationControllerPersistenceHooks
  ): AgentConversationController;
  resumeRecovered(conversations: readonly AgentConversationController[]): void;
  notifications: ConversationRuntimeRegistryNotifications;
}
