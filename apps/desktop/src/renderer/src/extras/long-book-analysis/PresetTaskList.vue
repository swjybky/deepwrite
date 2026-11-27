<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { LongBookAnalysisPreset } from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator } from "../../i18n";
import { presetLabel } from "../analysis-ui/preset-labels";
import type { PresetBatchItem } from "../analysis-ui/preset-batch";
import { analysisOutputTypeLabel } from "./task-options";
import "./preset-batch.css";

type Item = PresetBatchItem<LongBookAnalysisPreset, unknown>;

const t = createScopedTranslator("extras.analysisUi");
const lt = createScopedTranslator("extras.longBookAnalysis");
const props = defineProps<{
  presets: readonly LongBookAnalysisPreset[];
  items: readonly Item[];
  savedIds: readonly string[];
  live: boolean;
  disabled: boolean;
  resumeLabel: string;
}>();
const emit = defineEmits<{
  remove: [id: string];
  stop: [id: string];
  retry: [id: string];
  process: [id: string];
  result: [id: string];
}>();
const now = ref(Date.now());
const anyActive = computed(() => props.items.some(isActive));
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  anyActive,
  (active) => {
    clearInterval(timer);
    now.value = Date.now();
    if (active) timer = setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true }
);
onUnmounted(() => clearInterval(timer));

function isActive(item: Item): boolean {
  return item.state === "running" || item.state === "stopping";
}
function outputLabel(preset: LongBookAnalysisPreset): string {
  const domain =
    preset.output.domain === "material"
      ? lt("materialEntry")
      : lt("skillEntry");
  return `${domain} · ${analysisOutputTypeLabel(preset)}`;
}
function detail(item: Item): string {
  switch (item.state) {
    case "queued":
      return item.waiting ? t("taskWaitingSlot") : t("taskQueued");
    case "running":
      return (
        item.runner.progressText?.value || item.runner.activity.value || ""
      );
    case "stopping":
      return t("stopping");
    case "stopped":
      return item.started ? t("stopped") : t("taskNotStarted");
    case "error":
      return item.failure ?? item.runner.error.value ?? t("analysisFailed");
    case "completed":
      return props.savedIds.includes(item.id)
        ? t("taskSaved")
        : t("taskAwaitingSave");
  }
}
function elapsed(item: Item): string {
  if (!item.started || item.state === "queued") return "—";
  const times = item.runner.entries.value
    .map((entry) => Date.parse(entry.createdAt ?? ""))
    .filter(Number.isFinite);
  if (!times.length) return "—";
  const end = isActive(item) ? now.value : times.at(-1)!;
  const seconds = Math.max(0, Math.floor((end - times[0]!) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
</script>

<template>
  <div class="preset-task-list" :class="{ 'is-live': live }" role="list">
    <template v-if="live">
      <div
        v-for="item in items"
        :key="item.id"
        class="preset-task-row"
        :class="`is-${item.state}`"
        role="listitem"
      >
        <span
          class="preset-task-state"
          :class="`is-${item.state}`"
          role="img"
          :aria-label="detail(item)"
          ><AppIcon
            v-if="item.state === 'completed'"
            name="check"
            :size="11"
          /><template v-else-if="item.state === 'error'">!</template></span
        >
        <div class="preset-task-copy">
          <strong>{{ presetLabel(item.preset) }}</strong>
          <span>{{ detail(item) }}</span>
        </div>
        <small class="preset-task-chip">{{ outputLabel(item.preset) }}</small>
        <time class="preset-task-time">{{ elapsed(item) }}</time>
        <span class="preset-task-actions">
          <button
            v-if="item.started && item.state !== 'completed'"
            type="button"
            @click="emit('process', item.id)"
          >
            {{ t("taskProcess") }}
          </button>
          <button
            v-if="item.state === 'running'"
            type="button"
            @click="emit('stop', item.id)"
          >
            {{ t("taskStop") }}
          </button>
          <button
            v-else-if="item.state === 'queued'"
            type="button"
            @click="emit('stop', item.id)"
          >
            {{ t("taskDequeue") }}
          </button>
          <button
            v-else-if="item.state === 'error' || item.state === 'stopped'"
            type="button"
            @click="emit('retry', item.id)"
          >
            {{ item.started ? resumeLabel : t("taskRequeue") }}
          </button>
          <button
            v-else-if="item.state === 'completed'"
            type="button"
            @click="emit('result', item.id)"
          >
            {{ t("taskViewResult") }}
          </button>
        </span>
      </div>
    </template>
    <template v-else>
      <div
        v-for="preset in presets"
        :key="preset.id"
        class="preset-task-row"
        role="listitem"
      >
        <div class="preset-task-copy">
          <strong>{{ presetLabel(preset) }}</strong>
          <span>{{ presetLabel(preset, "description") }}</span>
        </div>
        <small class="preset-task-chip">{{ outputLabel(preset) }}</small>
        <button
          v-if="presets.length > 1"
          type="button"
          class="preset-task-remove"
          :aria-label="t('removePreset', { name: presetLabel(preset) })"
          :title="t('removePreset', { name: presetLabel(preset) })"
          :disabled="disabled"
          @click="emit('remove', preset.id)"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </template>
  </div>
</template>
