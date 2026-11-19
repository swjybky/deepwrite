import { watch } from "vue";
import type { TextMenuHistory } from "./nativeTextContextMenu";
import { textareaOffsetToMarkdownSource } from "../utils/bookImageInsertion";
import { randomHex8 } from "@deepwrite/shared";
import type { EditorTextReference } from "../types/conversation";
import {
  createEditorTextReference,
  createRenderedEditorTextReference,
  type EditorTextReferenceDocument
} from "../utils/editorTextReferences";
import { useSelectionInsertionMenu } from "./useSelectionInsertionMenu";
import { richMarkdownEditorAt } from "../utils/richMarkdownBridge";

export interface EditorSelectionReferenceSource {
  resourceId: string;
  document: EditorTextReferenceDocument;
}

export function useEditorSelectionInsertion(options: {
  source(): EditorSelectionReferenceSource | undefined;
  history?: TextMenuHistory;
  insert(reference: EditorTextReference): void;
}) {
  const menu = useSelectionInsertionMenu({ insert: options.insert });
  watch(
    [
      () => options.source()?.resourceId,
      () => options.source()?.document.id,
      () => options.source()?.document.content
    ],
    menu.closeSelectionAction
  );

  function sourceIsCurrent(source: EditorSelectionReferenceSource): boolean {
    const current = options.source();
    return (
      current?.resourceId === source.resourceId &&
      current.document.id === source.document.id &&
      current.document.content === source.document.content
    );
  }

  function handleEditorContextMenu(event: MouseEvent): void {
    const input =
      event.target instanceof HTMLTextAreaElement
        ? event.target
        : event.currentTarget;
    const source = options.source();
    if (!(input instanceof HTMLTextAreaElement) || !source) {
      menu.closeSelectionAction();
      return;
    }

    const blockSource = source.document.content;
    const start = textareaOffsetToMarkdownSource(
      blockSource,
      input.selectionStart ?? 0
    );
    const end = textareaOffsetToMarkdownSource(
      blockSource,
      input.selectionEnd ?? input.selectionStart ?? 0
    );
    const reference = createEditorTextReference({
      id: randomHex8(),
      resourceId: source.resourceId,
      document: source.document,
      start,
      end
    });
    menu.openSelectionAction(
      reference ?? undefined,
      event,
      options.history,
      () => sourceIsCurrent(source)
    );
  }

  function handlePreviewContextMenu(event: MouseEvent): void {
    const preview = event.currentTarget;
    const source = options.source();
    const selection = globalThis.getSelection?.();
    const editor =
      event.target instanceof HTMLElement
        ? richMarkdownEditorAt(event.target)
        : undefined;
    const history = editor ? options.history : undefined;
    if (
      !(preview instanceof HTMLElement) ||
      !source ||
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount !== 1 ||
      !preview.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      if (source && history)
        menu.openSelectionAction(undefined, event, history, () =>
          sourceIsCurrent(source)
        );
      else menu.closeSelectionAction();
      return;
    }
    const input = {
      id: randomHex8(),
      resourceId: source.resourceId,
      document: source.document
    };
    const reference = editor
      ? createEditorTextReference({ ...input, ...editor.selection() })
      : createRenderedEditorTextReference({
          ...input,
          text: selection.toString()
        });
    if (!reference) {
      menu.closeSelectionAction();
      return;
    }
    menu.openSelectionAction(reference, event, history, () =>
      sourceIsCurrent(source)
    );
  }

  return {
    ...menu,
    handleEditorContextMenu,
    handlePreviewContextMenu
  };
}
