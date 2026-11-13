import type { TextContextMenuContext } from "@deepwrite/contracts";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number"
]);

export function captureTextMenuTarget(
  event: MouseEvent,
  allowReadonly = false
) {
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    target === document.body ||
    target === document.documentElement
  )
    return undefined;
  const input =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target
      : undefined;
  if (
    input &&
    (input.matches(":disabled") ||
      (input instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(input.type)))
  )
    return undefined;
  if (!input && target.closest("button, select, input, [role=button]"))
    return undefined;
  const editable = input ? !input.readOnly : target.isContentEditable;
  if (input || editable) target.focus({ preventScroll: true });
  const selection = globalThis.getSelection();
  const range =
    !input && selection?.rangeCount === 1
      ? selection.getRangeAt(0).cloneRange()
      : undefined;
  const selectedText =
    range && !range.collapsed && range.intersectsNode(target)
      ? (selection?.toString() ?? "")
      : "";
  if (!input && !editable && !selectedText && !allowReadonly) return undefined;
  const value = input?.value ?? target.textContent;
  const start = input?.selectionStart;
  const end = input?.selectionEnd;
  const context: TextContextMenuContext = {
    kind: editable
      ? "editable"
      : input || !selectedText
        ? "readonly"
        : "selection",
    password: input instanceof HTMLInputElement && input.type === "password",
    hasSelection: input
      ? start != null && end != null && end > start
      : Boolean(selectedText),
    hasText: Boolean(value),
    canInsertReference: false,
    canInsertImage: false
  };
  return {
    target,
    context,
    valid(checkSelection = true): boolean {
      if (!target.isConnected || (input?.value ?? target.textContent) !== value)
        return false;
      if (input)
        return (
          !input.matches(":disabled") &&
          input.readOnly === !editable &&
          document.activeElement === input &&
          (!checkSelection ||
            (input.selectionStart === start && input.selectionEnd === end))
        );
      if (editable !== target.isContentEditable) return false;
      if (!checkSelection) return true;
      const current = globalThis.getSelection();
      if (!range) return !current || current.rangeCount === 0;
      if (!current || current.rangeCount !== 1) return false;
      const next = current.getRangeAt(0);
      return (
        next.startContainer === range.startContainer &&
        next.startOffset === range.startOffset &&
        next.endContainer === range.endContainer &&
        next.endOffset === range.endOffset &&
        current.toString() === selectedText
      );
    }
  };
}
