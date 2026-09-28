<script setup lang="ts">
/**
 * The batch plan's control surface: how far the whole plan has got, and what
 * happened to each individual round.
 *
 * The panel is a pure projection of `controller.planTasks` / `planSummary` —
 * it owns no state of its own. The runner keeps mutating task objects in place,
 * so every read here has to go through `.value` on the individual refs; a
 * `shallowRef` array would not make nested ref changes reactive on its own.
 */
import { computed } from "vue";
import { uiMessage } from "../../ui-feedback";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";
import {
  taskProgressText,
  type AnalysisTaskQueueStatus,
  type AnalysisTaskRuntime
} from "./analysis-task";

const props = defineProps<{
  controller: LongBookAnalysisController;
}>();
/** Both are fire-and-forget: the page scrolls and focuses, the panel stays put. */
const emit = defineEmits<{
  showResult: [taskId: string];
  showProcess: [taskId: string];
}>();

/** Mirrors `AnalysisTaskQueueStatus`; `waiting_capacity` is a wait, not a failure. */
const STATUS_LABELS: Record<AnalysisTaskQueueStatus, string> = {
  queued: "排队中",
  running: "分析中",
  waiting_capacity: "等待并发空闲",
  completed: "已完成",
  skipped: "已跳过",
  stopped: "已停止"
};

interface PlanTaskGroup {
  presetId: string;
  presetName: string;
  tasks: AnalysisTaskRuntime[];
  completed: number;
}

const tasks = computed(() => props.controller.planTasks.value);
const summary = computed(() => props.controller.planSummary.value);
/**
 * A plan is the cartesian product of presets × rounds, ordered round-major, so
 * grouping by preset puts each preset's rounds back in chapter order.
 */
const groups = computed<PlanTaskGroup[]>(() => {
  const byPreset = new Map<string, PlanTaskGroup>();
  for (const task of tasks.value) {
    let group = byPreset.get(task.presetId);
    if (!group) {
      group = {
        presetId: task.presetId,
        presetName: task.presetName,
        tasks: [],
        completed: 0
      };
      byPreset.set(task.presetId, group);
    }
    group.tasks.push(task);
    if (task.queueStatus.value === "completed") group.completed += 1;
  }
  return [...byPreset.values()];
});
/** Distinct rounds, not tasks — the header reads "N presets × M rounds". */
const roundCount = computed(
  () => new Set(tasks.value.map((task) => task.roundIndex)).size
);
const percent = computed(() =>
  summary.value.total === 0
    ? 0
    : Math.round((summary.value.completed / summary.value.total) * 100)
);
const isRunning = computed(() =>
  tasks.value.some((task) => task.queueStatus.value === "running")
);
/** `waiting_capacity` counts too: those rounds are parked on a slot, not dead. */
const canResume = computed(
  () =>
    summary.value.queued > 0 ||
    tasks.value.some((task) => task.queueStatus.value === "stopped")
);

function statusLabel(status: AnalysisTaskQueueStatus): string {
  return STATUS_LABELS[status];
}

/** A round can be inspected once its pipeline produced a result. */
function canShowResult(task: AnalysisTaskRuntime): boolean {
  return task.state.status.value === "completed";
}

async function clearPlan(): Promise<void> {
  const cleared = await props.controller.clearPlan();
  if (cleared) uiMessage.success("拆书计划与历史记录已清理。");
  else uiMessage.warning("计划运行中，请先暂停再清理。");
}

function rerun(task: AnalysisTaskRuntime): void {
  props.controller.rerunPlanTask(task.id);
}
</script>

<template>
  <section v-if="tasks.length > 0" class="analysis-card analysis-plan-panel">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">批量计划</p>
        <h2>
          {{ groups.length }} 个预设 × {{ roundCount }} 轮 =
          {{ summary.total }} 个任务
        </h2>
      </div>
      <span class="analysis-status" :class="`is-${isRunning ? 'running' : 'idle'}`">
        <i aria-hidden="true"></i>
        {{ summary.completed }} / {{ summary.total }} 已完成
      </span>
    </header>

    <div
      class="plan-progress"
      role="progressbar"
      :aria-valuenow="summary.completed"
      aria-valuemin="0"
      :aria-valuemax="summary.total"
      :aria-label="`计划进度 ${summary.completed} / ${summary.total}`"
    >
      <span :style="{ width: `${percent}%` }"></span>
    </div>
    <div class="plan-progress-meta">
      <span v-if="summary.queued > 0">队列中 {{ summary.queued }}</span>
      <span v-if="summary.stopped > 0">已停止 {{ summary.stopped }}</span>
      <span v-if="summary.skipped.length > 0"
        >跳过 {{ summary.skipped.length }}</span
      >
      <span v-if="summary.unsaved.length > 0"
        >未落库 {{ summary.unsaved.length }}</span
      >
    </div>

    <!-- Plan-wide controls. Per-round recovery lives in the table below. -->
    <div class="plan-run-actions">
      <button v-if="isRunning" type="button" @click="controller.pausePlan">
        暂停计划
      </button>
      <button
        v-else-if="canResume"
        type="button"
        @click="controller.resumePlan"
      >
        继续计划
      </button>
      <!--
        Also drops the plan files earlier runs left behind: they are written
        once per run, carry a full round checkpoint each, and nothing reads
        them again. Disabled while running, since the tasks it would discard
        are the ones in flight.
      -->
      <button
        class="plan-clear-button"
        type="button"
        :disabled="isRunning"
        @click="clearPlan"
      >
        清理记录
      </button>
    </div>

    <!-- Raised only when the account ran out: every other failure skips one round. -->
    <div v-if="summary.haltedReason" class="plan-halt" role="alert">
      <strong>计划已停止</strong>
      <span>{{ summary.haltedReason }}</span>
      <small>检查账户余额或额度后，可逐轮重跑或继续计划。</small>
    </div>

    <!--
      One table per preset. Rounds inside a group are already in chapter order
      because the plan was built round-major (A1,B1,C1,A2,…).
    -->
    <div
      v-for="group in groups"
      :key="group.presetId"
      class="plan-group"
    >
      <div class="plan-group-heading">
        <strong>{{ group.presetName }}</strong>
        <small>{{ group.completed }} / {{ group.tasks.length }} 轮已完成</small>
      </div>
      <table class="plan-table">
        <thead>
          <tr>
            <th scope="col">章节</th>
            <th scope="col">状态</th>
            <th scope="col">进度</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <!--
            `is-active` follows the focused task, which is also what the shared
            执行过程 / 结果 panels above are projecting. `is-problem` marks the two
            ways a round can end up needing attention: skipped, or finished but
            never written to its library.
          -->
          <tr
            v-for="task in group.tasks"
            :key="task.id"
            :class="{
              'is-active':
                task.id === controller.activeTaskId.value,
              'is-problem':
                task.queueStatus.value === 'skipped' ||
                task.writeError.value !== null
            }"
          >
            <td>
              <strong>第 {{ task.startOrder }}-{{ task.endOrder }} 章</strong>
              <small v-if="task.attempts.value > 0"
                >重试 {{ task.attempts.value }} 次</small
              >
            </td>
            <td>
              <span
                class="plan-task-status"
                :class="`is-${task.queueStatus.value}`"
              >
                {{ statusLabel(task.queueStatus.value) }}
              </span>
              <small v-if="task.queueError.value" class="plan-task-error">{{
                task.queueError.value
              }}</small>
              <small v-else-if="task.writeError.value" class="plan-task-error"
                >写入素材库失败：{{ task.writeError.value }}</small
              >
            </td>
            <td>{{ taskProgressText(task) }}</td>
            <td class="plan-task-actions">
              <!-- Focusing first is what makes the panels above switch to this round. -->
              <button
                type="button"
                @click="
                  controller.focusTask(task.id);
                  emit('showProcess', task.id);
                "
              >
                查看过程
              </button>
              <button
                v-if="canShowResult(task)"
                type="button"
                @click="
                  controller.focusTask(task.id);
                  emit('showResult', task.id);
                "
              >
                查看结果
              </button>
              <button
                v-if="task.writeError.value"
                type="button"
                @click="controller.retryPlanWrite(task.id)"
              >
                重新写入
              </button>
              <button
                type="button"
                :disabled="task.queueStatus.value === 'running'"
                @click="rerun(task)"
              >
                重跑此轮
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="summary.skipped.length > 0" class="plan-digest is-error">
      <strong>跳过的轮次</strong>
      <ul>
        <li v-for="item in summary.skipped" :key="item.label">
          <span>{{ item.label }}</span>
          <small>{{ item.error }}</small>
        </li>
      </ul>
    </div>
    <div v-if="summary.unsaved.length > 0" class="plan-digest is-warning">
      <strong>已完成但未写入素材库</strong>
      <ul>
        <li v-for="item in summary.unsaved" :key="item.label">
          <span>{{ item.label }}</span>
          <small>{{ item.error }}</small>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.analysis-plan-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plan-progress {
  overflow: hidden;
  height: 6px;
  border-radius: 3px;
  background: var(--theme-line-soft, #e8e8e4);
}

.plan-progress > span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent, #5b82b8);
  transition: width 220ms ease;
}

.plan-progress-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--text-tertiary, #8b8f94);
  font-size: 0.785714rem;
}

.plan-run-actions {
  display: flex;
  gap: 8px;
}

.plan-run-actions > button {
  padding: 5px 12px;
  border: 1px solid var(--theme-line, #d9d9d6);
  border-radius: 8px;
  background: var(--surface-main, #ffffff);
  color: var(--text-primary, #303338);
  font-size: 0.785714rem;
  cursor: pointer;
}

.plan-run-actions > button:hover {
  background: var(--surface-hover, #f0f0ee);
}

.plan-halt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--danger, #c64b4b) 35%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--danger, #c64b4b) 8%, transparent);
  font-size: 0.785714rem;
}

.plan-halt > small,
.plan-digest small {
  color: var(--text-secondary, #666a70);
}

.plan-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plan-group-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.857143rem;
}

.plan-group-heading > small {
  color: var(--text-tertiary, #8b8f94);
  font-size: 0.785714rem;
}

.plan-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.785714rem;
}

.plan-table th {
  padding: 5px 8px;
  border-bottom: 1px solid var(--theme-line-soft, #e8e8e4);
  color: var(--text-tertiary, #8b8f94);
  font-weight: 520;
  text-align: left;
}

.plan-table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--theme-line-soft, #e8e8e4);
  color: var(--text-secondary, #666a70);
  vertical-align: top;
}

.plan-table tr.is-active td {
  background: var(--surface-selected, #e7e7e4);
}

.plan-table tr.is-problem td:first-child {
  box-shadow: inset 2px 0 0 var(--danger, #c64b4b);
}

.plan-table td strong {
  display: block;
  color: var(--text-primary, #303338);
  font-weight: 560;
}

.plan-table td small {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary, #8b8f94);
}

.plan-task-status {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 7px;
  background: var(--surface-hover, #ececea);
  color: var(--text-secondary, #666a70);
  white-space: nowrap;
}

.plan-task-status.is-completed {
  background: color-mix(in srgb, var(--accent, #5b82b8) 16%, transparent);
  color: var(--accent, #5b82b8);
}

.plan-task-status.is-running {
  background: color-mix(in srgb, var(--accent, #5b82b8) 26%, transparent);
  color: var(--accent, #5b82b8);
}

.plan-task-status.is-skipped,
.plan-task-status.is-stopped {
  background: color-mix(in srgb, var(--danger, #c64b4b) 14%, transparent);
  color: var(--danger, #c64b4b);
}

.plan-task-error {
  color: var(--danger, #c64b4b) !important;
  word-break: break-word;
}

.plan-task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  white-space: nowrap;
}

.plan-task-actions > button {
  padding: 3px 8px;
  border: 1px solid var(--theme-line, #d9d9d6);
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary, #666a70);
  font-size: 0.75rem;
  cursor: pointer;
}

.plan-task-actions > button:hover:not(:disabled) {
  background: var(--surface-hover, #ececea);
  color: var(--text-primary, #17191c);
}

.plan-task-actions > button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.plan-digest {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.785714rem;
}

.plan-digest.is-error {
  background: color-mix(in srgb, var(--danger, #c64b4b) 8%, transparent);
}

.plan-digest.is-warning {
  background: color-mix(in srgb, var(--warning, #b8862f) 10%, transparent);
}

.plan-digest ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-digest li {
  display: flex;
  flex-direction: column;
}

.plan-digest li > span {
  color: var(--text-primary, #303338);
  font-weight: 520;
}
</style>
