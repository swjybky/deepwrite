<script lang="ts">
import type { IconName } from "../../types/workspace";

export interface ExportOption<T extends string> {
  id: T;
  label: string;
  description?: string;
  icon?: IconName;
  wide?: boolean;
  badge?: string;
}
</script>

<script setup lang="ts" generic="T extends string">
import { useId } from "vue";
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

const props = defineProps<{
  title?: string;
  options: readonly ExportOption<T>[];
  modelValue?: T;
  selected?: readonly T[];
  compact?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [id: T];
  "update:selected": [ids: T[]];
}>();
const groupName = useId();
const t = createScopedTranslator("components.exportShortManuscriptDialog");

function isSelected(id: T): boolean {
  return props.selected ? props.selected.includes(id) : props.modelValue === id;
}

function change(id: T, event: Event): void {
  if (props.disabled) return;
  if (!props.selected) {
    emit("update:modelValue", id);
    return;
  }
  const { checked } = event.target as HTMLInputElement;
  emit(
    "update:selected",
    checked
      ? [...props.selected, id]
      : props.selected.filter((item) => item !== id)
  );
}
</script>

<template>
  <fieldset
    class="export-option-cards"
    :class="{ 'is-compact': compact }"
    :disabled="disabled"
  >
    <legend class="export-section-title">
      {{ title ?? t("selectExportFormat") }}
    </legend>
    <div class="export-option-grid">
      <label
        v-for="option in options"
        :key="option.id"
        class="export-option-card"
        :class="{
          'is-selected': isSelected(option.id),
          'is-wide': option.wide
        }"
      >
        <input
          :type="selected ? 'checkbox' : 'radio'"
          :name="groupName"
          :value="option.id"
          :checked="isSelected(option.id)"
          @change="change(option.id, $event)"
        />
        <span v-if="!compact" class="export-option-icon">
          <AppIcon :name="option.icon ?? 'file'" :size="20" />
        </span>
        <span class="export-option-copy">
          <strong
            >{{ option.label }}
            <span
              v-if="option.badge"
              class="export-option-badge"
              aria-live="polite"
              >{{ option.badge }}</span
            ></strong
          >
          <small v-if="option.description">{{ option.description }}</small>
        </span>
        <span v-if="!compact" class="export-option-check" aria-hidden="true"
          >✓</span
        >
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.export-option-cards {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.export-option-cards legend {
  margin-bottom: 7px;
  padding: 0;
}
.export-option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.export-option-card {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 9px 25px 9px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  cursor: pointer;
}
.export-option-card.is-wide {
  grid-column: 1 / -1;
}
.export-option-card:hover {
  background: var(--surface-muted);
}
.export-option-card.is-selected {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--theme-line));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-main));
}
.export-option-card:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.export-option-cards:disabled .export-option-card {
  cursor: not-allowed;
}
.export-option-card input {
  margin: 0;
  accent-color: var(--accent);
}
.export-option-cards:not(.is-compact) input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.export-option-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.is-selected .export-option-icon {
  background: var(--accent-soft);
  color: var(--accent);
}
.export-option-copy {
  display: grid;
  gap: 2px;
}
.export-option-copy strong {
  color: var(--text-primary);
  font-size: 0.892857rem;
  font-weight: 600;
}
.export-option-copy small,
.export-option-badge {
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.45;
}
.export-option-badge {
  margin-inline-start: 4px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--surface-muted);
  font-weight: 400;
  box-decoration-break: clone;
}
.export-option-check {
  position: absolute;
  inset: 6px 9px auto auto;
  visibility: hidden;
  color: var(--accent);
  font-size: 0.785714rem;
}
.is-selected .export-option-check {
  visibility: visible;
}
.is-compact .export-option-card {
  grid-template-columns: 15px minmax(0, 1fr);
  padding: 8px 10px;
}
.is-compact input {
  width: 15px;
  height: 15px;
}
.is-compact .export-option-copy {
  display: block;
}
.is-compact .export-option-copy small {
  margin-inline-start: 5px;
}
@media (max-width: 680px) {
  .export-option-cards:not(.is-compact) .export-option-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
