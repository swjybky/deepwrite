import { computed, ref, watch } from "vue";
import type { ChatMessage } from "../types/conversation";

export function useConversationMessageEditing(options: {
  messages: () => readonly ChatMessage[];
  sessionId: () => string | undefined;
  responding: () => boolean;
  canRewrite: () => boolean;
}) {
  const editingMessageId = ref<string | null>(null);
  const editingMessage = computed(() => {
    const id = editingMessageId.value;
    return id
      ? options.messages().find((message) => message.id === id)
      : undefined;
  });
  let original:
    | { content: string; createdAt: string; sessionId: string | undefined }
    | undefined;

  function clearEditingMessage(): void {
    editingMessageId.value = null;
    original = undefined;
  }

  function messageIsEditable(message: ChatMessage): boolean {
    return (
      options.canRewrite() &&
      message.role === "user" &&
      message.status !== "streaming" &&
      !message.attachments?.length
    );
  }

  function requestEdit(messageId: string): void {
    const message = options
      .messages()
      .find((candidate) => candidate.id === messageId);
    if (!message || !messageIsEditable(message)) return;
    original = {
      content: message.content,
      createdAt: message.createdAt,
      sessionId: options.sessionId()
    };
    editingMessageId.value = messageId;
  }

  function cancelEdit(messageId: string): void {
    if (editingMessageId.value === messageId) clearEditingMessage();
  }

  watch(
    () => {
      const message = editingMessage.value;
      // While no editor is open, no historical message content is subscribed to.
      return [
        options.sessionId(),
        options.responding(),
        options.canRewrite(),
        message?.id,
        message?.content,
        message?.createdAt,
        message?.role,
        message?.status,
        message?.attachments?.length
      ];
    },
    () => {
      const message = editingMessage.value;
      if (
        editingMessageId.value &&
        (!message ||
          !original ||
          options.responding() ||
          options.sessionId() !== original.sessionId ||
          !messageIsEditable(message) ||
          message.content !== original.content ||
          message.createdAt !== original.createdAt)
      ) {
        clearEditingMessage();
      }
    },
    { flush: "sync" }
  );

  return { editingMessageId, messageIsEditable, requestEdit, cancelEdit };
}
