<script setup lang="ts">
import { ref, watch } from "vue";
import type { ConversationHistoryItem } from "../types/conversation";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{
  conversationHistory: ConversationHistoryItem[];
  currentSessionId: string;
  responding: boolean;
  bookScoped: boolean;
}>();
const emit = defineEmits<{ selectConversation: [sessionId: string] }>();
const historyOpen = ref(false);
watch(
  () => props.currentSessionId,
  () => {
    historyOpen.value = false;
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
      aria-controls="conversation-history-panel"
      @click="historyOpen = !historyOpen"
    >
      <AppIcon name="history" :size="16" />
      历史对话
    </button>
    <div
      v-if="historyOpen"
      class="conversation-history-dismiss"
      aria-hidden="true"
      @mousedown="historyOpen = false"
    />
    <section
      v-if="historyOpen"
      id="conversation-history-panel"
      class="conversation-history-panel"
      role="dialog"
      aria-label="历史对话"
    >
      <header>
        <div>
          <strong>历史对话</strong>
          <span>{{
            bookScoped
              ? `本书共 ${conversationHistory.length} 个对话`
              : `共 ${conversationHistory.length} 个对话`
          }}</span>
        </div>
        <button
          type="button"
          aria-label="关闭历史对话"
          @click="historyOpen = false"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </header>
      <div v-if="conversationHistory.length" class="conversation-history-list">
        <button
          v-for="item in conversationHistory"
          :key="item.sessionId"
          class="conversation-history-item"
          :class="{ 'is-current': item.current }"
          type="button"
          :disabled="responding && !item.current"
          @click="selectHistoryConversation(item)"
        >
          <span class="conversation-history-icon">
            <AppIcon :name="item.current ? 'check' : 'message'" :size="15" />
          </span>
          <span class="conversation-history-copy">
            <span class="conversation-history-title-row">
              <strong>{{ item.title }}</strong>
              <time :datetime="item.updatedAt">{{
                formatHistoryTime(item.updatedAt)
              }}</time>
            </span>
            <small>{{ item.preview || "暂无回复内容" }}</small>
            <span class="conversation-history-meta">
              {{
                item.current
                  ? "当前对话"
                  : `${item.turnCount} 轮 · ${item.messageCount} 条消息`
              }}
            </span>
          </span>
        </button>
      </div>
      <div v-else class="conversation-history-empty">
        <AppIcon name="history" :size="22" />
        <strong>还没有历史对话</strong>
        <span>发送消息后，对话会自动保存在这里。</span>
      </div>
      <p class="conversation-history-running-note">
        {{
          responding
            ? "当前回复完成或停止后，可切换到其他对话。"
            : "选择历史记录即可切换对话。"
        }}
      </p>
    </section>
  </div>
</template>
