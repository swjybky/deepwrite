import { onBeforeUnmount, onMounted, type Ref } from "vue";

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function trapFocus(
  event: KeyboardEvent,
  root: HTMLElement | null
): void {
  if (
    event.key !== "Tab" ||
    !root ||
    !(event.target instanceof Node) ||
    !root.contains(event.target)
  ) {
    return;
  }
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE)
  ).filter((element) => !element.hasAttribute("hidden"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export function useDialogKeyboard(
  dialogElement: Ref<HTMLElement | null>,
  options: { isOpen: () => boolean; close: () => void }
): void {
  function handleKeydown(event: KeyboardEvent): void {
    if (!options.isOpen()) return;
    if (event.key === "Escape") {
      options.close();
      return;
    }
    trapFocus(event, dialogElement.value);
  }

  onMounted(() => document.addEventListener("keydown", handleKeydown));
  onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
}
