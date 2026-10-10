<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { LibraryPackageSourceKind } from "@deepwrite/contracts";
import { ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.importLibraryPackageDialog");

const props = defineProps<{ choosing: boolean }>();
const emit = defineEmits<{ choose: [sourceKind: LibraryPackageSourceKind] }>();

const SOURCES = ["zip", "directory"] as const;
const chosen = ref<LibraryPackageSourceKind | null>(null);

watch(
  () => props.choosing,
  (choosing) => {
    if (!choosing) chosen.value = null;
  }
);

function choose(sourceKind: LibraryPackageSourceKind): void {
  if (props.choosing) return;
  chosen.value = sourceKind;
  emit("choose", sourceKind);
}
</script>

<template>
  <div class="package-source-options">
    <button
      v-for="kind in SOURCES"
      :key="kind"
      type="button"
      class="package-source-option"
      :disabled="choosing"
      @click="choose(kind)"
    >
      <AppIcon :name="kind === 'zip' ? 'archive' : 'folder'" :size="22" />
      <span>
        <strong>{{
          choosing && chosen === kind
            ? t("recognizing")
            : kind === "zip"
              ? t("chooseZip")
              : t("chooseFolder")
        }}</strong>
        <small>{{
          kind === "zip" ? t("chooseZipHint") : t("chooseFolderHint")
        }}</small>
      </span>
    </button>
  </div>
  <p class="dialog-description package-source-description">
    {{ t("sourceDescription") }}
  </p>
</template>

<style scoped>
.package-source-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.package-source-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  color: var(--text-primary);
  background: var(--surface-raised);
  text-align: left;
  cursor: pointer;
}

.package-source-option:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.package-source-option:disabled {
  cursor: default;
}

.package-source-option span {
  display: grid;
  gap: 4px;
}

.package-source-option strong {
  font-size: 0.821429rem;
  font-weight: 620;
}

.package-source-option small {
  color: var(--text-secondary);
  font-size: 0.714286rem;
  line-height: 1.5;
}

.package-source-description {
  margin: 14px 0 0;
}

@media (max-width: 560px) {
  .package-source-options {
    grid-template-columns: 1fr;
  }
}
</style>
