import { ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisSource,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import {
  createAnalysisTaskState,
  type AnalysisTaskRuntime
} from "./analysis-task";
import type { AnalysisFailure } from "./analysis-failures";
import {
  LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS,
  LongBookAnalysisPlanRunner
} from "./analysis-plan-runner";

type Outcome = "completed" | "capacity" | "insufficient_quota" | "other";

interface Stub {
  task: AnalysisTaskRuntime;
  settle(outcome: Outcome): Promise<void>;
  attempts(): number;
  freshStarts(): number;
}

const source = {
  id: "source-1",
  name: "测试书",
  kind: "txt",
  chapters: []
} as unknown as LongBookAnalysisSource;

const preset: LongBookAnalysisPreset = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: { domain: "material", kind: "plot", stageId: "pacing" }
};

afterEach(() => {
  vi.useRealTimers();
});

/** A task whose pipeline outcome the test controls explicitly. */
function stubTask(id: string, options: { throwOnStart?: boolean } = {}): Stub {
  const state = createAnalysisTaskState();
  let settleIdle: (() => void) | null = null;
  let started = 0;
  let freshStarts = 0;
  let failure: AnalysisFailure | null = null;

  const pipeline = {
    get hasJob() {
      return started > 0;
    },
    get lastFailure() {
      return failure;
    },
    get preset() {
      return preset;
    },
    start() {
      if (options.throwOnStart) throw new Error("请选择可用模型。");
      started += 1;
      freshStarts += 1;
      state.status.value = "running";
    },
    retry() {
      started += 1;
      state.status.value = "running";
      return true;
    },
    async stop() {
      state.status.value = "stopped";
      settleIdle?.();
      return true;
    },
    whenIdle() {
      return new Promise<void>((resolve) => {
        settleIdle = resolve;
      });
    },
    dispose() {}
  };

  const task = {
    id,
    presetId: preset.id,
    presetName: preset.name,
    roundIndex: 0,
    startOrder: 1,
    endOrder: 50,
    libraryId: "material-1",
    modelId: "model-1",
    thinkingLevel: "off",
    state,
    pipeline,
    presetSnapshot: preset,
    queueStatus: ref("queued"),
    attempts: ref(0),
    queueError: ref<string | null>(null),
    writeError: ref<string | null>(null),
    checkpoint: null,
    forceRestart: false
  } as unknown as AnalysisTaskRuntime;

  return {
    task,
    attempts: () => started,
    freshStarts: () => freshStarts,
    async settle(outcome: Outcome) {
      failure =
        outcome === "completed"
          ? null
          : {
              kind: outcome,
              message:
                outcome === "insufficient_quota"
                  ? "insufficient_quota: 余额不足"
                  : "错误"
            };
      state.status.value = outcome === "completed" ? "completed" : "error";
      settleIdle?.();
      // Let the runner's awaited continuation run.
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

function createHarness(
  count: number,
  options: { failPersist?: boolean; throwOnStart?: boolean } = {}
) {
  const stubs = Array.from({ length: count }, (_, index) =>
    stubTask(`task_${index}`, { throwOnStart: options.throwOnStart ?? false })
  );
  const tasks = shallowRef(stubs.map((stub) => stub.task));
  const persisted: string[] = [];
  const halted: string[] = [];
  let runningPeak = 0;
  let failPersist = options.failPersist ?? false;
  const runner = new LongBookAnalysisPlanRunner(tasks, {
    getApi: () => ({}) as DeepWriteApi,
    models: shallowRef([] as readonly ModelConfig[]),
    source: () => source,
    presets: () => [preset],
    persistTask: async (task) => {
      if (failPersist) throw new Error("素材库不可写");
      persisted.push(task.id);
    },
    onTaskSettled: () => {
      runningPeak = Math.max(runningPeak, countRunning(stubs));
    },
    onHalted: (reason) => {
      halted.push(reason);
    }
  });
  return {
    stubs,
    tasks,
    runner,
    persisted,
    halted,
    peak: () => runningPeak,
    allowPersist: () => {
      failPersist = false;
    }
  };
}

function countRunning(stubs: Stub[]): number {
  return stubs.filter((stub) => stub.task.queueStatus.value === "running")
    .length;
}

/** Settle whichever tasks are currently running. */
async function settleRunning(stubs: Stub[], outcome: Outcome): Promise<void> {
  const running = stubs.filter(
    (stub) => stub.task.queueStatus.value === "running"
  );
  await Promise.all(running.map((stub) => stub.settle(outcome)));
}

describe("long-book analysis plan runner", () => {
  it("never exceeds the analysis concurrency ceiling", async () => {
    const harness = createHarness(8);
    harness.runner.startBatch();
    expect(countRunning(harness.stubs)).toBe(
      LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS
    );

    // Drain in waves; the peak is sampled on every settle.
    for (let wave = 0; wave < 4; wave += 1) {
      await settleRunning(harness.stubs, "completed");
    }

    expect(harness.peak()).toBeLessThanOrEqual(
      LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS
    );
    expect(harness.persisted).toHaveLength(8);
    expect(harness.runner.planSummary.completed).toBe(8);
  });

  it("parks a capacity rejection and retries it without skipping", async () => {
    vi.useFakeTimers();
    const harness = createHarness(2);
    harness.runner.startBatch();

    await settleRunning(harness.stubs, "capacity");
    expect(
      harness.stubs.every(
        (stub) => stub.task.queueStatus.value === "waiting_capacity"
      )
    ).toBe(true);

    // Nothing runs again until the backoff elapses — no spin against a full process.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(countRunning(harness.stubs)).toBe(0);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(countRunning(harness.stubs)).toBe(2);

    await settleRunning(harness.stubs, "completed");
    expect(harness.runner.planSummary.completed).toBe(2);
    expect(harness.runner.planSummary.skipped).toEqual([]);
  });

  it("halts the whole plan when the account is out of credit", async () => {
    const harness = createHarness(6);
    harness.runner.startBatch();

    await settleRunning(harness.stubs, "insufficient_quota");

    expect(harness.halted).toHaveLength(1);
    expect(harness.runner.planSummary.haltedReason).toContain(
      "insufficient_quota"
    );
    // The queued rounds must not have been started.
    const started = harness.stubs.filter((stub) => stub.attempts() > 0).length;
    expect(started).toBeLessThanOrEqual(
      LONG_BOOK_ANALYSIS_MAX_CONCURRENT_TASKS
    );
  });

  it("retries a generic failure once, then skips that round and moves on", async () => {
    const harness = createHarness(2);
    harness.runner.startBatch();
    const [first, second] = harness.stubs;

    // First failure: back into the queue for one retry.
    await Promise.all([first!.settle("other"), second!.settle("completed")]);
    expect(first!.task.attempts.value).toBe(1);
    expect(first!.attempts()).toBe(2);
    expect(first!.task.queueStatus.value).toBe("running");

    // Second failure: skip this round, keep the plan going.
    await first!.settle("other");
    expect(first!.task.queueStatus.value).toBe("skipped");
    expect(first!.task.queueError.value).toBe("错误");
    expect(harness.runner.planSummary.skipped).toHaveLength(1);
    expect(harness.runner.planSummary.completed).toBe(1);
    expect(harness.halted).toEqual([]);
  });

  it("re-runs one round from clean when the panel asks for it", async () => {
    const harness = createHarness(2);
    harness.runner.startBatch();
    await settleRunning(harness.stubs, "completed");
    await settleRunning(harness.stubs, "completed");
    expect(harness.runner.planSummary.completed).toBe(2);

    const target = harness.stubs[0]!;
    const before = target.freshStarts();
    harness.runner.rerunTask(target.task.id);
    await settleRunning(harness.stubs, "completed");

    // A fresh job rather than a retry of the round that already finished —
    // otherwise the stale result would be reported as a new one.
    expect(target.freshStarts()).toBe(before + 1);
    expect(target.task.forceRestart).toBe(false);
    // Both rounds are complete again: re-running one round costs only that round.
    expect(harness.runner.planSummary.completed).toBe(2);
    expect(harness.stubs[1]!.task.queueStatus.value).toBe("completed");
    expect(target.task.queueStatus.value).toBe("completed");
  });

  it("records a round whose library write failed and can write it later", async () => {
    const harness = createHarness(1, { failPersist: true });
    harness.runner.startBatch();
    await settleRunning(harness.stubs, "completed");

    const task = harness.stubs[0]!.task;
    expect(task.queueStatus.value).toBe("completed");
    expect(task.writeError.value).toBe("素材库不可写");
    expect(harness.runner.planSummary.unsaved).toEqual([
      { label: "剧情结构 · 第 1-50 章", error: "素材库不可写" }
    ]);

    harness.allowPersist();
    await harness.runner.retryWrite(task.id);
    expect(task.writeError.value).toBeNull();
    expect(harness.persisted).toEqual([task.id]);
    expect(harness.runner.planSummary.unsaved).toEqual([]);
  });

  it("skips a round that cannot be launched instead of wedging the plan", async () => {
    // `pipeline.start` throws synchronously on configuration problems — a model
    // that vanished, a source whose chapters moved. The round must fail with
    // that reason rather than sit on "running" forever.
    const harness = createHarness(4, { throwOnStart: true });
    harness.runner.startBatch();
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();

    expect(countRunning(harness.stubs)).toBe(0);
    expect(
      harness.stubs.every((stub) => stub.task.queueStatus.value === "skipped")
    ).toBe(true);
    expect(harness.stubs[0]!.task.queueError.value).toBe("请选择可用模型。");
    expect(harness.runner.planSummary.skipped).toHaveLength(4);
    expect(harness.runner.planSummary.completed).toBe(0);
  });
});
