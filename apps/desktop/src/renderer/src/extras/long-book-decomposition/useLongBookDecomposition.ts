import { editableAgentProfileBaseline } from "../../utils/agentSettingsBaseline";
import { computed, ref, shallowRef, watch } from "vue";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  splitDecompositionChunks,
  decompositionInputBudget,
  limitingDecompositionReadingModel,
  estimateDecomposition,
  isModelQuotaExhausted,
  type DeepWriteApi,
  type DecompositionModelsInput,
  type DecompositionModelSelection,
  type ModelConfig,
  type ThinkingLevel,
  type LongBookDecompositionProfile,
  type DecompositionSourceConfirmation,
  type CreateDecompositionJobInput,
  type LongBookSummary,
  type LongBookDecompositionJob,
  type DecompositionRegistryData,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { createLongAnalysisSources } from "../long-book-analysis/long-analysis-sources";
import { createDecompositionEngine } from "./engine";
import { createDecompositionCreationRecovery } from "./creation-recovery";
import { createDecompositionRegistryBinding } from "./registry-binding";
import {
  formatError,
  formatModelProviderError,
  getErrorPayload
} from "../../i18n/errors";
import { jsonClone } from "@deepwrite/shared";

export function useLongBookDecomposition(options: {
  api(): DeepWriteApi | undefined;
}) {
  let disposed = false;
  const api = () => {
    const value = options.api();
    if (!value) throw new Error("DeepWrite API unavailable.");
    return value;
  };
  const configuredModels = shallowRef<readonly ModelConfig[]>([]);
  const engine = createDecompositionEngine(api, () => configuredModels.value);
  const confirmation = shallowRef<DecompositionSourceConfirmation | null>(null);
  const sources = createLongAnalysisSources({
    api,
    isBusy: () => engine.isBusy.value,
    isDisposed: () => disposed,
    onChange: () => {
      confirmation.value = null;
    }
  });
  const profiles = ref<LongBookDecompositionProfile[]>([
    DEFAULT_DECOMPOSITION_PROFILE
  ]);
  const profileId = ref(DEFAULT_DECOMPOSITION_PROFILE.id);
  const jobs = shallowRef<LongBookDecompositionJob[]>([]);
  const creationRecovery = createDecompositionCreationRecovery({
    api,
    job: engine.job,
    jobs,
    isDisposed: () => disposed
  });
  const books = shallowRef<LongBookSummary[]>([]);
  const registryBinding = createDecompositionRegistryBinding({
    api,
    job: engine.job
  });
  const readingModelId = ref("");
  const integrationModelId = ref("");
  const readingThinkingLevel = ref<ThinkingLevel>("off");
  const integrationThinkingLevel = ref<ThinkingLevel>("off");
  const readingFallbacks = ref<DecompositionModelSelection[]>([]);
  const integrationFallbacks = ref<DecompositionModelSelection[]>([]);
  const loading = ref(false);
  const selectedModelIds = computed(
    () =>
      new Set([
        readingModelId.value,
        integrationModelId.value,
        ...readingFallbacks.value.map(({ modelId }) => modelId),
        ...integrationFallbacks.value.map(({ modelId }) => modelId)
      ])
  );
  const stopCapacityWatch = watch(
    [configuredModels, selectedModelIds],
    () => {
      void Promise.allSettled(
        configuredModels.value
          .filter(({ id }) => selectedModelIds.value.has(id))
          .map(engine.resolveModelCapacity)
      );
    },
    { immediate: true }
  );
  const selectedProfile = computed(
    () =>
      profiles.value.find(({ id }) => id === profileId.value) ??
      DEFAULT_DECOMPOSITION_PROFILE
  );
  async function load() {
    loading.value = true;
    try {
      const [settings, savedJobs, longBooks] = await Promise.all([
        api().extrasAgents.profiles.list("long-book-decomposition"),
        api().longBookDecomposition.listJobs(),
        api().long.list(),
        sources.loadSavedSources()
      ]);
      profiles.value = settings.profiles;
      creationRecovery.adopt(savedJobs);
      books.value = longBooks.books;
    } finally {
      loading.value = false;
    }
  }
  async function confirm(range: { start: number; end: number }) {
    confirmation.value = null;
    await sources.saveSource();
    const source = sources.source.value;
    if (!source?.revision || !source.fingerprint)
      throw new Error("来源保存失败。");
    confirmation.value = await api().longBookAnalysis.sources.confirm({
      sourceId: source.id,
      sourceRevision: source.revision,
      fingerprint: source.fingerprint,
      range: { start: range.start, end: range.end }
    });
  }
  async function inspect() {
    if (!engine.job.value) return;
    await engine.refresh();
    const job = engine.job.value;
    if (job) await registryBinding.sync(job);
    jobs.value = await api().longBookDecomposition.listJobs();
  }
  async function selectJob(id: string) {
    if (engine.isBusy.value) return;
    engine.job.value = await api().longBookDecomposition.getJob(id);
    await inspect();
  }
  async function create(
    input: Pick<
      CreateDecompositionJobInput,
      | "mode"
      | "targetSelection"
      | "autoContinue"
      | "maxConcurrency"
      | "reuseJobId"
    >
  ) {
    if (
      !confirmation.value ||
      sources.sourceDirty.value ||
      sources.sourceSaving.value ||
      sources.sourceDeleting.value
    )
      throw new Error("请先保存并确认章节与范围。");
    const uniqueModelIds = [
      ...new Set([
        readingModelId.value,
        ...readingFallbacks.value.map(({ modelId }) => modelId),
        integrationModelId.value,
        ...integrationFallbacks.value.map(({ modelId }) => modelId)
      ])
    ];
    await Promise.all(
      uniqueModelIds.map(async (id) => {
        const model = configuredModels.value.find((model) => model.id === id);
        if (!model) throw new Error("请选择可用的拆解模型。");
        decompositionInputBudget(
          await engine.resolveModelCapacity(model),
          selectedProfile.value.systemPrompt.length
        );
      })
    );
    try {
      engine.job.value = await api().longBookDecomposition.createJob({
        ...input,
        confirmation: confirmation.value,
        profileId: profileId.value,
        models: {
          reading: {
            modelId: readingModelId.value,
            thinkingLevel: readingThinkingLevel.value
          },
          integration: {
            modelId: integrationModelId.value,
            thinkingLevel: integrationThinkingLevel.value
          },
          ...(readingFallbacks.value.length
            ? { readingFallbacks: jsonClone(readingFallbacks.value) }
            : {}),
          ...(integrationFallbacks.value.length
            ? { integrationFallbacks: jsonClone(integrationFallbacks.value) }
            : {})
        }
      });
    } catch (cause) {
      await creationRecovery.recover(cause).catch(() => undefined);
      throw cause;
    }
    await inspect();
    if (engine.job.value?.lastError)
      throw new Error(engine.job.value.lastError);
  }
  function estimate(
    range: { start: number; end: number },
    concurrency?: number
  ) {
    const source = sources.source.value;
    const primaryModel = configuredModels.value.find(
      ({ id }) => id === readingModelId.value
    );
    if (!source || !primaryModel) return null;
    const primaryCapacity = engine.modelCapacity(primaryModel);
    if (!primaryCapacity) return null;
    const capacities = [
      primaryCapacity,
      ...readingFallbacks.value
        .map(({ modelId }) =>
          configuredModels.value.find(({ id }) => id === modelId)
        )
        .map((item) => (item ? engine.modelCapacity(item) : undefined))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    ];
    const capacity = limitingDecompositionReadingModel(
      capacities,
      selectedProfile.value.systemPrompt.length
    );
    const chapters = source.chapters.filter(
      ({ order }) => order >= range.start && order <= range.end
    );
    const chunks = splitDecompositionChunks(
      chapters,
      capacity,
      selectedProfile.value.systemPrompt.length
    );
    return estimateDecomposition(
      chapters.length,
      chapters.reduce((sum, { charCount }) => sum + charCount, 0),
      chunks.length,
      concurrency
    );
  }
  async function updateJobModels(models: DecompositionModelsInput) {
    const current = engine.job.value;
    if (!current) throw new Error("没有打开的拆解任务。");
    if (engine.isBusy.value) throw new Error("请先停止任务再切换模型。");
    const updated = await api().longBookDecomposition.updateModels({
      jobId: current.id,
      models
    });
    engine.job.value = updated;
    if (
      !updated.lastError &&
      (isModelQuotaExhausted(engine.error.value) ||
        (current.lastError !== undefined &&
          (engine.error.value === current.lastError ||
            engine.error.value ===
              formatModelProviderError(current.lastError))))
    )
      engine.error.value = null;
    jobs.value = await api().longBookDecomposition.listJobs();
    return updated;
  }
  return {
    ...sources,
    ...engine,
    confirmation,
    profiles,
    profileId,
    selectedProfile,
    jobs,
    books,
    registry: registryBinding.registry,
    loading,
    readingModelId,
    integrationModelId,
    readingThinkingLevel,
    integrationThinkingLevel,
    readingFallbacks,
    integrationFallbacks,
    load,
    confirm,
    create,
    updateJobModels,
    selectJob,
    inspect,
    estimate,
    handleEvent(event: SystemEventEnvelope) {
      engine.handleEvent(event);
      creationRecovery.handleEvent(event);
    },
    async run() {
      await engine.run();
      try {
        await inspect();
      } catch (cause) {
        engine.error.value ??=
          getErrorPayload(cause)?.message ?? formatError(cause, String(cause));
      }
    },
    /** Task-local records for the progress dialog. */
    readUnit(unitId: string) {
      const job = engine.job.value;
      if (!job) throw new Error("没有打开的拆解任务。");
      return api().longBookDecomposition.readUnit(job.id, unitId);
    },
    async saveRegistry(next: DecompositionRegistryData, confirmed: boolean) {
      const base = registryBinding.registry.value;
      if (!engine.job.value || !base) return;
      engine.job.value = await api().longBookDecomposition.saveRegistry({
        jobId: engine.job.value.id,
        baseRevision: base.version,
        registry: jsonClone(next),
        confirm: confirmed
      });
      await inspect();
    },
    async saveProfiles(next: LongBookDecompositionProfile[]) {
      const previous = new Set(profiles.value.map(({ id }) => id));
      profiles.value = (
        await api().extrasAgents.profiles.save({
          agentId: "long-book-decomposition",
          baseProfiles: editableAgentProfileBaseline(profiles.value),
          profiles: next.map(({ builtin: _builtin, ...profile }) => ({
            ...profile,
            worldCategories: profile.worldCategories.map((category) => ({
              ...category
            }))
          }))
        })
      ).profiles;
      // A profile created in this save is the one the user means to run next.
      const created = profiles.value
        .filter(({ id, builtin }) => !builtin && !previous.has(id))
        .at(-1);
      if (created) profileId.value = created.id;
      else if (!profiles.value.some(({ id }) => id === profileId.value))
        profileId.value = profiles.value[0]?.id ?? profileId.value;
    },
    async loadProfileDefaults() {
      return (
        await api().extrasAgents.profiles.reset(
          "long-book-decomposition",
          undefined,
          true
        )
      ).profiles;
    },
    async resetProfile(id: string) {
      profiles.value = (
        await api().extrasAgents.profiles.reset("long-book-decomposition", id)
      ).profiles;
    },
    setConfiguredModels(
      models: readonly ModelConfig[],
      defaultModelId?: string
    ) {
      configuredModels.value = models.filter(
        ({ enabled }) => enabled !== false
      );
      for (const [id, thinking] of [
        [readingModelId, readingThinkingLevel],
        [integrationModelId, integrationThinkingLevel]
      ] as const) {
        const selected =
          configuredModels.value.find((item) => item.id === id.value) ??
          configuredModels.value.find((item) => item.id === defaultModelId) ??
          configuredModels.value[0];
        if (selected && selected.id !== id.value) {
          id.value = selected.id;
          thinking.value = selected.defaultThinkingLevel;
        }
      }
      const sanitizeFallbacks = (
        primaryId: string,
        items: readonly DecompositionModelSelection[]
      ) => {
        const seen = new Set<string>([primaryId]);
        return items.filter((item) => {
          if (
            seen.has(item.modelId) ||
            !configuredModels.value.some(({ id }) => id === item.modelId)
          )
            return false;
          seen.add(item.modelId);
          return true;
        });
      };
      readingFallbacks.value = sanitizeFallbacks(
        readingModelId.value,
        readingFallbacks.value
      );
      integrationFallbacks.value = sanitizeFallbacks(
        integrationModelId.value,
        integrationFallbacks.value
      );
    },
    dispose() {
      disposed = true;
      stopCapacityWatch();
      registryBinding.dispose();
      engine.dispose();
    }
  };
}
export type LongBookDecompositionController = ReturnType<
  typeof useLongBookDecomposition
>;
