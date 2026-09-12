import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

/** Pins mounted nodes only. It does not make unmounted text natively selectable. */
export function selectedConversationWindowIds(
  container: HTMLElement,
  selection: Selection | null,
  attribute = "data-conversation-window-id"
): string[] {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return [];
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) =>
    selection.getRangeAt(index)
  );
  return [...container.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .filter((element) => ranges.some((range) => range.intersectsNode(element)))
    .flatMap((element) =>
      element.getAttribute(attribute) ? [element.getAttribute(attribute)!] : []
    );
}

export function useConversationWindowPins(options: {
  container: Ref<HTMLElement | undefined>;
  editingIds: () => readonly string[];
  retainedIds?: () => readonly string[];
  attribute?: "data-conversation-window-id" | "data-conversation-message-id";
}) {
  const selectionIds = ref<string[]>([]);
  const focusId = ref<string>();
  let cleanup: (() => void) | undefined;
  watch(
    options.container,
    (container) => {
      cleanup?.();
      selectionIds.value = [];
      focusId.value = undefined;
      if (!container) return;
      const document = container.ownerDocument;
      let attached = true;
      function updateSelection(): void {
        selectionIds.value = selectedConversationWindowIds(
          container!,
          document.getSelection(),
          options.attribute
        );
      }
      function updateFocus(event?: Event): void {
        if (!attached) return;
        const active =
          event?.type === "focusin" && event.target instanceof Element
            ? event.target
            : document.activeElement;
        const row =
          active instanceof Element && container!.contains(active)
            ? active.closest<HTMLElement>(
                `[${options.attribute ?? "data-conversation-window-id"}]`
              )
            : null;
        focusId.value =
          row?.getAttribute(
            options.attribute ?? "data-conversation-window-id"
          ) ?? undefined;
      }
      const deferFocusUpdate = () => queueMicrotask(updateFocus);
      document.addEventListener("selectionchange", updateSelection);
      container.addEventListener("focusin", updateFocus);
      container.addEventListener("focusout", deferFocusUpdate);
      cleanup = () => {
        attached = false;
        document.removeEventListener("selectionchange", updateSelection);
        container.removeEventListener("focusin", updateFocus);
        container.removeEventListener("focusout", deferFocusUpdate);
      };
      updateSelection();
      updateFocus();
    },
    { immediate: true, flush: "post" }
  );
  onScopeDispose(() => cleanup?.());
  return computed(() => [
    ...new Set([
      ...options.editingIds(),
      ...(options.retainedIds?.() ?? []),
      ...selectionIds.value,
      ...(focusId.value ? [focusId.value] : [])
    ])
  ]);
}
