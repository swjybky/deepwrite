import { editableAgentProfileBaseline } from "../../utils/agentSettingsBaseline";
import { createScopedTranslator } from "../../i18n";
import { presetLabel } from "../analysis-ui/preset-labels";
import { computed, ref, shallowRef, watch } from "vue";
import {
  ExtrasAgentSettingsInputSchema,
  type DeepWriteApi,
  type ModelConfig,
  type ShortBookAnalysisPreset,
  type ShortBookAnalysisResult,
  type ShortBookAnalysisSource,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import {
  PRESET_BATCH_MAX_PRESETS,
  createPresetBatch
} from "../analysis-ui/preset-batch";
import { buildPresetRunners } from "../analysis-ui/preset-runner";
import {
  persistAnalysisResult,
  persistAnalysisResults,
  type AnalysisSaveInput
} from "../long-book-analysis/analysis-result-content";
import { createShortAnalysisRun } from "./analysis-run";
import { shortPresetBlock, shortSelectionLimit } from "./preset-selection";
import { useShortAnalysisSources } from "./useShortAnalysisSources";
import { jsonClone } from "@deepwrite/shared";

const t = createScopedTranslator("extras");
export type ShortBookAnalysisController = ReturnType<
  typeof useShortBookAnalysis
>;
export function useShortBookAnalysis(options: {
  api: () => DeepWriteApi | undefined;
}) {
  const api = () => {
    const current = options.api();
    if (!current)
      throw new Error(t("shortBookAnalysis.shortAnalysisUnavailable"));
    return current;
  };
  const batch = createPresetBatch<
    ShortBookAnalysisPreset,
    ShortBookAnalysisResult
  >({ label: (preset) => presetLabel(preset) });
  const presets = ref<ShortBookAnalysisPreset[]>([]);
  const selectedPresetIds = ref<string[]>([]);
  const selectedModelId = ref("");
  const selectedThinkingLevel = ref<ThinkingLevel>("off");
  const models = shallowRef<readonly ModelConfig[]>([]);
  let disposed = false;
  const sources = useShortAnalysisSources({
    api: () => api().shortBookAnalysis,
    assertEditable: editable,
    settle: () => batch.settle(),
    selectionLimit: () => selectionLimit.value,
    isDisposed: () => disposed
  });
  const { drafts, selectedIds, activeId, loading } = sources;
  const selectedPresets = computed(() =>
    selectedPresetIds.value.flatMap((id) => {
      const preset = presets.value.find((item) => item.id === id);
      return preset ? [preset] : [];
    })
  );
  const selectedBooks = computed(() =>
    selectedIds.value
      .map((id) => drafts.value.find((b) => b.id === id))
      .filter((b): b is ShortBookAnalysisSource => Boolean(b))
  );
  const selectionLimit = computed(() =>
    shortSelectionLimit(selectedPresets.value)
  );
  const selectionValid = computed(
    () =>
      selectedBooks.value.length > 0 &&
      selectedBooks.value.every(
        (book) => book.title.trim() && book.text.trim()
      ) &&
      selectedBooks.value.length <= selectionLimit.value
  );
  // Edited presets may turn single-story; keep the story being edited.
  const stopLimitWatch = watch(
    selectionLimit,
    (limit) => {
      if (limit !== 1 || selectedIds.value.length <= 1 || batch.isBusy.value)
        return;
      const id =
        drafts.value.find((book) => book.id === activeId.value)?.id ??
        selectedIds.value[0];
      if (!id) return;
      batch.settle();
      selectedIds.value = [id];
    },
    { flush: "sync" }
  );
  const stopModelWatch = watch(selectedModelId, () => {
    selectedThinkingLevel.value =
      models.value.find((m) => m.id === selectedModelId.value)
        ?.defaultThinkingLevel ?? "off";
  });
  function editable() {
    if (batch.isBusy.value || loading.value)
      throw new Error(t("revisionAnalysis.busyEditLater"));
  }
  async function loadPresets() {
    const settings = await api().extrasAgents.profiles.list(
      "short-book-analysis"
    );
    if (disposed) return;
    presets.value = settings.profiles;
    const kept = selectedPresetIds.value.filter((id) =>
      presets.value.some((preset) => preset.id === id)
    );
    const first = presets.value[0]?.id;
    selectedPresetIds.value = kept.length || !first ? kept : [first];
  }
  async function persistResult(id: string, input: AnalysisSaveInput) {
    const entry = batch.results.value.find((item) => item.id === id);
    if (!entry) throw new Error(t("shortBookAnalysis.noCompletedResult"));
    const saved = await persistAnalysisResult(
      api(),
      entry.preset.output,
      entry.result,
      input
    );
    batch.markSaved(id, { libraryId: input.libraryId, entryId: saved.id });
  }
  return {
    ...sources,
    batch,
    status: batch.status,
    isBusy: batch.isBusy,
    error: batch.error,
    presets,
    selectedPresetIds,
    selectedModelId,
    selectedThinkingLevel,
    selectedPresets,
    selectedBooks,
    selectionLimit,
    selectionValid,
    presetBlock: (preset: ShortBookAnalysisPreset) =>
      shortPresetBlock(
        preset,
        selectedPresetIds.value,
        selectedIds.value.length
      ),
    selectPresets(ids: readonly string[]) {
      editable();
      const next = ids.filter((id, index) => ids.indexOf(id) === index);
      if (next.length > PRESET_BATCH_MAX_PRESETS)
        throw new Error(
          t("analysisUi.tooManyPresets", { max: PRESET_BATCH_MAX_PRESETS })
        );
      const added = presets.value.filter(
        (preset) =>
          next.includes(preset.id) &&
          !selectedPresetIds.value.includes(preset.id)
      );
      if (
        added.some((preset) => preset.selectionMode === "single") &&
        selectedIds.value.length > 1
      )
        throw new Error(
          t("shortBookAnalysis.singlePresetNeedsOneStory", {
            count: selectedIds.value.length
          })
        );
      batch.settle();
      selectedPresetIds.value = next;
    },
    resetWorkspace() {
      editable();
      batch.clear();
      drafts.value = [];
      selectedIds.value = [];
      activeId.value = "";
      const first = presets.value[0]?.id;
      selectedPresetIds.value = first ? [first] : [];
    },
    loadPresets,
    setConfiguredModels(next: readonly ModelConfig[], defaultModelId?: string) {
      models.value = next;
      const current =
        next.find((m) => m.id === selectedModelId.value) ??
        next.find((m) => m.id === defaultModelId) ??
        next[0];
      selectedModelId.value = current?.id ?? "";
      if (
        current &&
        !current.thinkingLevelOptions.includes(selectedThinkingLevel.value)
      )
        selectedThinkingLevel.value = current.defaultThinkingLevel;
    },
    async savePresets(next: readonly ShortBookAnalysisPreset[]) {
      editable();
      const input = ExtrasAgentSettingsInputSchema.parse({
        agentId: "short-book-analysis",
        baseProfiles: editableAgentProfileBaseline(presets.value),
        profiles: next.map(({ builtin, ...preset }) => {
          void builtin;
          return preset;
        })
      });
      if (input.agentId !== "short-book-analysis") return;
      batch.settle();
      presets.value = (await api().extrasAgents.profiles.save(input)).profiles;
      await loadPresets();
    },
    async loadPresetDefaults() {
      return (
        await api().extrasAgents.profiles.reset(
          "short-book-analysis",
          undefined,
          true
        )
      ).profiles;
    },
    async resetPresets(id?: string) {
      editable();
      batch.settle();
      presets.value = (
        await api().extrasAgents.profiles.reset("short-book-analysis", id)
      ).profiles;
      await loadPresets();
    },
    start() {
      editable();
      const chosen = selectedPresets.value;
      const model = models.value.find((m) => m.id === selectedModelId.value);
      if (!chosen.length || !model)
        throw new Error(t("shortBookAnalysis.presetAndModelRequired"));
      const books = selectedBooks.value;
      const thinkingLevel = selectedThinkingLevel.value;
      const runners = buildPresetRunners(
        chosen,
        (preset) => presetLabel(preset),
        (preset) =>
          createShortAnalysisRun(api, { books, preset, model, thinkingLevel })
      );
      batch.start(
        chosen.map((preset, index) => ({
          preset: jsonClone(preset),
          runner: runners[index]!
        })),
        books.map((book) => book.title).join("、")
      );
    },
    stop: () => batch.stop(),
    persistResult,
    persistResults: (
      requests: readonly (AnalysisSaveInput & { id: string })[]
    ) => persistAnalysisResults(requests, persistResult),
    handleEvent: batch.handleEvent,
    dispose() {
      disposed = true;
      stopModelWatch();
      stopLimitWatch();
      batch.dispose();
    }
  };
}
