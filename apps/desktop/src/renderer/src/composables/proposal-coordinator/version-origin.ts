import type { DocumentVersionOrigin } from "@deepwrite/contracts/renderer";
import type { ChatMessage } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";

export function conversationVersionOrigin(
  conversation: Pick<AgentConversationController, "sessionId" | "messages">,
  runId: string,
  fallbackSummary: string
): DocumentVersionOrigin {
  const messages = conversation.messages.value;
  const assistantIndex = messages.findIndex(
    (message) => message.role === "assistant" && message.runId === runId
  );
  let userMessage: ChatMessage | undefined = messages.find(
    (message) => message.role === "user" && message.runId === runId
  );
  if (!userMessage && assistantIndex >= 0) {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        userMessage = messages[index];
        break;
      }
    }
  }
  const firstLine = (userMessage?.content || fallbackSummary || runId)
    .trim()
    .split(/\r?\n/u)[0]!
    .trim();
  return {
    sessionId: conversation.sessionId.value,
    runId,
    summary: (firstLine || fallbackSummary.trim() || runId).slice(0, 120)
  };
}
