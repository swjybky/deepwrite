<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import AnalysisProcessPanel from "./AnalysisProcessPanel.vue";
import type { LongBookAnalysisProcessEntry } from "./analysis-process";
import type { LongBookAnalysisRunStatus } from "./useLongBookAnalysis";

const props = defineProps<{
  status: LongBookAnalysisRunStatus;
  entries: readonly LongBookAnalysisProcessEntry[];
  currentActivity: string;
  liveOutput: string;
  error: string | null;
  title: string;
  progressText?: string;
}>();
const panelId = useId();
const panel = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const now = ref(Date.now());
// `waiting` counts as busy: the round is parked on a slot, not finished.
const busy = computed(() =>
  ["running", "stopping", "waiting"].includes(props.status)
);
const statusLabel = computed(
  () =>
    ({
      idle: "等待开始",
      running: "分析中",
      stopping: "正在停止",
      waiting: "等待并发空闲",
      stopped: "已停止",
      error: "分析失败",
      completed: "分析完成"
    })[props.status]
);
const elapsed = computed(() => {
  const first = props.entries[0];
  if (!first) return "0:00";
  const end = busy.value
    ? now.value
    : Date.parse(props.entries.at(-1)!.createdAt);
  const seconds = Math.max(
    0,
    Math.floor((end - Date.parse(first.createdAt)) / 1000)
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  busy,
  (running) => {
    clearInterval(timer);
    now.value = Date.now();
    if (running)
      timer = setInterval(() => {
        now.value = Date.now();
      }, 1000);
  },
  { immediate: true }
);
watch(
  () => props.status,
  (status) => {
    if (status === "idle") panel.value?.hidePopover();
  }
);
onUnmounted(() => clearInterval(timer));
function close() {
  panel.value?.hidePopover();
  trigger.value?.focus();
}
function onToggle(event: Event) {
  open.value = (event as ToggleEvent).newState === "open";
}
</script>

<template>
  <div class="analysis-run-status">
    <button
      ref="trigger"
      type="button"
      class="analysis-status-trigger"
      :class="`is-${status}`"
      :disabled="status === 'idle'"
      :popovertarget="panelId"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-haspopup="dialog"
      :aria-label="`${statusLabel}${status === 'idle' ? '' : '，查看运行详情'}`"
    >
      <i :class="{ 'is-busy': busy }" aria-hidden="true"></i>
      <span aria-live="polite">{{ statusLabel }}</span>
      <time v-if="status !== 'idle'">{{ elapsed }}</time>
      <span v-if="status !== 'idle'" class="analysis-status-link"
        >查看详情</span
      >
    </button>
    <section
      :id="panelId"
      ref="panel"
      popover="auto"
      role="dialog"
      :aria-labelledby="`${panelId}-title`"
      class="analysis-status-popover"
      @toggle="onToggle"
    >
      <header class="analysis-status-heading">
        <div>
          <p>运行状态 · {{ statusLabel }}</p>
          <h2 :id="`${panelId}-title`">{{ title }}</h2>
        </div>
        <button
          type="button"
          autofocus
          aria-label="关闭运行详情"
          @click="close"
        >
          <AppIcon name="close" :size="18" />
        </button>
      </header>
      <div class="analysis-status-summary">
        <div>
          <span>当前进度</span>
          <strong aria-live="polite">{{
            currentActivity || statusLabel
          }}</strong>
          <small v-if="progressText">{{ progressText }}</small>
        </div>
        <div>
          <span>任务历时</span>
          <strong>{{ elapsed }}</strong>
          <small>包含等待时间</small>
        </div>
      </div>
      <AnalysisProcessPanel
        v-if="open"
        :entries="entries"
        :current-activity="currentActivity"
        :live-output="liveOutput"
        :error="error"
        :accessible-label="title"
      />
      <p v-if="busy && !liveOutput.trim()" class="analysis-status-hint">
        模型尚未返回公开输出。收到阶段变化或分析说明后会自动更新，可关闭此面板继续使用。
      </p>
    </section>
  </div>
</template>

<style scoped>
.analysis-run-status {
  flex-shrink: 0;
  max-width: 100%;
}
.analysis-run-status .analysis-status-trigger {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.821429rem;
  line-height: 1.4;
}
.analysis-run-status .analysis-status-trigger:disabled {
  opacity: 1;
  color: var(--text-secondary);
}
.analysis-status-trigger i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.analysis-status-trigger i.is-busy {
  background: var(--accent);
  animation: analysis-pulse 1.8s ease-in-out infinite;
}
.analysis-status-trigger.is-completed i {
  background: var(--success);
}
.analysis-status-trigger.is-error i {
  background: var(--danger);
}
.analysis-status-trigger time {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.analysis-status-link {
  padding-left: 8px;
  border-left: 1px solid var(--theme-line);
  color: var(--text-secondary);
}
.analysis-status-trigger:hover .analysis-status-link {
  color: var(--text-primary);
}
.analysis-run-status button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.analysis-status-popover {
  position: fixed;
  inset: 0;
  width: min(640px, calc(100vw - 32px));
  max-height: min(780px, calc(100dvh - 48px));
  box-sizing: border-box;
  margin: auto;
  padding: 24px;
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 18px;
  background: var(--surface-main);
  color: var(--text-primary);
  box-shadow: 0 16px 60px
    color-mix(in srgb, var(--text-primary) 18%, transparent);
}
.analysis-status-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.analysis-status-heading p {
  margin: 0 0 6px;
  font-size: 0.785714rem;
  color: var(--text-secondary);
}
.analysis-status-heading h2 {
  margin: 0;
  font-size: 1.285714rem;
}
.analysis-status-heading button {
  padding: 8px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.analysis-status-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 16px;
  margin-top: 20px;
  background: var(--surface-muted);
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
}
.analysis-status-summary > div {
  display: grid;
  gap: 6px;
  align-content: start;
}
.analysis-status-summary span,
.analysis-status-summary small {
  color: var(--text-secondary);
  font-size: 0.785714rem;
}
.analysis-status-summary strong {
  overflow-wrap: anywhere;
  font-size: 0.928571rem;
  font-variant-numeric: tabular-nums;
}
.analysis-status-hint {
  margin: 14px 0 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.6;
}
@keyframes analysis-pulse {
  50% {
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
}
@media (prefers-reduced-motion: reduce) {
  .analysis-status-trigger i.is-busy {
    animation: none;
  }
}
@media (max-width: 700px) {
  .analysis-status-popover {
    padding: 16px;
  }
  .analysis-status-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
