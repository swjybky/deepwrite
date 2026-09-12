import type { AgentConversationController } from "../../composables/useAgentConversation";
import { uiMessage } from "../../ui-feedback";

export function useChatAssistantHistoryActions(options: {
  controller: () => Pick<
    AgentConversationController,
    "newConversation" | "selectConversation"
  > &
    Partial<Pick<AgentConversationController, "openConversation">>;
  focusInput: () => void;
  notifications?: Pick<typeof uiMessage, "info" | "error">;
}) {
  const notifications = options.notifications ?? uiMessage;
  function newConversation(): void {
    options.controller().newConversation();
    options.focusInput();
  }
  async function selectConversation(sessionId: string): Promise<void> {
    const conversation = options.controller();
    try {
      const selected = await (conversation.openConversation
        ? conversation.openConversation(sessionId)
        : conversation.selectConversation(sessionId));
      if (!selected) {
        notifications.info("当前回复完成或停止后，才能切换聊天记录");
        return;
      }
      options.focusInput();
    } catch (error) {
      notifications.error(
        error instanceof Error
          ? error.message
          : "暂时无法打开这条历史对话，请重试。"
      );
    }
  }
  return { newConversation, selectConversation };
}
