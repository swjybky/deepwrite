import { randomHex8 } from "@deepwrite/shared";
import type { EditorTextReference } from "../types/conversation";
import {
  createEditorTextReference,
  createRenderedEditorTextReference,
  type EditorTextReferenceDocument
} from "../utils/editorTextReferences";
import { useSelectionInsertionMenu } from "./useSelectionInsertionMenu";

export interface EditorSelectionReferenceSource {
  resourceId: string;
  document: EditorTextReferenceDocument;
}

export function useEditorSelectionInsertion(options: {
  source(): EditorSelectionReferenceSource | undefined;
  insert(reference: EditorTextReference): void;
}) {
  const menu = useSelectionInsertionMenu({ insert: options.insert });

  function handleEditorContextMenu(event: MouseEvent): void {
    const input = event.currentTarget;
    const source = options.source();
    if (!(input instanceof HTMLTextAreaElement) || !source) {
      menu.closeSelectionAction();
      return;
    }

    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const reference = createEditorTextReference({
      id: randomHex8(),
      resourceId: source.resourceId,
      document: source.document,
      start,
      end
    });
    if (!reference) {
      menu.closeSelectionAction();
      return;
    }
    menu.openSelectionAction(reference, event);
    event.preventDefault();
  }

  function handlePreviewContextMenu(event: MouseEvent): void {
    const preview = event.currentTarget;
    const source = options.source();
    const selection = globalThis.getSelection?.();
    if (
      !(preview instanceof HTMLElement) ||
      !source ||
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount !== 1 ||
      !preview.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      menu.closeSelectionAction();
      return;
    }
    const reference = createRenderedEditorTextReference({
      id: randomHex8(),
      resourceId: source.resourceId,
      document: source.document,
      text: selection.toString()
    });
    if (!reference) {
      menu.closeSelectionAction();
      return;
    }
    menu.openSelectionAction(reference, event);
    event.preventDefault();
  }

  return {
    ...menu,
    handleEditorContextMenu,
    handlePreviewContextMenu
  };
}
