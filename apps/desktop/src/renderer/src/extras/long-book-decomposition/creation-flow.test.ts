import { expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  type DeepWriteApi,
  type LongBookDecompositionJob,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import { useLongBookDecomposition } from "./useLongBookDecomposition";
import DecompositionProgress from "./DecompositionProgress.vue";
import { createScopedTranslator } from "../../i18n";

it("创建超时后工作台保留原任务入口，点击继续恢复原任务而不重新创建", async () => {
  const now = new Date().toISOString();
  const model: ModelConfig = {
    id: "model_test",
    label: "合成模型",
    provider: "test",
    modelId: "test",
    api: "openai-completions",
    baseUrl: "https://example.test",
    reasoning: false,
    hasApiKey: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: [],
    temperatureOptions: [0.1, 0.7, 1],
    contextWindow: 128_000,
    maxTokens: 8192
  };
  let stored: LongBookDecompositionJob = {
    schemaVersion: 1,
    id: "ldjob_creation_timeout",
    createdAt: now,
    updatedAt: now,
    mode: "continuation",
    outputVersion: 1,
    autoContinue: false,
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    source: {
      sourceId: "long_book_analysis_source_test",
      sourceRevision: 1,
      title: "合成样书",
      fingerprint: "a".repeat(64),
      confirmationId: "confirmation_test",
      confirmedAt: now,
      chapterCount: 1,
      characterCount: 5,
      range: { start: 1, end: 1 }
    },
    targetSelection: { kind: "long", action: "create", title: "合成目标" },
    models: {
      reading: {
        modelId: model.id,
        thinkingLevel: "off",
        contextWindow: 128_000,
        maxTokens: 8192
      },
      integration: {
        modelId: model.id,
        thinkingLevel: "off",
        contextWindow: 128_000,
        maxTokens: 8192
      }
    },
    chunks: [
      {
        id: "chunk:1",
        chapterIds: ["chapter_test"],
        startOrder: 1,
        endOrder: 1,
        estimatedTokens: 5
      }
    ],
    chronicleSegments: [],
    phase: "prepare_target",
    status: "idle",
    units: {}
  };
  const failure = {
    code: "decomposition.command_timeout",
    message: "合成创建等待超时",
    details: { jobId: stored.id }
  };
  const createJob = vi.fn().mockRejectedValue(failure);
  const listJobs = vi.fn(async () => [structuredClone(stored)]);
  const control = vi.fn<DeepWriteApi["longBookDecomposition"]["control"]>(
    async (input) => {
      expect(input).toEqual({ jobId: stored.id, action: "resume" });
      stored = {
        ...stored,
        phase: "registry_review",
        status: "idle",
        target: {
          kind: "long",
          bookId: "longbook_recovered",
          baseRevision: 0,
          state: "ready"
        }
      };
      return structuredClone(stored);
    }
  );
  const controller = useLongBookDecomposition({
    api: () =>
      ({
        longBookDecomposition: {
          createJob,
          listJobs,
          control,
          getJob: vi.fn(async () => structuredClone(stored))
        }
      }) as unknown as DeepWriteApi
  });
  controller.setConfiguredModels([model]);
  controller.source.value = {
    id: stored.source.sourceId,
    kind: "txt",
    name: "合成样书",
    revision: 1,
    fingerprint: stored.source.fingerprint,
    diagnostics: [],
    chapters: [
      {
        id: "chapter_test",
        order: 1,
        title: "第一章",
        text: "合成正文。",
        charCount: 5,
        sourceName: "合成样书.txt"
      }
    ]
  };
  controller.confirmation.value = {
    id: stored.source.confirmationId,
    sourceId: stored.source.sourceId,
    sourceRevision: 1,
    fingerprint: stored.source.fingerprint,
    confirmedAt: now,
    range: stored.source.range
  };
  try {
    await expect(
      controller.create({
        mode: stored.mode,
        targetSelection: stored.targetSelection,
        autoContinue: false,
        maxConcurrency: 5
      })
    ).rejects.toEqual(failure);
    expect(controller.job.value).toMatchObject({
      id: stored.id,
      phase: "prepare_target"
    });
    expect(controller.jobs.value).toHaveLength(1);
    const html = await renderToString(
      createSSRApp(DecompositionProgress, {
        controller,
        disabled: false
      })
    );
    const resume = createScopedTranslator("extras.longBookDecomposition")(
      "resume"
    );
    expect(html).toMatch(
      new RegExp(`<button[^>]*>\\s*${resume}\\s*</button>`, "u")
    );
    await controller.run();
    expect(controller.job.value).toMatchObject({
      id: stored.id,
      phase: "registry_review"
    });
    expect(controller.error.value).toBeNull();
    expect(control).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledTimes(1);
  } finally {
    controller.dispose();
  }
});
