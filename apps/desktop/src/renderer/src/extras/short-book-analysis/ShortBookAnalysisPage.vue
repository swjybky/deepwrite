<script setup lang="ts">
import { uiConfirm } from "../../ui-confirm";
import { presetLabel } from "../analysis-ui/preset-labels";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ShortBookAnalysisPresetSchema,
  type CatalogSnapshot,
  type LongBookAnalysisPreset,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import PresetManager from "../long-book-analysis/PresetManager.vue";
import AnalysisPageShell from "../analysis-ui/AnalysisPageShell.vue";
import AnalysisModelSettings from "../analysis-ui/AnalysisModelSettings.vue";
import AnalysisRefreshButton from "../analysis-ui/AnalysisRefreshButton.vue";
import { PRESET_BATCH_MAX_PRESETS } from "../analysis-ui/preset-batch";
import ShortAnalysisSourceControls from "./ShortAnalysisSourceControls.vue";
import AnalysisResultTabs from "../long-book-analysis/AnalysisResultTabs.vue";
import PresetBatchPanel from "../long-book-analysis/PresetBatchPanel.vue";
import type { AnalysisSaveInput } from "../long-book-analysis/analysis-result-content";
import ShortAnalysisSources from "./ShortAnalysisSources.vue";
import type { ShortBookAnalysisController } from "./useShortBookAnalysis";
import "../long-book-analysis/long-book-analysis.css";
import "./short-book-analysis.css";

const t = createScopedTranslator("extras");
const props = defineProps<{
  controller: ShortBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  openEntry: [entry: { libraryId: string; entryId: string }];
}>();
const c = props.controller;
const managerOpen = ref(false);
const saving = ref(false);
const analysisPage = ref<InstanceType<typeof AnalysisPageShell> | null>(null);
const resultAnchor = ref<HTMLElement | null>(null);
const resetVersion = ref(0);
const activeResultId = ref("");
const model = computed(
  () => props.models.find((m) => m.id === c.selectedModelId.value) ?? null
);
const disabled = computed(() => c.isBusy.value || c.loading.value);
const presetOptions = computed<PopupSelectOption[]>(() =>
  c.presets.value.map((preset) => {
    const block = c.presetBlock(preset);
    return {
      value: preset.id,
      label: presetLabel(preset),
      description:
        block === "limit"
          ? t("analysisUi.presetLimitReached", {
              max: PRESET_BATCH_MAX_PRESETS
            })
          : block === "single"
            ? t("shortBookAnalysis.singlePresetBlocked", {
                count: c.selectedIds.value.length
              })
            : preset.selectionMode === "single"
              ? t("shortBookAnalysis.single")
              : t("longBookAnalysis.multipleBooksCompact"),
      disabled: block !== null
    };
  })
);
function clearWorkspace(): void {
  c.resetWorkspace();
  resetVersion.value += 1;
}
async function act(action: () => unknown) {
  try {
    await action();
  } catch (error) {
    uiMessage.warning(
      formatError(error, t("revisionAnalysis.operationFailed"))
    );
  }
}
async function start() {
  const unsaved = c.batch.unsavedCount.value;
  if (
    unsaved &&
    !(await uiConfirm({
      message: t("analysisUi.replaceUnsavedConfirm", { count: unsaved })
    }))
  )
    return;
  return act(() => c.start());
}
async function showResult(id?: string) {
  if (id) activeResultId.value = id;
  await nextTick();
  analysisPage.value?.scrollToResult(resultAnchor.value);
}
async function savePresets(next: LongBookAnalysisPreset[]) {
  saving.value = true;
  try {
    await c.savePresets(ShortBookAnalysisPresetSchema.array().parse(next));
    managerOpen.value = false;
    uiMessage.success(t("shortBookAnalysis.shortPresetSaved"));
  } catch (error) {
    uiMessage.error(formatError(error, t("shortBookAnalysis.saveFailed")));
  } finally {
    saving.value = false;
  }
}
async function saveResult(id: string, input: AnalysisSaveInput) {
  saving.value = true;
  try {
    await c.persistResult(id, input);
    emit("refreshCatalog");
    uiMessage.success(t("shortBookAnalysis.analysisSavedToLibrary"));
  } catch (error) {
    uiMessage.error(formatError(error, t("shortBookAnalysis.saveFailed")));
  } finally {
    saving.value = false;
  }
}
async function saveResults(requests: (AnalysisSaveInput & { id: string })[]) {
  saving.value = true;
  try {
    const { saved, errors } = await c.persistResults(requests);
    emit("refreshCatalog");
    if (!errors.length)
      uiMessage.success(t("analysisUi.allResultsSaved", { count: saved }));
    else
      uiMessage.warning(
        t("analysisUi.someResultsSaveFailed", {
          saved,
          failed: errors.length,
          message: formatError(errors[0], t("shortBookAnalysis.saveFailed"))
        })
      );
  } finally {
    saving.value = false;
  }
}
watch(
  () => c.status.value,
  (status) => {
    if (status === "completed" || status === "partial") void showResult();
  }
);
onMounted(() => void act(() => c.loadPresets()));
</script>
<template>
  <AnalysisPageShell
    ref="analysisPage"
    class="long-book-analysis-page short-book-analysis-page"
    :title="t('shortBookAnalysis.shortStoryAnalysis')"
    :description="t('shortBookAnalysis.shortAnalysisDescription')"
  >
    <template #header-actions>
      <ShortAnalysisSourceControls
        :controller="c"
        :reset-version="resetVersion"
        @manage-presets="managerOpen = true"
      >
        <AnalysisModelSettings
          v-model:model-id="c.selectedModelId.value"
          v-model:thinking-level="c.selectedThinkingLevel.value"
          :models="models"
          :disabled="disabled"
        />
        <AnalysisRefreshButton
          :busy="c.isBusy.value"
          :status="c.status.value"
          :disabled="c.loading.value || saving"
          :stop="c.stop"
          :clear="clearWorkspace"
        />
      </ShortAnalysisSourceControls>
    </template>
    <ShortAnalysisSources :key="resetVersion" :controller="c" />
    <section class="analysis-card setup-card">
      <header class="analysis-card-heading">
        <div>
          <p class="analysis-eyebrow">
            {{ t("longBookAnalysis.analysisTask") }}
          </p>
          <h2>{{ t("shortBookAnalysis.chooseAnalysisPreset") }}</h2>
        </div>
      </header>
      <div class="setup-grid">
        <div class="setup-field setup-range-field">
          <span class="setup-field-label"
            >{{ t("shortBookAnalysis.bookScope")
            }}<small>{{
              t("shortBookAnalysis.determinedByPreset")
            }}</small></span
          >
          <div class="short-selection-summary">
            {{
              c.selectionLimit.value === 1
                ? t("shortBookAnalysis.singleSelectBook")
                : t("shortBookAnalysis.multipleJointAnalysis")
            }}
            <small
              v-if="
                c.selectionLimit.value === 1 &&
                c.selectedPresets.value.length > 1
              "
              >{{ t("shortBookAnalysis.singlePresetScopeHint") }}</small
            >
          </div>
        </div>
        <label class="setup-field"
          ><span class="setup-field-label"
            >{{ t("longBookAnalysis.analysisPreset")
            }}<small>{{
              t("analysisUi.multiSelectHint", {
                max: PRESET_BATCH_MAX_PRESETS
              })
            }}</small></span
          ><PopupSelect
            model-value=""
            multiple
            :selected-values="c.selectedPresetIds.value"
            :selected-summary="
              t('analysisUi.presetsSelected', {
                count: c.selectedPresetIds.value.length
              })
            "
            :options="presetOptions"
            :placeholder="t('analysisUi.choosePresets')"
            :accessible-label="t('longBookAnalysis.analysisPreset')"
            :disabled="disabled"
            :menu-min-width="280"
            @update:selected-values="
              (values) => act(() => c.selectPresets(values.map(String)))
            "
        /></label>
      </div>
      <PresetBatchPanel
        :batch="c.batch"
        :presets="c.selectedPresets.value"
        :scope-text="
          t('shortBookAnalysis.booksSelected', {
            count: c.selectedIds.value.length
          })
        "
        :can-start="
          !disabled &&
          c.selectionValid.value &&
          !!model &&
          c.selectedPresets.value.length > 0
        "
        :disabled="c.loading.value"
        :resume-label="t('analysisUi.retryPreset')"
        :process-title="t('shortBookAnalysis.shortAnalysisDetails')"
        @start="start"
        @remove="
          (id) =>
            act(() =>
              c.selectPresets(
                c.selectedPresetIds.value.filter((value) => value !== id)
              )
            )
        "
        @show-result="showResult"
      />
    </section>
    <div
      v-if="c.batch.results.value.length"
      ref="resultAnchor"
      class="analysis-result-anchor"
    >
      <AnalysisResultTabs
        @open-entry="emit('openEntry', $event)"
        v-model:active-id="activeResultId"
        :results="c.batch.results.value"
        :total="c.batch.items.value.length"
        :catalog-snapshot="catalogSnapshot"
        :saving="saving"
        :context="c.batch.context.value"
        @update="(id, result) => c.batch.updateResult(id, result)"
        @save="saveResult"
        @save-all="saveResults"
      />
    </div>
    <PresetManager
      short
      :open="managerOpen"
      :presets="c.presets.value"
      :saving="saving"
      @close="managerOpen = false"
      @save="savePresets"
      :load-defaults="c.loadPresetDefaults"
    />
  </AnalysisPageShell>
</template>
