<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  isActiveSubagentRun,
  subagentRunDetailId,
  type AgentSubagentRun,
  type ChatMessage
} from "../types/conversation";
import {
  subagentDuration,
  subagentRetryProgress,
  subagentReviewHint,
  subagentStatusLabel,
  subagentUsageLabel
} from "./subagentRunPresentation";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
import ConversationRunClock from "./ConversationRunClock.vue";
import SubagentRunDetail from "./SubagentRunDetail.vue";

const t = createScopedTranslator("components.subagentRunList");

defineProps<{
  message: ChatMessage;
  run: AgentSubagentRun;
  /** The candidate a draw selection adopted. */
  selected?: boolean;
}>();

function waitingLabel(run: AgentSubagentRun): string | undefined {
  return run.status === "queued" && run.batchTask?.dependsOn.length
    ? t("waitingForValue", { arg0: run.batchTask.dependsOn.join("、") })
    : undefined;
}

/** A draw group already shows the shared task; a candidate shows its focus. */
function taskLine(run: AgentSubagentRun): string {
  return run.draw?.role === "candidate" && run.draw.variant
    ? t("variantValue", { arg0: run.draw.variant })
    : run.task;
}

function keyLabel(run: AgentSubagentRun): string | undefined {
  if (run.draw?.role === "candidate") {
    return t("candidateValue", { arg0: run.draw.index + 1 });
  }
  if (run.draw?.role === "evaluator") return undefined;
  return run.batchTask?.key;
}
</script>

<template>
  <ConversationDetails
    :detail-id="subagentRunDetailId(run)"
    class="subagent-run-card"
    :class="[`is-${run.status}`, { 'is-draw-selected': selected }]"
    :aria-busy="isActiveSubagentRun(run)"
  >
    <template #summary>
      <span class="subagent-run-icon" aria-hidden="true">
        <AppIcon
          :name="run.draw?.role === 'evaluator' ? 'check' : 'user'"
          :size="17"
        />
      </span>
      <span class="subagent-run-heading">
        <span class="subagent-run-title-row">
          <span v-if="keyLabel(run)" class="subagent-run-key">{{
            keyLabel(run)
          }}</span>
          <strong>{{ run.name }}</strong>
          <span class="subagent-run-status" :class="`is-${run.status}`">
            <ConversationRunClock
              v-slot="{ now }"
              :active="run.status === 'running'"
            >
              {{ subagentStatusLabel(run, now) }}
            </ConversationRunClock>
          </span>
          <span v-if="selected" class="subagent-run-adopted">{{
            t("adopted")
          }}</span>
          <span
            v-else-if="run.status === 'queued' && run.drawCount"
            class="subagent-run-key"
            >{{ t("drawCountValue", { arg0: run.drawCount }) }}</span
          >
        </span>
        <span class="subagent-run-task">{{ taskLine(run) }}</span>
      </span>
      <span class="subagent-run-meta" :aria-label="t('subtaskSummary')">
        <ConversationRunClock
          v-slot="{ now }"
          :active="run.status === 'running'"
        >
          <span v-if="subagentDuration(run, now)">{{
            subagentDuration(run, now)
          }}</span>
        </ConversationRunClock>
        <span v-if="waitingLabel(run)">{{ waitingLabel(run) }}</span>
        <span v-if="subagentRetryProgress(run)">{{
          subagentRetryProgress(run)
        }}</span>
        <span>{{
          t("toolsMessage", {
            arg0: run.toolCalls.length ?? ""
          })
        }}</span>
        <span
          v-if="subagentUsageLabel(run)"
          :aria-label="t('subagentTokenUsage')"
        >
          {{ subagentUsageLabel(run) }}
        </span>
        <span v-if="subagentReviewHint(message, run)" class="is-review">
          {{ subagentReviewHint(message, run) }}
        </span>
      </span>
      <AppIcon class="subagent-run-chevron" name="chevron" :size="14" />
    </template>

    <SubagentRunDetail :run="run" />
  </ConversationDetails>
</template>

<style scoped>
.subagent-run-key,
.subagent-run-adopted {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  color: var(--text-secondary);
  font-family: var(--code-font);
  font-size: 0.714286rem;
  line-height: 1.4;
}

.subagent-run-adopted {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: inherit;
  font-weight: 650;
}

.subagent-run-card.is-draw-selected {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line));
}

.subagent-run-card.is-queued .subagent-run-icon,
.subagent-run-card.is-skipped .subagent-run-icon {
  opacity: 0.55;
}
</style>
