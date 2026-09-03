import { computed, watch, type Ref } from "vue";
import type { EditorTextReference } from "../types/conversation";
import type { PendingEditorReferenceNotifications } from "./usePendingEditorReferences";
import { usePendingEditorReferences } from "./usePendingEditorReferences";

function conversationMessageElement(
  root: HTMLElement,
  messageId: string
): HTMLElement | undefined {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-conversation-message-id]")
  ).find((element) => element.dataset.conversationMessageId === messageId);
}

function selectReferenceText(
  root: HTMLElement,
  reference: EditorTextReference
): void {
  const textRoot = root.querySelector<HTMLElement>(
    "[data-assistant-response-message-id]"
  );
  if (!textRoot) return;
  const text = textRoot.textContent ?? "";
  const start = text.indexOf(reference.text);
  if (start < 0) return;

  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let offset = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  const end = start + reference.text.length;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = Math.max(0, start - offset);
    }
    if (end <= offset + length) {
      endNode = node;
      endOffset = Math.max(0, end - offset);
      break;
    }
    offset += length;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function useConversationTextReferences(options: {
  sessionId(): string;
  externalReferences(): readonly EditorTextReference[];
  messageList: Readonly<Ref<HTMLElement | undefined>>;
  clearExternalReferences(): void;
  removeExternalReference(referenceId: string): void;
  locateExternalReference(reference: EditorTextReference): void;
  notifications: PendingEditorReferenceNotifications;
}) {
  const local = usePendingEditorReferences(options.notifications, {
    existingReferences: options.externalReferences
  });
  const composerReferences = computed(() => [
    ...options.externalReferences(),
    ...local.editorReferences.value
  ]);

  function clearComposerReferences(): void {
    local.clearEditorReferences();
    options.clearExternalReferences();
  }

  function removeComposerReference(referenceId: string): void {
    if (local.editorReferences.value.some(({ id }) => id === referenceId)) {
      local.removeEditorReference(referenceId);
      return;
    }
    options.removeExternalReference(referenceId);
  }

  function locateComposerReference(reference: EditorTextReference): void {
    if (reference.source !== "conversation") {
      options.locateExternalReference(reference);
      return;
    }
    const messageId = reference.conversationMessageId;
    const root = options.messageList.value;
    const message =
      messageId && root
        ? conversationMessageElement(root, messageId)
        : undefined;
    if (!message) {
      local.removeEditorReference(reference.id);
      options.notifications.warning("引用的智能体回复已不存在，已移除这条引用");
      return;
    }
    message.scrollIntoView({ block: "center" });
    selectReferenceText(message, reference);
  }

  watch(options.sessionId, local.clearEditorReferences);

  return {
    composerReferences,
    insertConversationReference: local.insertEditorReference,
    clearComposerReferences,
    removeComposerReference,
    locateComposerReference
  };
}
