<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

defineProps<{ description: string; detail?: string | undefined }>();
const t = createScopedTranslator("components.exportShortManuscriptDialog");
</script>

<template>
  <div class="export-scope-notice" role="note" :aria-label="t('exportScope')">
    <span class="export-scope-icon"
      ><AppIcon name="download" :size="18"
    /></span>
    <div>
      <strong>{{ t("exportScope") }}</strong>
      <p>{{ description }}</p>
      <p v-if="detail">{{ detail }}</p>
    </div>
  </div>
</template>

<style scoped>
.export-scope-notice {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid
    color-mix(in srgb, var(--accent) 22%, var(--theme-line-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-main));
  color: var(--text-primary);
  font-size: 0.857143rem;
}
.export-scope-icon {
  display: grid;
  place-items: center;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
}
.export-scope-notice strong {
  font-weight: 620;
}
.export-scope-notice p {
  margin: 3px 0 0;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
