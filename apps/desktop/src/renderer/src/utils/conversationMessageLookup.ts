import type { ChatMessage } from "../types/conversation";

export function lastAssistantMessage(
  messages: readonly ChatMessage[],
  requireContent = false
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (
      message.role === "assistant" &&
      (!requireContent || /\S/.test(message.content))
    )
      return message;
  }
  return undefined;
}
