import type { AgentConversationController } from "./useAgentConversation";

interface HistorySelectionOptions {
  prepare(): boolean;
  current(): AgentConversationController | null | undefined;
  warning(message: string): void;
  busyMessage: string;
  unavailableMessage: string;
  selected?(conversation: AgentConversationController): void;
}

/** Keeps asynchronous history loading and its error feedback consistent across workspaces. */
export function createConversationHistorySelection(
  options: HistorySelectionOptions
) {
  return (sessionId: string): void => {
    if (!options.prepare()) return;
    const conversation = options.current();
    if (!conversation) return;
    function settled(selected: boolean) {
      if (options.current() !== conversation) return;
      if (!selected) {
        options.warning(
          conversation!.isBusy.value
            ? options.busyMessage
            : options.unavailableMessage
        );
        return;
      }
      options.selected?.(conversation!);
    }
    try {
      const selected = conversation.openConversation
        ? conversation.openConversation(sessionId)
        : conversation.selectConversation(sessionId);
      if (typeof selected === "boolean") settled(selected);
      else
        void selected.then(settled, (error: unknown) => {
          options.warning(
            error instanceof Error ? error.message : options.unavailableMessage
          );
        });
    } catch (error) {
      options.warning(
        error instanceof Error ? error.message : options.unavailableMessage
      );
    }
  };
}
