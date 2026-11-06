<script setup lang="ts">
import { computed } from "vue";
import { createScopedTranslator, locale } from "../i18n";
import type { ChatMessage } from "../types/conversation";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
import SubagentRunCard from "./SubagentRunCard.vue";
import {
  finishedDrawCount,
  subagentDrawGroupStatus,
  subagentDrawGroupTokens,
  type SubagentDrawGroup
} from "./subagentDrawGroups";

const t = createScopedTranslator("components.subagentDrawGroup");

const props = defineProps<{
  message: ChatMessage;
  group: SubagentDrawGroup;
}>();

const status = computed(() => subagentDrawGroupStatus(props.group));
const state = computed(() => props.group.state);
const selectedNumber = computed(() =>
  state.value?.selectedIndex !== undefined
    ? state.value.selectedIndex + 1
    : undefined
);
const runs = computed(() => [
  ...props.group.candidates,
  ...(props.group.evaluator ? [props.group.evaluator] : [])
]);

const statusLabel = computed(() => {
  switch (state.value?.phase) {
    case "selected":
      return t("adoptedCandidateValue", { arg0: selectedNumber.value ?? "" });
    case "selecting":
      return t("waitingForYourChoice");
    case "evaluating":
      return t("evaluating");
    case "rejected":
      return t("noneAdopted");
    case "failed":
      return status.value === "stopped" ? t("stopped") : t("failed");
    default:
      return status.value === "stopped"
        ? t("stopped")
        : t("drawingValueValue", {
            arg0: finishedDrawCount(props.group),
            arg1: props.group.count
          });
  }
});

/** One line saying who chose what, or why nothing was chosen. */
const selectionTitle = computed(() => {
  const current = state.value;
  if (!current) return undefined;
  if (current.phase === "selected") {
    if (current.selectedBy === "evaluator") {
      return t("evaluatorChoseValue", { arg0: selectedNumber.value ?? "" });
    }
    if (current.selectedBy === "only-success") {
      return t("onlyValueSucceeded", { arg0: selectedNumber.value ?? "" });
    }
    return t("youChoseValue", { arg0: selectedNumber.value ?? "" });
  }
  if (current.phase === "rejected") return t("youAdoptedNone");
  if (current.phase === "evaluating" && current.reason) {
    return t("evaluating");
  }
  if (current.phase === "selecting" && current.reason) {
    return t("evaluatorHandedTheChoiceToYou");
  }
  if (current.phase === "failed") return t("drawEndedWithoutAResult");
  return undefined;
});

const tokenLabel = computed(() => {
  const tokens = subagentDrawGroupTokens(props.group);
  return tokens ? `${tokens.toLocaleString(locale.value)} tokens` : "";
});
</script>

<template>
  <ConversationDetails
    :detail-id="`draw:${group.key}`"
    class="subagent-run-card subagent-draw-card"
    :class="`is-${status}`"
    :aria-busy="status === 'running'"
  >
    <template #summary>
      <span class="subagent-run-icon" aria-hidden="true">
        <AppIcon name="sparkles" :size="17" />
      </span>
      <span class="subagent-run-heading">
        <span class="subagent-run-title-row">
          <span v-if="group.batchTask" class="subagent-draw-key">{{
            group.batchTask.key
          }}</span>
          <strong>{{ group.name }}</strong>
          <span class="subagent-draw-key">{{
            t("drawValue", { arg0: group.count })
          }}</span>
          <span class="subagent-run-status" :class="`is-${status}`">{{
            statusLabel
          }}</span>
        </span>
        <span class="subagent-run-task">{{ group.task }}</span>
      </span>
      <span class="subagent-run-meta" :aria-label="t('drawSummary')">
        <span>{{
          t("finishedValueValue", {
            arg0: finishedDrawCount(group),
            arg1: group.count
          })
        }}</span>
        <span v-if="tokenLabel">{{ tokenLabel }}</span>
      </span>
      <AppIcon class="subagent-run-chevron" name="chevron" :size="14" />
    </template>

    <div class="subagent-run-detail">
      <section class="subagent-run-handoff subagent-run-assigned-task">
        <strong>{{ t("taskAssignedByPrimaryAgent") }}</strong>
        <p>{{ group.task }}</p>
      </section>
      <section
        v-if="selectionTitle"
        class="subagent-run-handoff"
        :class="{ 'is-error': state?.phase === 'failed' }"
      >
        <strong>{{ selectionTitle }}</strong>
        <p v-if="state?.reason">{{ state.reason }}</p>
        <p v-if="state?.note">
          {{ t("yourNoteValue", { arg0: state.note }) }}
        </p>
      </section>
      <div class="subagent-draw-runs" :aria-label="t('candidates')">
        <SubagentRunCard
          v-for="run in runs"
          :key="run.subagentRunId"
          :message="message"
          :run="run"
          :selected="
            state?.phase === 'selected' &&
            state.selectedSubagentRunId === run.subagentRunId
          "
        />
      </div>
    </div>
  </ConversationDetails>
</template>

<style scoped>
.subagent-draw-key {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  color: var(--text-secondary);
  font-family: var(--code-font);
  font-size: 0.714286rem;
  line-height: 1.4;
}

.subagent-draw-runs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
</style>
