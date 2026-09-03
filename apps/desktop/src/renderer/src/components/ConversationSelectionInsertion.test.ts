import { describe, expect, it } from "vitest";
import conversationSource from "./AgentConversation.vue?raw";
import itemSource from "./ConversationMessageItem.vue?raw";
import listSource from "./ConversationMessageList.vue?raw";
import menuSource from "./EditorSelectionMenu.vue?raw";
import referenceCoordinatorSource from "../composables/useConversationTextReferences.ts?raw";

describe("assistant response selection insertion", () => {
  it("shows the shared insert action for selected completed assistant text", () => {
    expect(itemSource).toContain(':data-assistant-response-message-id="');
    expect(itemSource).toContain(
      "message.status === 'streaming' ? undefined : message.id"
    );
    expect(listSource).toContain(
      '@contextmenu="handleConversationContextMenu"'
    );
    expect(listSource).toContain('"[data-assistant-response-message-id]"');
    expect(listSource).toContain(
      "response.contains(selection.getRangeAt(0).commonAncestorContainer)"
    );
    expect(listSource).toContain("createConversationTextReference({");
    expect(listSource).toContain("<EditorSelectionMenu");
    expect(menuSource).toContain("插入输入框");
  });

  it("merges response selections into the composer and preserves navigation", () => {
    expect(conversationSource).toContain(
      '@insert-selection="insertConversationReference"'
    );
    expect(conversationSource).toContain(
      ':editor-references="composerReferences"'
    );
    expect(conversationSource).toContain(
      '@clear-editor-references="clearComposerReferences"'
    );
    expect(conversationSource).toContain(
      '@remove-editor-reference="removeComposerReference"'
    );
    expect(conversationSource).toContain(
      '@locate-editor-reference="locateComposerReference"'
    );
    expect(referenceCoordinatorSource).toContain(
      'reference.source !== "conversation"'
    );
    expect(referenceCoordinatorSource).toContain(
      'message.scrollIntoView({ block: "center" })'
    );
    expect(referenceCoordinatorSource).toContain("selection?.addRange(range)");
  });
});
