<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { computed } from "vue";
import type { SyncKind, SyncStatus } from "@deepwrite/contracts/renderer";
import SyncContentGroup from "./SyncContentGroup.vue";

const t = createScopedTranslator("extras");

const props = defineProps<{
  items: SyncStatus["items"];
}>();
defineEmits<{
  toggle: [key: string, included: boolean];
  toggleMany: [keys: string[], included: boolean];
}>();
const categories: {
  id: string;
  title: string;
  kinds: SyncKind[];
  note?: string;
}[] = [
  {
    id: "workspace",
    get title() {
      return t("cloudBackup.workspace");
    },
    kinds: ["book", "long-book"]
  },
  {
    id: "skill",
    get title() {
      return t("cloudBackup.skillLibrary");
    },
    kinds: ["skill-library", "skill-group"]
  },
  {
    id: "material",
    get title() {
      return t("cloudBackup.materialLibrary");
    },
    kinds: ["material-library", "material-group"]
  },
  {
    id: "model",
    get title() {
      return t("deviceSync.modelConfig");
    },
    get note() {
      return t("deviceSync.modelConfigNote");
    },
    kinds: ["model-config"]
  }
];
const groups = computed(() =>
  categories.map((category) => ({
    id: category.id,
    title: category.title,
    note: category.note,
    items: props.items.filter((item) => category.kinds.includes(item.kind))
  }))
);
</script>

<template>
  <section class="sync-card sync-content-panel">
    <h2>{{ t("deviceSync.syncContents") }}</h2>
    <p>{{ t("deviceSync.scopeDescription") }}</p>
    <SyncContentGroup
      v-for="group in groups"
      :key="group.id"
      :title="group.title"
      :items="group.items"
      :note="group.note"
      @toggle="(key, included) => $emit('toggle', key, included)"
      @toggle-many="(keys, included) => $emit('toggleMany', keys, included)"
    />
  </section>
</template>
