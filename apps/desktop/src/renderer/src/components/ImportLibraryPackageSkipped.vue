<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  LibraryPackagePreview,
  LibraryPackageSkipReason
} from "@deepwrite/contracts";
import { computed } from "vue";

const t = createScopedTranslator("components.importLibraryPackageDialog");

const props = defineProps<{
  skipped: LibraryPackagePreview["skipped"];
  files: LibraryPackagePreview["skippedFiles"];
}>();

const labels: Record<LibraryPackageSkipReason, () => string> = {
  unsupported: () => t("skipUnsupported"),
  empty: () => t("skipEmpty"),
  tooLarge: () => t("skipTooLarge"),
  undecodable: () => t("skipUndecodable"),
  missing: () => t("skipMissing"),
  unassigned: () => t("skipUnassigned"),
  limit: () => t("skipLimit")
};

const counts = computed(() =>
  (
    Object.entries(props.skipped) as [LibraryPackageSkipReason, number][]
  ).filter(([, count]) => count > 0)
);
const total = computed(() =>
  counts.value.reduce((sum, [, count]) => sum + count, 0)
);
const summary = computed(() =>
  counts.value
    .map(([reason, count]) => `${labels[reason]()} ${count}`)
    .join(" · ")
);
</script>

<template>
  <details v-if="total" class="package-skipped">
    <summary>{{ t("skippedFiles", { count: total, summary }) }}</summary>
    <ul>
      <li v-for="file in files" :key="file.path">
        {{ file.path }} — {{ labels[file.reason]() }}
      </li>
    </ul>
  </details>
</template>

<style scoped>
.package-skipped {
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 0.714286rem;
}

.package-skipped summary {
  cursor: pointer;
}

.package-skipped ul {
  max-height: 140px;
  margin: 6px 0 0;
  padding-left: 18px;
  overflow: auto;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}
</style>
