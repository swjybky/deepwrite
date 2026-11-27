import { computed, ref, shallowRef, watch } from "vue";
import {
  readyDecompositionUnitIds,
  assertExtrasAgentBudget,
  decompositionInputBudget,
  type DeepWriteApi,
  type DecompositionModelsInput,
  type DecompositionModelSelection,
  type LongBookDecompositionJob,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import type { ExtrasAgentTaskHandle } from "../agent-runtime/extrasAgentTask";
import { createSubagentRunTracker } from "../agent-runtime/subagentRunTracker";
import { createDecompositionModelCapacities } from "./model-capacity";
import {
  decompositionFailureMessage as failureMessage,
  startDecompositionPackage
} from "./package-runner";
import { formatModelProviderError } from "../../i18n/errors";

/** The page can unmount; this controller belongs to the workspace feature host. */
export function createDecompositionEngine(
  api: () => DeepWriteApi,
  models: () => readonly ModelConfig[]
) {
  const modelCapacities = createDecompositionModelCapacities(api);
  const job = shallowRef<LongBookDecompositionJob | null>(null);
  const running = ref(false);
  const error = ref<string | null>(null);
  const waitingForSlot = ref(false);
  const lastModelSwitch = shallowRef<{
    id: number;
    slot: "reading" | "integration";
    fromModelId: string;
    toModelId: string;
  } | null>(null);
  let wakeSlot: (() => void) | undefined;
  let switchSequence = 0;
  // Children of the latest packages: who runs, who waits, what they did.
  const subtasks = createSubagentRunTracker();
  // Another task's board is not this one's; a running package keeps its own.
  const stopSubtaskReset = watch(
    () => job.value?.id,
    () => {
      if (!running.value) subtasks.reset();
    }
  );
  let handle: ExtrasAgentTaskHandle | undefined;
  let generation = 0;
  let refreshSequence = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let refreshPending = false;
  function reportBlockedUnit() {
    if (job.value?.status === "ended") {
      error.value = null;
      return;
    }
    const blocked = Object.values(job.value?.units ?? {}).find(
      (unit) => ["conflict", "failed"].includes(unit.status) && unit.lastError
    );
    if (blocked?.lastError) {
      error.value = formatModelProviderError(blocked.lastError);
      return;
    }
    if (job.value?.status === "failed" && job.value.lastError) {
      error.value = formatModelProviderError(job.value.lastError);
      return;
    }
    if (job.value?.status !== "stopped") error.value = null;
  }
  async function refresh() {
    const id = job.value?.id;
    const sequence = ++refreshSequence;
    if (!id) return;
    const latest = await api().longBookDecomposition.getJob(id);
    if (job.value?.id === id && sequence === refreshSequence) {
      job.value = latest;
      reportBlockedUnit();
    }
  }
  function queueRefresh() {
    refreshPending = true;
    if (refreshTimer || refreshing) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = undefined;
      refreshPending = false;
      refreshing = true;
      try {
        await refresh();
      } catch {
        /* The package boundary reports persistent errors. */
      } finally {
        refreshing = false;
        if (refreshPending) queueRefresh();
      }
    }, 400);
  }
  async function control(
    action: Parameters<
      DeepWriteApi["longBookDecomposition"]["control"]
    >[0]["action"],
    unitId?: string,
    conflictChoice?: "keep-user" | "regenerate"
  ) {
    if (!job.value) return;
    refreshSequence++;
    job.value = await api().longBookDecomposition.control({
      jobId: job.value.id,
      action,
      ...(unitId ? { unitId } : {}),
      ...(conflictChoice ? { conflictChoice } : {})
    });
    reportBlockedUnit();
  }
  async function promoteNextFallback(
    current: LongBookDecompositionJob,
    slot: "reading" | "integration"
  ): Promise<boolean> {
    const fallbacks =
      slot === "reading"
        ? (current.models.readingFallbacks ?? [])
        : (current.models.integrationFallbacks ?? []);
    if (!fallbacks.length) return false;
    const fromModelId =
      slot === "reading"
        ? current.models.reading.modelId
        : current.models.integration.modelId;
    const pick = ({
      modelId,
      thinkingLevel
    }: DecompositionModelSelection): DecompositionModelSelection => ({
      modelId,
      thinkingLevel
    });
    for (let index = 0; index < fallbacks.length; index++) {
      const candidate = fallbacks[index]!;
      if (!models().some(({ id }) => id === candidate.modelId)) continue;
      const remaining = fallbacks.slice(index + 1).map(pick);
      const otherFallbacks =
        slot === "reading"
          ? current.models.integrationFallbacks?.map(pick)
          : current.models.readingFallbacks?.map(pick);
      const nextModels: DecompositionModelsInput =
        slot === "reading"
          ? {
              reading: pick(candidate),
              integration: pick(current.models.integration),
              ...(remaining.length ? { readingFallbacks: remaining } : {}),
              ...(otherFallbacks?.length
                ? { integrationFallbacks: otherFallbacks }
                : {})
            }
          : {
              reading: pick(current.models.reading),
              integration: pick(candidate),
              ...(otherFallbacks?.length
                ? { readingFallbacks: otherFallbacks }
                : {}),
              ...(remaining.length ? { integrationFallbacks: remaining } : {})
            };
      try {
        refreshSequence++;
        job.value = await api().longBookDecomposition.updateModels({
          jobId: current.id,
          models: nextModels
        });
        error.value = null;
        lastModelSwitch.value = {
          id: ++switchSequence,
          slot,
          fromModelId,
          toModelId: candidate.modelId
        };
        return true;
      } catch {
        /* Skip unusable fallback and try the next candidate in order. */
      }
    }
    return false;
  }
  async function run() {
    if (running.value || !job.value) return;
    running.value = true;
    error.value = null;
    const epoch = ++generation;
    try {
      await control("resume");
      while (epoch === generation && job.value && job.value.phase !== "done") {
        const current: LongBookDecompositionJob = job.value;
        if (current.phase === "registry_review") break;
        const unitIds = readyDecompositionUnitIds(current);
        if (!unitIds.length) {
          const previous: LongBookDecompositionJob["phase"] = current.phase;
          await control("advance");
          if (job.value?.phase === previous) break;
          continue;
        }
        const phase = current.phase as
          "read" | "registry" | "integrate" | "review";
        const chosen =
          phase === "read"
            ? current.models.reading
            : current.models.integration;
        const model = models().find(({ id }) => id === chosen.modelId);
        if (!model) throw new Error("请选择可用的拆解模型。");
        const modelCapacity = await modelCapacities.resolve(model);
        if (epoch !== generation) break;
        assertExtrasAgentBudget(
          {
            agentId: "long-book-decomposition",
            profile: current.profile,
            input: {
              jobId: current.id,
              phase,
              unitIds,
              outputVersion: current.outputVersion,
              mode: current.mode,
              attemptId: "ldattempt_preflight",
              modelId: chosen.modelId,
              thinkingLevel: chosen.thinkingLevel,
              units: current.units,
              inputBudget: decompositionInputBudget(
                chosen,
                current.profile.systemPrompt.length
              ),
              contextWindow: chosen.contextWindow,
              ...(chosen.maxTokens ? { maxTokens: chosen.maxTokens } : {})
            }
          },
          modelCapacity
        );
        const pkg = startDecompositionPackage(
          api(),
          current,
          phase,
          unitIds,
          subtasks,
          {
            onAccepted: (acceptedJob) => {
              const sequence = ++refreshSequence;
              // Claimed units show as running now, not after the first save.
              acceptedJob.then(
                (latest) => {
                  if (
                    job.value?.id === latest.id &&
                    sequence === refreshSequence
                  )
                    job.value = latest;
                },
                () => undefined
              );
            },
            onOutput: () => {
              queueRefresh();
            }
          }
        );
        handle = pkg.handle;
        const { failure, capacity, quota, unitErrors } = await pkg.outcome;
        if (epoch !== generation) break;
        if (quota) {
          refreshSequence++;
          job.value = await api().longBookDecomposition.control({
            jobId: current.id,
            action: "stop",
            ...(failure ? { error: failure.slice(0, 2000) } : {})
          });
          handle = undefined;
          if (epoch !== generation || !job.value) break;
          const slot = phase === "read" ? "reading" : "integration";
          const switched = await promoteNextFallback(job.value, slot);
          if (epoch !== generation || !job.value) break;
          if (switched) {
            await control("resume");
            continue;
          }
          error.value = failure ?? null;
          break;
        }
        if (capacity && epoch === generation) {
          waitingForSlot.value = true;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wakeSlot = undefined;
              resolve();
            }, 5000);
            wakeSlot = () => {
              clearTimeout(timer);
              wakeSlot = undefined;
              resolve();
            };
          });
          waitingForSlot.value = false;
          handle = undefined;
          if (epoch !== generation) break;
          await refresh();
          continue;
        }
        const snapshot = await pkg.claimedJob();
        const attemptId =
          snapshot &&
          unitIds.map((id) => snapshot.units[id]?.attemptId).find(Boolean);
        if (epoch !== generation) break;
        if (attemptId)
          job.value = await api().longBookDecomposition.control({
            jobId: current.id,
            action: "finish-package",
            attemptId,
            ...(failure ? { error: failure, failed: true } : {}),
            ...(Object.keys(unitErrors).length ? { unitErrors } : {})
          });
        else await refresh();
        reportBlockedUnit();
        handle = undefined;
        if (job.value?.status === "failed") break;
        // Core pauses once usage passes the accepted limit; continuing is
        // the user's call.
        if (job.value?.status === "stopped") {
          if (job.value.lastError) error.value = job.value.lastError;
          break;
        }
        if (failure && !attemptId) throw new Error(failure);
      }
    } catch (cause) {
      error.value = formatModelProviderError(failureMessage(cause));
    } finally {
      handle = undefined;
      running.value = false;
    }
  }
  return {
    job,
    error,
    subtasks,
    waitingForSlot,
    lastModelSwitch,
    modelCapacity: modelCapacities.peek,
    resolveModelCapacity: modelCapacities.resolve,
    isBusy: computed(() => running.value),
    refresh,
    control,
    run,
    async stop() {
      generation++;
      wakeSlot?.();
      waitingForSlot.value = false;
      await handle?.stop();
      await control("stop");
      running.value = false;
    },
    handleEvent(event: SystemEventEnvelope) {
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      )
        wakeSlot?.();
      handle?.handleEvent(event);
    },
    dispose() {
      stopSubtaskReset();
      subtasks.dispose();
      modelCapacities.dispose();
      generation++;
      refreshSequence++;
      refreshPending = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = undefined;
      wakeSlot?.();
      waitingForSlot.value = false;
      handle?.dispose();
      handle = undefined;
      running.value = false;
    }
  };
}
