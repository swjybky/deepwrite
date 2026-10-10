<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  LongMaterialEntryStatus,
  LongMaterialEntryView
} from "@deepwrite/contracts/renderer";
import PopupSelect from "../../components/PopupSelect.vue";
import { packT as t, statusLabel } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const emit = defineEmits<{
  openEntry: [entry: { libraryId: string; entryId: string }];
}>();
const store = useLongMaterialPackStore();
const filter = ref<"all" | LongMaterialEntryStatus>("all");
const expanded = ref(new Set<string>());
const PREVIEW = 4;
const filterOptions = computed(() => [
  { value: "all", label: t("filterAll") },
  ...(["new", "updated", "unchanged", "conflict", "stale", "deleted"] as const)
    .filter((status) => store.result?.counts[status])
    .map((status) => ({ value: status, label: statusLabel(status) }))
]);
const groups = computed(() => {
  const entries = (store.result?.entries ?? []).filter(
    ({ status }) => filter.value === "all" || status === filter.value
  );
  const order = ["plot", "character", "gimmick", "draft", "other"] as const;
  return order
    .map((kind) => ({
      kind,
      title:
        store.result?.libraries.find((library) => library.kind === kind)
          ?.title ?? kind,
      entries: entries.filter((entry) => entry.kind === kind)
    }))
    .filter(({ entries: list }) => list.length);
});
function visible(kind: string, entries: LongMaterialEntryView[]) {
  return expanded.value.has(kind) ? entries : entries.slice(0, PREVIEW);
}
function toggle(kind: string) {
  const next = new Set(expanded.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  expanded.value = next;
}
function open(entry: LongMaterialEntryView) {
  if (entry.libraryId && entry.entryId && entry.status !== "deleted")
    emit("openEntry", { libraryId: entry.libraryId, entryId: entry.entryId });
}
</script>

<template>
  <section
    v-if="store.result"
    class="analysis-card pack-card"
    :aria-label="t('entriesTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("entriesTitle") }}</h2>
      <PopupSelect
        v-model="filter"
        variant="compact"
        align="end"
        :options="filterOptions"
        :accessible-label="t('entriesTitle')"
      />
    </div>
    <div v-for="group in groups" :key="group.kind" class="pack-entry-group">
      <h3>
        {{
          t("countLabel", { label: group.title, count: group.entries.length })
        }}
      </h3>
      <ul class="pack-entries">
        <li
          v-for="entry in visible(group.kind, group.entries)"
          :key="entry.key"
        >
          <span class="pack-entry-title">
            {{ entry.title }}
            <small v-if="entry.enhanced" class="pack-tag">{{
              t("enhanced")
            }}</small>
          </span>
          <span class="pack-status" :class="`is-${entry.status}`">
            {{ entry.status ? statusLabel(entry.status) : "" }}
          </span>
          <button
            type="button"
            class="pack-link"
            :disabled="entry.status === 'deleted' || !entry.entryId"
            @click="open(entry)"
          >
            {{ t("open") }}
          </button>
        </li>
      </ul>
      <button
        v-if="group.entries.length > PREVIEW"
        type="button"
        class="pack-link"
        @click="toggle(group.kind)"
      >
        {{
          expanded.has(group.kind)
            ? t("collapse")
            : t("moreEntries", { count: group.entries.length - PREVIEW })
        }}
      </button>
    </div>
  </section>
</template>
