<script setup lang="ts">
import type { ConversationHistoryItem } from "../../types/conversation";
import AppIcon from "../../components/AppIcon.vue";
import ConversationHistoryMenu from "../../components/ConversationHistoryMenu.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "../../components/PopupSelect.vue";

defineProps<{
  title: string;
  activeContextKey: string;
  contextOptions: PopupSelectOption[];
  contextDisabled: boolean;
  history: ConversationHistoryItem[];
  sessionId: string;
  busy: boolean;
  canCopy: boolean;
}>();

const emit = defineEmits<{
  updateContext: [value: PopupSelectValue];
  editProject: [value: PopupSelectValue];
  selectConversation: [sessionId: string];
  newConversation: [];
  copyLastReply: [];
  minimize: [];
}>();
</script>

<template>
  <header class="chat-assistant-header">
    <div class="chat-assistant-header-main">
      <strong :title="title">{{ title }}</strong>
      <PopupSelect
        class="chat-assistant-context-select"
        :model-value="activeContextKey"
        :options="contextOptions"
        accessible-label="切换聊天上下文"
        variant="compact"
        size="small"
        :disabled="contextDisabled"
        :menu-min-width="260"
        :menu-z-index="100"
        @update:model-value="emit('updateContext', $event)"
        @option-action="emit('editProject', $event)"
      />
    </div>
    <div class="chat-assistant-header-actions">
      <ConversationHistoryMenu
        :conversation-history="history"
        :current-session-id="sessionId"
        :responding="busy"
        :book-scoped="false"
        compact
        @select-conversation="emit('selectConversation', $event)"
      />
      <button
        type="button"
        aria-label="新建聊天"
        :disabled="busy"
        @click="emit('newConversation')"
      >
        <AppIcon name="plus" :size="18" />
      </button>
      <button
        type="button"
        aria-label="复制最后一条回复"
        :disabled="!canCopy"
        @click="emit('copyLastReply')"
      >
        <AppIcon name="copy" :size="18" />
      </button>
      <button
        type="button"
        aria-label="最小化聊天助手"
        @click="emit('minimize')"
      >
        <AppIcon name="minus" :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-assistant-header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.chat-assistant-header-main {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.chat-assistant-header-main > strong {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
}
.chat-assistant-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat-assistant-context-select {
  max-width: 190px;
}
.chat-assistant-context-select :deep(.popup-select-trigger) {
  max-width: 190px;
  padding: 0 11px;
  background: var(--surface-raised);
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  box-shadow: 0 2px 8px color-mix(in srgb, #000 4%, transparent);
}
.chat-assistant-context-select :deep(.popup-select-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-assistant-header-actions {
  flex: none;
}
.chat-assistant-header-actions button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: 10px;
}
.chat-assistant-header-actions button:not(:disabled):hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.chat-assistant-header button:disabled {
  opacity: 0.42;
}
@media (max-width: 760px) {
  .chat-assistant-header {
    align-items: flex-start;
    padding: 12px 16px;
  }
  .chat-assistant-header-main > strong {
    width: 100%;
    max-width: none;
  }
}
</style>
