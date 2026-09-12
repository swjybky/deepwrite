import type {
  GeneralPermissionMode,
  ModelSettings
} from "@deepwrite/contracts";
import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";
import type {
  AgentModelSelection,
  AgentRunPreferences,
  AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";
import { RUN_PREFERENCES_PERSISTENCE_KEY } from "../stores/conversationStore";
import type { ConversationRuntimeRegistryCoordinatorOptions } from "./conversationRuntimeRegistryTypes";
export function createConversationRegistryPreferences(
  options: ConversationRuntimeRegistryCoordinatorOptions,
  isDisposed: () => boolean
) {
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
    if (isDisposed()) return;
    options.store.setSessionAgentModelSelection(selection, {
      ...(source ? { source } : {}),
      persist: false
    });
  }

  function synchronizeSessionAgentModelSelection(
    source: AgentConversationController
  ): void {
    if (isDisposed()) return;
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
    if (isDisposed()) return;
    options.store.setAgentRunPreferences(scope, preferences);
  }

  function removeAgentRunPreferences(scope: string): void {
    if (isDisposed()) return;
    options.store.removeAgentRunPreferences(scope);
  }

  function synchronizeAgentRunPreferences(
    scope: string,
    source: AgentConversationController
  ): void {
    if (isDisposed()) return;
    options.store.setAgentRunPreferences(
      scope,
      captureAgentRunPreferences(source),
      { source }
    );
  }

  function applyDefaultApprovalMode(
    permissionMode: GeneralPermissionMode
  ): void {
    if (isDisposed()) return;
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
    if (isDisposed()) return;
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

  return {
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
  };
}
