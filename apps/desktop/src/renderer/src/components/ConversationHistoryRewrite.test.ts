import { describe, expect, it } from "vitest";
import agentConversationSource from "./AgentConversation.vue?raw";
import editorSource from "./ConversationUserMessageEditor.vue?raw";
import longWorkspaceSource from "./LongWorkspaceModule.vue?raw";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import messageListSource from "./ConversationMessageList.vue?raw";
import editingSource from "../composables/useConversationMessageEditing.ts?raw";
import writingWorkspaceSource from "./WritingWorkspaceModule.vue?raw";
import chatAssistantSource from "../features/chat-assistant/ChatAssistantOverlay.vue?raw";

describe("conversation history rewrite presentation", () => {
  it("opens one inline editor from double-click or the edit action", () => {
    expect(editingSource).toContain(
      "const editingMessageId = ref<string | null>(null)"
    );
    expect(messageListSource).toContain("useConversationMessageEditing");
    expect(messageListSource).toContain(
      ':editing="editingMessageId === message.id"'
    );
    expect(messageItemSource).toContain('@dblclick="requestEdit"');
    expect(messageItemSource).toContain('aria-label="修改并重新发送"');
    expect(messageItemSource).toContain('<AppIcon name="edit"');
    expect(messageItemSource).toContain("<ConversationUserMessageEditor");
  });

  it("supports cancel, send, Enter, Shift+Enter, and Escape without changing the main draft", () => {
    expect(editorSource).toContain('@submit.prevent="submit"');
    expect(editorSource).toContain("取消");
    expect(editorSource).toContain('submitting ? "发送中…" : "发送"');
    expect(editorSource).toContain('event.key === "Enter" && !event.shiftKey');
    expect(editorSource).toContain('event.key === "Escape"');
    expect(editorSource).toContain("event.isComposing");
    expect(editorSource).toContain(
      ':maxlength="CONVERSATION_MESSAGE_MAX_LENGTH"'
    );
    expect(editorSource).toContain("content.value.trim().length > 0");
    expect(editorSource).toContain(':disabled="submitting || disabled"');
    expect(editorSource).toContain("if (!started)");
  });

  it("only enables pure completed user messages and exits on run or replacement", () => {
    expect(editingSource).toContain('message.role === "user"');
    expect(editingSource).toContain('message.status !== "streaming"');
    expect(editingSource).toContain("!message.attachments?.length");
    expect(messageListSource).toContain("props.responding");
    expect(messageListSource).not.toContain("messages.map(messageFingerprint)");
    expect(editingSource).toContain("message.content !== original.content");
    expect(messageListSource).toContain("props.conversationSessionId");
    expect(editingSource).toContain("clearEditingMessage()");
  });

  it("uses themed responsive styling matching the workspace conversation", () => {
    expect(editorSource).toContain("var(--surface-muted)");
    expect(editorSource).toContain("var(--text-primary)");
    expect(editorSource).toContain("var(--accent-soft)");
    expect(editorSource).toContain("var(--neutral-solid)");
    expect(editorSource).toContain("@media (max-width: 720px)");
    expect(messageItemSource).toContain(
      ".message.is-user.is-editing .message-body"
    );
  });

  it("wires workspace agents but leaves the floating chat assistant unchanged", () => {
    expect(agentConversationSource).toContain(
      ':can-rewrite-history="canRewriteHistory"'
    );
    expect(agentConversationSource).toContain(
      ':submit-edited-message="submitEditedMessage"'
    );
    expect(writingWorkspaceSource).toContain('"canRewriteHistory"');
    expect(writingWorkspaceSource).toContain('"submitEditedMessage"');
    expect(longWorkspaceSource).toContain(
      ':can-rewrite-history="canRewriteHistory"'
    );
    expect(longWorkspaceSource).toContain('item.status === "accepted"');
    expect(chatAssistantSource).not.toContain("can-rewrite-history");
    expect(chatAssistantSource).not.toContain("submit-edited-message");
  });
});
