<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { LongBookAnalysisPreset } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import AnalysisRunStatus from "../analysis-ui/AnalysisRunStatus.vue";
import { presetLabel } from "../analysis-ui/preset-labels";
import type { PresetBatch } from "../analysis-ui/preset-batch";
import PresetTaskList from "./PresetTaskList.vue";

const t = createScopedTranslator("extras.analysisUi");
const lt = createScopedTranslator("extras.longBookAnalysis");
const props = defineProps<{
  batch: PresetBatch<LongBookAnalysisPreset, unknown>;
  presets: readonly LongBookAnalysisPreset[];
  /** "已选 N 章" / "已选 1 本" */
  scopeText: string;
  canStart: boolean;
  disabled: boolean;
  resumeLabel: string;
  processTitle: string;
}>();
const emit = defineEmits<{
  start: [];
  remove: [id: string];
  showResult: [id?: string];
}>();
const status = ref<InstanceType<typeof AnalysisRunStatus> | null>(null);
const focusedId = ref("");
const items = computed(() => props.batch.items.value);
const live = computed(() => props.batch.tasksVisible.value);
const savedIds = computed(() =>
  props.batch.results.value.filter((entry) => entry.saved).map((e) => e.id)
);
const focused = computed(
  () =>
    items.value.find((item) => item.id === focusedId.value) ??
    items.value.find((item) => item.state === "running") ??
    items.value[0]
);
const count = computed(() =>
  live.value ? items.value.length : props.presets.length
);
const summary = computed(() => {
  const c = props.batch.counts.value;
  const parts: string[] = [];
  if (c.running) parts.push(t("batchCountRunning", { count: c.running }));
  if (c.queued) parts.push(t("batchCountQueued", { count: c.queued }));
  if (c.stopping) parts.push(t("batchCountStopping", { count: c.stopping }));
  parts.push(
    t("batchCountCompleted", { completed: c.completed, total: c.total })
  );
  if (c.failed) parts.push(t("batchCountFailed", { count: c.failed }));
  if (c.stopped) parts.push(t("batchCountStopped", { count: c.stopped }));
  return parts.join(" · ");
});
const startLabel = computed(() => {
  const again =
    props.batch.results.value.length > 0 || props.batch.canRetry.value;
  if (count.value <= 1) return again ? lt("analyzeAgain") : lt("startAnalysis");
  return again
    ? t("analyzeAgainBatch", { count: count.value })
    : t("startBatch", { count: count.value });
});

async function act(action: () => unknown, fallback: string): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    uiMessage.warning(formatError(error, fallback));
  }
}
async function showProcess(id: string): Promise<void> {
  focusedId.value = id;
  await nextTick();
  status.value?.open();
}
</script>

<template>
  <PresetTaskList
    v-if="live ? items.length : presets.length"
    :presets="presets"
    :items="items"
    :saved-ids="savedIds"
    :live="live"
    :disabled="disabled || batch.isBusy.value"
    :resume-label="resumeLabel"
    @remove="emit('remove', $event)"
    @stop="(id) => act(() => batch.stopItem(id), t('stopFailed'))"
    @retry="batch.retryItem($event)"
    @process="showProcess"
    @result="emit('showResult', $event)"
  />
  <div class="analysis-run-bar preset-batch-run-bar">
    <div class="analysis-run-progress">
      <strong
        >{{ scopeText }} · {{ t("presetCount", { count: count }) }}</strong
      >
      <span v-if="!live && count > 1">{{
        t("usageMultiplier", { count: count })
      }}</span>
      <AnalysisRunStatus
        ref="status"
        :status="batch.status.value"
        :entries="focused?.runner.entries.value ?? []"
        :current-activity="focused?.runner.activity.value ?? ''"
        :live-output="focused?.runner.liveOutput.value ?? ''"
        :error="focused?.failure ?? focused?.runner.error.value ?? null"
        :progress-text="focused?.runner.progressText?.value"
        :summary="items.length > 1 ? summary : undefined"
        :started-at="items.length > 1 ? batch.startedAt.value : undefined"
        :ended-at="items.length > 1 ? batch.endedAt.value : undefined"
        :title="
          focused && items.length > 1
            ? `${processTitle} · ${presetLabel(focused.preset)}`
            : processTitle
        "
      >
        <template v-if="items.length > 1" #switcher>
          <div
            class="analysis-drawer-switcher"
            role="group"
            :aria-label="t('processPreset')"
          >
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              :aria-pressed="item.id === focused?.id"
              @click="focusedId = item.id"
            >
              {{ presetLabel(item.preset) }}
            </button>
          </div>
        </template>
      </AnalysisRunStatus>
    </div>
    <div class="analysis-run-actions">
      <button
        v-if="batch.results.value.length"
        type="button"
        @click="emit('showResult')"
      >
        {{ lt("viewGeneratedResult") }}
      </button>
      <button
        v-if="batch.canRetry.value && !batch.isBusy.value"
        type="button"
        :disabled="disabled"
        @click="batch.retryFailed()"
      >
        {{ count > 1 ? t("retryFailed") : resumeLabel }}
      </button>
      <button
        v-if="batch.isBusy.value"
        type="button"
        :disabled="batch.status.value === 'stopping'"
        @click="act(() => batch.stop(), t('stopFailed'))"
      >
        {{ count > 1 ? t("stopAll") : lt("stop") }}
      </button>
      <button
        v-else
        class="analysis-primary-button"
        type="button"
        :disabled="disabled || !canStart"
        @click="emit('start')"
      >
        {{ startLabel }}
      </button>
    </div>
  </div>
</template>
