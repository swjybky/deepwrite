import type { ShallowRef } from "vue";
import type {
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisSource,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import type { AnalysisTaskRuntime } from "./analysis-task";

/**
 * Concurrent analysis tasks. Deliberately below the agent process's own ceiling
 * (5) so chat always keeps slots — analysis must never starve the rest of the app.
 */
export const LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS = 3;
/** Backoff before re-checking a queue parked on capacity. */
const CAPACITY_RETRY_DELAY_MS = 15_000;
/** "Other" failures get one automatic retry before the round is skipped. */
const MAX_TASK_ATTEMPTS = 1;

export interface AnalysisPlanSummary {
  total: number;
  completed: number;
  skipped: Array<{ label: string; error: string }>;
  stopped: number;
  queued: number;
  /** Rounds that finished but whose result never reached its library. */
  unsaved: Array<{ label: string; error: string }>;
  /** Set when the plan stopped early; the user must act before continuing. */
  haltedReason: string | null;
}

export interface AnalysisPlanRunnerHooks {
  getApi: () => DeepWriteApi;
  models: ShallowRef<readonly ModelConfig[]>;
  source: () => LongBookAnalysisSource | null;
  presets: () => readonly LongBookAnalysisPreset[];
  /** Persist the round's result into its target library. */
  persistTask(task: AnalysisTaskRuntime): Promise<void>;
  /** Called whenever a task's status changes, for persistence and UI. */
  onTaskSettled?(task: AnalysisTaskRuntime): void;
  /** Surfaces an unrecoverable stop to the user. */
  onHalted?(reason: string): void;
}

function taskLabel(task: AnalysisTaskRuntime): string {
  return `${task.presetName} · 第 ${task.startOrder}-${task.endOrder} 章`;
}

/**
 * Runs a batch plan: every task is one preset analysing one ≤50-chapter window.
 *
 * Scheduling policy comes from the product requirements:
 * - at most 3 tasks at a time, so two agent slots stay free for chat
 * - a capacity rejection means "wait for a slot", never a failure
 * - an exhausted account stops the whole plan immediately
 * - any other failure retries once, then skips that round and moves on
 */
export class LongBookAnalysisPlanRunner {
  private queue: string[] = [];
  /**
   * Tasks parked on capacity. Kept apart from `queue` on purpose: the finish
   * handler pumps immediately, so a re-queued task would be retried at once and
   * spin against a still-full agent process. Only the backoff timer revives these.
   */
  private waiting: string[] = [];
  private running = 0;
  private capacityTimer: ReturnType<typeof setTimeout> | null = null;
  private halted = false;
  private paused = true;

  constructor(
    private readonly tasks: ShallowRef<AnalysisTaskRuntime[]>,
    private readonly hooks: AnalysisPlanRunnerHooks
  ) {}

  get planSummary(): AnalysisPlanSummary {
    const all = this.tasks.value;
    return {
      total: all.length,
      completed: all.filter((task) => task.queueStatus.value === "completed")
        .length,
      skipped: all
        .filter((task) => task.queueStatus.value === "skipped")
        .map((task) => ({
          label: taskLabel(task),
          error: task.queueError.value ?? "未知错误"
        })),
      stopped: all.filter((task) => task.queueStatus.value === "stopped").length,
      queued: this.queue.length + this.waiting.length,
      unsaved: all
        .filter((task) => task.writeError.value !== null)
        .map((task) => ({
          label: taskLabel(task),
          error: task.writeError.value ?? "写入素材库失败。"
        })),
      haltedReason: this.halted ? (this.haltReason ?? "计划已停止") : null
    };
  }

  private haltReason: string | null = null;

  /** Enqueue every task that still needs work and start pumping. */
  startBatch(): void {
    this.halted = false;
    this.haltReason = null;
    this.paused = false;
    this.queue = this.tasks.value
      .filter((task) => this.needsWork(task))
      .map((task) => task.id);
    this.pump();
  }

  pause(): void {
    this.paused = true;
    this.clearCapacityTimer();
    for (const task of this.tasks.value) {
      if (task.queueStatus.value === "running") {
        void task.pipeline.stop();
      } else if (
        task.queueStatus.value === "queued" ||
        task.queueStatus.value === "waiting_capacity"
      ) {
        task.queueStatus.value = "stopped";
      }
    }
    this.queue = [];
    this.waiting = [];
  }

  resume(): void {
    if (this.halted) return;
    this.startBatch();
  }

  /**
   * Manually re-queue one round from the plan panel. The round's checkpoint is
   * dropped so it starts clean instead of resuming at the batch it reached last
   * time, and `forceRestart` tells `executeTask` to rebuild the job.
   */
  rerunTask(taskId: string): boolean {
    const task = this.tasks.value.find((item) => item.id === taskId);
    if (!task || task.queueStatus.value === "running") return false;
    this.halted = false;
    this.haltReason = null;
    task.attempts.value = 0;
    task.queueError.value = null;
    task.checkpoint = null;
    task.forceRestart = true;
    task.queueStatus.value = "queued";
    if (!this.queue.includes(taskId)) this.queue.push(taskId);
    this.pump();
    return true;
  }

  /**
   * Write a finished round's result by hand after its automatic write failed.
   * The round is already done, so this never touches the queue.
   */
  async retryWrite(taskId: string): Promise<boolean> {
    const task = this.tasks.value.find((item) => item.id === taskId);
    if (!task || task.writeError.value === null) return false;
    try {
      await this.hooks.persistTask(task);
      task.writeError.value = null;
    } catch (error: unknown) {
      task.writeError.value =
        error instanceof Error ? error.message : "写入素材库失败。";
    }
    return true;
  }

  dispose(): void {
    this.paused = true;
    this.clearCapacityTimer();
    this.queue = [];
  }

  private needsWork(task: AnalysisTaskRuntime): boolean {
    return (
      task.queueStatus.value === "queued" ||
      task.queueStatus.value === "waiting_capacity" ||
      task.queueStatus.value === "stopped"
    );
  }

  private takeNext(): AnalysisTaskRuntime | null {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      const task = this.tasks.value.find((item) => item.id === id);
      if (task && this.needsWork(task)) return task;
    }
    return null;
  }

  private pump(): void {
    if (this.paused || this.halted) return;
    while (this.running < LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS) {
      const task = this.takeNext();
      if (!task) break;
      void this.runTask(task);
    }
  }

  private async runTask(task: AnalysisTaskRuntime): Promise<void> {
    this.running += 1;
    try {
      await this.executeTask(task);
    } catch (error: unknown) {
      // Backstop. `pump` calls this with `void`, so a rejection here would be an
      // unhandled rejection *and* would leave the round pinned on "running".
      this.failTask(
        task,
        error instanceof Error ? error.message : "分析任务异常终止。"
      );
    } finally {
      this.running -= 1;
      this.hooks.onTaskSettled?.(task);
      this.pump();
    }
  }

  private failTask(task: AnalysisTaskRuntime, message: string): void {
    task.queueStatus.value = "skipped";
    task.queueError.value = message;
  }

  private async executeTask(task: AnalysisTaskRuntime): Promise<void> {
    const source = this.hooks.source();
    const preset = this.hooks.presets().find(
      (item) => item.id === task.presetId
    );
    if (!source || !preset) {
      this.failTask(task, "来源或预设已不可用。");
      return;
    }

    task.presetSnapshot = preset;
    task.queueStatus.value = "running";
    try {
      if (!task.forceRestart && task.pipeline.hasJob) {
        // Continue from the batch-level checkpoint rather than redoing the round.
        task.pipeline.retry();
      } else {
        task.forceRestart = false;
        task.pipeline.start(
          source,
          preset,
          {
            presetId: preset.id,
            startOrder: task.startOrder,
            endOrder: task.endOrder,
            modelId: task.modelId,
            thinkingLevel: task.thinkingLevel,
            libraryId: task.libraryId
          },
          {
            ...(task.checkpoint ? { resume: task.checkpoint } : {}),
            onCheckpoint: (checkpoint) => {
              task.checkpoint = checkpoint;
              this.hooks.onTaskSettled?.(task);
            }
          }
        );
      }
      await task.pipeline.whenIdle();
    } catch (error: unknown) {
      // `start` throws synchronously on configuration problems — a model that no
      // longer exists, a source whose chapters changed under a restored plan, a
      // range it refuses. Nothing was launched, so skip the round with the real
      // reason instead of waiting on a run that will never exist.
      this.failTask(
        task,
        error instanceof Error ? error.message : "无法启动该轮分析。"
      );
      return;
    }

    const status = task.state.status.value;
    const failure = task.pipeline.lastFailure;
    if (status === "completed") {
      task.checkpoint = null;
      try {
        await this.hooks.persistTask(task);
        task.writeError.value = null;
      } catch (error: unknown) {
        // Keep the result so the plan panel can offer a manual write later.
        task.writeError.value =
          error instanceof Error ? error.message : "写入素材库失败。";
      }
      task.queueStatus.value = "completed";
      return;
    }
    if (status === "stopped") {
      task.queueStatus.value = "stopped";
      return;
    }
    if (failure?.kind === "capacity") {
      // Not a failure: park until a slot frees up, ahead of later rounds.
      task.queueStatus.value = "waiting_capacity";
      task.queueError.value = null;
      this.waiting.push(task.id);
      this.scheduleCapacityRetry();
      return;
    }
    if (failure?.kind === "insufficient_quota") {
      this.failTask(task, failure.message);
      this.halt(failure.message);
      return;
    }
    if (task.attempts.value < MAX_TASK_ATTEMPTS) {
      task.attempts.value += 1;
      task.queueStatus.value = "queued";
      this.queue.unshift(task.id);
      this.pump();
      return;
    }
    this.failTask(task, failure?.message ?? "分析失败。");
  }

  /** One shared timer: a queue full of parked tasks has nothing else to wake it. */
  private scheduleCapacityRetry(): void {
    if (this.capacityTimer !== null) return;
    this.capacityTimer = setTimeout(() => {
      this.capacityTimer = null;
      if (this.paused || this.halted) return;
      // Parked tasks go back in front of anything still queued.
      this.queue = [...this.waiting, ...this.queue];
      this.waiting = [];
      this.pump();
    }, CAPACITY_RETRY_DELAY_MS);
  }

  private clearCapacityTimer(): void {
    if (this.capacityTimer === null) return;
    clearTimeout(this.capacityTimer);
    this.capacityTimer = null;
  }

  private halt(reason: string): void {
    this.halted = true;
    this.haltReason = reason;
    this.queue = [];
    this.clearCapacityTimer();
    for (const task of this.tasks.value) {
      if (task.queueStatus.value === "running") void task.pipeline.stop();
    }
    this.hooks.onHalted?.(reason);
  }
}
