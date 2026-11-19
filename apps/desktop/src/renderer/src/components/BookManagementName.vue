<script setup lang="ts">
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.longBookActionMenu");

defineProps<{
  title: string;
  pending?: boolean | undefined;
}>();
const emit = defineEmits<{ rename: [] }>();
</script>

<template>
  <div class="book-management-name">
    <span>{{ t("bookTitle") }}</span>
    <strong :title="title">{{ title }}</strong>
    <button
      class="dialog-secondary-button"
      type="button"
      :disabled="pending"
      @click="emit('rename')"
    >
      {{ t("rename") }}
    </button>
  </div>
</template>

<style scoped>
.book-management-name {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 22px;
  border-bottom: 1px solid var(--theme-line-soft);
  color: var(--text-secondary);
  font-size: 0.857143rem;
}
.book-management-name > strong {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
