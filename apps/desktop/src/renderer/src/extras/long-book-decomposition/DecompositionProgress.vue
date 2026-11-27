<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  decompositionUsageLimit,
  decompositionUsageTotal,
  getModelContentBlockReason,
  isModelQuotaExhausted,
  isSkippableDecompositionUnitId,
  type DecompositionControlInput,
  type DecompositionModelSelection,
  type DecompositionModelsInput,
  type DecompositionTarget,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator, locale } from "../../i18n";
import { formatModelProviderError } from "../../i18n/errors";
import DecompositionDialog from "./DecompositionDialog.vue";
import DecompositionModelField from "./DecompositionModelField.vue";
import DecompositionSubtaskBoard from "./DecompositionSubtaskBoard.vue";
import { decompositionUnitLabel } from "./unit-label";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
const t = createScopedTranslator("extras.longBookDecomposition");
const PAGE_SIZE = 100;
type UnitFilter = "all" | "failed" | "unfinished" | "skipped" | "done";
const UNIT_FILTERS: readonly UnitFilter[] = [
  "all",
  "failed",
  "unfinished",
  "skipped",
  "done"
];
const props = withDefaults(
  defineProps<{
    controller: LongBookDecompositionController;
    models?: readonly ModelConfig[];
    savingModels?: boolean;
    disabled: boolean;
  }>(),
  {
    models: () => [],
    savingModels: false
  }
);
const emit = defineEmits<{
  control: [
    action: DecompositionControlInput["action"],
    unitId?: string,
    choice?: "keep-user" | "regenerate"
  ];
  view: [unitId: string, title: string];
  openTarget: [target: DecompositionTarget];
  openMaterialPack: [bookId: string];
  updateModels: [models: DecompositionModelsInput];
  run: [];
  stop: [];
}>();
const page = ref(0);
const unitFilter = ref<UnitFilter>("all");
const conflictId = ref<string | null>(null);
const skipId = ref<string | null>(null);
const ending = ref(false);
const job = computed(() => props.controller.job.value);
const units = computed(() => Object.entries(job.value?.units ?? {}));
const failedUnits = computed(() =>
  units.value.filter(([, unit]) => ["failed", "conflict"].includes(unit.status))
);
const unfinishedUnits = computed(() => {
  const list = units.value.filter(
    ([, unit]) => !["done", "skipped"].includes(unit.status)
  );
  return [...list].sort(([, a], [, b]) => {
    const rank = (status: string) =>
      status === "failed" || status === "conflict" ? 0 : 1;
    return rank(a.status) - rank(b.status);
  });
});
const skippedUnits = computed(() =>
  units.value.filter(([, unit]) => unit.status === "skipped")
);
const doneUnits = computed(() =>
  units.value.filter(([, unit]) => unit.status === "done")
);
const unitCounts = computed<Record<UnitFilter, number>>(() => ({
  all: units.value.length,
  failed: failedUnits.value.length,
  unfinished: unfinishedUnits.value.length,
  skipped: skippedUnits.value.length,
  done: doneUnits.value.length
}));
const filteredUnits = computed(() => {
  if (unitFilter.value === "failed") return failedUnits.value;
  if (unitFilter.value === "unfinished") return unfinishedUnits.value;
  if (unitFilter.value === "skipped") return skippedUnits.value;
  if (unitFilter.value === "done") return doneUnits.value;
  if (job.value?.status === "failed" && failedUnits.value.length) {
    return [...units.value].sort(([, a], [, b]) => {
      const rank = (status: string) =>
        status === "failed" || status === "conflict" ? 0 : 1;
      return rank(a.status) - rank(b.status);
    });
  }
  return units.value;
});
const visible = computed(() =>
  filteredUnits.value.slice(
    page.value * PAGE_SIZE,
    (page.value + 1) * PAGE_SIZE
  )
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredUnits.value.length / PAGE_SIZE))
);
const done = computed(() => doneUnits.value.length);
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
    ["stopped", "failed", "ended"].includes(job.value?.status ?? "") ||
    job.value?.phase === "prepare_target" ||
    units.value.some(([, unit]) => unit.status !== "pending") ||
    !["prepare_target", "read"].includes(job.value?.phase ?? "")
);
const canEnd = computed(
  () =>
    !busy.value &&
    !finished.value &&
    Boolean(job.value) &&
    job.value!.status !== "ended" &&
    (started.value || failedUnits.value.length > 0)
);
const isContentBlocked = computed(() => {
  if (busy.value || job.value?.status !== "failed") return false;
  return Boolean(
    getModelContentBlockReason(job.value.lastError) ||
    failedUnits.value.some(([, unit]) =>
      Boolean(getModelContentBlockReason(unit.lastError))
    )
  );
});
const phase = computed(() => {
  if (!busy.value && job.value?.status === "failed")
    return t(isContentBlocked.value ? "contentBlockedFailed" : "failedStatus");
  if (!busy.value && job.value?.status === "ended") return t("endedStatus");
  if (!busy.value && job.value?.status === "stopped")
    return t(
      isModelQuotaExhausted(job.value.lastError) ? "quotaPaused" : "stopped"
    );
  if (props.controller.waitingForSlot.value) return t("waitingForSlot");
  return job.value?.phase === "registry"
    ? t("registryPhase")
    : t(job.value?.phase ?? "idle");
});
const phaseTone = computed(() =>
  job.value?.phase === "done"
    ? "success"
    : busy.value
      ? "accent"
      : job.value?.status === "failed"
        ? "danger"
        : "neutral"
);
function statusTone(status: string): string {
  if (status === "done") return "success";
  if (status === "failed") return "danger";
  if (status === "conflict") return "warning";
  if (status === "running" || status === "writing") return "accent";
  return "neutral";
}
const readingLocked = computed(
  () =>
    !job.value ||
    props.disabled ||
    busy.value ||
    !["prepare_target", "read"].includes(job.value.phase)
);
const readingDone = computed(
  () =>
    Boolean(job.value) && !["prepare_target", "read"].includes(job.value!.phase)
);
const integrationLocked = computed(
  () => !job.value || props.disabled || busy.value || job.value.phase === "done"
);
const modelsHint = computed(() => {
  if (!job.value || job.value.phase === "done") return "";
  if (busy.value) return t("modelsHintRunning");
  if (isModelQuotaExhausted(job.value.lastError)) return t("modelsHintQuota");
  if (job.value.status === "failed") return t("modelsHintFailed");
  if (job.value.status === "ended") return t("modelsHintEnded");
  return t("modelsHintPaused");
});
const remainingPhases = computed(() => {
  if (!job.value || job.value.phase === "done") return "";
  const order = [
    "read",
    "registry",
    "integrate",
    "review",
    "finalize"
  ] as const;
  const current =
    job.value.phase === "prepare_target"
      ? -1
      : job.value.phase === "registry_review"
        ? 1
        : order.indexOf(job.value.phase as (typeof order)[number]);
  const sep = locale.value.startsWith("zh") ? "、" : ", ";
  return order
    .slice(Math.max(0, current + 1))
    .map((item) => t(item === "registry" ? "registryPhase" : item))
    .join(sep);
});
function unitLabel(id: string): string {
  return job.value
    ? decompositionUnitLabel(job.value, id, props.controller.registry.value)
    : id;
}
function formatUnitError(message?: string): string {
  return message ? formatModelProviderError(message) : "";
}
function skipLabel(id: string): string {
  if (id.startsWith("chunk:")) return t("skip");
  if (id.startsWith("character-volume:")) return t("skipBiography");
  return t("skipCharacter");
}
const skipConfirmMessage = computed(() => {
  const id = skipId.value;
  if (!id) return "";
  const name = unitLabel(id);
  if (id.startsWith("chunk:")) return t("skipChunkHelp", { name });
  if (id.startsWith("character-volume:"))
    return t("skipBiographyHelp", { name });
  return t("skipCharacterHelp", { name });
});
const endConfirmMessage = computed(() =>
  t("endConfirmMessage", {
    done: done.value,
    unfinished: unfinishedUnits.value.length
  })
);
const endedSummaryText = computed(() =>
  skippedUnits.value.length
    ? t("endedBannerSummaryWithSkipped", {
        done: done.value,
        unfinished: unfinishedUnits.value.length,
        skipped: skippedUnits.value.length
      })
    : t("endedBannerSummary", {
        done: done.value,
        unfinished: unfinishedUnits.value.length
      })
);
function saveSlotModels(
  slot: "reading" | "integration",
  payload: {
    primary: DecompositionModelSelection;
    fallbacks: readonly DecompositionModelSelection[];
  }
) {
  const current = job.value;
  if (!current) return;
  const pick = ({
    modelId,
    thinkingLevel
  }: DecompositionModelSelection): DecompositionModelSelection => ({
    modelId,
    thinkingLevel
  });
  const reading =
    slot === "reading" ? pick(payload.primary) : pick(current.models.reading);
  const integration =
    slot === "integration"
      ? pick(payload.primary)
      : pick(current.models.integration);
  const readingFallbacks =
    slot === "reading"
      ? payload.fallbacks.map(pick)
      : (current.models.readingFallbacks ?? []).map(pick);
  const integrationFallbacks =
    slot === "integration"
      ? payload.fallbacks.map(pick)
      : (current.models.integrationFallbacks ?? []).map(pick);
  emit("updateModels", {
    reading,
    integration,
    ...(readingFallbacks.length ? { readingFallbacks } : {}),
    ...(integrationFallbacks.length ? { integrationFallbacks } : {})
  });
}
watch(
  () => job.value?.id,
  () => {
    page.value = 0;
    unitFilter.value = "all";
    skipId.value = null;
    ending.value = false;
    conflictId.value = null;
  }
);
watch(unitFilter, () => {
  page.value = 0;
});
watch(pageCount, (count) => {
  if (page.value >= count) page.value = Math.max(0, count - 1);
});
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
          :class="{ 'analysis-primary-button': job.status === 'ended' }"
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
        <template v-else-if="!finished">
          <button
            v-if="canEnd"
            type="button"
            :disabled="disabled"
            @click="ending = true"
          >
            {{ t("endAndKeepProgress") }}
          </button>
          <button
            type="button"
            :class="{
              'analysis-primary-button': job.status !== 'ended' || !job.target
            }"
            :disabled="disabled"
            @click="emit('run')"
          >
            {{ started ? t("resume") : t("start") }}
          </button>
        </template>
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
    <div
      v-if="!busy && job.status === 'failed'"
      class="decomposition-status-banner is-danger"
      role="status"
    >
      <div class="decomposition-status-banner-head">
        <h3>
          {{
            failedUnits.length
              ? isContentBlocked
                ? t("failedContentBlockTitle", { count: failedUnits.length })
                : t("failedBannerTitle", { count: failedUnits.length })
              : t("failedGenericTitle")
          }}
        </h3>
        <button
          v-if="failedUnits.length > 6"
          type="button"
          @click="unitFilter = 'failed'"
        >
          {{ t("unitFilter_failed", { count: failedUnits.length }) }}
        </button>
      </div>
      <p class="decomposition-status-banner-summary">
        {{
          failedUnits.length
            ? t("failedBannerHint")
            : formatUnitError(job.lastError)
        }}
      </p>
      <ul v-if="failedUnits.length" class="decomposition-status-list">
        <li
          v-for="[id, unit] in failedUnits.slice(0, 6)"
          :key="id"
          class="decomposition-status-item"
        >
          <div class="decomposition-status-item-main">
            <span class="decomposition-status-item-title">{{
              unitLabel(id)
            }}</span>
            <span
              class="decomposition-pill"
              :class="`is-${statusTone(unit.status)}`"
              >{{ t(unit.status) }}</span
            >
            <p v-if="unit.lastError" class="decomposition-status-item-reason">
              {{ formatUnitError(unit.lastError) }}
            </p>
          </div>
          <div class="decomposition-row-actions">
            <button
              v-if="unit.status === 'failed'"
              type="button"
              :disabled="disabled"
              @click="emit('control', 'retry', id)"
            >
              {{ t("retry") }}
            </button>
            <button
              v-if="
                isSkippableDecompositionUnitId(id) && unit.status === 'failed'
              "
              type="button"
              :disabled="disabled"
              @click="skipId = id"
            >
              {{ skipLabel(id) }}
            </button>
          </div>
        </li>
      </ul>
    </div>
    <div
      v-else-if="!busy && job.status === 'ended'"
      class="decomposition-status-banner"
      role="status"
    >
      <div class="decomposition-status-banner-head">
        <h3>{{ t("endedBannerTitle") }}</h3>
        <button
          v-if="unfinishedUnits.length > 8"
          type="button"
          @click="unitFilter = 'unfinished'"
        >
          {{ t("viewUnfinished") }}
        </button>
      </div>
      <p class="decomposition-status-banner-summary">
        {{ endedSummaryText }}
        <template v-if="remainingPhases">
          {{ t("endedRemainingPhases", { phases: remainingPhases }) }}
        </template>
      </p>
      <ul v-if="unfinishedUnits.length" class="decomposition-status-list">
        <li
          v-for="[id, unit] in unfinishedUnits.slice(0, 8)"
          :key="id"
          class="decomposition-status-item"
        >
          <div class="decomposition-status-item-main">
            <span class="decomposition-status-item-title">{{
              unitLabel(id)
            }}</span>
            <span
              class="decomposition-pill"
              :class="`is-${statusTone(unit.status)}`"
              >{{ t(unit.status) }}</span
            >
            <p
              v-if="unit.lastError && unit.status === 'failed'"
              class="decomposition-status-item-reason"
            >
              {{ formatUnitError(unit.lastError) }}
            </p>
          </div>
        </li>
      </ul>
    </div>
    <div class="decomposition-models-bar">
      <div class="decomposition-models-grid">
        <div class="decomposition-models-slot">
          <div class="decomposition-models-slot-head">
            <span class="setup-field-label">{{ t("readingModel") }}</span>
            <span v-if="readingDone" class="decomposition-models-locked-tag">{{
              t("phaseDoneTag")
            }}</span>
          </div>
          <DecompositionModelField
            :models="models"
            :model-id="job.models.reading.modelId"
            :thinking-level="job.models.reading.thinkingLevel"
            :fallbacks="job.models.readingFallbacks ?? []"
            :label="t('readingModel')"
            :disabled="readingLocked"
            :saving="savingModels"
            confirm-save
            @save="saveSlotModels('reading', $event)"
          />
        </div>
        <div class="decomposition-models-slot">
          <div class="decomposition-models-slot-head">
            <span class="setup-field-label">{{ t("integrationModel") }}</span>
            <span
              v-if="job.phase === 'done'"
              class="decomposition-models-locked-tag"
              >{{ t("phaseDoneTag") }}</span
            >
          </div>
          <DecompositionModelField
            :models="models"
            :model-id="job.models.integration.modelId"
            :thinking-level="job.models.integration.thinkingLevel"
            :fallbacks="job.models.integrationFallbacks ?? []"
            :label="t('integrationModel')"
            :disabled="integrationLocked"
            :saving="savingModels"
            confirm-save
            @save="saveSlotModels('integration', $event)"
          />
        </div>
      </div>
      <p v-if="modelsHint" class="analysis-help">{{ modelsHint }}</p>
    </div>
    <div class="decomposition-table-toolbar">
      <div
        class="decomposition-segmented"
        role="group"
        :aria-label="t('units')"
      >
        <button
          v-for="item in UNIT_FILTERS"
          :key="item"
          type="button"
          :aria-pressed="unitFilter === item"
          @click="unitFilter = item"
        >
          {{ t(`unitFilter_${item}`, { count: unitCounts[item] }) }}
        </button>
      </div>
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
          <tr v-if="!visible.length">
            <td colspan="4" class="decomposition-table-empty">
              {{ t("unitFilterEmpty") }}
            </td>
          </tr>
          <tr v-for="[id, unit] in visible" :key="id">
            <td class="is-unit">
              <span>{{ unitLabel(id) }}</span>
              <p
                v-if="
                  unit.lastError && ['failed', 'conflict'].includes(unit.status)
                "
                class="decomposition-unit-error"
              >
                {{ formatUnitError(unit.lastError) }}
              </p>
            </td>
            <td
              :title="
                unit.lastError ? formatUnitError(unit.lastError) : undefined
              "
            >
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
                  @click="emit('view', id, unitLabel(id))"
                >
                  {{ t("open") }}
                </button>
                <button
                  v-if="
                    job.phase !== 'done' &&
                    ['failed', 'skipped'].includes(unit.status)
                  "
                  type="button"
                  :disabled="disabled"
                  @click="emit('control', 'retry', id)"
                >
                  {{ t("retry") }}
                </button>
                <button
                  v-if="
                    job.phase !== 'done' &&
                    isSkippableDecompositionUnitId(id) &&
                    ['failed', 'pending'].includes(unit.status)
                  "
                  type="button"
                  :disabled="disabled"
                  @click="skipId = id"
                >
                  {{ skipLabel(id) }}
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
  <DecompositionDialog
    v-if="skipId"
    :title="t('skipConfirmTitle')"
    :message="skipConfirmMessage"
    :confirm-label="t('confirmSkip')"
    :cancel-label="t('cancel')"
    @cancel="skipId = null"
    @confirm="
      emit('control', 'skip', skipId);
      skipId = null;
    "
  />
  <DecompositionDialog
    v-if="ending"
    :title="t('endConfirmTitle')"
    :message="endConfirmMessage"
    :confirm-label="t('endConfirmAction')"
    :cancel-label="t('cancel')"
    @cancel="ending = false"
    @confirm="
      emit('control', 'end');
      ending = false;
    "
  />
</template>
