import {
  computed,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import {
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSourceSchema,
  type DeepWriteApi,
  type LongBookAnalysisChapter,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisSavedSourceSummary,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind,
  type LongBookAnalysisPlan,
  type LongBookAnalysisPlanStatus,
  type ModelConfig,
  type SystemEventEnvelope,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import {
  createAnalysisTask,
  type AnalysisTaskRuntime
} from "./analysis-task";
import {
  LongBookAnalysisPlanRunner,
  type AnalysisPlanSummary
} from "./analysis-plan-runner";
import { buildAnalysisRoundRanges } from "./plan-rounds";
import { analysisResultEntry } from "./analysis-result-content";
import { type LongBookAnalysisPhase } from "./analysis-pipeline";
import {
  formatAnalysisProgress,
  type LongBookAnalysisProcessEntry
} from "./analysis-process";

export type LongBookAnalysisRunStatus =
  | "idle"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "completed"
  /** Parked because the agent process hit its concurrent-run ceiling. */
  | "waiting";

export interface LongBookAnalysisStartInput {
  presetId: string;
  startOrder: number;
  endOrder: number;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  libraryId?: string;
}

export interface LongBookAnalysisPersistInput {
  libraryId: string;
  baseProjectRevision?: number;
}

export interface LongBookAnalysisPlanStartInput {
  presetIds: readonly string[];
  startOrder: number;
  endOrder: number;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  /** Target library for each selected preset id. */
  libraryIds: Readonly<Record<string, string>>;
}

export interface LongBookAnalysisController {
  source: Ref<LongBookAnalysisSource | null>;
  savedSources: Ref<LongBookAnalysisSavedSourceSummary[]>;
  sourcesLoading: Readonly<Ref<boolean>>;
  presets: Ref<LongBookAnalysisPreset[]>;
  presetsLoading: Readonly<Ref<boolean>>;
  selectedModelId: Ref<string>;
  selectedThinkingLevel: Ref<ThinkingLevel>;
  activePresetId: ComputedRef<string>;
  targetLibraryId: ComputedRef<string>;
  status: Readonly<Ref<LongBookAnalysisRunStatus>>;
  phase: Readonly<Ref<LongBookAnalysisPhase | null>>;
  progressText: ComputedRef<string>;
  error: Readonly<Ref<string | null>>;
  result: Ref<LongBookAnalysisResult | null>;
  processEntries: Readonly<Ref<LongBookAnalysisProcessEntry[]>>;
  currentActivity: Readonly<Ref<string>>;
  liveOutput: Readonly<Ref<string>>;
  isBusy: ComputedRef<boolean>;
  canRetry: ComputedRef<boolean>;
  setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void;
  loadPresets(): Promise<void>;
  savePresets(presets: readonly LongBookAnalysisPreset[]): Promise<void>;
  resetPresets(presetId?: string): Promise<void>;
  loadSavedSources(): Promise<void>;
  loadSavedSource(sourceId: string): Promise<boolean>;
  chooseSource(kind: LongBookAnalysisSourceKind): Promise<boolean>;
  replaceChapters(chapters: readonly LongBookAnalysisChapter[]): boolean;
  start(input: LongBookAnalysisStartInput): Promise<boolean>;
  retry(): Promise<boolean>;
  stop(): Promise<boolean>;
  persistResult(input: LongBookAnalysisPersistInput): Promise<void>;
  /** Batch plan: one task per (preset × ≤50-chapter round). */
  startPlan(input: LongBookAnalysisPlanStartInput): Promise<boolean>;
  planTasks: ShallowRef<AnalysisTaskRuntime[]>;
  /** Which task the process/result panels are currently projecting. */
  activeTaskId: Ref<string>;
  planSummary: ComputedRef<AnalysisPlanSummary>;
  pausePlan(): void;
  resumePlan(): void;
  /** Re-queue one round from scratch after a failure or a manual cancel. */
  rerunPlanTask(taskId: string): boolean;
  /** Write a finished round's result again after its automatic write failed. */
  retryPlanWrite(taskId: string): Promise<boolean>;
  /** Rebuild and resume the last interrupted plan, if any. */
  restorePlan(): Promise<boolean>;
  /** Drop the plan and every finished plan file left in the store. */
  clearPlan(): Promise<boolean>;
  focusTask(taskId: string): void;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

export function useLongBookAnalysis(options: {
  api: () => DeepWriteApi | undefined;
}): LongBookAnalysisController {
  const source = shallowRef<LongBookAnalysisSource | null>(null);
  const savedSources = ref<LongBookAnalysisSavedSourceSummary[]>([]);
  const sourcesLoading = ref(false);
  const presets = ref<LongBookAnalysisPreset[]>([]);
  const presetsLoading = ref(false);
  const selectedModelId = ref("");
  const selectedThinkingLevel = ref<ThinkingLevel>("off");
  const configuredModels = shallowRef<readonly ModelConfig[]>([]);
  // --- per-task run state -------------------------------------------------------
  // Each analysis task owns its own pipeline and reactive state so several
  // presets can run at once without resetting each other's progress or logs.
  const tasks = shallowRef<AnalysisTaskRuntime[]>([]);
  const activeTaskId = ref("");
  /**
   * The task the shared 执行过程 / 结果 panels project. Falls back to the first
   * task so a plan that was just rebuilt (or whose focus was cleared) still has
   * something to show instead of blanking the panels.
   */
  const activeTask = computed<AnalysisTaskRuntime | null>(
    () =>
      tasks.value.find((task) => task.id === activeTaskId.value) ??
      tasks.value[0] ??
      null
  );

  /** Points the shared panels at one round without disturbing the scheduler. */
  function focusTask(taskId: string): void {
    activeTaskId.value = taskId;
  }

  /**
   * Drop every task's run state. Any task still running throws from
   * `pipeline.reset()`, which is how source and preset edits stay blocked
   * while a run is in flight.
   */
  function resetTasks(): void {
    for (const task of tasks.value) task.pipeline.reset();
  }

  // Compatibility projections. The page drives a "current run" through these
  // names, which is why they stay computed rather than being removed.
  const status = computed<LongBookAnalysisRunStatus>(
    () => activeTask.value?.state.status.value ?? "idle"
  );
  const phase = computed<LongBookAnalysisPhase | null>(
    () => activeTask.value?.state.phase.value ?? null
  );
  const completedUnits = computed(
    () => activeTask.value?.state.completedUnits.value ?? 0
  );
  const estimatedUnits = computed(
    () => activeTask.value?.state.estimatedUnits.value ?? 0
  );
  const error = computed<string | null>(
    () => activeTask.value?.state.error.value ?? null
  );
  // Writable on purpose: LongBookAnalysisPage edits the preview in place.
  const result = computed<LongBookAnalysisResult | null>({
    get: () => activeTask.value?.state.result.value ?? null,
    set: (value) => {
      const task = activeTask.value;
      if (task) task.state.result.value = value;
    }
  });
  const processEntries = computed<LongBookAnalysisProcessEntry[]>(
    () => activeTask.value?.state.processEntries.value ?? []
  );
  const currentActivity = computed(
    () => activeTask.value?.state.currentActivity.value ?? ""
  );
  const liveOutput = computed(
    () => activeTask.value?.state.liveOutput.value ?? ""
  );
  const isBusy = computed(() =>
    tasks.value.some((task) =>
      ["running", "stopping", "waiting"].includes(task.state.status.value)
    )
  );
  const canRetry = computed(() => {
    const task = activeTask.value;
    if (!task?.pipeline.hasJob) return false;
    return ["error", "stopped"].includes(task.state.status.value);
  });
  const progressText = computed(() =>
    formatAnalysisProgress(
      phase.value,
      completedUnits.value,
      estimatedUnits.value
    )
  );
  const activePresetId = computed(
    () => activeTask.value?.pipeline.preset?.id ?? ""
  );
  const targetLibraryId = computed(
    () => activeTask.value?.pipeline.targetLibraryId ?? ""
  );
  let disposed = false;
  let sourceListSequence = 0;
  let activeSourceListRequests = 0;

  function api(): DeepWriteApi {
    const current = options.api();
    if (!current) throw new Error("当前环境不支持长篇拆书分析。");
    return current;
  }

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
      const settings = await api().longBookAnalysis.presets.list();
      if (!disposed) presets.value = settings.presets;
    } finally {
      if (!disposed) presetsLoading.value = false;
    }
  }

  async function savePresets(
    nextPresets: readonly LongBookAnalysisPreset[]
  ): Promise<void> {
    const input = LongBookAnalysisSettingsInputSchema.parse({
      presets: nextPresets.map(({ builtin: _builtin, ...preset }) => preset)
    });
    resetTasks();
    presets.value = (await api().longBookAnalysis.presets.save(input)).presets;
  }

  async function resetPresets(presetId?: string): Promise<void> {
    resetTasks();
    presets.value = (
      await api().longBookAnalysis.presets.reset(presetId)
    ).presets;
  }

  async function loadSavedSources(): Promise<void> {
    const sequence = ++sourceListSequence;
    activeSourceListRequests += 1;
    sourcesLoading.value = true;
    try {
      const catalog = await api().longBookAnalysis.sources.list();
      if (!disposed && sequence === sourceListSequence) {
        savedSources.value = catalog.sources;
      }
    } finally {
      activeSourceListRequests -= 1;
      if (!disposed) sourcesLoading.value = activeSourceListRequests > 0;
    }
  }

  async function loadSavedSource(sourceId: string): Promise<boolean> {
    if (isBusy.value) {
      throw new Error("分析运行中，不能更换导入来源。");
    }
    if (source.value?.id === sourceId) return false;
    const selected = await api().longBookAnalysis.sources.load(sourceId);
    if (disposed) return false;
    resetTasks();
    source.value = selected;
    return true;
  }

  async function chooseSource(
    kind: LongBookAnalysisSourceKind
  ): Promise<boolean> {
    if (isBusy.value) {
      throw new Error("分析运行中，不能更换导入来源。");
    }
    const selected = await api().longBookAnalysis.chooseSource(kind);
    if (!selected) return false;
    resetTasks();
    source.value = selected;
    await loadSavedSources();
    return true;
  }

  function replaceChapters(
    chapters: readonly LongBookAnalysisChapter[]
  ): boolean {
    if (!source.value) return false;
    resetTasks();
    source.value = LongBookAnalysisSourceSchema.parse({
      ...source.value,
      chapters: chapters.map((chapter, index) => ({
        ...chapter,
        order: index + 1
      }))
    });
    return true;
  }

  async function start(input: LongBookAnalysisStartInput): Promise<boolean> {
    if (isBusy.value) return false;
    if (!source.value) throw new Error("请先导入 TXT 或章节文件夹。");
    const preset = presets.value.find((item) => item.id === input.presetId);
    if (!preset) throw new Error("请选择一个拆书预设。");
    // Single-round mode is one task; the batch runner seeds `tasks` directly.
    resetTasks();
    const task = createAnalysisTask({
      presetId: preset.id,
      presetName: preset.name,
      roundIndex: 0,
      startOrder: input.startOrder,
      endOrder: input.endOrder,
      libraryId: input.libraryId?.trim() ?? "",
      modelId: input.modelId || selectedModelId.value,
      thinkingLevel: input.thinkingLevel ?? selectedThinkingLevel.value,
      getApi: api,
      models: configuredModels
    });
    task.presetSnapshot = preset;
    task.queueStatus.value = "running";
    tasks.value = [task];
    focusTask(task.id);
    task.pipeline.start(source.value, preset, {
      ...input,
      modelId: input.modelId || selectedModelId.value,
      thinkingLevel: input.thinkingLevel ?? selectedThinkingLevel.value
    });
    return true;
  }


  async function persistResult(
    input: LongBookAnalysisPersistInput
  ): Promise<void> {
    // Read from the focused task, not a shared pipeline: several tasks can hold
    // results at once and only one of them is the one the user is looking at.
    const preset = activeTask.value?.pipeline.preset ?? null;
    if (!preset || !result.value) {
      throw new Error("当前没有可落库的拆书结果。");
    }
    const output = preset.output;
    // `analysisResultEntry` is upstream's fix for the same problem our
    // `withSkillFrontmatter` addressed: a skill entry has to carry name and
    // description. Upstream takes them from the model's result instead of
    // inferring them, so this uses theirs.
    // Branched rather than passing `output.domain` through: `createLibraryEntry`
    // is a discriminated union and only narrows per literal.
    const revision =
      input.baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision: input.baseProjectRevision };
    if (output.domain === "material") {
      await api().catalog.createLibraryEntry({
        domain: "material",
        libraryId: input.libraryId,
        ...analysisResultEntry(result.value, "material"),
        stageId: output.stageId,
        ...revision
      });
    } else {
      await api().catalog.createLibraryEntry({
        domain: "skill",
        libraryId: input.libraryId,
        ...analysisResultEntry(result.value, "skill"),
        stageId: output.stageId,
        ...revision
      });
    }
  }

  /** Shared by the manual button and the batch runner's automatic write-back. */
  async function writeResultToLibrary(
    preset: LongBookAnalysisPreset,
    analysisResult: LongBookAnalysisResult,
    libraryId: string
  ): Promise<void> {
    const output = preset.output;
    if (output.domain === "material") {
      await api().catalog.createLibraryEntry({
        domain: "material",
        libraryId,
        ...analysisResultEntry(analysisResult, "material"),
        stageId: output.stageId
      });
    } else {
      await api().catalog.createLibraryEntry({
        domain: "skill",
        libraryId,
        ...analysisResultEntry(analysisResult, "skill"),
        stageId: output.stageId
      });
    }
  }

  const runner = new LongBookAnalysisPlanRunner(tasks, {
    getApi: api,
    models: configuredModels,
    source: () => source.value,
    presets: () => presets.value,
    persistTask: async (task) => {
      const taskResult = task.state.result.value;
      const taskPreset = task.presetSnapshot;
      if (!taskResult || !taskPreset) {
        throw new Error("该轮没有可落库的拆书结果。");
      }
      await writeResultToLibrary(taskPreset, taskResult, task.libraryId);
    },
    onTaskSettled: () => {
      // Every settle (including batch-level checkpoints) advances the on-disk
      // plan, which is what makes a restart resume rather than restart.
      void persistPlan(planStatus === "halted" ? "halted" : "running");
    },
    onHalted: (reason) => {
      void persistPlan("halted");
      activeTask.value?.state.processEntries.value.push({
        id: createId("analysis_plan_halt"),
        createdAt: new Date().toISOString(),
        title: "计划已停止",
        detail: reason,
        phase: null,
        tone: "error"
      });
    }
  });
  const planSummary = computed(() => runner.planSummary);

  /**
   * Start a batch plan: every selected preset analyses every ≤50-chapter round.
   * Tasks are ordered round-major, so with three slots the presets advance
   * together and every round is written to its own library as it finishes.
   */
  async function startPlan(
    input: LongBookAnalysisPlanStartInput
  ): Promise<boolean> {
    if (isBusy.value) return false;
    if (!source.value) throw new Error("请先导入 TXT 或章节文件夹。");
    const selected = presets.value.filter((preset) =>
      input.presetIds.includes(preset.id)
    );
    if (selected.length === 0) throw new Error("请至少选择一个拆书预设。");
    for (const preset of selected) {
      if (!input.libraryIds[preset.id]?.trim()) {
        throw new Error(`请为「${preset.name}」选择目标资料库。`);
      }
    }
    resetTasks();
    const modelId = input.modelId || selectedModelId.value;
    const thinkingLevel = input.thinkingLevel ?? selectedThinkingLevel.value;
    const rounds = buildAnalysisRoundRanges(input.startOrder, input.endOrder);
    const created: AnalysisTaskRuntime[] = [];
    for (const round of rounds) {
      for (const preset of selected) {
        const task = createAnalysisTask({
          presetId: preset.id,
          presetName: preset.name,
          roundIndex: round.index,
          startOrder: round.startOrder,
          endOrder: round.endOrder,
          libraryId: input.libraryIds[preset.id]!.trim(),
          modelId,
          thinkingLevel,
          getApi: api,
          models: configuredModels
        });
        task.presetSnapshot = preset;
        created.push(task);
      }
    }
    tasks.value = created;
    if (created[0]) focusTask(created[0].id);
    planId = createId("analysis_plan");
    planCreatedAt = new Date().toISOString();
    runner.startBatch();
    await persistPlan("running");
    return true;
  }

  // --- plan persistence ---------------------------------------------------------
  // A 1000+ chapter plan runs for hours, so its progress (completed rounds plus
  // each round's batch-level checkpoint) is written after every settle and
  // rebuilt on the next launch.

  let planId = createId("analysis_plan");
  let planCreatedAt = new Date().toISOString();
  let planStatus: LongBookAnalysisPlanStatus = "paused";
  let saveChain: Promise<void> = Promise.resolve();

  /**
   * Serializes the whole plan from live task state. Written whole rather than
   * patched: a 60-task plan is small next to the results it holds, and a full
   * snapshot cannot drift out of sync with the tasks the way a delta could.
   *
   * Returns null before a source or any task exists, which is what stops
   * `persistPlan` from writing an empty plan over a real one.
   */
  function buildPlanSnapshot(
    next: LongBookAnalysisPlanStatus
  ): LongBookAnalysisPlan | null {
    const current = source.value;
    const all = tasks.value;
    if (!current || all.length === 0) return null;
    // Model and thinking level are frozen for the whole plan, so any task holds
    // them; the range is the union of every round, not just the first one.
    const first = all[0]!;
    return {
      version: 1,
      id: planId,
      sourceId: current.id,
      sourceTitle: current.name,
      sourceChapterCount: Math.max(1, current.chapters.length),
      modelId: first.modelId,
      thinkingLevel: first.thinkingLevel,
      startOrder: Math.min(...all.map((task) => task.startOrder)),
      endOrder: Math.max(...all.map((task) => task.endOrder)),
      autoContinueOnLaunch: true,
      status: next,
      createdAt: planCreatedAt,
      updatedAt: new Date().toISOString(),
      tasks: all.map((task) => ({
        id: task.id,
        presetId: task.presetId,
        presetName: task.presetName,
        roundIndex: task.roundIndex,
        startOrder: task.startOrder,
        endOrder: task.endOrder,
        libraryId: task.libraryId,
        status: task.queueStatus.value,
        attempts: task.attempts.value,
        // Model-written messages can be huge; the plan file is not a log.
        ...(task.queueError.value
          ? { error: task.queueError.value.slice(0, 2_000) }
          : {}),
        // Cleared on settle, so this is only ever a round still in flight.
        ...(task.checkpoint ? { checkpoint: task.checkpoint } : {}),
        // Only keep an unwritten result; a written one lives in its library.
        ...(task.state.result.value && task.queueStatus.value !== "completed"
          ? { unsavedResult: task.state.result.value }
          : {})
      }))
    };
  }

  /** Serialized so concurrent settles cannot interleave writes. */
  async function persistPlan(next: LongBookAnalysisPlanStatus): Promise<void> {
    planStatus = next;
    const snapshot = buildPlanSnapshot(next);
    if (!snapshot) return;
    saveChain = saveChain.then(async () => {
      await api().longBookAnalysis.plans.save(snapshot);
    });
    await saveChain;
  }

  /**
   * Discard the plan: the task list goes, and so do its files.
   *
   * Two things are removed on purpose. The current plan, obviously — but also
   * every plan left behind by earlier runs. Those accumulate one file per run
   * and each can carry a full round checkpoint (tens of KB apiece), and nothing
   * else ever reads them, since `restorePlan` only looks at `running` plans.
   *
   * Refused while a run is in flight: the tasks it would drop are the ones
   * being written to.
   */
  async function clearPlan(): Promise<boolean> {
    if (isBusy.value) return false;
    runner.pause();
    for (const task of tasks.value) task.pipeline.dispose();
    tasks.value = [];
    activeTaskId.value = "";
    const stale = await api().longBookAnalysis.plans.list();
    for (const plan of stale) {
      await api().longBookAnalysis.plans.remove(plan.id);
    }
    // A fresh id, so the next plan cannot collide with a file just deleted.
    planId = createId("analysis_plan");
    planCreatedAt = new Date().toISOString();
    planStatus = "paused";
    return true;
  }

  /**
   * Rebuild the most recent interrupted plan and resume it. Rounds that already
   * finished stay finished; in-flight rounds continue from their checkpoint.
   */
  async function restorePlan(): Promise<boolean> {
    if (isBusy.value || tasks.value.length > 0) return false;
    const plans = await api().longBookAnalysis.plans.list();
    const plan = plans.find(
      (item) => item.status === "running" && item.autoContinueOnLaunch
    );
    if (!plan) return false;
    // The preset or source may have been removed since the plan was written.
    if (!(await loadSavedSource(plan.sourceId))) return false;
    planId = plan.id;
    planCreatedAt = plan.createdAt;
    const restored: AnalysisTaskRuntime[] = [];
    for (const item of plan.tasks) {
      const preset = presets.value.find((entry) => entry.id === item.presetId);
      if (!preset) continue;
      const task = createAnalysisTask({
        presetId: item.presetId,
        presetName: item.presetName,
        roundIndex: item.roundIndex,
        startOrder: item.startOrder,
        endOrder: item.endOrder,
        libraryId: item.libraryId,
        modelId: plan.modelId,
        thinkingLevel: plan.thinkingLevel,
        getApi: api,
        models: configuredModels
      });
      task.presetSnapshot = preset;
      task.attempts.value = item.attempts;
      task.checkpoint = item.checkpoint ?? null;
      // Finished and abandoned rounds are not queued again.
      task.queueStatus.value =
        item.status === "completed"
          ? "completed"
          : item.status === "skipped"
            ? "skipped"
            : "queued";
      restored.push(task);
    }
    if (restored.length === 0) return false;
    tasks.value = restored;
    focusTask(restored[0]!.id);
    runner.startBatch();
    return true;
  }

  return {
    source,
    savedSources,
    sourcesLoading,
    presets,
    presetsLoading,
    selectedModelId,
    selectedThinkingLevel,
    activePresetId,
    targetLibraryId,
    status,
    phase,
    progressText,
    error,
    result,
    processEntries,
    currentActivity,
    liveOutput,
    isBusy,
    canRetry,
    setConfiguredModels,
    loadPresets,
    savePresets,
    resetPresets,
    loadSavedSources,
    loadSavedSource,
    chooseSource,
    replaceChapters,
    start,
    retry: async () => activeTask.value?.pipeline.retry() ?? false,
    stop: async () => (await activeTask.value?.pipeline.stop()) ?? false,
    startPlan,
    planTasks: tasks,
    activeTaskId,
    planSummary,
    pausePlan: () => runner.pause(),
    resumePlan: () => runner.resume(),
    rerunPlanTask: (taskId: string) => {
      const accepted = runner.rerunTask(taskId);
      // A manual re-run lifts a halt, so the on-disk plan is running again.
      if (accepted) void persistPlan("running");
      return accepted;
    },
    retryPlanWrite: (taskId: string) => runner.retryWrite(taskId),
    restorePlan,
    clearPlan,
    focusTask,
    persistResult,
    handleEvent: (event) => {
      // Broadcast: each pipeline filters by its own sessionId/runId, so
      // concurrent tasks only consume the events that belong to them.
      for (const task of tasks.value) task.pipeline.handleEvent(event);
    },
    dispose() {
      disposed = true;
      for (const task of tasks.value) task.pipeline.dispose();
    }
  };
}
