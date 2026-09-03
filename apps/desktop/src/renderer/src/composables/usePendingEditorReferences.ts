import { ref } from "vue";
import { PROMPT_ATTACHMENT_MAX_ITEMS } from "@deepwrite/contracts";
import type { EditorTextReference } from "../types/conversation";

export interface PendingEditorReferenceNotifications {
  info(message: string): void;
  warning(message: string): void;
}

export function usePendingEditorReferences(
  notifications: PendingEditorReferenceNotifications,
  options: {
    existingReferences?(): readonly EditorTextReference[];
  } = {}
) {
  const editorReferences = ref<EditorTextReference[]>([]);

  function insertEditorReference(reference: EditorTextReference): void {
    const existingReferences = options.existingReferences?.() ?? [];
    const duplicate = [...existingReferences, ...editorReferences.value].some(
      (item) =>
        item.documentId === reference.documentId &&
        item.start === reference.start &&
        item.end === reference.end &&
        item.text === reference.text
    );
    if (duplicate) {
      notifications.info("这段正文已经插入输入框");
      return;
    }
    if (
      existingReferences.length + editorReferences.value.length >=
      PROMPT_ATTACHMENT_MAX_ITEMS
    ) {
      notifications.warning(
        `每条消息最多插入 ${PROMPT_ATTACHMENT_MAX_ITEMS} 段正文引用`
      );
      return;
    }
    editorReferences.value = [...editorReferences.value, reference];
  }

  function removeEditorReference(referenceId: string): void {
    editorReferences.value = editorReferences.value.filter(
      ({ id }) => id !== referenceId
    );
  }

  function clearEditorReferences(): void {
    editorReferences.value = [];
  }

  return {
    editorReferences,
    insertEditorReference,
    removeEditorReference,
    clearEditorReferences
  };
}
