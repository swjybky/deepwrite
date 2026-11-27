import { formatError } from "../../i18n/errors";
import {
  localizedMessage,
  resolveLocalizedText,
  type LocalizedText,
  localizedTextRef,
  localizedNullableTextRef
} from "../analysis-ui/localized-text";
import { createScopedTranslator } from "../../i18n";
import { computed, ref } from "vue";
import { createId, jsonClone } from "@deepwrite/shared";
import {
  RevisionAnalysisRuntimeContextSchema,
  assertExtrasAgentBudget,
  type DeepWriteApi,
  type ModelConfig,
  type RevisionAnalysisInput,
  type RevisionAnalysisProfile,
  type RevisionAnalysisResult,
  type SystemEventEnvelope,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import {
  startExtrasAgentTask,
  type ExtrasAgentTaskHandle
} from "../agent-runtime/extrasAgentTask";
import type { AnalysisProcessEntry } from "../analysis-ui/analysis-process";

const t = createScopedTranslator("extras");

interface Job {
  input: ReturnType<typeof RevisionAnalysisRuntimeContextSchema.parse>;
  profile: RevisionAnalysisProfile;
  model: ModelConfig;
  thinkingLevel: ThinkingLevel;
}

/** Identifies the input and method a result was produced from. */
export function revisionAnalysisInputKey(
  input: RevisionAnalysisInput,
  systemPrompt: string
): string {
  return JSON.stringify({ ...input, systemPrompt });
}

export function createRevisionAnalysisRun(api: () => DeepWriteApi) {
  const status = ref<
    "idle" | "running" | "stopping" | "stopped" | "error" | "completed"
  >("idle");
  const completedInput = ref("");
  const result = ref<RevisionAnalysisResult | null>(null);
  const resultIsPrevious = ref(false);
  const error = localizedNullableTextRef();
  const liveOutput = ref("");
  const activity = localizedTextRef(
    localizedMessage("extras.analysisUi.waitingToStart")
  );
  const entries = ref<AnalysisProcessEntry[]>([]);
  const isBusy = computed(
    () => status.value === "running" || status.value === "stopping"
  );
  const canRetry = computed(
    () => status.value === "stopped" || status.value === "error"
  );
  let job: Job | null = null;
  let task: ExtrasAgentTaskHandle | null = null;
  let disposed = false;
  function log(
    message: LocalizedText,
    tone: AnalysisProcessEntry["tone"] = "info"
  ) {
    activity.value = message;
    entries.value.push({
      id: createId("revision_process"),
      get title() {
        return resolveLocalizedText(message);
      },
      createdAt: new Date().toISOString(),
      tone
    });
  }
  function clear() {
    if (isBusy.value)
      throw new Error(t("revisionAnalysis.inputsLockedWhileRunning"));
    job = null;
    completedInput.value = "";
    result.value = null;
    resultIsPrevious.value = false;
    status.value = "idle";
    error.value = null;
    entries.value = [];
    liveOutput.value = "";
    activity.value = localizedMessage("extras.analysisUi.waitingToStart");
  }
  function fail(cause: unknown) {
    status.value = "error";
    const message = () =>
      formatError(cause, t("revisionAnalysis.revisionFailed"));
    error.value = message;
    log(message, "error");
  }
  function execute() {
    if (!job || disposed) return;
    const current = job;
    assertExtrasAgentBudget(
      {
        agentId: "revision-analysis",
        profile: current.profile,
        input: current.input
      },
      current.model
    );
    status.value = "running";
    resultIsPrevious.value = Boolean(result.value);
    error.value = null;
    liveOutput.value = "";
    entries.value = [];
    log(
      localizedMessage("extras.revisionAnalysis.learningChanges", {
        count: current.input.changes.length
      })
    );
    let draft: RevisionAnalysisResult | undefined;
    const running = startExtrasAgentTask(
      api(),
      {
        modelId: current.model.id,
        thinkingLevel: current.thinkingLevel,
        task: {
          agentId: "revision-analysis",
          profileId: current.profile.id,
          input: current.input
        }
      },
      {
        onRetryScheduled(delayMs) {
          log(
            localizedMessage("extras.revisionAnalysis.requestRetryDelay", {
              seconds: Math.ceil(delayMs / 1000)
            })
          );
        },
        onDelta(delta) {
          liveOutput.value = (liveOutput.value + delta).slice(-200000);
          activity.value = localizedMessage(
            "extras.revisionAnalysis.generatingRevisionAnalysis"
          );
        },
        onThinking() {
          if (activity.value !== t("revisionAnalysis.modelThinking"))
            log(localizedMessage("extras.revisionAnalysis.modelThinking"));
        },
        onToolRequested() {
          log(localizedMessage("extras.revisionAnalysis.creatingSkillDraft"));
        },
        onOutput(output) {
          if (output.kind !== "revision-analysis-result") return;
          draft = {
            ...output.result,
            report: output.result.report || liveOutput.value.trim()
          };
        }
      }
    );
    task = running;
    void running.outcome.then(
      (outcome) => {
        if (task !== running) return;
        task = null;
        if (outcome.status === "stopped") {
          status.value = "stopped";
          log(localizedMessage("extras.revisionAnalysis.stoppedCanAnalyze"));
          return;
        }
        if (!draft) {
          fail(new Error(t("revisionAnalysis.skillDraftToolMissing")));
          return;
        }
        result.value = {
          ...draft,
          report:
            draft.report ||
            (outcome.content || liveOutput.value).trim().slice(0, 200000)
        };
        const { jobId, ...input } = current.input;
        void jobId;
        completedInput.value = revisionAnalysisInputKey(
          input,
          current.profile.systemPrompt
        );
        status.value = "completed";
        resultIsPrevious.value = false;
        log(
          localizedMessage("extras.revisionAnalysis.resultReadyToEdit"),
          "success"
        );
      },
      (cause: unknown) => {
        if (task !== running) return;
        task = null;
        fail(cause);
      }
    );
  }
  function start(
    input: RevisionAnalysisInput,
    profile: RevisionAnalysisProfile,
    model: ModelConfig,
    thinkingLevel: ThinkingLevel
  ) {
    if (isBusy.value || disposed)
      throw new Error(t("revisionAnalysis.analysisRunningOrDisposed"));
    if (
      thinkingLevel !== "off" &&
      !model.thinkingLevelOptions.includes(thinkingLevel)
    )
      throw new Error(t("revisionAnalysis.supportedThinkingRequired"));
    const context = RevisionAnalysisRuntimeContextSchema.parse({
      ...input,
      jobId: createId("revision_analysis_job")
    });
    assertExtrasAgentBudget(
      { agentId: "revision-analysis", profile, input: context },
      model
    );
    job = jsonClone({ input: context, profile, model, thinkingLevel });
    execute();
  }
  return {
    completedInput,
    status,
    result,
    resultIsPrevious,
    error,
    liveOutput,
    activity,
    entries,
    isBusy,
    canRetry,
    clear,
    start,
    handleEvent(event: SystemEventEnvelope) {
      task?.handleEvent(event);
    },
    retry() {
      if (canRetry.value && !isBusy.value) execute();
    },
    async stop() {
      if (!isBusy.value || !task) return;
      status.value = "stopping";
      log(localizedMessage("extras.analysisUi.stopping"));
      try {
        await task.stop();
      } catch (cause: unknown) {
        status.value = "running";
        const message = () => formatError(cause, t("agentRuntime.stopFailed"));
        error.value = message;
        log(message);
      }
    },
    dispose() {
      disposed = true;
      const current = task;
      task = null;
      current?.dispose();
    }
  };
}
