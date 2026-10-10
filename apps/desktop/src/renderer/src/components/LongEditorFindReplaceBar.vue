<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { EditorEntrySearchResult } from "../types/editorEntrySearch";
import AppIcon from "./AppIcon.vue";
import EditorEntrySearchRow from "./EditorEntrySearchRow.vue";
import { createEditorFindPanelInput } from "./editorFindPanelInput";

const t = createScopedTranslator("components.longEditorFindReplaceBar");

defineProps<{
  findPanelMode: "find" | "replace";
  searchQuery: string;
  replacementText: string;
  searchResultLabel: string;
  currentReadOnly: boolean;
  entrySearchQuery: string;
  entrySearchResults: readonly EditorEntrySearchResult[];
  activeEntrySearchIndex: number;
  entrySearchPending: boolean;
  entrySearchResultLabel: string;
}>();

const emit = defineEmits<{
  "update:searchQuery": [value: string];
  "update:replacementText": [value: string];
  "update:entrySearchQuery": [value: string];
  findInput: [];
  findMatch: [direction: 1 | -1];
  close: [];
  replaceCurrent: [];
  replaceAll: [];
  entrySearchInput: [];
  moveEntrySearch: [direction: 1 | -1];
  selectEntrySearch: [index?: number];
}>();

const findPanelElement = defineModel<HTMLElement | null>("findPanelElement", {
  default: null
});
const findInput = defineModel<HTMLInputElement | null>("findInput", {
  default: null
});
const {
  handleQueryInput,
  handleQueryCompositionEnd,
  handleQueryEnter,
  handleReplacementEnter
} = createEditorFindPanelInput({
  updateQuery: (value) => emit("update:searchQuery", value),
  search: () => emit("findInput"),
  findMatch: (direction) => emit("findMatch", direction),
  replaceCurrent: () => emit("replaceCurrent")
});
</script>

<template>
  <div
    ref="findPanelElement"
    class="long-editor-find-panel"
    role="dialog"
    :aria-label="
      findPanelMode === 'replace' ? t('findAndReplace') : t('findText')
    "
    @keydown.esc.stop="emit('close')"
  >
    <div class="long-editor-find-row">
      <label class="long-editor-find-field">
        <AppIcon name="search" :size="14" />
        <input
          ref="findInput"
          :value="searchQuery"
          type="text"
          :aria-label="t('findText')"
          :placeholder="t('find')"
          @input="handleQueryInput"
          @compositionend="handleQueryCompositionEnd"
          @keydown.enter="handleQueryEnter"
        />
        <span class="long-editor-find-count" aria-live="polite">
          {{ searchResultLabel }}
        </span>
      </label>
      <button
        class="long-editor-find-icon-button is-previous"
        type="button"
        :aria-label="t('findPrevious')"
        :title="t('findPrevious')"
        @mousedown.prevent
        @click="emit('findMatch', -1)"
      >
        <AppIcon name="chevron" :size="14" />
      </button>
      <button
        class="long-editor-find-icon-button"
        type="button"
        :aria-label="t('findNext')"
        :title="t('findNext')"
        @mousedown.prevent
        @click="emit('findMatch', 1)"
      >
        <AppIcon name="chevron" :size="14" />
      </button>
      <button
        class="long-editor-find-icon-button"
        type="button"
        :aria-label="t('closeFind')"
        :title="t('close')"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div v-if="findPanelMode === 'replace'" class="long-editor-replace-row">
      <label class="long-editor-find-field">
        <AppIcon name="replace" :size="14" />
        <input
          :value="replacementText"
          type="text"
          :aria-label="t('replaceWith')"
          :placeholder="t('replaceWith')"
          :disabled="currentReadOnly"
          @input="
            emit(
              'update:replacementText',
              ($event.target as HTMLInputElement).value
            )
          "
          @keydown.enter="handleReplacementEnter"
        />
      </label>
      <button
        class="long-editor-find-action"
        type="button"
        :disabled="currentReadOnly"
        @mousedown.prevent
        @click="emit('replaceCurrent')"
      >
        {{ t("replace") }}
      </button>
      <button
        class="long-editor-find-action"
        type="button"
        :disabled="currentReadOnly"
        @mousedown.prevent
        @click="emit('replaceAll')"
      >
        {{ t("all") }}
      </button>
    </div>
    <EditorEntrySearchRow
      :query="entrySearchQuery"
      :results="entrySearchResults"
      :active-index="activeEntrySearchIndex"
      :pending="entrySearchPending"
      :result-label="entrySearchResultLabel"
      @update:query="emit('update:entrySearchQuery', $event)"
      @input="emit('entrySearchInput')"
      @move="emit('moveEntrySearch', $event)"
      @select="emit('selectEntrySearch', $event)"
    />
  </div>
</template>

<style scoped>
.long-editor-text-tools {
  position: static;
}

.long-story-plot-text-toolbar {
  position: relative;
}

.long-editor-find-panel {
  position: absolute;
  z-index: 100;
  top: calc(100% + 8px);
  right: 13px;
  display: grid;
  width: min(350px, calc(100% - 26px));
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-raised);
  box-shadow:
    0 12px 30px rgb(24 27 30 / 16%),
    0 2px 7px rgb(24 27 30 / 8%);
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.long-editor-find-row,
.long-editor-replace-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
}

.long-editor-find-field {
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

.long-editor-find-field:focus-within {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--theme-line));
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.long-editor-find-field input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.75rem;
}

.long-editor-find-field input::placeholder {
  color: var(--text-tertiary);
}

.long-editor-find-count {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  white-space: nowrap;
}

.long-editor-find-icon-button,
.long-editor-find-action {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-editor-find-icon-button {
  width: 26px;
}

.long-editor-find-icon-button:hover,
.long-editor-find-action:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-find-icon-button.is-previous svg {
  transform: rotate(180deg);
}

.long-editor-find-action {
  padding: 0 9px;
  border: 1px solid var(--theme-line);
  background: var(--surface-main);
  font-size: 0.714286rem;
  font-weight: 560;
}

.long-editor-find-action:disabled,
.long-editor-find-field input:disabled {
  cursor: default;
  opacity: 0.45;
}

.long-story-plot-text-toolbar .long-editor-find-panel {
  right: 0;
  left: auto;
}

@container (max-width: 27rem) {
  .long-editor-find-panel {
    right: 8px;
  }
}
</style>
