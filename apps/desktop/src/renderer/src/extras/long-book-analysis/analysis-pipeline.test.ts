import { ref, shallowRef } from "vue";
import type {
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisSource,
  ModelConfig,
  SessionPromptCommandPayload,
  SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { describe, expect, it, vi } from "vitest";
import { LongBookAnalysisPipeline } from "./analysis-pipeline";
import type { LongBookAnalysisPipelineState } from "./analysis-pipeline-types";

function fixture() {
  const prompts: SessionPromptCommandPayload[] = [];
  const abort = vi.fn(async () => ({
    sessionId: "session",
    runId: "run",
    abortedAt: new Date().toISOString()
  }));
  const api = {
    session: {
      prompt: vi.fn(async (payload: SessionPromptCommandPayload) => {
        prompts.push(payload);
        return {
          sessionId: payload.sessionId,
          runId: `${payload.sessionId}-run`,
          acceptedAt: new Date().toISOString(),
          runtime: {
            provider: "test",
            model: "test",
            mode: "provider" as const
          }
        };
      }),
      abort
    }
  } as unknown as DeepWriteApi;
  const model = {
    id: "model-1",
    contextWindow: 100_000,
    maxTokens: 16_000,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"]
  } as ModelConfig;
  const state: LongBookAnalysisPipelineState = {
    status: ref("idle"),
    phase: ref(null),
    completedUnits: ref(0),
    estimatedUnits: ref(0),
    error: ref(null),
    result: ref(null),
    processEntries: ref([]),
    currentActivity: ref(""),
    liveOutput: ref("")
  };
  return {
    prompts,
    abort,
    state,
    api,
    pipeline: new LongBookAnalysisPipeline(
      () => api,
      shallowRef([model]),
      state
    )
  };
}

const source: LongBookAnalysisSource = {
  id: "source-1",
  kind: "txt",
  name: "测试长篇.txt",
  diagnostics: [],
  chapters: [
    {
      id: "chapter-1",
      order: 1,
      title: "第一章",
      sourceName: "测试长篇.txt",
      text: "雨夜来信。".repeat(200),
      charCount: 1_000
    }
  ]
};

const preset: LongBookAnalysisPreset = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: { domain: "material", kind: "plot", stageId: "pacing" }
};

function event(
  type: string,
  prompt: SessionPromptCommandPayload,
  payload: Record<string, unknown>
): SystemEventEnvelope {
  return {
    type,
    payload: {
      sessionId: prompt.sessionId,
      runId: `${prompt.sessionId}-run`,
      ...payload
    }
  } as SystemEventEnvelope;
}

async function waitForPrompt(
  prompts: SessionPromptCommandPayload[],
  count: number
) {
  await vi.waitFor(() => expect(prompts).toHaveLength(count));
  return prompts[count - 1]!;
}

describe("long-book analysis pipeline checkpoints", () => {
  it("keeps a failed batch checkpoint and retries through the final result", async () => {
    const { pipeline, prompts, state } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1",
      thinkingLevel: "high",
      libraryId: "material-library-1"
    });
    const failed = await waitForPrompt(prompts, 1);
    expect(failed.thinkingLevel).toBe("high");
    pipeline.handleEvent(
      event("agent.error", failed, { message: "temporary", code: "test" })
    );
    await vi.waitFor(() => expect(state.status.value).toBe("error"));

    expect(pipeline.retry()).toBe(true);
    const batch = await waitForPrompt(prompts, 2);
    const batchContext = batch.workspaceContext!.longBookAnalysis!;
    pipeline.handleEvent(
      event("long_book_analysis.note_updated", batch, {
        unitId: batchContext.unitId,
        jobId: batchContext.jobId,
        toolCallId: "tool-note",
        note: { text: "保留章节证据的中间笔记。" }
      })
    );
    pipeline.handleEvent(
      event("agent.message_completed", batch, {
        role: "assistant",
        content: "批次分析完成。"
      })
    );

    const final = await waitForPrompt(prompts, 3);
    const finalContext = final.workspaceContext!.longBookAnalysis!;
    pipeline.handleEvent(
      event("long_book_analysis.result_updated", final, {
        unitId: finalContext.unitId,
        jobId: finalContext.jobId,
        toolCallId: "tool-result",
        result: { name: "剧情结构", description: "拆书结果", content: "# 可编辑结果" }
      })
    );
    expect(state.result.value?.content).toBe("# 可编辑结果");
    pipeline.handleEvent(
      event("agent.message_completed", final, {
        role: "assistant",
        content: "正式结果已生成。"
      })
    );

    await vi.waitFor(() => expect(state.status.value).toBe("completed"));
    expect(state.result.value?.content).toBe("# 可编辑结果");
    expect(state.processEntries.value.at(-1)?.title).toBe("当前预设执行完成");
  });

  it("aborts the active run and preserves it for resume", async () => {
    const { pipeline, prompts, state, abort } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1",
      libraryId: "material-library-1"
    });
    const active = await waitForPrompt(prompts, 1);
    await pipeline.stop();
    expect(abort).toHaveBeenCalled();
    pipeline.handleEvent(
      event("agent.error", active, { message: "aborted", code: "aborted" })
    );
    await vi.waitFor(() => expect(state.status.value).toBe("stopped"));
    expect(pipeline.hasJob).toBe(true);
  });

  it("runs only the selected preset without requiring a target library", async () => {
    const { pipeline, prompts, state } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1"
    });

    const active = await waitForPrompt(prompts, 1);
    expect(active.workspaceContext?.longBookAnalysis?.presetId).toBe(preset.id);
    expect(pipeline.targetLibraryId).toBe("");
    expect(state.processEntries.value[0]?.detail).toContain("仅运行当前预设");
  });

  it("parks on a capacity rejection instead of failing the round", async () => {
    const { pipeline, api, state } = fixture();
    // The preload command bridge rejects with "<code>: <message>".
    vi.mocked(api.session.prompt).mockRejectedValueOnce(
      new Error("agent.capacity_reached: 本地智能体并发运行数量已达到上限。")
    );
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1"
    });

    await vi.waitFor(() => expect(state.status.value).toBe("waiting"));
    expect(pipeline.lastFailure?.kind).toBe("capacity");
    // The round is intact, so the scheduler can retry it without redoing work.
    expect(pipeline.hasJob).toBe(true);
    expect(state.error.value).toBeNull();
  });

  it("classifies an exhausted account as a terminal failure", async () => {
    const { pipeline, prompts, state } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1"
    });
    const batch = await waitForPrompt(prompts, 1);
    pipeline.handleEvent(
      event("agent.error", batch, {
        message: "insufficient_quota: You exceeded your current quota",
        code: "pi_agent.provider_error",
        details: { failureKind: "insufficient_quota" }
      })
    );

    await vi.waitFor(() => expect(state.status.value).toBe("error"));
    expect(pipeline.lastFailure?.kind).toBe("insufficient_quota");
  });

  it("reports batch progress through onCheckpoint", async () => {
    const { pipeline, prompts } = fixture();
    const checkpoints: Array<{ batchIndex: number; notes: number }> = [];
    pipeline.start(
      source,
      preset,
      {
        presetId: preset.id,
        startOrder: 1,
        endOrder: 1,
        modelId: "model-1"
      },
      {
        onCheckpoint: (checkpoint) => {
          checkpoints.push({
            batchIndex: checkpoint.batchIndex,
            notes: checkpoint.notes.length
          });
        }
      }
    );
    const batch = await waitForPrompt(prompts, 1);
    const context = batch.workspaceContext!.longBookAnalysis!;
    pipeline.handleEvent(
      event("long_book_analysis.note_updated", batch, {
        unitId: context.unitId,
        jobId: context.jobId,
        toolCallId: "tool-note",
        note: {
          id: "note-1",
          label: "第 1-1 章批次笔记",
          chapterStart: 1,
          chapterEnd: 1,
          text: "保留章节证据的中间笔记。"
        }
      })
    );
    pipeline.handleEvent(
      event("agent.message_completed", batch, { content: "完成" })
    );

    await vi.waitFor(() => expect(checkpoints.length).toBeGreaterThan(0));
    expect(checkpoints[0]).toEqual({ batchIndex: 1, notes: 1 });
  });

  it("skips already-finished batches when resuming from a checkpoint", async () => {
    const { pipeline, prompts } = fixture();
    pipeline.start(
      source,
      preset,
      {
        presetId: preset.id,
        startOrder: 1,
        endOrder: 1,
        modelId: "model-1"
      },
      {
        // One batch exists; a checkpoint at index 1 means it already ran.
        resume: {
          batchIndex: 1,
          reductionRounds: 0,
          notes: [
            {
              id: "note-1",
              label: "第 1-1 章批次笔记",
              chapterStart: 1,
              chapterEnd: 1,
              text: "上一轮已完成的笔记。"
            }
          ]
        }
      }
    );

    const first = await waitForPrompt(prompts, 1);
    // Resuming must not re-run the batch phase.
    expect(first.workspaceContext?.longBookAnalysis?.phase).not.toBe("batch");
  });
});
