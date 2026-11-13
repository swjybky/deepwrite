export interface RichMarkdownSelection {
  start: number;
  end: number;
}
export interface RichMarkdownBridge {
  selection(): RichMarkdownSelection;
  select(start: number, end: number, focus?: boolean): void;
  focus(): void;
  hasFocus(): boolean;
}
const editors = new WeakMap<HTMLElement, RichMarkdownBridge>();
export function registerRichMarkdownEditor(
  element: HTMLElement,
  editor: RichMarkdownBridge
): () => void {
  editors.set(element, editor);
  return () => editors.delete(element);
}
export function richMarkdownEditorAt(
  element: Element | null
): RichMarkdownBridge | undefined {
  const root =
    element?.closest<HTMLElement>(".editable-markdown-preview") ??
    element?.querySelector<HTMLElement>(".editable-markdown-preview");
  return root ? editors.get(root) : undefined;
}
