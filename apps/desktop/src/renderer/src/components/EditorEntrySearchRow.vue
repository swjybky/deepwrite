<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { EditorEntrySearchResult } from "../types/editorEntrySearch";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.editorEntrySearchRow");

defineProps<{
  query: string;
  results: readonly EditorEntrySearchResult[];
  activeIndex: number;
  pending: boolean;
  resultLabel: string;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  input: [];
  move: [direction: 1 | -1];
  select: [index?: number];
}>();

function updateQuery(event: Event): void {
  emit("update:query", (event.target as HTMLInputElement).value);
  emit("input");
}

function handleKeydown(event: KeyboardEvent): void {
  // Enter and arrows belong to the IME candidate list while composing.
  if (event.isComposing) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    emit("move", 1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    emit("move", -1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    emit("select");
  }
}
</script>

<template>
  <div class="entry-search-block">
    <div class="entry-search-row">
      <label class="entry-search-field">
        <AppIcon name="directory" :size="14" />
        <input
          :value="query"
          type="search"
          :aria-label="t('searchAllEntriesInThisStage')"
          :placeholder="t('searchAllEntries')"
          autocomplete="off"
          @input="updateQuery"
          @keydown="handleKeydown"
        />
        <span class="entry-search-count" aria-live="polite">
          {{ resultLabel }}
        </span>
      </label>
    </div>

    <div
      v-if="query.trim()"
      class="entry-search-results transient-scrollbar"
      role="listbox"
      :aria-label="t('entrySearchResults')"
    >
      <p v-if="pending" class="entry-search-status">
        {{ t("searchingAllEntries") }}
      </p>
      <p v-else-if="!results.length" class="entry-search-status">
        {{ t("noMatchingEntries") }}
      </p>
      <template v-else>
        <button
          v-for="(result, index) in results"
          :key="result.id"
          class="entry-search-result"
          :class="{ 'is-active': index === activeIndex }"
          type="button"
          role="option"
          :aria-selected="index === activeIndex"
          @mousedown.prevent
          @click="emit('select', index)"
        >
          <span class="entry-search-result-title">{{ result.title }}</span>
          <span v-if="result.detail" class="entry-search-result-detail">
            {{ result.detail }}
          </span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.entry-search-block {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.entry-search-row {
  display: flex;
  min-width: 0;
}

.entry-search-field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  height: 30px;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-tertiary);
}

.entry-search-field:focus-within {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--theme-line));
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.entry-search-field input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.75rem;
}

.entry-search-field input::-webkit-search-cancel-button {
  display: none;
}

.entry-search-field input::placeholder,
.entry-search-count,
.entry-search-result-detail,
.entry-search-status {
  color: var(--text-tertiary);
}

.entry-search-count {
  flex: 0 0 auto;
  font-size: 0.642857rem;
  white-space: nowrap;
}

.entry-search-results {
  display: grid;
  max-height: 210px;
  overflow: auto;
  padding: 3px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-main);
}

.entry-search-result {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.entry-search-result:hover,
.entry-search-result.is-active {
  background: var(--surface-hover);
}

.entry-search-result.is-active {
  box-shadow: inset 2px 0 0 var(--accent);
}

.entry-search-result-title,
.entry-search-result-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-search-result-title {
  font-size: 0.714286rem;
  font-weight: 600;
}

.entry-search-result-detail,
.entry-search-status {
  font-size: 0.642857rem;
}

.entry-search-status {
  margin: 0;
  padding: 9px 8px;
  text-align: center;
}
</style>
