<script setup lang="ts">
import { computed } from "vue";
import {
  DECOMPOSITION_DEFAULT_CONCURRENCY,
  type DecompositionRegistry,
  type LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import ConversationRunClock from "../../components/ConversationRunClock.vue";
import {
  subagentDuration,
  subagentRetryStatus
} from "../../components/subagentRunPresentation";
import { createScopedTranslator, locale } from "../../i18n";
import {
  SUBTASK_GROUPS,
  subtaskAction,
  type SubtaskRow
} from "./subtask-board";
import { decompositionUnitLabel } from "./unit-label";

const t = createScopedTranslator("extras.longBookDecomposition");
const props = defineProps<{
  rows: readonly SubtaskRow[];
  job: LongBookDecompositionJob;
  registry: DecompositionRegistry | null;
}>();
const emit = defineEmits<{ open: [key: string] }>();

const sections = computed(() =>
  SUBTASK_GROUPS.map((group) => ({
    group,
    rows: props.rows.filter((row) => row.group === group)
  })).filter((section) => section.rows.length)
);
const running = computed(
  () => props.rows.filter((row) => row.group === "running").length
);
const byTask = computed(
  () =>
    new Map(
      props.rows.flatMap((row) =>
        row.run?.batchTask
          ? [
              [
                `${row.run.parentToolCallId}:${row.run.batchTask.key}`,
                row
              ] as const
            ]
          : []
      )
    )
);
const compact = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      notation: "compact",
      maximumFractionDigits: 1
    })
);

const unitLabels = (row: SubtaskRow) =>
  row.unitIds.map((id) =>
    decompositionUnitLabel(props.job, id, props.registry)
  );
function unitText(row: SubtaskRow): string {
  const labels = unitLabels(row);
  if (!labels.length) return "—";
  return labels.length > 2
    ? `${labels.slice(0, 2).join("、")} +${labels.length - 2}`
    : labels.join("、");
}
/** A dependency reads best as its unit; the model-chosen key is the fallback. */
function waitingNames(row: SubtaskRow): string {
  return row.waitingFor
    .map((key) => {
      const task = byTask.value.get(`${row.run?.parentToolCallId}:${key}`);
      return (task && unitLabels(task)[0]) ?? task?.run?.name ?? key;
    })
    .join("、");
}
function actionText(row: SubtaskRow, now: number): string {
  const run = row.run;
  if (!run) return t("subtaskUnassignedHint");
  if (row.group === "queued")
    return row.waitingFor.length
      ? t("subtaskWaitingFor", { names: waitingNames(row) })
      : t("subtaskWaitingSlot", {
          position: row.slotPosition ?? 1,
          running: running.value,
          limit: props.job.maxConcurrency ?? DECOMPOSITION_DEFAULT_CONCURRENCY
        });
  if (row.group === "running") {
    const action = subtaskAction(run);
    if (action.kind === "retry")
      return subagentRetryStatus(run, now) ?? t("subtaskParentRetry");
    return action.kind === "tool"
      ? t("subtaskActionTool", { tool: action.toolName })
      : t(`subtaskAction_${action.kind}`);
  }
  if (run.status === "completed") return t("subtaskDone");
  if (run.status === "skipped") return t("subtaskSkipped");
  if (run.status === "stopped") return t("stopped");
  return run.errorMessage ?? t("failed");
}
function tone(row: SubtaskRow): string {
  const status = row.run?.status;
  if (row.group === "running") return "is-accent";
  if (status === "completed") return "is-success";
  if (status === "error") return "is-danger";
  return row.group === "queued" ? "is-queued" : "is-muted";
}
const usageText = (row: SubtaskRow) =>
  row.group === "queued" || !row.run
    ? ""
    : [
        t("subtaskToolCount", { count: row.run?.toolCalls.length ?? 0 }),
        ...(row.run?.usage
          ? [compact.value.format(row.run.usage.totalTokens)]
          : [])
      ].join(" · ");
</script>

<template>
  <div
    class="decomposition-subtask-scroll"
    role="table"
    :aria-label="t('subtasks')"
  >
    <div class="decomposition-subtask-line is-head" role="row">
      <span role="columnheader">{{ t("subtaskMember") }}</span>
      <span role="columnheader">{{ t("subtaskUnits") }}</span>
      <span role="columnheader">{{ t("subtaskAction") }}</span>
      <span class="is-time" role="columnheader">{{ t("subtaskTime") }}</span>
      <span class="is-usage" role="columnheader">{{ t("subtaskUsage") }}</span>
      <span role="columnheader"></span>
    </div>
    <ConversationRunClock v-slot="{ now }" :active="running > 0">
      <div v-for="section in sections" :key="section.group" role="rowgroup">
        <div class="decomposition-subtask-group" role="row">
          <span role="rowheader">{{
            t(`subtaskGroup_${section.group}`, { count: section.rows.length })
          }}</span>
        </div>
        <div
          v-for="row in section.rows"
          :key="row.key"
          class="decomposition-subtask-line decomposition-subtask-row"
          :class="{ 'is-clickable': row.run }"
          role="row"
          @click="row.run && emit('open', row.key)"
        >
          <span class="is-member" role="cell">
            <span
              class="decomposition-subtask-dot"
              :class="tone(row)"
              aria-hidden="true"
            ></span
            >{{ row.run?.name ?? "—" }}
          </span>
          <span
            class="is-unit"
            role="cell"
            :title="unitLabels(row).join('、')"
            >{{ unitText(row) }}</span
          >
          <span
            class="is-action"
            :class="tone(row)"
            role="cell"
            :title="actionText(row, now)"
            >{{ actionText(row, now) }}</span
          >
          <span class="is-time" role="cell">{{
            row.run ? subagentDuration(row.run, now) : ""
          }}</span>
          <span class="is-usage" role="cell">{{
            row.run ? usageText(row) : ""
          }}</span>
          <span class="is-open" role="cell">
            <button
              v-if="row.run"
              type="button"
              class="decomposition-subtask-open"
              :aria-label="t('subtaskOpen', { name: row.run.name })"
              @click.stop="emit('open', row.key)"
            >
              <AppIcon name="chevron" :size="14" />
            </button>
          </span>
        </div>
      </div>
    </ConversationRunClock>
  </div>
</template>
