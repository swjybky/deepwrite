<script lang="ts">
export interface ExportChecklistItem {
  id: string;
  title: string;
  empty?: boolean;
}
export type ExportChecklistEntry =
  | ExportChecklistItem
  | { id: string; title: string; items: readonly ExportChecklistItem[] };
</script>

<script setup lang="ts">
import { computed, useId } from "vue";
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

const props = defineProps<{
  title: string;
  entries: readonly ExportChecklistEntry[];
  selectedIds: readonly string[];
  status?: string;
  disabled?: boolean;
  selectNonEmptyLabel?: string;
  clearLabel?: string;
}>();
const emit = defineEmits<{ "update:selectedIds": [ids: string[]] }>();

const t = createScopedTranslator("components.exportLongManuscriptChapterList");
const titleId = useId();
const items = computed(() =>
  props.entries.flatMap((entry) => ("items" in entry ? entry.items : [entry]))
);
const rows = computed(() =>
  props.entries.flatMap((entry) => {
    if ("items" in entry) {
      return [
        {
          ...entry,
          key: `group-${entry.id}`,
          ids: entry.items.map((item) => item.id),
          nested: false,
          empty: false
        },
        ...entry.items.map((item) => ({
          ...item,
          key: `item-${item.id}`,
          ids: [item.id],
          nested: true
        }))
      ];
    }
    return [
      { ...entry, key: `item-${entry.id}`, ids: [entry.id], nested: false }
    ];
  })
);
const selected = computed(() => new Set(props.selectedIds));
const count = computed(
  () => items.value.filter((item) => selected.value.has(item.id)).length
);
const allSelected = computed(
  () => items.value.length > 0 && count.value === items.value.length
);

function checkedCount(ids: readonly string[]): number {
  return ids.filter((id) => selected.value.has(id)).length;
}

function toggle(ids: readonly string[], event: Event): void {
  const { checked } = event.target as HTMLInputElement;
  const group = new Set(ids);
  emit(
    "update:selectedIds",
    checked
      ? [...new Set([...props.selectedIds, ...ids])]
      : props.selectedIds.filter((id) => !group.has(id))
  );
}
</script>

<template>
  <section class="export-checklist" :aria-labelledby="titleId">
    <div class="export-checklist-heading">
      <h3 :id="titleId" class="export-section-title">{{ title }}</h3>
      <span class="export-checklist-badge" aria-live="polite">{{
        t("selectionCount", { count, total: items.length })
      }}</span>
      <div class="export-checklist-actions">
        <button
          v-if="selectNonEmptyLabel"
          type="button"
          :disabled="disabled || !items.length"
          @click="
            emit(
              'update:selectedIds',
              items.filter((item) => !item.empty).map((item) => item.id)
            )
          "
        >
          {{ selectNonEmptyLabel }}
        </button>
        <button
          type="button"
          :disabled="disabled || !items.length"
          @click="
            emit(
              'update:selectedIds',
              allSelected && !clearLabel ? [] : items.map((item) => item.id)
            )
          "
        >
          {{ t(allSelected && !clearLabel ? "deselectAll" : "selectAll") }}
        </button>
        <button
          v-if="clearLabel"
          type="button"
          :disabled="disabled"
          @click="emit('update:selectedIds', [])"
        >
          {{ clearLabel }}
        </button>
      </div>
    </div>

    <p v-if="status" class="export-checklist-status">{{ status }}</p>
    <div
      v-else
      class="export-checklist-panel transient-scrollbar"
      role="group"
      :aria-labelledby="titleId"
    >
      <label
        v-for="row in rows"
        :key="row.key"
        class="export-checklist-row"
        :class="{ 'is-group': 'items' in row, 'is-nested': row.nested }"
      >
        <input
          type="checkbox"
          :value="row.id"
          :disabled="disabled || !row.ids.length"
          :checked="
            row.ids.length > 0 && checkedCount(row.ids) === row.ids.length
          "
          :indeterminate.prop="
            checkedCount(row.ids) > 0 && checkedCount(row.ids) < row.ids.length
          "
          @change="toggle(row.ids, $event)"
        />
        <AppIcon v-if="'items' in row" name="folder" :size="15" />
        <span>{{ row.title }}</span>
        <small
          v-if="'items' in row || row.empty"
          class="export-checklist-badge"
        >
          {{ "items" in row ? row.ids.length : t("empty") }}
        </small>
      </label>
    </div>
  </section>
</template>

<style scoped>
.export-checklist {
  display: grid;
  gap: 7px;
}
.export-checklist-heading,
.export-checklist-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.export-checklist-actions {
  margin-inline-start: auto;
}
.export-checklist-actions button {
  padding: 2px;
  color: var(--accent);
  background: none;
  font-size: 0.785714rem;
  cursor: pointer;
}
.export-checklist-actions button:enabled:hover {
  text-decoration: underline;
}
.export-checklist-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.export-checklist-badge {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.714286rem;
  white-space: nowrap;
}
.export-checklist-panel {
  max-height: 245px;
  overflow-y: auto;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
}
.export-checklist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 10px;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  cursor: pointer;
}
.export-checklist-row + .export-checklist-row {
  border-top: 1px solid var(--theme-line-soft);
}
.export-checklist-row:hover {
  background: var(--surface-muted);
}
.export-checklist-row.is-group {
  background: var(--surface-raised);
  color: var(--text-primary);
  font-weight: 600;
}
.export-checklist-row.is-nested {
  padding-inline-start: 34px;
}
.export-checklist-row svg,
.export-checklist-row input {
  flex: none;
}
.export-checklist-row input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
}
.export-checklist-row .export-checklist-badge {
  margin-inline-start: auto;
  font-weight: 400;
}
.export-checklist-status {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.857143rem;
}
</style>
