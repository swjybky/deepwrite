import { ref, type Ref, type ShallowRef } from "vue";
import type {
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisResult,
  LongBookAnalysisRoundCheckpoint,
  ModelConfig,
  ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import {
  LongBookAnalysisPipeline,
  type LongBookAnalysisStartOptions
} from "./analysis-pipeline";
import type { LongBookAnalysisPhase } from "./analysis-pipeline-types";
import type { LongBookAnalysisRunStatus } from "./useLongBookAnalysis";
import {
  formatAnalysisProgress,
  type LongBookAnalysisProcessEntry
} from "./analysis-process";

/**
 * The nine per-run reactive fields. Each analysis task owns one of these, which
 * is what lets several presets analyse concurrently without clobbering each
 * other's progress, results or logs.
 */
export interface LongBookAnalysisTaskState {
  status: Ref<LongBookAnalysisRunStatus>;
  phase: Ref<LongBookAnalysisPhase | null>;
  completedUnits: Ref<number>;
  estimatedUnits: Ref<number>;
  error: Ref<string | null>;
  result: Ref<LongBookAnalysisResult | null>;
  processEntries: Ref<LongBookAnalysisProcessEntry[]>;
  currentActivity: Ref<string>;
  liveOutput: Ref<string>;
}

export function createAnalysisTaskState(): LongBookAnalysisTaskState {
  return {
    status: ref<LongBookAnalysisRunStatus>("idle"),
    phase: ref<LongBookAnalysisPhase | null>(null),
    completedUnits: ref(0),
    estimatedUnits: ref(0),
    error: ref<string | null>(null),
    result: ref<LongBookAnalysisResult | null>(null),
    processEntries: ref<LongBookAnalysisProcessEntry[]>([]),
    currentActivity: ref(""),
    liveOutput: ref("")
  };
}

/** Where a task sits in the plan queue. */
export type AnalysisTaskQueueStatus =
  | "queued"
  | "running"
  | "waiting_capacity"
  | "completed"
  | "skipped"
  | "stopped";

/**
 * One round of one preset. A batch plan is the cartesian product of the chosen
 * presets and the ≤50-chapter windows, so every task is a self-contained run
 * that the existing pipeline already knows how to execute.
 */
export interface AnalysisTaskRuntime {
  id: string;
  presetId: string;
  presetName: string;
  roundIndex: number;
  startOrder: number;
  endOrder: number;
  /** Frozen at plan creation so later preset edits cannot retarget it. */
  libraryId: string;
  /** Model and thinking level chosen when the plan was created. */
  modelId: string;
  thinkingLevel: ThinkingLevel;
  state: LongBookAnalysisTaskState;
  pipeline: LongBookAnalysisPipeline;
  presetSnapshot: LongBookAnalysisPreset | null;
  queueStatus: Ref<AnalysisTaskQueueStatus>;
  attempts: Ref<number>;
  queueError: Ref<string | null>;
  /** Set when the round finished but its result could not reach the library. */
  writeError: Ref<string | null>;
  checkpoint: LongBookAnalysisRoundCheckpoint | null;
  /**
   * Set by the plan panel's "重跑此轮" so the next execution builds a fresh job.
   * Without it a finished round would be `retry()`-ed into its own finished
   * checkpoint and report the stale result as if it had just run.
   */
  forceRestart: boolean;
}

export interface CreateAnalysisTaskInput {
  presetId: string;
  presetName: string;
  roundIndex: number;
  startOrder: number;
  endOrder: number;
  libraryId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  getApi: () => DeepWriteApi;
  models: ShallowRef<readonly ModelConfig[]>;
}

export function createAnalysisTask(
  input: CreateAnalysisTaskInput
): AnalysisTaskRuntime {
  const state = createAnalysisTaskState();
  return {
    id: createId("analysis_task"),
    presetId: input.presetId,
    presetName: input.presetName,
    roundIndex: input.roundIndex,
    startOrder: input.startOrder,
    endOrder: input.endOrder,
    libraryId: input.libraryId,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    state,
    pipeline: new LongBookAnalysisPipeline(input.getApi, input.models, state),
    presetSnapshot: null,
    queueStatus: ref<AnalysisTaskQueueStatus>("queued"),
    attempts: ref(0),
    queueError: ref<string | null>(null),
    writeError: ref<string | null>(null),
    checkpoint: null,
    forceRestart: false
  };
}

/** Re-exported so callers can build start options without reaching deeper. */
export type { LongBookAnalysisStartOptions };

export function taskProgressText(task: AnalysisTaskRuntime): string {
  return formatAnalysisProgress(
    task.state.phase.value,
    task.state.completedUnits.value,
    task.state.estimatedUnits.value
  );
}
