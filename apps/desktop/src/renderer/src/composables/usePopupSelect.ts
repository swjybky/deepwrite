import { t } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties
} from "vue";
import { createId } from "@deepwrite/shared";

import type {
  PopupSelectOption,
  PopupSelectValue,
  PopupSelectProps,
  PopupSelectEvents
} from "../types/popupSelect";
import { scrollSelectedIntoView } from "../utils/scrollSelectedIntoView";

export function usePopupSelect(
  props: PopupSelectProps,
  emit: PopupSelectEvents
) {
  const trigger = ref<HTMLButtonElement | null>(null);
  const menu = ref<HTMLElement | null>(null);
  const optionElements = ref<Array<HTMLButtonElement | undefined>>([]);
  const open = ref(false);
  const menuStyle = ref<CSSProperties>({});
  const menuId = createId("popup-select");

  const selectedOption = computed(() =>
    props.options.find((option) => Object.is(option.value, props.modelValue))
  );
  const displayLabel = computed(() =>
    props.multiple
      ? props.selectedValues.length
        ? props.selectedSummary ||
          t("workspace.popupSelect.modelsSelected", {
            length: props.selectedValues.length
          })
        : props.placeholder
      : (selectedOption.value?.label ?? props.placeholder)
  );
  function isSelected(value: PopupSelectValue): boolean {
    return props.multiple
      ? props.selectedValues.includes(value)
      : Object.is(value, props.modelValue);
  }

  function setOptionElement(element: unknown, index: number): void {
    optionElements.value[index] =
      element instanceof HTMLButtonElement ? element : undefined;
  }

  function firstEnabledIndex(): number {
    return props.options.findIndex((option) => !option.disabled);
  }

  function selectedEnabledIndex(): number {
    const index = props.options.findIndex(
      (option) => isSelected(option.value) && !option.disabled
    );
    return index >= 0 ? index : firstEnabledIndex();
  }

  function positionMenu(): void {
    if (!open.value || !trigger.value) {
      return;
    }
    const rect = trigger.value.getBoundingClientRect();
    const viewportMargin = 8;
    const gap = 7;
    const maximumWidth = Math.max(160, window.innerWidth - viewportMargin * 2);
    const minimumWidth = Math.min(
      Math.max(rect.width, props.menuMinWidth),
      Math.min(360, maximumWidth)
    );
    const estimatedHeight = Math.min(
      menu.value?.scrollHeight ?? 12,
      props.menuMaxHeight
    );
    const spaceBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - gap - viewportMargin
    );
    const spaceAbove = Math.max(0, rect.top - gap - viewportMargin);
    const opensUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableHeight = opensUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      72,
      Math.min(props.menuMaxHeight, availableHeight)
    );
    const renderedHeight = Math.min(estimatedHeight, maxHeight);
    const preferredLeft =
      props.align === "end" ? rect.right - minimumWidth : rect.left;
    const left = Math.min(
      Math.max(viewportMargin, preferredLeft),
      window.innerWidth - minimumWidth - viewportMargin
    );
    const top = opensUpward
      ? rect.top - gap - renderedHeight
      : rect.bottom + gap;

    menuStyle.value = {
      top: `${Math.max(viewportMargin, top)}px`,
      left: `${left}px`,
      width: `${minimumWidth}px`,
      maxWidth: `${Math.min(360, maximumWidth)}px`,
      maxHeight: `${maxHeight}px`,
      zIndex: props.menuZIndex,
      transformOrigin: opensUpward ? "bottom" : "top"
    };
  }

  function focusOption(index: number, direction: 1 | -1 = 1): void {
    if (index < 0 || props.options.length === 0) {
      return;
    }
    let candidate = index;
    for (let attempts = 0; attempts < props.options.length; attempts += 1) {
      const option = props.options[candidate];
      if (option && !option.disabled) {
        optionElements.value[candidate]?.focus();
        return;
      }
      candidate =
        (candidate + direction + props.options.length) % props.options.length;
    }
  }

  function revealSelectedOption(): void {
    scrollSelectedIntoView(
      menu.value,
      optionElements.value[selectedEnabledIndex()]
    );
  }

  async function openMenu(focusSelection = false): Promise<void> {
    if (props.disabled || open.value || firstEnabledIndex() < 0) {
      return;
    }
    optionElements.value = [];
    open.value = true;
    await nextTick();
    positionMenu();
    await nextTick();
    positionMenu();
    if (focusSelection) {
      focusOption(selectedEnabledIndex());
    }
    revealSelectedOption();
  }

  function closeMenu(returnFocus = false): void {
    if (!open.value) {
      return;
    }
    open.value = false;
    if (returnFocus) {
      nextTick(() => trigger.value?.focus());
    }
  }

  function toggleMenu(): void {
    if (open.value) {
      closeMenu();
    } else {
      void openMenu();
    }
  }

  function selectOption(option: PopupSelectOption): void {
    if (option.disabled) {
      return;
    }
    if (props.multiple) {
      emit(
        "update:selectedValues",
        isSelected(option.value)
          ? props.selectedValues.filter((value) => value !== option.value)
          : [...props.selectedValues, option.value]
      );
      return;
    }
    if (!Object.is(option.value, props.modelValue)) {
      emit("update:modelValue", option.value);
      emit("change", option.value);
    }
    closeMenu(true);
  }

  function runOptionAction(option: PopupSelectOption): void {
    if (option.disabled || !option.actionIcon || !option.actionLabel) {
      return;
    }
    emit("optionAction", option.value);
    closeMenu();
  }

  function moveFocus(direction: 1 | -1): void {
    const currentIndex = optionElements.value.findIndex(
      (element) => element === document.activeElement
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : selectedEnabledIndex();
    focusOption(
      (baseIndex + direction + props.options.length) % props.options.length,
      direction
    );
  }

  function navigateMenu(event: KeyboardEvent): boolean {
    if (
      props.variant !== "menu" ||
      !["ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    emit("menuNavigate", event.key === "ArrowRight" ? 1 : -1);
    return true;
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (navigateMenu(event)) return;
    if (event.key === "Escape" && open.value) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void openMenu(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open.value) {
        closeMenu();
      } else {
        void openMenu(true);
      }
    }
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (navigateMenu(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(
        event.key === "Home" ? 0 : props.options.length - 1,
        event.key === "Home" ? 1 : -1
      );
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const row = target.closest<HTMLElement>(".popup-select-option-row");
        const option = row?.querySelector<HTMLButtonElement>(
          ".popup-select-option"
        );
        const action = row?.querySelector<HTMLButtonElement>(
          ".popup-select-option-action"
        );
        if (
          !event.shiftKey &&
          target === option &&
          action &&
          !action.disabled
        ) {
          event.preventDefault();
          action.focus();
          return;
        }
        if (event.shiftKey && target === action && option && !option.disabled) {
          event.preventDefault();
          option.focus();
          return;
        }
      }
      closeMenu(props.variant === "menu");
    }
  }

  function handleDocumentPointerdown(event: PointerEvent): void {
    const target = event.target;
    if (
      target instanceof Node &&
      !trigger.value?.contains(target) &&
      !menu.value?.contains(target)
    ) {
      closeMenu();
    }
  }

  function handleViewportChange(): void {
    if (open.value) {
      positionMenu();
    }
  }

  watch(
    () => [props.disabled, props.options.length] as const,
    ([disabled, optionCount]) => {
      if (disabled || optionCount === 0) {
        closeMenu();
      } else if (open.value) {
        nextTick(positionMenu);
      }
    }
  );

  onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerdown);
    window.addEventListener("resize", handleViewportChange);
    document.addEventListener("scroll", handleViewportChange, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerdown);
    window.removeEventListener("resize", handleViewportChange);
    document.removeEventListener("scroll", handleViewportChange, true);
  });

  return {
    openMenu,
    closeMenu,
    trigger,
    menu,
    open,
    menuStyle,
    menuId,
    selectedOption,
    displayLabel,
    isSelected,
    setOptionElement,
    toggleMenu,
    handleTriggerKeydown,
    handleMenuKeydown,
    selectOption,
    runOptionAction
  };
}
