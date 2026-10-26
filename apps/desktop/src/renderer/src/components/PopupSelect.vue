<script setup lang="ts">
import { t } from "../i18n";
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { usePopupSelect } from "../composables/usePopupSelect";
import type { PopupSelectValue, PopupSelectOption } from "../types/popupSelect";
export type { PopupSelectValue, PopupSelectOption } from "../types/popupSelect";
const props = withDefaults(
  defineProps<{
    modelValue: PopupSelectValue;
    options: readonly PopupSelectOption[];
    accessibleLabel: string;
    disabled?: boolean;
    placeholder?: string;
    variant?: "field" | "compact" | "preset" | "menu";
    size?: "small" | "medium" | "large";
    align?: "start" | "end";
    menuMinWidth?: number;
    menuMaxHeight?: number;
    menuZIndex?: number;
    multiple?: boolean;
    selectedValues?: readonly PopupSelectValue[];
    /** Trigger text for a multiple selection; defaults to a model count. */
    selectedSummary?: string;
  }>(),
  {
    disabled: false,
    placeholder: "",
    variant: "field",
    size: "medium",
    align: "start",
    menuMinWidth: 190,
    menuMaxHeight: 320,
    menuZIndex: 1000,
    multiple: false,
    selectedValues: () => [],
    selectedSummary: ""
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: PopupSelectValue];
  change: [value: PopupSelectValue];
  menuNavigate: [direction: 1 | -1];
  optionAction: [value: PopupSelectValue];
  "update:selectedValues": [values: PopupSelectValue[]];
}>();

const optionGroups = computed(() => {
  const groups: Array<{
    group: PopupSelectOption["group"];
    options: Array<{ option: PopupSelectOption; index: number }>;
  }> = [];
  for (const [index, option] of props.options.entries()) {
    let group = groups.at(-1);
    if (!group || group.group?.key !== option.group?.key) {
      group = { group: option.group, options: [] };
      groups.push(group);
    }
    group.options.push({ option, index });
  }
  return groups;
});

const {
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
} = usePopupSelect(props, emit);
defineExpose({ openMenu, closeMenu, trigger, open });
</script>

<template>
  <span
    class="popup-select"
    :class="[
      `is-${variant}`,
      `is-${size}`,
      { 'is-open': open, 'is-disabled': disabled }
    ]"
  >
    <button
      ref="trigger"
      class="popup-select-trigger"
      type="button"
      :role="variant === 'menu' ? 'menuitem' : 'combobox'"
      :aria-haspopup="
        variant === 'menu' ? 'menu' : $slots.footer ? 'dialog' : 'listbox'
      "
      :aria-label="accessibleLabel"
      :aria-controls="open ? menuId : undefined"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span v-if="$slots.prefix" class="popup-select-prefix"
        ><slot name="prefix"
      /></span>
      <span
        class="popup-select-label"
        :class="{ 'is-placeholder': !selectedOption }"
        :style="selectedOption?.style"
      >
        {{ displayLabel || t("components.popupSelect.select") }}
      </span>
      <AppIcon
        v-if="variant !== 'menu'"
        class="popup-select-chevron"
        name="chevron"
        :size="variant === 'compact' ? 11 : 13"
      />
    </button>

    <Teleport to="body">
      <Transition name="popup-select-menu">
        <div
          v-if="open"
          :id="menuId"
          ref="menu"
          class="popup-select-menu"
          :class="{
            'is-compact-menu': variant === 'compact',
            'has-groups': optionGroups.some((group) => group.group)
          }"
          :style="menuStyle"
          :role="
            variant === 'menu' ? 'menu' : $slots.footer ? undefined : 'listbox'
          "
          :aria-label="accessibleLabel"
          :aria-multiselectable="!$slots.footer && multiple ? true : undefined"
          @keydown="handleMenuKeydown"
        >
          <div
            :role="$slots.footer ? 'listbox' : undefined"
            :aria-label="$slots.footer ? accessibleLabel : undefined"
            :aria-multiselectable="$slots.footer && multiple ? true : undefined"
          >
            <div
              v-for="(group, groupIndex) in optionGroups"
              :key="groupIndex"
              class="popup-select-option-group"
              :class="{ 'has-label': group.group }"
              :role="group.group ? 'group' : 'presentation'"
              :aria-label="group.group?.label"
            >
              <div
                v-if="group.group"
                class="popup-select-group-label"
                aria-hidden="true"
              >
                {{ group.group.label }}
              </div>
              <div
                v-for="{ option, index } in group.options"
                :key="`${typeof option.value}:${option.value}`"
                class="popup-select-option-row"
                :class="{
                  'has-action': Boolean(option.actionIcon && option.actionLabel)
                }"
                role="presentation"
              >
                <button
                  :ref="(element) => setOptionElement(element, index)"
                  class="popup-select-option"
                  :class="{
                    'is-selected': isSelected(option.value),
                    'has-description': Boolean(option.description)
                  }"
                  type="button"
                  :role="variant === 'menu' ? 'menuitem' : 'option'"
                  :aria-selected="
                    variant === 'menu' ? undefined : isSelected(option.value)
                  "
                  :disabled="option.disabled"
                  :title="option.title"
                  :style="option.style"
                  @click="selectOption(option)"
                >
                  <span class="popup-select-option-copy">
                    <span>{{ option.label }}</span>
                    <small v-if="option.description">{{
                      option.description
                    }}</small>
                  </span>
                  <span
                    v-if="multiple"
                    class="popup-select-checkbox"
                    :class="{ 'is-checked': isSelected(option.value) }"
                    aria-hidden="true"
                  >
                    <AppIcon
                      v-if="isSelected(option.value)"
                      name="check"
                      :size="12"
                    />
                  </span>
                  <AppIcon
                    v-else-if="isSelected(option.value)"
                    class="popup-select-check"
                    name="check"
                    :size="15"
                  />
                </button>
                <button
                  v-if="option.actionIcon && option.actionLabel"
                  class="popup-select-option-action"
                  type="button"
                  :aria-label="option.actionLabel"
                  :title="option.actionLabel"
                  :disabled="option.disabled"
                  @click.stop="runOptionAction(option)"
                >
                  <AppIcon :name="option.actionIcon" :size="15" />
                </button>
              </div>
            </div>
          </div>
          <div v-if="$slots.footer" class="popup-select-footer">
            <slot name="footer" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped src="../styles/popup-select.css"></style>
<style scoped src="../styles/popup-select-groups.css"></style>
