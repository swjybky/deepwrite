<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import AppIcon from "../AppIcon.vue";

defineProps<{
  title: string;
  pending?: boolean;
  upDisabled?: boolean | undefined;
  downDisabled?: boolean | undefined;
  editDisabled?: boolean | undefined;
  deleteDisabled?: boolean | undefined;
  editLabel?: string;
}>();
const emit = defineEmits<{
  move: [direction: "up" | "down"];
  edit: [];
  delete: [];
}>();
const t = createScopedTranslator("components.plotStructureDialog");
</script>

<template>
  <div class="book-management-row-actions">
    <button
      class="icon-button"
      type="button"
      :aria-label="t('moveValueUp', { arg0: title })"
      :title="t('moveUp')"
      :disabled="pending || upDisabled"
      @click="emit('move', 'up')"
    >
      <AppIcon name="arrow-up" :size="16" />
    </button>
    <button
      class="icon-button"
      type="button"
      :aria-label="t('moveValueDown', { arg0: title })"
      :title="t('moveDown')"
      :disabled="pending || downDisabled"
      @click="emit('move', 'down')"
    >
      <AppIcon name="arrow-up" :size="16" class="book-management-move-down" />
    </button>
    <button
      class="icon-button"
      type="button"
      :aria-label="editLabel ?? t('editValue', { arg0: title })"
      :title="editLabel ?? t('edit')"
      :disabled="pending || editDisabled"
      @click="emit('edit')"
    >
      <AppIcon name="edit" :size="16" />
    </button>
    <button
      class="icon-button"
      type="button"
      :aria-label="t('deleteValue', { arg0: title })"
      :title="t('delete')"
      :disabled="pending || deleteDisabled"
      @click="emit('delete')"
    >
      <AppIcon name="trash" :size="16" />
    </button>
  </div>
</template>
