<script setup lang="ts">
import { presetLabel } from "../analysis-ui/preset-labels";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { computed, ref, watch } from "vue";
import { LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS } from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import { PRESET_BATCH_MAX_PRESETS } from "../analysis-ui/preset-batch";
import PresetBatchPanel from "./PresetBatchPanel.vue";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const t = createScopedTranslator("extras.longBookAnalysis");
const ui = createScopedTranslator("extras.analysisUi");
const props = defineProps<{
  controller: LongBookAnalysisController;
}>();
const emit = defineEmits<{ showResult: [id?: string] }>();
const selectedPresetIds = ref<string[]>([]);
const startOrder = ref(1);
const endOrder = ref(1);

const source = computed(() => props.controller.source.value);
const presets = computed(() => props.controller.presets.value);
const selectedPresets = computed(() =>
  selectedPresetIds.value.flatMap((id) => {
    const preset = presets.value.find((item) => item.id === id);
    return preset ? [preset] : [];
  })
);
const presetOptions = computed<PopupSelectOption[]>(() =>
  presets.value.map((preset) => {
    const blocked =
      !selectedPresetIds.value.includes(preset.id) &&
      selectedPresetIds.value.length >= PRESET_BATCH_MAX_PRESETS;
    return {
      value: preset.id,
      label: presetLabel(preset),
      description: blocked
        ? ui("presetLimitReached", { max: PRESET_BATCH_MAX_PRESETS })
        : presetLabel(preset, "description"),
      disabled: blocked
    };
  })
);
const selectionCount = computed(() =>
  Math.max(0, endOrder.value - startOrder.value + 1)
);

watch(
  presets,
  (next) => {
    const kept = selectedPresetIds.value.filter((id) =>
      next.some((preset) => preset.id === id)
    );
    const first = next[0]?.id;
    selectedPresetIds.value = kept.length || !first ? kept : [first];
  },
  { immediate: true }
);

watch(
  source,
  (next, previous) => {
    if (!next) return;
    if (next.id !== previous?.id) {
      startOrder.value = 1;
      endOrder.value = Math.min(
        LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
        next.chapters.length
      );
    } else normalizeRange("start");
  },
  { immediate: true }
);

function normalizeRange(anchor: "start" | "end"): void {
  const maximum = source.value?.chapters.length ?? 1;
  startOrder.value = Math.max(
    1,
    Math.min(maximum, Math.round(startOrder.value || 1))
  );
  endOrder.value = Math.max(
    1,
    Math.min(maximum, Math.round(endOrder.value || 1))
  );
  if (anchor === "start") {
    endOrder.value = Math.max(
      startOrder.value,
      Math.min(
        endOrder.value,
        startOrder.value + LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS - 1
      )
    );
  } else {
    startOrder.value = Math.min(
      endOrder.value,
      Math.max(
        startOrder.value,
        endOrder.value - LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS + 1
      )
    );
  }
}

function changeRange(anchor: "start" | "end"): void {
  normalizeRange(anchor);
  props.controller.settleTasks();
}

function selectPresets(values: readonly PopupSelectValue[]): void {
  selectedPresetIds.value = values
    .map(String)
    .slice(0, PRESET_BATCH_MAX_PRESETS);
  props.controller.settleTasks();
}

async function start(): Promise<void> {
  const unsaved = props.controller.batch.unsavedCount.value;
  if (
    unsaved &&
    !window.confirm(ui("replaceUnsavedConfirm", { count: unsaved }))
  )
    return;
  try {
    await props.controller.start({
      presetIds: selectedPresetIds.value,
      startOrder: startOrder.value,
      endOrder: endOrder.value,
      modelId: props.controller.selectedModelId.value,
      thinkingLevel: props.controller.selectedThinkingLevel.value
    });
  } catch (error: unknown) {
    uiMessage.warning(formatError(error, t("cannotStartAnalysis")));
  }
}
</script>
<template>
  <section class="analysis-card setup-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">
          {{ t("analysisTask") }}
        </p>
        <h2>{{ t("chooseRangePreset") }}</h2>
      </div>
    </header>
    <div class="setup-grid">
      <div class="setup-field setup-range-field">
        <span class="setup-field-label"
          >{{ t("chapterRange")
          }}<small>{{
            t("maxSelectedChapters", {
              count: LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
            })
          }}</small></span
        >
        <div class="chapter-range-inputs">
          <input
            v-model.number="startOrder"
            type="number"
            :aria-label="t('startChapter')"
            min="1"
            :max="source?.chapters.length ?? 1"
            :disabled="!source || controller.isBusy.value"
            @change="changeRange('start')"
          />
          <span>{{ t("to") }}</span>
          <input
            v-model.number="endOrder"
            type="number"
            :aria-label="t('endChapter')"
            min="1"
            :max="source?.chapters.length ?? 1"
            :disabled="!source || controller.isBusy.value"
            @change="changeRange('end')"
          />
        </div>
      </div>
      <label class="setup-field"
        ><span class="setup-field-label"
          >{{ t("analysisPreset")
          }}<small>{{
            ui("multiSelectHint", { max: PRESET_BATCH_MAX_PRESETS })
          }}</small></span
        ><PopupSelect
          model-value=""
          multiple
          :selected-values="selectedPresetIds"
          :selected-summary="
            ui('presetsSelected', { count: selectedPresetIds.length })
          "
          :options="presetOptions"
          :placeholder="ui('choosePresets')"
          :accessible-label="t('analysisPreset')"
          :disabled="controller.isBusy.value"
          :menu-min-width="280"
          @update:selected-values="selectPresets"
      /></label>
    </div>
    <PresetBatchPanel
      :batch="controller.batch"
      :presets="selectedPresets"
      :scope-text="t('selectedChapterCount', { count: selectionCount })"
      :can-start="
        !!source &&
        selectedPresets.length > 0 &&
        !!controller.selectedModelId.value &&
        selectionCount >= 1 &&
        selectionCount <= LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
      "
      :disabled="controller.sourceDeleting.value"
      :resume-label="t('continueIncompletePhase')"
      :process-title="t('novelAnalysisProcess')"
      @start="start"
      @remove="
        (id) => selectPresets(selectedPresetIds.filter((value) => value !== id))
      "
      @show-result="emit('showResult', $event)"
    />
  </section>
</template>
