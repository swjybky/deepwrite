<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { QueuedComposerMessage } from "../composables/agent-conversation/follow-up-queue";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.conversationComposer");

const props = defineProps<{
  items: readonly QueuedComposerMessage[];
  responding: boolean;
  hasPendingEditReview: boolean;
  /** A queued message could start a new turn right now. */
  canSendNow: boolean;
}>();

const emit = defineEmits<{
  withdraw: [item: QueuedComposerMessage];
  sendNow: [itemId: string];
}>();

function hasImage(item: QueuedComposerMessage): boolean {
  return item.attachments.some((attachment) => attachment.kind === "image");
}

function canSend(item: QueuedComposerMessage): boolean {
  if (item.state !== "queued") return false;
  return props.responding ? !hasImage(item) : props.canSendNow;
}

function sendTitle(item: QueuedComposerMessage): string {
  if (props.responding) {
    return hasImage(item) ? t("imageNeedsNextTurn") : t("steerNow");
  }
  return props.hasPendingEditReview ? t("reviewFirst") : t("sendQueuedNow");
}
</script>

<template>
  <ul class="composer-queue" :aria-label="t('queuedMessages')">
    <li
      v-for="item in items"
      :key="item.id"
      class="composer-queue-item"
      :class="`is-${item.state}`"
    >
      <span class="composer-queue-text" :title="item.content">{{
        item.content
      }}</span>
      <span v-if="item.attachments.length" class="composer-queue-files">
        <AppIcon name="attach" :size="12" />{{ item.attachments.length }}
      </span>
      <button
        class="composer-queue-button"
        type="button"
        :aria-label="t('withdrawQueued')"
        :title="t('withdrawQueued')"
        :disabled="item.state !== 'queued'"
        @click="emit('withdraw', item)"
      >
        <AppIcon name="trash" :size="13" />
      </button>
      <button
        class="composer-queue-button"
        type="button"
        :aria-label="sendTitle(item)"
        :title="sendTitle(item)"
        :disabled="!canSend(item)"
        @click="emit('sendNow', item.id)"
      >
        <AppIcon name="arrow-up" :size="13" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.composer-queue {
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: calc(100% - 28px);
  margin: 0 14px -15px;
  padding: 6px 8px 21px 14px;
  border: 1px solid var(--theme-line-soft);
  border-bottom: 0;
  border-radius: 16px 16px 0 0;
  background: var(--surface-muted);
  list-style: none;
}

.composer-queue-item {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 0.857143rem;
}

.composer-queue-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-queue-item.is-sending .composer-queue-text {
  color: var(--text-secondary);
}

.composer-queue-files {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  color: var(--text-tertiary);
}

.composer-queue-button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.composer-queue-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.composer-queue-button:disabled {
  cursor: default;
  opacity: 0.42;
}
</style>
