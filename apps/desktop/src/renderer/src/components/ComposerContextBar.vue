<script setup lang="ts">
import type { IconName } from "../types/workspace";
import { createScopedTranslator } from "../i18n";
import { defineAsyncComponent, inject, ref, shallowRef } from "vue";
import {
  COMPOSER_CONTEXT_NAVIGATION,
  type ComposerContextNavigation
} from "../composables/composerContextNavigationContext";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.composerContextBar");
const ComposerContextMenu = defineAsyncComponent(
  () => import("./ComposerContextMenu.vue")
);
defineProps<{
  bookTitle: string;
  stageLabel: string;
  stageIcon?: IconName | undefined;
  responding: boolean;
}>();
const source = inject(COMPOSER_CONTEXT_NAVIGATION, null);
const navigation = shallowRef<ComposerContextNavigation | null>(null);
const loading = ref(false);
const anchor = shallowRef<HTMLElement>();
async function show(kind: "book" | "stage", event: MouseEvent): Promise<void> {
  if (open.value === kind) {
    open.value = null;
    return;
  }
  anchor.value = event.currentTarget as HTMLElement;
  if (!source || loading.value) return;
  loading.value = true;
  try {
    navigation.value = await source.load();
    if (navigation.value) open.value = kind;
  } finally {
    loading.value = false;
  }
}
const open = ref<"book" | "stage" | null>(null);
async function select(id: string): Promise<void> {
  if (
    navigation.value &&
    open.value &&
    (await navigation.value.select(open.value, id))
  )
    open.value = null;
}
</script>
<template>
  <div
    class="composer-context-bar"
    role="group"
    :aria-label="
      t('currentlyLinkedBookValueStageValue', {
        arg0: bookTitle,
        arg1: stageLabel
      })
    "
  >
    <button
      v-for="kind in ['book', 'stage'] as const"
      :key="kind"
      class="composer-context-item"
      :class="`composer-${kind}-context`"
      type="button"
      :title="
        kind === 'book'
          ? t('chooseABookOrLibrary')
          : t('chooseAStageInTheCurrentBook')
      "
      :aria-label="
        t('valueCurrentValue', {
          arg0: kind === 'book' ? t('chooseABookOrLibrary') : t('selectStage'),
          arg1: kind === 'book' ? bookTitle : stageLabel
        })
      "
      aria-haspopup="dialog"
      :aria-busy="loading"
      :aria-expanded="open === kind"
      :disabled="
        !source ||
        responding ||
        navigation?.busy.value ||
        (kind === 'stage' && !source.available.value)
      "
      @click="show(kind, $event)"
    >
      <AppIcon
        :name="kind === 'book' ? 'book' : (stageIcon ?? 'wand')"
        :size="16"
      />
      <strong>{{ kind === "book" ? bookTitle : stageLabel }}</strong>
      <AppIcon class="context-chevron" name="chevron" :size="12" />
    </button>
  </div>
  <ComposerContextMenu
    v-if="open && navigation && anchor"
    :key="open"
    :anchor="anchor"
    :kind="open"
    :book-title="bookTitle"
    :library="navigation.currentBook.value?.catalogNodeType === 'library'"
    :options="
      open === 'book' ? navigation.books.value : navigation.stages.value
    "
    :busy="navigation.busy.value"
    @select="select"
    @close="open = null"
  />
</template>
<style scoped>
.composer-context-bar {
  gap: 8px;
  padding: 0 6px;
}
.composer-context-item {
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  font-family: var(--ui-font);
  cursor: pointer;
  transition:
    background 120ms,
    border-color 120ms,
    transform 120ms;
}
.composer-context-item:hover:not(:disabled),
.composer-context-item[aria-expanded="true"] {
  background: var(--surface-hover);
  border-color: var(--theme-line);
}
.composer-context-item:active:not(:disabled) {
  transform: translateY(1px);
  background: var(--surface-selected);
}
.composer-context-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.composer-context-item:disabled {
  cursor: default;
  opacity: 0.6;
}
.composer-context-item .context-chevron {
  color: var(--text-tertiary);
}
.composer-stage-context {
  flex: 0 1 auto;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .composer-context-item {
    transition: none;
  }
}
</style>
