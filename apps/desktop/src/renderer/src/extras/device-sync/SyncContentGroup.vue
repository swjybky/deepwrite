<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { computed, nextTick, ref, useId } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import type { SyncScopeRow } from "./presentation";

const t = createScopedTranslator("extras");

const props = defineProps<{
  title: string;
  items: SyncScopeRow[];
  note?: string | undefined;
}>();
const emit = defineEmits<{
  toggle: [key: string, included: boolean];
  toggleMany: [keys: string[], included: boolean];
}>();
const expanded = ref(false);
const listId = useId();
const included = computed(
  () => props.items.filter((item) => item.included).length
);
const allIncluded = computed(
  () => props.items.length > 0 && props.items.every((item) => item.included)
);
const partlyIncluded = computed(() => included.value > 0 && !allIncluded.value);
function itemStatus(item: SyncScopeRow): string {
  if (!item.included) return t("deviceSync.syncPaused");
  if (item.dirty && item.remoteDirty) return t("deviceSync.bothChanged");
  if (item.dirty) return t("deviceSync.awaitingUpload");
  if (item.remoteDirty) return t("deviceSync.awaitingDownload");
  return t("deviceSync.synced");
}
// A native checkbox flips itself on click. Report the request, then pin the DOM back to
// the data once the parent has updated it, so a rejected change never stays on screen.
function changeItem(key: string, event: Event) {
  const input = event.target as HTMLInputElement;
  emit("toggle", key, input.checked);
  void nextTick(() => {
    input.checked =
      props.items.find((item) => item.key === key)?.included ?? false;
  });
}
function changeAll(event: Event) {
  const input = event.target as HTMLInputElement;
  const target = !allIncluded.value;
  const keys = props.items
    .filter((item) => item.included !== target)
    .map((item) => item.key);
  if (keys.length) emit("toggleMany", keys, target);
  void nextTick(() => {
    input.checked = allIncluded.value;
    input.indeterminate = partlyIncluded.value;
  });
}
</script>

<template>
  <section class="sync-content-group" :aria-label="title">
    <header class="sync-content-heading">
      <h3>
        <button
          type="button"
          class="sync-content-toggle"
          :aria-expanded="expanded"
          :aria-controls="listId"
          :aria-label="
            t(
              expanded ? 'deviceSync.collapseGroup' : 'deviceSync.expandGroup',
              { category: title }
            )
          "
          @click="expanded = !expanded"
        >
          <span class="sync-content-chevron" :class="{ 'is-open': expanded }">
            <AppIcon name="chevron" :size="14" />
          </span>
          {{ title }}
        </button>
      </h3>
      <span class="sync-content-count">{{
        t("deviceSync.enabledCount", {
          enabled: included,
          total: items.length
        })
      }}</span>
      <label class="sync-select-all">
        <input
          type="checkbox"
          :checked="allIncluded"
          :indeterminate="partlyIncluded"
          :disabled="!items.length"
          :aria-label="t('deviceSync.selectAllGroup', { category: title })"
          @change="changeAll"
        />
        <span>{{ t("deviceSync.selectAll") }}</span>
      </label>
    </header>
    <div v-show="expanded" :id="listId" class="sync-content-body">
      <p v-if="note" class="sync-content-note">{{ note }}</p>
      <label v-for="item in items" :key="item.key" class="sync-list-row">
        <span>
          {{ item.title }}
          <small>{{ itemStatus(item) }}</small>
        </span>
        <input
          type="checkbox"
          :checked="item.included"
          :aria-label="t('deviceSync.syncItem', { title: item.title })"
          @change="changeItem(item.key, $event)"
        />
      </label>
      <p v-if="!items.length" class="sync-content-empty">
        {{ t("deviceSync.noSyncableContent", { category: title }) }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.sync-content-group {
  min-width: 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  overflow: hidden;
}
.sync-content-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 16px;
  background: var(--surface-muted);
}
.sync-content-heading h3 {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 1em;
  line-height: 1.5;
}
.sync-content-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.sync-content-toggle:focus-visible,
.sync-select-all:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 6px;
}
.sync-content-chevron {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 0.15s ease;
}
.sync-content-chevron.is-open {
  transform: rotate(90deg);
}
.sync-content-count {
  font-size: 0.875em;
  color: var(--text-secondary);
}
.sync-select-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 0.875em;
  color: var(--text-secondary);
  cursor: pointer;
}
.sync-select-all:has(input:disabled) {
  cursor: default;
}
.sync-content-body {
  min-width: 0;
}
.sync-content-group .sync-list-row {
  margin: 0 16px;
  flex-wrap: nowrap;
  gap: 16px;
  cursor: pointer;
}
.sync-content-group .sync-list-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.sync-content-group input {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: inherit;
}
.sync-content-group input:disabled {
  cursor: default;
}
.sync-content-group .sync-content-empty,
.sync-content-group .sync-content-note {
  margin: 0;
  padding: 12px 16px 0;
  color: var(--text-secondary);
  font-size: 0.875em;
}
.sync-content-group .sync-content-empty {
  padding: 16px;
  font-size: inherit;
}
</style>
