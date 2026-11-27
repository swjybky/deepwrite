import { presetLabel } from "../analysis-ui/preset-labels";
import { formatError } from "../../i18n/errors";
import {
  localizedMessage,
  resolveLocalizedText,
  type LocalizedText,
  localizedTextRef,
  localizedNullableTextRef
} from "../analysis-ui/localized-text";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, ref } from "vue";
import { createId, jsonClone } from "@deepwrite/shared";
import {
  ShortBookAnalysisRuntimeContextSchema,
  assertExtrasAgentBudget,
  type DeepWriteApi,
  type ModelConfig,
  type ShortBookAnalysisPreset,
  type ShortBookAnalysisResult,
  type ShortBookAnalysisSource,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import type { AnalysisProcessEntry } from "../analysis-ui/analysis-process";
import {
  errorCodeOf,
  type AnalysisPresetRunner,
  type PresetRunStatus
} from "../analysis-ui/preset-runner";
import {
  startExtrasAgentTask,
  type ExtrasAgentTaskHandle
} from "../agent-runtime/extrasAgentTask";

const t = createScopedTranslator("extras");

export interface ShortAnalysisJobInput {
  books: readonly ShortBookAnalysisSource[];
  preset: ShortBookAnalysisPreset;
  model: ModelConfig;
  thinkingLevel: ThinkingLevel;
}

interface Job {
  context: ReturnType<typeof ShortBookAnalysisRuntimeContextSchema.parse>;
  preset: ShortBookAnalysisPreset;
  model: ModelConfig;
  thinkingLevel: ThinkingLevel;
}

export type ShortAnalysisRun = AnalysisPresetRunner<ShortBookAnalysisResult> & {
  readonly canRetry: Readonly<{ value: boolean }>;
};

/** Validates the selection now, so an oversized preset never issues a request. */
function createJob(input: ShortAnalysisJobInput): Job {
  const { books, preset, model, thinkingLevel } = input;
  if (
    thinkingLevel !== "off" &&
    !model.thinkingLevelOptions.includes(thinkingLevel)
  )
    throw new Error(t("revisionAnalysis.supportedThinkingRequired"));
  const context = ShortBookAnalysisRuntimeContextSchema.parse({
    jobId: createId("short_analysis_job"),
    books
  });
  assertExtrasAgentBudget(
    { agentId: "short-book-analysis", profile: preset, input: context },
    model
  );
  return jsonClone({ context, preset, model, thinkingLevel });
}

/** One short-story preset analysis over a fixed snapshot of the selected books. */
export function createShortAnalysisRun(
  api: () => DeepWriteApi,
  input: ShortAnalysisJobInput
): ShortAnalysisRun {
  const job = createJob(input);
  const status = ref<PresetRunStatus>("idle");
  const result = ref<ShortBookAnalysisResult | null>(null);
  const error = localizedNullableTextRef();
  const liveOutput = ref("");
  const activity = localizedTextRef(
    localizedMessage("extras.analysisUi.waitingToStart")
  );
  const entries = ref<(AnalysisProcessEntry & { createdAt: string })[]>([]);
  const isBusy = computed(
    () => status.value === "running" || status.value === "stopping"
  );
  const canRetry = computed(
    () => status.value === "stopped" || status.value === "error"
  );
  let task: ExtrasAgentTaskHandle | null = null;
  let lastFailure: unknown;
  let disposed = false;
  function log(
    message: LocalizedText,
    detail?: LocalizedText,
    tone: AnalysisProcessEntry["tone"] = "info"
  ) {
    activity.value = message;
    entries.value = [
      ...entries.value,
      {
        id: createId("short_analysis_process"),
        createdAt: new Date().toISOString(),
        get title() {
          return resolveLocalizedText(message);
        },
        get detail() {
          return detail ? resolveLocalizedText(detail) : "";
        },
        tone,
        phase: null
      }
    ];
    if (entries.value.length > 120)
      entries.value.splice(1, entries.value.length - 120);
  }
  function setActivity(message: LocalizedText) {
    if (activity.value !== resolveLocalizedText(message)) log(message);
  }
  function fail(cause: unknown) {
    lastFailure = cause;
    status.value = "error";
    const message = () =>
      formatError(cause, t("shortBookAnalysis.shortAnalysisFailed"));
    error.value = message;
    log(message, undefined, "error");
  }
  function execute() {
    if (disposed || isBusy.value) return;
    status.value = "running";
    error.value = null;
    lastFailure = undefined;
    result.value = null;
    liveOutput.value = "";
    entries.value = [];
    log(
      localizedMessage("extras.shortBookAnalysis.analyzingStoriesTogether", {
        count: job.context.books.length
      }),
      () =>
        t("shortBookAnalysis.shortRunSummary", {
          preset: presetLabel(job.preset),
          books: job.context.books.map((book) => book.title).join("、"),
          characters: job.context.books
            .reduce((total, book) => total + book.text.length, 0)
            .toLocaleString(locale.value)
        })
    );
    log(localizedMessage("extras.shortBookAnalysis.submittingAnalysis"));
    let submitted: ShortBookAnalysisResult | undefined;
    const running = startExtrasAgentTask(
      api(),
      {
        modelId: job.model.id,
        thinkingLevel: job.thinkingLevel,
        task: {
          agentId: "short-book-analysis",
          profileId: job.preset.id,
          input: job.context
        }
      },
      {
        onAccepted() {
          if (activity.value === t("shortBookAnalysis.submittingAnalysis"))
            log(
              localizedMessage("extras.shortBookAnalysis.awaitingModelResponse")
            );
        },
        onDelta(delta) {
          setActivity(
            localizedMessage("extras.shortBookAnalysis.modelDescribingAnalysis")
          );
          liveOutput.value = (liveOutput.value + delta).slice(-200000);
        },
        onThinking() {
          setActivity(
            localizedMessage("extras.shortBookAnalysis.modelAnalyzingText")
          );
        },
        onToolRequested() {
          log(
            localizedMessage(
              "extras.shortBookAnalysis.generatingStructuredResult"
            )
          );
        },
        onToolCompleted(_toolName, isError) {
          if (isError)
            log(
              localizedMessage(
                "extras.shortBookAnalysis.resultGenerationError"
              ),
              localizedMessage(
                "extras.shortBookAnalysis.waitingModelCorrection"
              ),
              "error"
            );
        },
        onOutput(output) {
          if (output.kind !== "book-analysis-result") return;
          submitted = output.result;
          log(
            localizedMessage("extras.shortBookAnalysis.structuredResultReady"),
            output.result.name,
            "success"
          );
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
        if (!liveOutput.value.trim() && outcome.content.trim())
          liveOutput.value = outcome.content.slice(-200000);
        if (!submitted) {
          fail(new Error(t("shortBookAnalysis.structuredResultMissing")));
          return;
        }
        result.value = submitted;
        status.value = "completed";
        log(
          localizedMessage("extras.revisionAnalysis.resultReadyToEdit"),
          undefined,
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
  return {
    status,
    result,
    error,
    liveOutput,
    activity,
    entries,
    canRetry,
    errorCode: () => errorCodeOf(lastFailure),
    start: execute,
    retry() {
      if (canRetry.value) execute();
    },
    handleEvent(event) {
      task?.handleEvent(event);
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
        log(message, undefined, "error");
        throw cause;
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
