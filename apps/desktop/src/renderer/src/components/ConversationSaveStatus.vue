<script setup lang="ts">
import { useCurrentConversationExport } from "../composables/useCurrentConversationExport";
import { useConversationSaveStatus } from "../composables/useConversationSaveStatus";
const props = defineProps<{ sessionId: string }>();
const exportAction = useCurrentConversationExport(() => props.sessionId);
const { status, label, retrying, retry, showError } = useConversationSaveStatus(
  () => props.sessionId
);
</script>

<template>
  <span
    class="conversation-save-status"
    :class="{ 'has-error': status === 'error' }"
  >
    <button
      v-if="status === 'error'"
      type="button"
      class="conversation-save-label"
      title="查看保存失败原因"
      @click="showError"
    >
      {{ label }}
    </button>
    <span
      v-else
      class="conversation-save-label"
      role="status"
      aria-live="polite"
      >{{ label }}</span
    >
    <button
      v-if="status === 'error'"
      class="conversation-save-retry"
      type="button"
      :disabled="retrying"
      @click="retry"
    >
      {{ retrying ? "重试中" : "重试" }}
    </button>
    <button
      v-if="status === 'error' && exportAction.available.value"
      class="conversation-save-export"
      type="button"
      :title="
        exportAction.exporting.value
          ? '取消导出'
          : '导出当前对话（含未保存内容）'
      "
      @click="
        exportAction.exporting.value
          ? exportAction.cancel()
          : exportAction.start()
      "
    >
      {{ exportAction.exporting.value ? "取消" : "导出" }}
    </button>
  </span>
</template>

<style scoped>
.conversation-save-status {
  display: inline-grid;
  grid-template-columns: 4em 3em 3em;
  align-items: center;
  gap: 0.35em;
  flex: none;
  width: 10.7em;
  font-size: 0.714286rem;
  color: var(--text-tertiary);
}
.conversation-save-status button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.conversation-save-label {
  text-align: left;
  white-space: nowrap;
}
.has-error {
  color: var(--text-primary);
}
.conversation-save-retry,
.conversation-save-export {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.conversation-save-retry:disabled {
  opacity: 0.6;
  cursor: default;
}
.conversation-save-status button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}
</style>
