<script setup lang="ts">
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.longContinuityLedgerNavigation");
export interface LongContinuityLedgerNavigationItem {
  id: string;
  label: string;
}

defineProps<{
  mode: "top-tabs" | "right-list";
  title: string;
  items: LongContinuityLedgerNavigationItem[];
  activeFileId: string | null;
  pendingFileId: string | null;
}>();

const emit = defineEmits<{
  selectFile: [fileId: string];
}>();
</script>

<template>
  <div
    v-if="mode === 'top-tabs'"
    class="draft-file-tabs"
    role="tablist"
    :aria-label="t('valueFile', { arg0: title })"
  >
    <button
      v-for="file in items"
      :key="file.id"
      type="button"
      role="tab"
      :aria-selected="activeFileId === file.id"
      :aria-busy="pendingFileId === file.id"
      :class="{
        'is-active': activeFileId === file.id,
        'is-loading': pendingFileId === file.id
      }"
      @click="emit('selectFile', file.id)"
    >
      {{ file.label }}
    </button>
  </div>

  <aside
    v-else
    class="long-story-plot-pane long-entry-list-pane long-continuity-ledger-list"
    :aria-label="t('continuityLedgerFiles')"
  >
    <header>
      <div>
        <strong>{{ t("chapterRecords") }}</strong>
        <span>{{ items.length }}</span>
      </div>
    </header>
    <div class="long-story-plot-list" role="list">
      <article
        v-for="(file, index) in items"
        :key="file.id"
        class="long-story-plot-card"
        :class="{
          'is-active': activeFileId === file.id,
          'is-loading': pendingFileId === file.id
        }"
        role="listitem"
      >
        <button
          class="long-story-plot-card-main"
          type="button"
          :aria-pressed="activeFileId === file.id"
          :aria-busy="pendingFileId === file.id"
          :title="file.label"
          @click="emit('selectFile', file.id)"
        >
          <span class="long-story-plot-card-order">{{ index + 1 }}</span>
          <span class="long-story-plot-card-title">{{ file.label }}</span>
        </button>
      </article>
    </div>
  </aside>
</template>

<style scoped>
.long-story-plot-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-story-plot-pane > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.long-story-plot-pane > header > div {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
}

.long-story-plot-pane > header strong {
  color: var(--text-primary);
  font-size: 0.75rem;
}

.long-story-plot-pane > header span {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-story-plot-list {
  min-height: 0;
  padding: 6px;
  overflow-y: auto;
}

.long-story-plot-card {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 7px;
}

.long-story-plot-card + .long-story-plot-card {
  margin-top: 3px;
}

.long-story-plot-card:hover,
.long-story-plot-card.is-active {
  background: var(--surface-hover);
}

.long-story-plot-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 24%, var(--theme-line));
  background: var(--surface-selected);
}

.long-story-plot-card.is-loading {
  opacity: 0.7;
}

.long-story-plot-card-main {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 5px;
  padding: 7px 8px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.long-story-plot-card-order {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.long-story-plot-card-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.714286rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
