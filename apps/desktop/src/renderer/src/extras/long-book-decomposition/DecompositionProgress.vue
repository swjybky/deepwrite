<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  decompositionUsageLimit,
  decompositionUsageTotal,
  type DecompositionControlInput,
  type DecompositionTarget
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator, locale } from "../../i18n";
import DecompositionDialog from "./DecompositionDialog.vue";
import DecompositionSubtaskBoard from "./DecompositionSubtaskBoard.vue";
import { decompositionUnitLabel } from "./unit-label";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
const t = createScopedTranslator("extras.longBookDecomposition");
const PAGE_SIZE = 100;
const props = defineProps<{
  controller: LongBookDecompositionController;
  disabled: boolean;
}>();
const emit = defineEmits<{
  control: [
    action: DecompositionControlInput["action"],
    unitId?: string,
    choice?: "keep-user" | "regenerate"
  ];
  view: [unitId: string, title: string];
  openTarget: [target: DecompositionTarget];
  openMaterialPack: [bookId: string];
  run: [];
  stop: [];
}>();
const page = ref(0);
const conflictId = ref<string | null>(null);
const job = computed(() => props.controller.job.value);
const units = computed(() => Object.entries(job.value?.units ?? {}));
const visible = computed(() =>
  units.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE)
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(units.value.length / PAGE_SIZE))
);
const done = computed(
  () => units.value.filter(([, unit]) => unit.status === "done").length
);
const percent = computed(() =>
  units.value.length ? Math.floor((done.value / units.value.length) * 100) : 0
);
const busy = computed(() => props.controller.isBusy.value);
const usage = computed(() => {
  const value = job.value;
  if (!value?.usage?.requests) return null;
  const input = value.usage.inputTokens + value.usage.cacheReadTokens;
  return t("usageMeta", {
    used: decompositionUsageTotal(value.usage).toLocaleString(locale.value),
    hit: input ? Math.round((value.usage.cacheReadTokens / input) * 100) : 0,
    limit: decompositionUsageLimit(value).toLocaleString(locale.value)
  });
});
const finished = computed(
  () => job.value?.phase === "done" || job.value?.phase === "registry_review"
);
const started = computed(
  () =>
    units.value.some(([, unit]) => unit.status !== "pending") ||
    !["prepare_target", "read"].includes(job.value?.phase ?? "")
);
const phase = computed(() =>
  props.controller.waitingForSlot.value
    ? t("waitingForSlot")
    : job.value?.phase === "registry"
      ? t("registryPhase")
      : t(job.value?.phase ?? "idle")
);
const phaseTone = computed(() =>
  job.value?.phase === "done" ? "success" : busy.value ? "accent" : "neutral"
);
function statusTone(status: string): string {
  if (status === "done") return "success";
  if (status === "failed") return "danger";
  if (status === "conflict") return "warning";
  if (status === "running" || status === "writing") return "accent";
  return "neutral";
}
watch(
  () => job.value?.id,
  () => {
    page.value = 0;
  }
);
</script>
<template>
  <section v-if="job" class="analysis-card decomposition-progress">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">{{ t("jobEyebrow") }}</p>
        <h2>{{ t("progress") }}</h2>
      </div>
      <div class="analysis-run-actions">
        <button
          v-if="job.target"
          type="button"
          @click="emit('openTarget', job.target)"
        >
          {{ t("openTarget") }}
        </button>
        <button
          v-if="finished && job.target?.kind === 'long'"
          type="button"
          @click="emit('openMaterialPack', job.target.bookId)"
        >
          {{ t("convertToMaterials") }}
        </button>
        <button v-if="busy" type="button" @click="emit('stop')">
          <AppIcon name="stop" :size="14" />{{ t("stop") }}
        </button>
        <button
          v-else-if="!finished"
          type="button"
          class="analysis-primary-button"
          :disabled="disabled"
          @click="emit('run')"
        >
          {{ started ? t("resume") : t("start") }}
        </button>
      </div>
    </header>
    <div class="decomposition-progress-meta">
      <span class="decomposition-pill" :class="`is-${phaseTone}`">{{
        phase
      }}</span>
      <span>{{ t("completed", { done, total: units.length }) }}</span>
      <span v-if="usage" class="decomposition-usage">{{ usage }}</span>
      <strong>{{ percent }}%</strong>
    </div>
    <div
      class="decomposition-bar"
      role="progressbar"
      :aria-label="t('progress')"
      aria-valuemin="0"
      :aria-valuemax="Math.max(1, units.length)"
      :aria-valuenow="done"
    >
      <span :style="{ width: `${percent}%` }"></span>
    </div>
    <div class="decomposition-table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ t("units") }}</th>
            <th>{{ t("status") }}</th>
            <th>{{ t("attempts") }}</th>
            <th class="is-actions">{{ t("actions") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[id, unit] in visible" :key="id">
            <td class="is-unit">
              {{ decompositionUnitLabel(job, id, controller.registry.value) }}
            </td>
            <td :title="unit.lastError">
              <span
                class="decomposition-pill"
                :class="`is-${statusTone(unit.status)}`"
                >{{
                  t(unit.status === "done" ? "completedStatus" : unit.status)
                }}</span
              >
            </td>
            <td class="is-attempts">{{ unit.attempts }} / 3</td>
            <td class="is-actions">
              <div class="decomposition-row-actions">
                <button
                  v-if="unit.status === 'done'"
                  type="button"
                  @click="
                    emit(
                      'view',
                      id,
                      decompositionUnitLabel(job, id, controller.registry.value)
                    )
                  "
                >
                  {{ t("open") }}
                </button>
                <button
                  v-if="['failed', 'skipped'].includes(unit.status)"
                  type="button"
                  :disabled="disabled"
                  @click="emit('control', 'retry', id)"
                >
                  {{ t("retry") }}
                </button>
                <button
                  v-if="
                    id.startsWith('chunk:') &&
                    ['failed', 'pending'].includes(unit.status)
                  "
                  type="button"
                  :disabled="disabled"
                  @click="emit('control', 'skip', id)"
                >
                  {{ t("skip") }}
                </button>
                <template v-if="unit.status === 'conflict'"
                  ><button
                    type="button"
                    :disabled="disabled"
                    @click="
                      emit('control', 'resolve-conflict', id, 'keep-user')
                    "
                  >
                    {{ t("keepUser") }}</button
                  ><button
                    type="button"
                    :disabled="disabled"
                    @click="conflictId = id"
                  >
                    {{ t("regenerate") }}
                  </button></template
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="pageCount > 1" class="decomposition-pager">
      <button type="button" :disabled="page === 0" @click="page--">
        {{ t("previous") }}
      </button>
      <span>{{ page + 1 }} / {{ pageCount }}</span>
      <button type="button" :disabled="page + 1 >= pageCount" @click="page++">
        {{ t("next") }}
      </button>
    </div>
    <DecompositionSubtaskBoard
      :controller="controller"
      @view="(unitId, title) => emit('view', unitId, title)"
    />
  </section>
  <DecompositionDialog
    v-if="conflictId"
    :title="t('regenerate')"
    :message="t('conflictHelp')"
    :confirm-label="t('approveRegenerate')"
    :cancel-label="t('cancel')"
    @cancel="conflictId = null"
    @confirm="
      emit('control', 'resolve-conflict', conflictId, 'regenerate');
      conflictId = null;
    "
  />
</template>
