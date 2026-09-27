<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import AnalysisPlanPanel from "./AnalysisPlanPanel.vue";
import { buildAnalysisRoundRanges } from "./plan-rounds";
import AnalysisRunStatus from "./AnalysisRunStatus.vue";
import LongAnalysisRunControls from "./LongAnalysisRunControls.vue";
import AnalysisResultPanel from "./AnalysisResultPanel.vue";
import AnalysisSourceControls from "./AnalysisSourceControls.vue";
import ChapterEditor from "./ChapterEditor.vue";
import PresetManager from "./PresetManager.vue";
import {
  analysisLibraryOption,
  analysisOutputTypeLabel,
  analysisThinkingOptions,
  compatibleAnalysisLibraries
} from "./task-options";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";
import "./long-book-analysis.css";

const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
}>();

/** Single round keeps the legacy ≤50-chapter behaviour; batch plans the whole book. */
type AnalysisMode = "single" | "batch";

const mode = ref<AnalysisMode>("single");
const selectedPresetIds = ref<string[]>([]);
const batchLibraryIds = ref<Record<string, string>>({});

const selectedPresetId = ref("");
const selectedTargetLibraryId = ref("");
const startOrder = ref(1);
const endOrder = ref(1);
const presetManagerOpen = ref(false);
const presetSaving = ref(false);
const resultSaving = ref(false);
const resultAnchor = ref<HTMLElement | null>(null);

const source = computed(() => props.controller.source.value);
const presets = computed(() => props.controller.presets.value);
const selectedPreset = computed(
  () =>
    presets.value.find((preset) => preset.id === selectedPresetId.value) ?? null
);
const resultPreset = computed(
  () =>
    presets.value.find(
      (preset) => preset.id === props.controller.activePresetId.value
    ) ?? null
);
const presetOptions = computed<PopupSelectOption[]>(() =>
  presets.value.map((preset) => ({
    value: preset.id,
    label: preset.name,
    description: preset.description
  }))
);
const modelOptions = computed<PopupSelectOption[]>(() =>
  props.models.map((model) => ({
    value: model.id,
    label: model.label,
    description: model.contextWindow
      ? `${model.provider} · ${model.contextWindow.toLocaleString()} tokens`
      : `${model.provider} · 默认按 272,000 tokens 计算`
  }))
);
const selectedModel = computed(
  () =>
    props.models.find(
      (model) => model.id === props.controller.selectedModelId.value
    ) ?? null
);
const thinkingOptions = computed<PopupSelectOption[]>(() =>
  analysisThinkingOptions(selectedModel.value)
);
const compatibleLibraries = computed(() =>
  compatibleAnalysisLibraries(selectedPreset.value, props.catalogSnapshot)
);
const targetLibraryOptions = computed<PopupSelectOption[]>(() =>
  compatibleLibraries.value.map(analysisLibraryOption)
);
const outputTypeLabel = computed(() =>
  analysisOutputTypeLabel(selectedPreset.value)
);
const targetLibraryPlaceholder = computed(() =>
  targetLibraryOptions.value.length > 0
    ? "请选择具体资料库"
    : "没有兼容的资料库"
);
const selectionCount = computed(() =>
  Math.max(0, endOrder.value - startOrder.value + 1)
);

const batchPresets = computed(() =>
  presets.value.filter((preset) => selectedPresetIds.value.includes(preset.id))
);
/** Batch mode has no 50-chapter cap; the plan splits the range into rounds. */
const roundCount = computed(
  () => buildAnalysisRoundRanges(startOrder.value, endOrder.value).length
);
const batchTaskCount = computed(
  () => roundCount.value * batchPresets.value.length
);
/**
 * One row per chosen preset. The library falls back to the preset's own default
 * whenever the stored pick is no longer compatible, so a stale choice can never
 * silently point a round at the wrong library.
 */
const batchRows = computed(() =>
  batchPresets.value.map((preset) => {
    const libraries = compatibleAnalysisLibraries(preset, props.catalogSnapshot);
    const stored = batchLibraryIds.value[preset.id] ?? "";
    const preferred = preset.output.libraryId ?? "";
    const libraryId = libraries.some((library) => library.id === stored)
      ? stored
      : libraries.some((library) => library.id === preferred)
        ? preferred
        : "";
    return {
      preset,
      libraryId,
      options: libraries.map(analysisLibraryOption)
    };
  })
);
/** Every chosen preset needs a target library, or the plan file outgrows its cap. */
const batchReady = computed(
  () =>
    Boolean(source.value) &&
    Boolean(props.controller.selectedModelId.value) &&
    batchRows.value.length > 0 &&
    roundCount.value > 0 &&
    batchRows.value.every((row) => row.libraryId !== "")
);

watch(
  presets,
  (next) => {
    if (!next.some((preset) => preset.id === selectedPresetId.value)) {
      selectedPresetId.value = next[0]?.id ?? "";
    }
  },
  { immediate: true }
);

watch(source, (next) => {
  if (!next) return;
  startOrder.value = 1;
  endOrder.value =
    mode.value === "batch"
      ? next.chapters.length
      : Math.min(50, next.chapters.length);
});

watch(
  selectedPresetId,
  () => {
    const defaultLibraryId = selectedPreset.value?.output.libraryId ?? "";
    selectedTargetLibraryId.value = compatibleLibraries.value.some(
      (library) => library.id === defaultLibraryId
    )
      ? defaultLibraryId
      : "";
  },
  { immediate: true }
);

watch(compatibleLibraries, (libraries) => {
  if (
    libraries.some((library) => library.id === selectedTargetLibraryId.value)
  ) {
    return;
  }
  const defaultLibraryId = selectedPreset.value?.output.libraryId ?? "";
  selectedTargetLibraryId.value = libraries.some(
    (library) => library.id === defaultLibraryId
  )
    ? defaultLibraryId
    : "";
});

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
      Math.min(endOrder.value, startOrder.value + 49)
    );
  } else {
    startOrder.value = Math.min(
      endOrder.value,
      Math.max(startOrder.value, endOrder.value - 49)
    );
  }
}

// Entering batch mode is a whole-book intent: widen the range and carry the
// preset the user had already picked over into the multi-select.
watch(mode, (next) => {
  if (next !== "batch") return;
  if (selectedPresetIds.value.length === 0 && selectedPresetId.value) {
    selectedPresetIds.value = [selectedPresetId.value];
  }
  if (source.value) {
    startOrder.value = 1;
    endOrder.value = source.value.chapters.length;
  }
});

/** Library picks live here, not on the preset, so a plan never mutates presets. */
function setBatchLibrary(presetId: string, value: string | number): void {
  batchLibraryIds.value = { ...batchLibraryIds.value, [presetId]: String(value) };
}

/**
 * Hands the whole plan to the controller at once — the scheduler then runs it
 * unattended, writing each round into its own library as it finishes.
 */
async function startBatch(): Promise<void> {
  if (!batchReady.value) return;
  const libraryIds: Record<string, string> = {};
  for (const row of batchRows.value) libraryIds[row.preset.id] = row.libraryId;
  try {
    await props.controller.startPlan({
      presetIds: batchRows.value.map((row) => row.preset.id),
      startOrder: startOrder.value,
      endOrder: endOrder.value,
      modelId: props.controller.selectedModelId.value,
      thinkingLevel: props.controller.selectedThinkingLevel.value,
      libraryIds
    });
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法开始批量计划。"
    );
  }
}

async function start(): Promise<void> {
  try {
    await props.controller.start({
      presetId: selectedPresetId.value,
      startOrder: startOrder.value,
      endOrder: endOrder.value,
      modelId: props.controller.selectedModelId.value,
      thinkingLevel: props.controller.selectedThinkingLevel.value,
      libraryId: selectedTargetLibraryId.value
    });
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法开始分析。"
    );
  }
}

async function showResult(): Promise<void> {
  await nextTick();
  resultAnchor.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

watch(
  () => props.controller.status.value,
  (status) => {
    if (status === "completed" && props.controller.result.value) {
      void showResult();
    }
  }
);

async function savePresets(next: LongBookAnalysisPreset[]): Promise<void> {
  presetSaving.value = true;
  try {
    await props.controller.savePresets(next);
    presetManagerOpen.value = false;
    uiMessage.success("拆书预设已保存。");
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "保存预设失败。");
  } finally {
    presetSaving.value = false;
  }
}

async function resetPresets(presetId?: string): Promise<void> {
  try {
    await props.controller.resetPresets(presetId);
    uiMessage.success(presetId ? "该默认预设已恢复。" : "全部默认预设已恢复。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复默认预设失败。"
    );
  }
}

async function persistResult(input: {
  libraryId: string;
  baseProjectRevision?: number;
}): Promise<void> {
  resultSaving.value = true;
  try {
    await props.controller.persistResult(input);
    emit("refreshCatalog");
    uiMessage.success("拆书结果已作为新条目写入目标资料库。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "创建资料条目失败。"
    );
  } finally {
    resultSaving.value = false;
  }
}

onMounted(() => {
  void props.controller.loadPresets().catch((error: unknown) => {
    uiMessage.error(
      error instanceof Error ? error.message : "加载拆书预设失败。"
    );
  });
  // A batch plan survives a restart: pick up the interrupted one and continue.
  void props.controller
    .restorePlan()
    .then((restored) => {
      if (restored) {
        mode.value = "batch";
        uiMessage.success("已恢复上次未完成的批量计划，正在继续。");
      }
    })
    .catch(() => undefined);
});
</script>

<template>
  <div class="long-book-analysis-page">
    <header class="analysis-page-header">
      <div class="analysis-page-intro">
        <p class="analysis-eyebrow">更多功能</p>
        <h1>长篇拆书分析</h1>
        <p>导入长篇，提炼剧情、人物与文风，生成素材或技能。</p>
      </div>
      <AnalysisSourceControls
        :controller="controller"
        @manage-presets="presetManagerOpen = true"
      />
    </header>
        <!-- Single-round keeps the legacy 50-chapter cap; batch plans the book. -->
        <div class="analysis-mode-switch" role="group" aria-label="运行模式">
          <button
            type="button"
            :class="{ 'is-active': mode === 'single' }"
            :aria-pressed="mode === 'single'"
            :disabled="controller.isBusy.value"
            @click="mode = 'single'"
          >
            单轮运行（≤50章）
          </button>
          <button
            type="button"
            :class="{ 'is-active': mode === 'batch' }"
            :aria-pressed="mode === 'batch'"
            :disabled="controller.isBusy.value"
            @click="mode = 'batch'"
          >
            整本批量
          </button>
        </div>

    <div class="analysis-content">
      <ChapterEditor
        v-if="source"
        :source="source"
        :disabled="controller.isBusy.value"
        @update="controller.replaceChapters($event)"
      />
      <section v-else class="analysis-card analysis-empty-source">
        <div class="analysis-empty-icon">
          <AppIcon name="book" :size="26" />
        </div>
        <div class="analysis-empty-copy">
          <strong>先导入一本长篇</strong>
          <p>
            支持单个 TXT，或递归读取按章节保存的 TXT / Markdown
            文件夹；每次导入都会备份到工作目录，下次可从顶部直接选择。
          </p>
        </div>
        <div class="analysis-empty-meta" aria-label="支持的导入格式">
          <span>TXT</span>
          <span>Markdown</span>
          <span>最多选择 50 章</span>
        </div>
      </section>

      <section class="analysis-card setup-card">
        <header class="analysis-card-heading">
          <div>
            <p class="analysis-eyebrow">选择范围与预设</p>
            <h2>配置本次拆书任务</h2>
          </div>
          <AnalysisRunStatus
            :status="controller.status.value"
            :entries="controller.processEntries.value"
            :current-activity="controller.currentActivity.value"
            :live-output="controller.liveOutput.value"
            :error="controller.error.value"
            :progress-text="controller.progressText.value"
            title="长篇拆书运行详情"
          />
        </header>
        <div class="setup-grid">
          <div class="setup-field setup-range-field">
            <span class="setup-field-label"
              >章节范围 <small>单次最多 50 章</small></span
            >
            <div class="chapter-range-inputs">
              <input
                v-model.number="startOrder"
                type="number"
                aria-label="起始章节"
                min="1"
                :max="source?.chapters.length ?? 1"
                :disabled="!source || controller.isBusy.value"
                @change="normalizeRange('start')"
              />
              <span>至</span>
              <input
                v-model.number="endOrder"
                type="number"
                aria-label="结束章节"
                min="1"
                :max="source?.chapters.length ?? 1"
                :disabled="!source || controller.isBusy.value"
                @change="normalizeRange('end')"
              />
            </div>
          </div>
          <label v-if="mode === 'single'" class="setup-field"
            ><span class="setup-field-label">拆书预设</span
            ><PopupSelect
              v-model="selectedPresetId"
              :options="presetOptions"
              accessible-label="拆书预设"
              :disabled="controller.isBusy.value"
              :menu-min-width="280"
          /></label>
          <div v-else class="setup-field">
            <span class="setup-field-label"
              >拆书预设 <small>每个预设独立并行</small></span
            >
            <PopupSelect
              multiple
              :model-value="selectedPresetIds[0] ?? ''"
              :selected-values="selectedPresetIds"
              :options="presetOptions"
              accessible-label="拆书预设（可多选）"
              placeholder="选择一个或多个预设"
              :disabled="controller.isBusy.value"
              :menu-min-width="280"
              @update:selected-values="
                selectedPresetIds = $event.map(String)
              "
            />
          </div>
          <label class="setup-field"
            ><span class="setup-field-label">分析模型</span
            ><PopupSelect
              v-model="controller.selectedModelId.value"
              :options="modelOptions"
              accessible-label="分析模型"
              :disabled="controller.isBusy.value"
              :menu-min-width="280"
          /></label>
          <label class="setup-field setup-thinking-field"
            ><span class="setup-field-label">思考等级</span
            ><PopupSelect
              v-model="controller.selectedThinkingLevel.value"
              :options="thinkingOptions"
              accessible-label="思考等级"
              :disabled="controller.isBusy.value || !selectedModel"
              :menu-min-width="180"
          /></label>
        </div>
        <div v-if="mode === 'single' && selectedPreset" class="preset-summary">
          <div class="preset-summary-main">
            <div class="preset-summary-copy">
              <strong>{{ selectedPreset.name }}</strong>
              <span>{{ selectedPreset.description }}</span>
            </div>
            <small>
              {{
                selectedPreset.output.domain === "material"
                  ? "素材条目"
                  : "技能条目"
              }}
              · {{ outputTypeLabel }}
            </small>
          </div>
          <label class="preset-target-field">
            <span
              >预选{{
                selectedPreset.output.domain === "material"
                  ? "素材库"
                  : "技能库"
              }}
              <small>生成后可修改</small></span
            >
            <PopupSelect
              v-model="selectedTargetLibraryId"
              :options="targetLibraryOptions"
              accessible-label="目标资料库"
              :placeholder="targetLibraryPlaceholder"
              :disabled="
                controller.isBusy.value || targetLibraryOptions.length === 0
              "
              :menu-min-width="260"
            />
          </label>
        </div>

        <!--
          One row per chosen preset: a batch writes into several libraries at
          once, so each preset needs its own target — the batch start button
          stays disabled until every row has one.
        -->
        <div v-if="mode === 'batch'" class="batch-library-list">
          <div
            v-for="row in batchRows"
            :key="row.preset.id"
            class="batch-library-row"
          >
            <div class="batch-library-copy">
              <strong>{{ row.preset.name }}</strong>
              <span>{{ row.preset.description }}</span>
            </div>
            <label class="preset-target-field">
              <span
                >目标{{
                  row.preset.output.domain === "material" ? "素材库" : "技能库"
                }}
                <small>{{
                  row.libraryId ? "生成后自动写入" : "未选择无法开始"
                }}</small></span
              >
              <PopupSelect
                :model-value="row.libraryId"
                :options="row.options"
                :accessible-label="`${row.preset.name}的目标资料库`"
                :placeholder="
                  row.options.length > 0 ? '请选择具体资料库' : '没有兼容的资料库'
                "
                :disabled="controller.isBusy.value || row.options.length === 0"
                :menu-min-width="260"
                @update:model-value="setBatchLibrary(row.preset.id, $event)"
              />
            </label>
          </div>
          <p v-if="batchRows.length === 0" class="analysis-empty-meta">
            <span>先选择至少一个拆书预设</span>
          </p>
        </div>
        <LongAnalysisRunControls
          v-if="mode === 'single'"
          :controller="controller"
          :selection-count="selectionCount"
          :preset-name="selectedPreset?.name ?? '当前'"
          :can-start="
            !!source &&
            !!selectedPreset &&
            !!controller.selectedModelId.value &&
            selectionCount >= 1 &&
            selectionCount <= 50
          "
          @start="start"
          @show-result="showResult"
        />
        <div v-else class="analysis-run-bar">
          <div class="analysis-run-progress">
            <strong>已选 {{ selectionCount }} 章</strong>
            <span
              >{{ roundCount }} 轮 × {{ batchRows.length }} 个预设 =
              {{ batchTaskCount }} 个任务</span
            >
          </div>
          <div class="analysis-run-actions">
            <button
              v-if="controller.isBusy.value"
              class="analysis-danger-button"
              type="button"
              @click="controller.pausePlan()"
            >
              暂停计划
            </button>
            <button
              v-else
              class="analysis-primary-button"
              type="button"
              :disabled="!batchReady"
              @click="startBatch"
            >
              开始批量计划（{{ batchTaskCount }} 个任务）
            </button>
          </div>
        </div>
        <AnalysisPlanPanel :controller="controller" />
      </section>

      <div
        v-if="controller.result.value && resultPreset"
        ref="resultAnchor"
        class="analysis-result-anchor"
      >
        <AnalysisResultPanel
          :result="controller.result.value"
          :preset="resultPreset"
          :catalog-snapshot="catalogSnapshot"
          :target-library-id="controller.targetLibraryId.value"
          :saving="resultSaving"
          @update="controller.result.value = $event"
          @save="persistResult"
        />
      </div>
    </div>

    <PresetManager
      :open="presetManagerOpen"
      :presets="presets"
      :saving="presetSaving"
      :catalog-snapshot="catalogSnapshot"
      @close="presetManagerOpen = false"
      @save="savePresets"
      @reset="resetPresets"
    />
  </div>
</template>
