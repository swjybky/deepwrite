import { onBeforeUnmount, onMounted, ref } from "vue";
import type { EditorTextReference } from "../types/conversation";

interface SelectionInsertionAction {
  reference: EditorTextReference;
  left: number;
  top: number;
}

const SELECTION_MENU_WIDTH = 142;
const SELECTION_MENU_HEIGHT = 42;
const VIEWPORT_MARGIN = 8;

export function useSelectionInsertionMenu(options: {
  insert(reference: EditorTextReference): void;
}) {
  const selectionAction = ref<SelectionInsertionAction | null>(null);

  function closeSelectionAction(): void {
    selectionAction.value = null;
  }

  function openSelectionAction(
    reference: EditorTextReference,
    event: MouseEvent
  ): void {
    selectionAction.value = {
      reference,
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(
          globalThis.innerWidth - SELECTION_MENU_WIDTH - VIEWPORT_MARGIN,
          event.clientX + VIEWPORT_MARGIN
        )
      ),
      top: Math.max(
        VIEWPORT_MARGIN,
        Math.min(
          globalThis.innerHeight - SELECTION_MENU_HEIGHT - VIEWPORT_MARGIN,
          event.clientY + VIEWPORT_MARGIN
        )
      )
    };
  }

  function insertSelectedText(): void {
    const reference = selectionAction.value?.reference;
    if (!reference) return;
    options.insert(reference);
    closeSelectionAction();
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest(".editor-selection-menu")) {
      return;
    }
    closeSelectionAction();
  }

  onMounted(() => {
    globalThis.addEventListener("pointerdown", handleWindowPointerDown, true);
  });

  onBeforeUnmount(() => {
    globalThis.removeEventListener(
      "pointerdown",
      handleWindowPointerDown,
      true
    );
  });

  return {
    selectionAction,
    closeSelectionAction,
    openSelectionAction,
    insertSelectedText
  };
}
