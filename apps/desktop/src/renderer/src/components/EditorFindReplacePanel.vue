<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, onMounted } from "vue";
import type { EditorEntrySearchResult } from "../types/editorEntrySearch";
import AppIcon from "./AppIcon.vue";
import EditorEntrySearchRow from "./EditorEntrySearchRow.vue";
import { createEditorFindPanelInput } from "./editorFindPanelInput";

const t = createScopedTranslator("components.editorFindReplacePanel");

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
onMounted(async () => {
  await nextTick();
  findInput.value?.focus({ preventScroll: true });
  findInput.value?.select();
});
</script>

<template>
  <div
    ref="findPanelElement"
    class="editor-find-panel"
    role="dialog"
    :aria-label="
      findPanelMode === 'replace' ? t('findAndReplace') : t('findText')
    "
    @keydown.esc.stop="emit('close')"
  >
    <div class="editor-find-row">
      <label class="editor-find-field">
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
        <span class="editor-find-count" aria-live="polite">
          {{ searchResultLabel }}
        </span>
      </label>
      <button
        class="editor-find-icon-button is-previous"
        type="button"
        :aria-label="t('findPrevious')"
        :title="t('findPrevious')"
        @mousedown.prevent
        @click="emit('findMatch', -1)"
      >
        <AppIcon name="chevron" :size="14" />
      </button>
      <button
        class="editor-find-icon-button"
        type="button"
        :aria-label="t('findNext')"
        :title="t('findNext')"
        @mousedown.prevent
        @click="emit('findMatch', 1)"
      >
        <AppIcon name="chevron" :size="14" />
      </button>
      <button
        class="editor-find-icon-button"
        type="button"
        :aria-label="t('closeFind')"
        :title="t('close')"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <div v-if="findPanelMode === 'replace'" class="editor-replace-row">
      <label class="editor-find-field">
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
        class="editor-find-action"
        type="button"
        :disabled="currentReadOnly"
        @mousedown.prevent
        @click="emit('replaceCurrent')"
      >
        {{ t("replace") }}
      </button>
      <button
        class="editor-find-action"
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
