<script setup lang="ts">
import { computed } from "vue";
import PopupSelect from "./PopupSelect.vue";
import { sharingT } from "./librarySharingLabels";

export interface BookBindingsPickerItem {
  id: string;
  title: string;
  tag?: string | undefined;
  meta?: string | undefined;
  checked?: boolean;
  indeterminate?: boolean;
}

export interface BookBindingsPickerSection {
  id: "group" | "library" | "entry";
  label?: string;
  note?: string;
  items: readonly BookBindingsPickerItem[];
  emptyText: string;
}

const props = defineProps<{
  label: string;
  items: readonly BookBindingsPickerItem[];
  selected: ReadonlySet<string>;
  emptyText: string;
  sections?: readonly BookBindingsPickerSection[] | undefined;
  loading?: boolean;
  search?: string | undefined;
  searchPlaceholder?: string | undefined;
  tag?: string | undefined;
  tagOptions?: readonly { value: string; label: string }[] | undefined;
}>();
const emit = defineEmits<{
  toggle: [id: string];
  toggleGroup: [id: string];
  "update:search": [value: string];
  "update:tag": [value: string];
}>();

const listSections = computed<readonly BookBindingsPickerSection[]>(
  () =>
    props.sections ?? [
      { id: "library", items: props.items, emptyText: props.emptyText }
    ]
);

function updateSearch(event: Event): void {
  emit("update:search", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="book-bindings-picker">
    <div v-if="search !== undefined" class="lib-picker-toolbar">
      <input
        :value="search"
        class="lib-picker-search-input"
        type="search"
        autocomplete="off"
        :placeholder="
          searchPlaceholder ?? sharingT('searchLibrariesPlaceholder')
        "
        :aria-label="
          searchPlaceholder ?? sharingT('searchLibrariesPlaceholder')
        "
        :disabled="loading"
        @input="updateSearch"
      />
      <PopupSelect
        v-if="tagOptions"
        :model-value="tag ?? ''"
        :options="tagOptions"
        :accessible-label="sharingT('filterByTag')"
        size="large"
        :disabled="loading"
        :menu-min-width="160"
        @update:model-value="emit('update:tag', String($event))"
      />
    </div>

    <div
      v-if="sections || items.length"
      class="lib-picker-list book-bindings-list"
      role="group"
      :aria-label="label"
    >
      <div
        v-for="section in listSections"
        :key="section.id"
        class="book-bindings-list-section"
        :role="section.label ? 'group' : undefined"
        :aria-label="section.label"
      >
        <h4 v-if="section.label" class="book-bindings-list-heading">
          {{ section.label }}
        </h4>
        <p v-if="section.note" class="book-bindings-list-note">
          {{ section.note }}
        </p>
        <p v-if="!section.items.length" class="book-bindings-list-note">
          {{ section.emptyText }}
        </p>
        <component
          :is="section.id === 'entry' ? 'div' : 'label'"
          v-for="item in section.items"
          :key="item.id"
          class="lib-picker-row"
          :class="{
            'is-checked': item.checked ?? selected.has(item.id),
            'book-bindings-reference-row': section.id === 'entry'
          }"
        >
          <span class="lib-picker-row-main">
            <input
              v-if="section.id !== 'entry'"
              type="checkbox"
              :checked="item.checked ?? selected.has(item.id)"
              :indeterminate="item.indeterminate ?? false"
              :disabled="loading"
              @change="
                section.id === 'group'
                  ? emit('toggleGroup', item.id)
                  : emit('toggle', item.id)
              "
            />
            <span class="lib-picker-row-title" :title="item.title">{{
              item.title
            }}</span>
          </span>
          <span v-if="item.tag || item.meta" class="lib-picker-row-meta">
            <span v-if="item.tag" class="lib-picker-tag-badge">{{
              item.tag
            }}</span>
            <span v-if="item.meta" class="lib-picker-entry-count">{{
              item.meta
            }}</span>
          </span>
        </component>
      </div>
    </div>
    <p v-else class="lib-picker-empty">{{ emptyText }}</p>
  </div>
</template>

<style scoped src="./library-sharing-picker.css"></style>
<style scoped>
.book-bindings-picker {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.book-bindings-list {
  flex: 0 1 auto;
  max-height: none;
  min-height: 0;
}
.book-bindings-list-section {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.book-bindings-list-section + .book-bindings-list-section {
  padding-top: 6px;
  border-top: 1px solid var(--theme-line);
}
.book-bindings-list-heading,
.book-bindings-list-note {
  margin: 0;
  padding-inline: 10px;
  font-size: 0.785714rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.book-bindings-list-heading {
  padding-top: 4px;
  color: var(--text-secondary);
  font-weight: 600;
}
.book-bindings-list-note {
  padding-bottom: 3px;
  color: var(--text-tertiary);
}
.lib-picker-row.book-bindings-reference-row {
  background: var(--surface-main);
  cursor: default;
}
.book-bindings-list .lib-picker-row.is-checked {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--theme-line));
  background: var(--accent-soft);
}
.book-bindings-list .lib-picker-row.is-checked .lib-picker-row-title {
  font-weight: 650;
}
</style>
