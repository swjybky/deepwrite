<script setup lang="ts">
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
import AppIcon from "./AppIcon.vue";

export type PopupSelectValue = string | number;

export interface PopupSelectOption {
  value: PopupSelectValue;
  label: string;
  description?: string;
  disabled?: boolean;
  title?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: PopupSelectValue;
    options: readonly PopupSelectOption[];
    accessibleLabel: string;
    disabled?: boolean;
    placeholder?: string;
    variant?: "field" | "compact" | "preset";
    size?: "small" | "medium" | "large";
    align?: "start" | "end";
    menuMinWidth?: number;
    menuZIndex?: number;
  }>(),
  {
    disabled: false,
    placeholder: "请选择",
    variant: "field",
    size: "medium",
    align: "start",
    menuMinWidth: 190,
    menuZIndex: 1000
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: PopupSelectValue];
  change: [value: PopupSelectValue];
}>();

const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const optionElements = ref<Array<HTMLButtonElement | undefined>>([]);
const open = ref(false);
const menuStyle = ref<CSSProperties>({});
const menuId = createId("popup-select");

const selectedOption = computed(() =>
  props.options.find((option) => Object.is(option.value, props.modelValue))
);
const displayLabel = computed(() => selectedOption.value?.label ?? props.placeholder);

function setOptionElement(element: unknown, index: number): void {
  optionElements.value[index] = element instanceof HTMLButtonElement ? element : undefined;
}

function firstEnabledIndex(): number {
  return props.options.findIndex((option) => !option.disabled);
}

function selectedEnabledIndex(): number {
  const index = props.options.findIndex(
    (option) => Object.is(option.value, props.modelValue) && !option.disabled
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
    props.options.reduce((height, option) => height + (option.description ? 58 : 41), 12),
    320
  );
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportMargin);
  const spaceAbove = Math.max(0, rect.top - gap - viewportMargin);
  const opensUpward = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow;
  const availableHeight = opensUpward ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(72, Math.min(320, availableHeight));
  const renderedHeight = Math.min(estimatedHeight, maxHeight);
  const preferredLeft =
    props.align === "end" ? rect.right - minimumWidth : rect.left;
  const left = Math.min(
    Math.max(viewportMargin, preferredLeft),
    window.innerWidth - minimumWidth - viewportMargin
  );
  const top = opensUpward ? rect.top - gap - renderedHeight : rect.bottom + gap;

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

function focusOption(index: number): void {
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
    candidate = (candidate + 1 + props.options.length) % props.options.length;
  }
}

async function openMenu(focusSelection = false): Promise<void> {
  if (props.disabled || open.value || firstEnabledIndex() < 0) {
    return;
  }
  optionElements.value = [];
  open.value = true;
  await nextTick();
  positionMenu();
  if (focusSelection) {
    focusOption(selectedEnabledIndex());
  }
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
  if (!Object.is(option.value, props.modelValue)) {
    emit("update:modelValue", option.value);
    emit("change", option.value);
  }
  closeMenu(true);
}

function moveFocus(direction: 1 | -1): void {
  const currentIndex = optionElements.value.findIndex(
    (element) => element === document.activeElement
  );
  const baseIndex = currentIndex >= 0 ? currentIndex : selectedEnabledIndex();
  focusOption((baseIndex + direction + props.options.length) % props.options.length);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
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
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    focusOption(event.key === "Home" ? 0 : props.options.length - 1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return;
  }
  if (event.key === "Tab") {
    closeMenu();
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
</script>

<template>
  <span
    class="popup-select"
    :class="[`is-${variant}`, `is-${size}`, { 'is-open': open, 'is-disabled': disabled }]"
  >
    <button
      ref="trigger"
      class="popup-select-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="accessibleLabel"
      :aria-controls="open ? menuId : undefined"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span v-if="$slots.prefix" class="popup-select-prefix"><slot name="prefix" /></span>
      <span class="popup-select-label" :class="{ 'is-placeholder': !selectedOption }">
        {{ displayLabel }}
      </span>
      <AppIcon class="popup-select-chevron" name="chevron" :size="variant === 'compact' ? 11 : 13" />
    </button>

    <Teleport to="body">
      <Transition name="popup-select-menu">
        <div
          v-if="open"
          :id="menuId"
          ref="menu"
          class="popup-select-menu"
          :class="{ 'is-compact-menu': variant === 'compact' }"
          :style="menuStyle"
          role="listbox"
          :aria-label="accessibleLabel"
          @keydown="handleMenuKeydown"
        >
          <button
            v-for="(option, index) in options"
            :key="`${typeof option.value}:${option.value}`"
            :ref="(element) => setOptionElement(element, index)"
            class="popup-select-option"
            :class="{
              'is-selected': Object.is(option.value, modelValue),
              'has-description': Boolean(option.description)
            }"
            type="button"
            role="option"
            :aria-selected="Object.is(option.value, modelValue)"
            :disabled="option.disabled"
            :title="option.title"
            @click="selectOption(option)"
          >
            <span class="popup-select-option-copy">
              <span>{{ option.label }}</span>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <AppIcon
              v-if="Object.is(option.value, modelValue)"
              class="popup-select-check"
              name="check"
              :size="15"
            />
          </button>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.popup-select {
  position: relative;
  display: inline-flex;
  width: 100%;
  min-width: 0;
  vertical-align: middle;
}

.popup-select.is-compact {
  width: auto;
}

.popup-select-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 34px;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--theme-line, #d9d9d6);
  border-radius: 8px;
  outline: 0;
  background: var(--surface-main, #ffffff);
  color: var(--text-primary, #303338);
  font-family: var(--ui-font);
  font-size: 0.785714rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
}

.popup-select.is-small .popup-select-trigger {
  height: 30px;
}

.popup-select.is-large .popup-select-trigger {
  height: 38px;
  padding-right: 11px;
  padding-left: 11px;
  font-size: 0.857143rem;
}

.popup-select.is-preset .popup-select-trigger {
  height: 38px;
  border-radius: 11px;
  font-size: 1rem;
}

.popup-select.is-compact .popup-select-trigger {
  width: auto;
  height: 29px;
  gap: 5px;
  padding: 0 7px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary, #666a70);
  font-size: 0.75rem;
  white-space: nowrap;
}

.popup-select-trigger:hover:not(:disabled),
.popup-select.is-open .popup-select-trigger {
  border-color: color-mix(in srgb, var(--accent, #5b82b8) 55%, var(--theme-line, #d9d9d6));
  background: var(--surface-hover, #f0f0ee);
}

.popup-select:not(.is-compact).is-open .popup-select-trigger,
.popup-select:not(.is-compact) .popup-select-trigger:focus-visible {
  box-shadow: 0 0 0 3px var(--accent-soft, rgb(90 105 120 / 10%));
}

.popup-select.is-compact .popup-select-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent, #5b82b8) 55%, transparent);
  outline-offset: 1px;
}

.popup-select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.popup-select-prefix {
  display: inline-flex;
  flex: 0 0 auto;
  color: currentColor;
}

.popup-select-label {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popup-select-label.is-placeholder {
  color: var(--text-tertiary, #8b8f94);
}

.popup-select-chevron {
  flex: 0 0 auto;
  color: var(--text-tertiary, #8b8f94);
  transform: rotate(90deg);
  transition: transform 140ms ease;
}

.popup-select.is-open .popup-select-chevron {
  transform: rotate(-90deg);
}

.popup-select-menu {
  position: fixed;
  z-index: 1000;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--theme-line, #dededb);
  border-radius: 13px;
  background: color-mix(in srgb, var(--surface-raised, #fbfbfa) 96%, transparent);
  box-shadow: 0 18px 46px color-mix(in srgb, var(--theme-foreground) 16%, transparent),
    0 3px 10px color-mix(in srgb, var(--theme-foreground) 10%, transparent);
  backdrop-filter: blur(18px) saturate(1.15);
}

.popup-select-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 8px;
  outline: 0;
  background: transparent;
  color: var(--text-primary, #303338);
  font-size: 0.928571rem;
  font-weight: 560;
  line-height: 1.35;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.popup-select-option-copy {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.popup-select-option-copy > span {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
}

.popup-select-option-copy > small {
  overflow: hidden;
  color: var(--text-tertiary, #8b8f94);
  font-size: 0.785714rem;
  font-weight: 430;
  text-overflow: ellipsis;
}

.popup-select-option:hover:not(:disabled),
.popup-select-option:focus-visible {
  background: var(--surface-hover, #ececea);
  color: var(--text-primary, #17191c);
}

.popup-select-option.is-selected {
  background: var(--surface-selected, #e7e7e4);
}

.popup-select-option:disabled {
  color: var(--text-tertiary, #8b8f94);
  cursor: not-allowed;
  opacity: 0.62;
}

.popup-select-check {
  color: var(--accent, #5b82b8);
}

.popup-select-menu-enter-active,
.popup-select-menu-leave-active {
  transition: opacity 110ms ease, transform 110ms ease;
}

.popup-select-menu-enter-from,
.popup-select-menu-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.985);
}

:global(html[data-theme="dark"] .popup-select-menu) {
  box-shadow: 0 20px 52px color-mix(in srgb, var(--theme-foreground) 38%, transparent),
    0 3px 12px color-mix(in srgb, var(--theme-foreground) 28%, transparent);
}
</style>
