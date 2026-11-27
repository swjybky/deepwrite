import { editableAgentProfileBaseline } from "../../utils/agentSettingsBaseline";
import { localizedMessage } from "../analysis-ui/localized-text";
import { presetLabel } from "../analysis-ui/preset-labels";
import { createScopedTranslator } from "../../i18n";
import { ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import {
  ExtrasAgentSettingsInputSchema,
  type DeepWriteApi,
  type LongBookAnalysisChapter,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisSavedSourceSummary,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind,
  type ModelConfig,
  type SystemEventEnvelope,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import {
  PRESET_BATCH_MAX_PRESETS,
  createPresetBatch,
  type PresetBatch,
  type PresetBatchStatus
} from "../analysis-ui/preset-batch";
import {
  buildPresetRunners,
  type PresetRunStatus
} from "../analysis-ui/preset-runner";
import {
  persistAnalysisResult,
  persistAnalysisResults,
  type AnalysisSaveInput
} from "./analysis-result-content";
import {
  createLongAnalysisSources,
  type ReplaceAnalysisChaptersOptions
} from "./long-analysis-sources";
import { createLongPresetRunner } from "./long-preset-runner";
import { jsonClone } from "@deepwrite/shared";

const t = createScopedTranslator("extras.longBookAnalysis");
const ui = createScopedTranslator("extras.analysisUi");

export type LongBookAnalysisRunStatus = PresetRunStatus;
export type LongBookAnalysisBatch = PresetBatch<
  LongBookAnalysisPreset,
  LongBookAnalysisResult
>;

export interface LongBookAnalysisStartInput {
  presetIds: readonly string[];
  startOrder: number;
  endOrder: number;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
}

export type LongBookAnalysisPersistInput = AnalysisSaveInput;

export interface LongBookAnalysisController {
  source: Ref<LongBookAnalysisSource | null>;
  selectedChapterId: Readonly<Ref<string>>;
  canUndoChapters: ComputedRef<boolean>;
  savedSources: Ref<LongBookAnalysisSavedSourceSummary[]>;
  sourcesLoading: Readonly<Ref<boolean>>;
  sourceSaving: Readonly<Ref<boolean>>;
  sourceDeleting: Readonly<Ref<boolean>>;
  sourceDirty: Readonly<Ref<boolean>>;
  selectChapter(chapterId: string): void;
  saveSource(): Promise<void>;
  presets: Ref<LongBookAnalysisPreset[]>;
  presetsLoading: Readonly<Ref<boolean>>;
  selectedModelId: Ref<string>;
  selectedThinkingLevel: Ref<ThinkingLevel>;
  batch: LongBookAnalysisBatch;
  status: ComputedRef<PresetBatchStatus>;
  isBusy: ComputedRef<boolean>;
  error: ComputedRef<string | null>;
  setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void;
  loadPresets(): Promise<void>;
  savePresets(presets: readonly LongBookAnalysisPreset[]): Promise<void>;
  resetPresets(presetId?: string): Promise<void>;
  loadPresetDefaults(): Promise<LongBookAnalysisPreset[]>;
  loadSavedSources(): Promise<void>;
  loadSavedSource(sourceId: string): Promise<boolean>;
  deleteSavedSource(sourceId: string): Promise<void>;
  chooseSource(kind: LongBookAnalysisSourceKind): Promise<boolean>;
  replaceChapters(
    chapters: readonly LongBookAnalysisChapter[],
    options?: ReplaceAnalysisChaptersOptions
  ): boolean;
  undoChapters(): boolean;
  start(input: LongBookAnalysisStartInput): Promise<boolean>;
  stop(): Promise<boolean>;
  /** Inputs changed: drop unfinished tasks, keep completed results. */
  settleTasks(): void;
  resetWorkspace(): void;
  persistResult(id: string, input: LongBookAnalysisPersistInput): Promise<void>;
  persistResults(
    requests: readonly (LongBookAnalysisPersistInput & { id: string })[]
  ): Promise<{ saved: number; errors: unknown[] }>;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

function clone<T>(value: T): T {
  return jsonClone(value);
}

export function useLongBookAnalysis(options: {
  api: () => DeepWriteApi | undefined;
}): LongBookAnalysisController {
  const presets = ref<LongBookAnalysisPreset[]>([]);
  const presetsLoading = ref(false);
  const selectedModelId = ref("");
  const selectedThinkingLevel = ref<ThinkingLevel>("off");
  const configuredModels = shallowRef<readonly ModelConfig[]>([]);
  const batch = createPresetBatch<
    LongBookAnalysisPreset,
    LongBookAnalysisResult
  >({ label: (preset) => presetLabel(preset) });
  let disposed = false;

  function api(): DeepWriteApi {
    const current = options.api();
    if (!current) throw new Error(t("novelAnalysisUnavailable"));
    return current;
  }
  const sources = createLongAnalysisSources({
    api,
    isBusy: () => batch.isBusy.value,
    isDisposed: () => disposed,
    onChange: () => batch.settle()
  });
  const { source } = sources;

  watch(selectedModelId, (modelId) => {
    const model = configuredModels.value.find((item) => item.id === modelId);
    selectedThinkingLevel.value = model?.defaultThinkingLevel ?? "off";
  });

  function setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void {
    configuredModels.value = models;
    const selected =
      models.find((model) => model.id === selectedModelId.value) ??
      (defaultModelId
        ? models.find((model) => model.id === defaultModelId)
        : undefined) ??
      models[0];
    if (!selected) {
      selectedModelId.value = "";
      selectedThinkingLevel.value = "off";
      return;
    }
    const modelChanged = selectedModelId.value !== selected.id;
    selectedModelId.value = selected.id;
    if (
      modelChanged ||
      (selectedThinkingLevel.value !== "off" &&
        !selected.thinkingLevelOptions.includes(selectedThinkingLevel.value))
    ) {
      selectedThinkingLevel.value = selected.defaultThinkingLevel;
    }
  }

  async function loadPresets(): Promise<void> {
    if (presetsLoading.value) return;
    presetsLoading.value = true;
    try {
      const settings =
        await api().extrasAgents.profiles.list("long-book-analysis");
      if (!disposed) presets.value = settings.profiles;
    } finally {
      if (!disposed) presetsLoading.value = false;
    }
  }

  async function savePresets(
    nextPresets: readonly LongBookAnalysisPreset[]
  ): Promise<void> {
    const input = ExtrasAgentSettingsInputSchema.parse({
      agentId: "long-book-analysis",
      profiles: nextPresets.map(({ builtin: _builtin, ...preset }) => preset),
      baseProfiles: editableAgentProfileBaseline(presets.value)
    });
    if (input.agentId !== "long-book-analysis") return;
    batch.settle();
    presets.value = (await api().extrasAgents.profiles.save(input)).profiles;
  }

  async function resetPresets(presetId?: string): Promise<void> {
    batch.settle();
    presets.value = (
      await api().extrasAgents.profiles.reset("long-book-analysis", presetId)
    ).profiles;
  }

  async function start(input: LongBookAnalysisStartInput): Promise<boolean> {
    if (batch.isBusy.value || sources.sourceDeleting.value) return false;
    if (sources.sourceDirty.value) await sources.saveSource();
    const current = source.value;
    if (!current) throw new Error(t("importSourceRequired"));
    const chosen = input.presetIds.flatMap((id) => {
      const preset = presets.value.find((item) => item.id === id);
      return preset ? [clone(preset)] : [];
    });
    if (!chosen.length) throw new Error(t("presetRequired"));
    if (chosen.length > PRESET_BATCH_MAX_PRESETS) {
      throw new Error(ui("tooManyPresets", { max: PRESET_BATCH_MAX_PRESETS }));
    }
    const range = {
      startOrder: input.startOrder,
      endOrder: input.endOrder,
      modelId: input.modelId || selectedModelId.value,
      thinkingLevel: input.thinkingLevel ?? selectedThinkingLevel.value
    };
    const runners = buildPresetRunners(
      chosen,
      (preset) => presetLabel(preset),
      (preset) =>
        createLongPresetRunner({
          api,
          models: configuredModels,
          source: current,
          preset,
          range
        })
    );
    batch.start(
      chosen.map((preset, index) => ({ preset, runner: runners[index]! })),
      localizedMessage("extras.longBookAnalysis.presetChapterRange", {
        preset: current.name,
        start: input.startOrder,
        end: input.endOrder
      })
    );
    return true;
  }

  async function persistResult(
    id: string,
    input: LongBookAnalysisPersistInput
  ): Promise<void> {
    const entry = batch.results.value.find((item) => item.id === id);
    if (!entry) throw new Error(t("noResultToSave"));
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
    presets,
    presetsLoading,
    selectedModelId,
    selectedThinkingLevel,
    batch,
    status: batch.status,
    isBusy: batch.isBusy,
    error: batch.error,
    setConfiguredModels,
    loadPresets,
    savePresets,
    resetPresets,
    loadPresetDefaults: async () =>
      (
        await api().extrasAgents.profiles.reset(
          "long-book-analysis",
          undefined,
          true
        )
      ).profiles,
    start,
    async stop() {
      if (!batch.isBusy.value) return false;
      await batch.stop();
      return true;
    },
    settleTasks() {
      if (!batch.isBusy.value) batch.settle();
    },
    resetWorkspace() {
      batch.clear();
      sources.clearSource();
    },
    persistResult,
    persistResults: (requests) =>
      persistAnalysisResults(requests, persistResult),
    handleEvent: (event) => batch.handleEvent(event),
    dispose() {
      disposed = true;
      batch.dispose();
    }
  };
}
