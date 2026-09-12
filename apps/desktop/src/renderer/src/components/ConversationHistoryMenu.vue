<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useId, watch } from "vue";
import { useCurrentConversationExport } from "../composables/useCurrentConversationExport";
import { useConversationHistoryManagement } from "../composables/useConversationHistoryManagement";
import type { ConversationHistoryItem } from "../types/conversation";
import AppIcon from "./AppIcon.vue";
const ConversationHistoryDeleteDialog = defineAsyncComponent(
  () => import("./ConversationHistoryDeleteDialog.vue")
);
const props = defineProps<{
  conversationHistory: ConversationHistoryItem[];
  currentSessionId: string;
  responding: boolean;
  bookScoped: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{ selectConversation: [sessionId: string] }>();
const exportAction = useCurrentConversationExport(() => props.currentSessionId);
const historyOpen = ref(false);
const panelId = useId();
const view = ref<"active" | "deleted">("active");
const pendingDelete = ref<ConversationHistoryItem>();
const {
  available: managementAvailable,
  deletedItems,
  loading,
  busy,
  refreshDeleted,
  deleteConversation,
  restoreConversation
} = useConversationHistoryManagement(() => props.currentSessionId);
const visibleHistory = computed(() =>
  view.value === "deleted" ? deletedItems.value : props.conversationHistory
);
watch([historyOpen, view], ([open, selected]) => {
  if (open && selected === "deleted") void refreshDeleted();
});
async function confirmDelete(): Promise<void> {
  if (pendingDelete.value && (await deleteConversation(pendingDelete.value)))
    pendingDelete.value = undefined;
}
watch(
  () => props.currentSessionId,
  () => {
    historyOpen.value = false;
    pendingDelete.value = undefined;
    view.value = "active";
  }
);
function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}

function selectHistoryConversation(item: ConversationHistoryItem): void {
  historyOpen.value = false;
  if (item.sessionId !== props.currentSessionId) {
    emit("selectConversation", item.sessionId);
  }
}
</script>
<template>
  <div
    class="conversation-history-control"
    @keydown.esc.stop="historyOpen = false"
  >
    <button
      class="header-text-button"
      :class="{ 'is-active': historyOpen }"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="historyOpen"
      :aria-controls="panelId"
      aria-label="历史对话"
      title="历史对话"
      @click="historyOpen = !historyOpen"
    >
      <AppIcon name="history" :size="16" />
      <span v-if="!compact">历史对话</span>
    </button>
    <div
      v-if="historyOpen"
      class="conversation-history-dismiss"
      aria-hidden="true"
      @mousedown="historyOpen = false"
    />
    <section
      v-if="historyOpen"
      :id="panelId"
      class="conversation-history-panel"
      role="dialog"
      aria-label="历史对话"
    >
      <header>
        <div class="conversation-history-heading">
          <strong>历史对话</strong>
          <div
            v-if="managementAvailable"
            class="conversation-history-tabs"
            role="group"
            aria-label="历史记录视图"
          >
            <button
              type="button"
              :aria-pressed="view === 'active'"
              @click="view = 'active'"
            >
              全部对话
            </button>
            <button
              type="button"
              :aria-pressed="view === 'deleted'"
              @click="view = 'deleted'"
            >
              已删除
            </button>
            <button
              v-if="view === 'deleted'"
              type="button"
              class="conversation-history-refresh"
              :disabled="loading"
              @click="refreshDeleted"
            >
              刷新
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭历史对话"
          @click="historyOpen = false"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </header>
      <div v-if="visibleHistory.length" class="conversation-history-list">
        <div
          v-for="item in visibleHistory"
          :key="item.sessionId"
          class="conversation-history-row"
        >
          <button
            class="conversation-history-item"
            :class="{ 'is-current': item.current }"
            :aria-current="item.current ? 'true' : undefined"
            :title="
              responding && !item.current
                ? '回复完成或停止后可切换'
                : item.title
            "
            type="button"
            :disabled="
              view === 'deleted' || busy || (responding && !item.current)
            "
            @click="selectHistoryConversation(item)"
          >
            <span class="conversation-history-copy">
              <span class="conversation-history-title-row">
                <strong>{{ item.title }}</strong>
                <time :datetime="item.updatedAt">{{
                  formatHistoryTime(item.updatedAt)
                }}</time>
              </span>
              <small v-if="item.preview && item.preview !== item.title">{{
                item.preview
              }}</small>
            </span>
          </button>
          <button
            v-if="managementAvailable"
            class="conversation-history-manage"
            type="button"
            :disabled="busy"
            :aria-label="`${view === 'deleted' ? '恢复' : '删除'}对话：${item.title}`"
            @click="
              view === 'deleted'
                ? restoreConversation(item)
                : (pendingDelete = item)
            "
          >
            <span v-if="view === 'deleted'">恢复</span
            ><AppIcon v-else name="trash" :size="15" />
          </button>
        </div>
      </div>
      <div v-else class="conversation-history-empty">
        <AppIcon name="history" :size="22" />
        <strong>{{
          loading
            ? "正在读取对话"
            : view === "deleted"
              ? "没有已删除的对话"
              : "还没有历史对话"
        }}</strong>
      </div>
      <div
        v-if="exportAction.available.value"
        class="conversation-history-export"
      >
        <button
          type="button"
          :disabled="exportAction.exporting.value"
          title="包含当前客户端里尚未保存的内容"
          @click="exportAction.start"
        >
          {{ exportAction.exporting.value ? "正在导出…" : "导出当前对话" }}
        </button>
        <button
          v-if="exportAction.exporting.value"
          type="button"
          @click="exportAction.cancel"
        >
          取消
        </button>
      </div>
    </section>
  </div>
  <ConversationHistoryDeleteDialog
    v-if="pendingDelete"
    :title="pendingDelete.title"
    :busy="busy"
    @close="pendingDelete = undefined"
    @confirm="confirmDelete"
  />
</template>
<style scoped>
.conversation-history-export {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--theme-line-soft);
}
.conversation-history-export button {
  border: 0;
  border-radius: 6px;
  padding: 6px;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: 0.785714rem;
  cursor: pointer;
}
.conversation-history-export button:hover {
  background: var(--surface-hover);
}
.conversation-history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
.conversation-history-manage {
  min-width: 2rem;
  min-height: 2rem;
  margin-right: 5px;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: 0.785714rem;
  cursor: pointer;
}
.conversation-history-manage:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.conversation-history-manage:disabled {
  opacity: 0.45;
  cursor: default;
}
.conversation-history-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.conversation-history-tabs button {
  min-height: 2rem;
  padding: 5px 8px;
  white-space: nowrap;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: 0.785714rem;
  cursor: pointer;
}
.conversation-history-tabs button[aria-pressed="true"] {
  color: var(--text-primary);
  background: var(--surface-selected);
}
.conversation-history-tabs button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.conversation-history-tabs button:disabled {
  opacity: 0.45;
  cursor: default;
}
.conversation-history-tabs button:focus-visible,
.conversation-history-manage:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
