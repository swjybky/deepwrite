<script setup lang="ts">
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import type { WriteApprovalItem } from "../composables/agent-conversation/write-approval";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.agentWriteApprovalCard");

const props = defineProps<{
  items: WriteApprovalItem[] | null;
  submitting: boolean;
  submitFailed: boolean;
}>();

const emit = defineEmits<{
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  stop: [];
  retry: [];
}>();

const list = computed(() => props.items ?? []);
const doneCount = computed(
  () => list.value.filter(({ state }) => state !== "waiting").length
);
const reviewable = computed(() =>
  list.value.flatMap(({ state, review }) =>
    state === "waiting" && review?.reviewable ? [review] : []
  )
);
const settled = computed(
  () => list.value.length > 0 && doneCount.value === list.value.length
);
const message = computed(() => {
  if (props.submitFailed) return t("submitFailed");
  if (!list.value.length) return t("loading");
  if (settled.value || props.submitting) return t("resuming");
  return t("hint");
});

function stateLabel(item: WriteApprovalItem): string {
  switch (item.state) {
    case "waiting":
      return t("stateWaiting");
    case "saved":
      return item.result.edited ? t("stateEdited") : t("stateSaved");
    case "rejected":
      return t("stateRejected");
    case "reverted":
      return t("stateReverted");
    default:
      return t("stateNotWritten");
  }
}

function reviewAll(decision: "accept" | "reject"): void {
  for (const review of reviewable.value) {
    emit("reviewEdit", {
      runId: review.runId,
      proposalId: review.proposalId,
      decision
    });
  }
}
</script>

<template>
  <section class="write-approval-card" aria-live="polite">
    <header class="write-approval-header">
      <span class="write-approval-icon" aria-hidden="true">
        <AppIcon name="edit" :size="16" />
      </span>
      <div class="write-approval-heading">
        <strong>{{ t("title") }}</strong>
        <span>{{ t("paused") }}</span>
      </div>
      <span v-if="list.length" class="write-approval-progress">
        {{ t("progress", { done: doneCount, total: list.length }) }}
      </span>
    </header>

    <ul v-if="list.length" class="write-approval-list">
      <li
        v-for="item in list"
        :key="item.key"
        class="write-approval-row"
        :class="`is-${item.state}`"
      >
        <span class="write-approval-row-title" :title="item.result.title">
          {{ item.result.title }}
        </span>
        <span class="write-approval-state">{{ stateLabel(item) }}</span>
      </li>
    </ul>

    <footer class="write-approval-footer">
      <span class="write-approval-message">{{ message }}</span>
      <div class="write-approval-actions">
        <button class="edit-review-button" type="button" @click="emit('stop')">
          {{ t("stop") }}
        </button>
        <template v-if="submitFailed">
          <button
            class="edit-review-button is-accept"
            type="button"
            :disabled="submitting"
            @click="emit('retry')"
          >
            {{ t("retry") }}
          </button>
        </template>
        <template v-else-if="reviewable.length > 1">
          <button
            class="edit-review-button"
            type="button"
            @click="reviewAll('reject')"
          >
            {{ t("rejectAll") }}
          </button>
          <button
            class="edit-review-button is-accept"
            type="button"
            @click="reviewAll('accept')"
          >
            {{ t("acceptAll") }}
          </button>
        </template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.write-approval-card {
  display: grid;
  gap: 10px;
  padding: 14px 14px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 12px 32px var(--shadow-color);
  color: var(--text-primary);
  font-size: 0.857143rem;
  line-height: 1.45;
}

.write-approval-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.write-approval-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
}

.write-approval-heading {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.write-approval-heading strong {
  font-size: 0.928571rem;
  font-weight: 650;
}

.write-approval-heading span,
.write-approval-message {
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.write-approval-progress {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-variant-numeric: tabular-nums;
}

.write-approval-list {
  display: grid;
  max-height: 168px;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
  list-style: none;
}

.write-approval-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
  padding: 0 11px;
}

.write-approval-row-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.write-approval-state {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.write-approval-row.is-waiting .write-approval-state {
  color: var(--warning);
}

.write-approval-row.is-saved .write-approval-state {
  color: var(--success);
}

.write-approval-row:is(.is-conflict, .is-failed) .write-approval-state {
  color: var(--danger-text);
}

.write-approval-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.write-approval-message {
  min-width: 0;
  flex: 1 1 200px;
}

.write-approval-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
}
</style>
