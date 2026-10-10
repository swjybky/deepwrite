export interface EditorFindPanelInputActions {
  updateQuery: (value: string) => void;
  search: () => void;
  findMatch: (direction: 1 | -1) => void;
  replaceCurrent: () => void;
}

/**
 * Input handling shared by the editor find panels. Chromium dispatches the
 * final input of an IME composition before compositionend while it is still
 * composing, so searching waits for compositionend instead of acting on
 * half-typed pinyin.
 */
export function createEditorFindPanelInput(
  actions: EditorFindPanelInputActions
) {
  return {
    handleQueryInput(event: Event): void {
      actions.updateQuery((event.target as HTMLInputElement).value);
      if (!(event as InputEvent).isComposing) actions.search();
    },
    handleQueryCompositionEnd(event: CompositionEvent): void {
      actions.updateQuery((event.target as HTMLInputElement).value);
      actions.search();
    },
    handleQueryEnter(event: KeyboardEvent): void {
      if (event.isComposing) return;
      event.preventDefault();
      actions.findMatch(event.shiftKey ? -1 : 1);
    },
    handleReplacementEnter(event: KeyboardEvent): void {
      if (event.isComposing) return;
      event.preventDefault();
      actions.replaceCurrent();
    }
  };
}
