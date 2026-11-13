<script setup lang="ts">
import { onMounted, ref } from "vue";

defineProps<{ label: string }>();
const text = defineModel<string>({ required: true });
const textarea = ref<HTMLTextAreaElement | null>(null);

onMounted(() => textarea.value?.focus());
</script>

<template>
  <div class="edit-proposal-editor">
    <textarea
      ref="textarea"
      v-model="text"
      class="edit-proposal-textarea"
      :aria-label="label"
      spellcheck="false"
    />
  </div>
</template>

<style scoped>
.edit-proposal-editor {
  padding: 10px 12px 0 13px;
}

.edit-proposal-textarea {
  display: block;
  width: 100%;
  min-height: 220px;
  max-height: 60vh;
  padding: 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: 0.857143rem;
  line-height: 1.7;
  resize: vertical;
}

.edit-proposal-textarea:focus {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--theme-line));
  box-shadow: 0 0 0 3px var(--accent-soft);
}
</style>
