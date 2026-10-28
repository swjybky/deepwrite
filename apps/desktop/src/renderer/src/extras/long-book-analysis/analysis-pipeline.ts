import { presetLabel } from "../analysis-ui/preset-labels";
import { localizedMessage } from "../analysis-ui/localized-text";
import { createScopedTranslator } from "../../i18n";
import type { ShallowRef } from "vue";
import {
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  type DeepWriteApi,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisRuntimeContext,
  type LongBookAnalysisSource,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import {
  buildAnalysisSegments,
  groupAnalysisSegments,
  resolveAnalysisInputBudget
} from "./batching";
import type {
  LongBookAnalysisJob as AnalysisJob,
  LongBookAnalysisPipelineState,
  LongBookAnalysisRangeInput
} from "./analysis-pipeline-types";
import {
  analysisErrorMessage,
  createAnalysisNote
} from "./analysis-pipeline-helpers";
import {
  startExtrasAgentTask,
  type ExtrasAgentTaskHandle
} from "../agent-runtime/extrasAgentTask";
import { errorCodeOf } from "../analysis-ui/preset-runner";
import { LongBookAnalysisProcessTracker } from "./analysis-process";
import { reduceAnalysisJob } from "./analysis-reducer";

const t = createScopedTranslator("extras.longBookAnalysis");
export type { LongBookAnalysisPhase } from "./analysis-pipeline-types";

export class LongBookAnalysisPipeline {
  private job: AnalysisJob | null = null;
  private pending: ExtrasAgentTaskHandle | null = null;
  private running: Promise<void> | null = null;
  private stopRequested = false;
  private disposed = false;
  private failure: unknown;
  private readonly process: LongBookAnalysisProcessTracker;

  constructor(
    private readonly getApi: () => DeepWriteApi,
    private readonly models: ShallowRef<readonly ModelConfig[]>,
    private readonly state: LongBookAnalysisPipelineState
  ) {
    this.process = new LongBookAnalysisProcessTracker(state);
  }

  get hasJob(): boolean {
    return this.job !== null;
  }

  get preset(): LongBookAnalysisPreset | null {
    return this.job?.preset ?? null;
  }

  /** Code of the last failure, e.g. a full Agent Utility. */
  get errorCode(): string | undefined {
    return errorCodeOf(this.failure);
  }

  reset(): void {
    if (["running", "stopping"].includes(this.state.status.value)) {
      throw new Error(t("analysisInputsLocked"));
    }
    this.job = null;
    this.state.result.value = null;
    this.state.phase.value = null;
    this.state.completedUnits.value = 0;
    this.state.estimatedUnits.value = 0;
    this.state.status.value = "idle";
    this.state.error.value = null;
    this.process.reset();
  }

  start(
    source: LongBookAnalysisSource,
    preset: LongBookAnalysisPreset,
    input: LongBookAnalysisRangeInput
  ): void {
    this.prepare(source, preset, input);
    this.begin();
  }

  /** Validates the range and plans batches without issuing a request. */
  prepare(
    source: LongBookAnalysisSource,
    preset: LongBookAnalysisPreset,
    input: LongBookAnalysisRangeInput
  ): void {
    const modelId = input.modelId ?? "";
    const model = this.models.value.find((item) => item.id === modelId);
    if (!modelId || !model) throw new Error(t("selectAvailableModel"));
    const thinkingLevel = input.thinkingLevel ?? model.defaultThinkingLevel;
    if (
      thinkingLevel !== "off" &&
      !model.thinkingLevelOptions.includes(thinkingLevel)
    ) {
      throw new Error(t("unsupportedThinking"));
    }
    if (input.endOrder < input.startOrder) {
      throw new Error(t("invalidChapterOrder"));
    }
    if (
      input.endOrder - input.startOrder + 1 >
      LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
    ) {
      throw new Error(
        t("consecutiveChapterLimit", {
          count: LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
        })
      );
    }
    const chapters = source.chapters.filter(
      (chapter) =>
        chapter.order >= input.startOrder && chapter.order <= input.endOrder
    );
    if (chapters.length !== input.endOrder - input.startOrder + 1) {
      throw new Error(t("chapterRangeChanged"));
    }
    const inputBudget = resolveAnalysisInputBudget(model, preset.systemPrompt);
    const batches = groupAnalysisSegments(
      buildAnalysisSegments(chapters, inputBudget),
      inputBudget
    );
    this.job = {
      id: createId("long_book_analysis_job"),
      sourceTitle: source.name,
      preset,
      modelId,
      thinkingLevel,
      selectionStart: input.startOrder,
      selectionEnd: input.endOrder,
      inputBudget,
      batches,
      batchIndex: 0,
      notes: [],
      reductionRounds: 0
    };
    this.state.result.value = null;
    this.state.phase.value = null;
    this.state.completedUnits.value = 0;
    this.state.estimatedUnits.value = batches.length + 1;
  }

  /** Starts the prepared job from its first batch. */
  begin(): void {
    const job = this.job;
    if (!job || this.running) return;
    this.state.phase.value = "batch";
    this.process.start(
      () => presetLabel(job.preset),
      job.selectionStart,
      job.selectionEnd,
      job.batches.length
    );
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  retry(): boolean {
    if (!this.job || !["error", "stopped"].includes(this.state.status.value)) {
      return false;
    }
    this.process.retry();
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return true;
  }

  async stop(): Promise<boolean> {
    if (!["running", "stopping"].includes(this.state.status.value)) {
      return false;
    }
    this.stopRequested = true;
    this.state.status.value = "stopping";
    this.process.requestStop();
    if (this.pending) {
      try {
        await this.pending.stop();
      } catch (error) {
        this.stopRequested = false;
        this.state.status.value = "running";
        throw error;
      }
    } else {
      this.state.status.value = "stopped";
      this.process.stopped();
    }
    await this.running;
    return true;
  }

  handleEvent(event: SystemEventEnvelope): void {
    this.pending?.handleEvent(event);
  }

  dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    const pending = this.pending;
    this.pending = null;
    pending?.dispose();
  }

  private base(unitId: string) {
    if (!this.job) throw new Error(t("analysisNotReady"));
    return {
      jobId: this.job.id,
      unitId,
      sourceTitle: this.job.sourceTitle,
      selectionStart: this.job.selectionStart,
      selectionEnd: this.job.selectionEnd
    };
  }

  private async runUnit(
    context: LongBookAnalysisRuntimeContext
  ): Promise<string | LongBookAnalysisResult> {
    const job = this.job;
    if (!job) throw new Error(t("analysisNotReady"));
    let note: string | undefined;
    let result: LongBookAnalysisResult | undefined;
    const task = startExtrasAgentTask(
      this.getApi(),
      {
        modelId: job.modelId,
        thinkingLevel: job.thinkingLevel,
        task: {
          agentId: "long-book-analysis",
          profileId: job.preset.id,
          input: context
        }
      },
      {
        onThinking: () => this.process.thinking(),
        onDelta: (delta) => this.process.appendMessage(delta),
        onToolRequested: (toolName) => this.process.toolStarted(toolName),
        onToolCompleted: (toolName, isError) =>
          this.process.toolCompleted(toolName, isError),
        onOutput: (output) => {
          if (output.kind === "book-analysis-note") {
            note = output.note.text;
            this.process.noteWritten(note.length);
          } else if (output.kind === "book-analysis-result") {
            result = output.result;
            this.state.result.value = output.result;
            this.process.resultWritten(output.result.name);
          }
        }
      }
    );
    this.pending = task;
    if (this.stopRequested) void task.stop().catch(() => undefined);
    try {
      const outcome = await task.outcome.catch((cause: unknown) => {
        throw new Error(analysisErrorMessage(cause, t("phaseFailed")), {
          cause
        });
      });
      if (outcome.status === "stopped") throw new Error(t("analysisStopped"));
      this.process.completeMessage(outcome.content);
      if (context.phase === "final") {
        if (result) return result;
        throw new Error(t("resultToolMissing"));
      }
      if (note) return note;
      throw new Error(t("noteToolMissing"));
    } finally {
      if (this.pending === task) this.pending = null;
    }
  }

  private async run(): Promise<void> {
    const job = this.job;
    if (!job || this.disposed) return;
    this.state.status.value = "running";
    this.state.error.value = null;
    this.stopRequested = false;
    this.failure = undefined;
    try {
      this.state.phase.value = "batch";
      while (job.batchIndex < job.batches.length) {
        const batch = job.batches[job.batchIndex]!;
        const start = Math.min(...batch.map((item) => item.chapterOrder));
        const end = Math.max(...batch.map((item) => item.chapterOrder));
        this.process.beginUnit(
          "batch",
          localizedMessage("extras.longBookAnalysis.batchProgress", {
            start: start,
            end: end,
            batch: job.batchIndex + 1,
            total: job.batches.length
          })
        );
        const text = await this.runUnit({
          ...this.base(createId("analysis_batch")),
          phase: "batch",
          segments: batch
        });
        if (typeof text !== "string") {
          throw new Error(t("batchNoteMissing"));
        }
        job.notes.push(
          createAnalysisNote(
            text,
            t("batchNoteTitle", {
              start: start,
              end: end
            }),
            start,
            end
          )
        );
        job.batchIndex += 1;
        this.state.completedUnits.value += 1;
      }
      this.state.phase.value = "reduce";
      await reduceAnalysisJob(job, {
        run: (notes) =>
          this.runUnit({
            ...this.base(createId("analysis_reduce")),
            phase: "reduce",
            notes
          }),
        begin: (detail) => this.process.beginUnit("reduce", detail),
        addEstimatedUnits: (count) => {
          this.state.estimatedUnits.value += count;
        },
        completeUnit: () => {
          this.state.completedUnits.value += 1;
        }
      });
      this.state.phase.value = "final";
      this.state.estimatedUnits.value = Math.max(
        this.state.estimatedUnits.value,
        this.state.completedUnits.value + 1
      );
      this.process.beginUnit(
        "final",
        localizedMessage("extras.longBookAnalysis.generateFinalResult")
      );
      const finalResult = await this.runUnit({
        ...this.base(createId("analysis_final")),
        phase: "final",
        notes: job.notes
      });
      if (typeof finalResult === "string") {
        throw new Error(t("finalResultMissing"));
      }
      this.state.result.value = finalResult;
      this.state.completedUnits.value += 1;
      this.state.status.value = "completed";
      this.process.complete();
    } catch (cause: unknown) {
      if (this.stopRequested) {
        this.state.status.value = "stopped";
        this.process.stopped();
      } else {
        this.failure = cause;
        this.state.status.value = "error";
        const message = () =>
          analysisErrorMessage(cause, t("novelAnalysisFailed"));
        this.state.error.value = message;
        this.process.fail(message);
      }
    } finally {
      this.pending = null;
    }
  }
}
