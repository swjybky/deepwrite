import { expect, vi } from "vitest";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  type DeepWriteApi,
  type LongBookDecompositionJob,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import {
  createExtrasAgentsFake,
  runEvent
} from "../agent-runtime/extrasAgent.test-support";
import { createDecompositionEngine } from "./engine";

export const model: ModelConfig = {
  id: "test",
  label: "合成模型",
  provider: "test",
  modelId: "test",
  api: "openai-completions",
  baseUrl: "https://example.test",
  reasoning: false,
  hasApiKey: true,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low"],
  temperatureOptions: [0.1, 0.7, 1],
  contextWindow: 128_000,
  maxTokens: 8192
};
export function decompositionEngineFixture(
  selectedModels: ModelConfig | readonly ModelConfig[] = model
) {
  const availableModels = Array.isArray(selectedModels)
    ? selectedModels
    : [selectedModels];
  const primary = availableModels[0] ?? model;
  const now = new Date().toISOString();
  let stored: LongBookDecompositionJob = {
    schemaVersion: 1,
    id: "ldjob_ui",
    createdAt: now,
    updatedAt: now,
    mode: "materials",
    outputVersion: 1,
    autoContinue: false,
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    source: {
      sourceId: "source_ui",
      sourceRevision: 1,
      title: "合成样书",
      fingerprint: "a".repeat(64),
      confirmationId: "confirm_ui",
      confirmedAt: now,
      chapterCount: 1,
      characterCount: 5,
      range: { start: 1, end: 1 }
    },
    targetSelection: {
      kind: "material-group",
      action: "create",
      title: "合成资料"
    },
    target: {
      kind: "material-group",
      groupId: "group_ui",
      libraryIds: {
        character: "c",
        plot: "p",
        draft: "d",
        other: "o",
        gimmick: "g"
      },
      baseRevisions: {},
      state: "ready"
    },
    models: {
      reading: {
        modelId: primary.id,
        thinkingLevel: "off",
        contextWindow: primary.contextWindow ?? 128_000,
        maxTokens: primary.maxTokens ?? 8192
      },
      integration: {
        modelId: primary.id,
        thinkingLevel: "off",
        contextWindow: primary.contextWindow ?? 128_000,
        maxTokens: primary.maxTokens ?? 8192
      }
    },
    chunks: [
      {
        id: "chunk:1",
        chapterIds: ["chapter_ui"],
        startOrder: 1,
        endOrder: 1,
        estimatedTokens: 5
      }
    ],
    chronicleSegments: [],
    phase: "read",
    status: "idle",
    units: {
      "chunk:1": {
        phase: "read",
        status: "pending",
        attempts: 0,
        inputRevision: "a".repeat(64),
        dependencies: [],
        outputRefs: [],
        receiptIds: [],
        updatedAt: now
      }
    }
  };
  const extras = createExtrasAgentsFake();
  const control = vi.fn<DeepWriteApi["longBookDecomposition"]["control"]>(
    async (input) => {
      if (input.action === "resume") {
        stored.status = "idle";
        delete stored.lastError;
      }
      if (input.action === "stop") {
        stored.status = "stopped";
        if (input.error) stored.lastError = input.error;
        delete stored.activeAttemptId;
        for (const unit of Object.values(stored.units))
          if (["running", "writing"].includes(unit.status)) {
            unit.status = "pending";
            delete unit.attemptId;
            delete unit.runId;
          }
      }
      if (input.action === "finish-package") {
        expect(input.attemptId).toBe("attempt_ui");
        stored.units["chunk:1"]!.status = "done";
        stored.status = "idle";
      }
      if (input.action === "advance") stored.phase = "registry_review";
      return structuredClone(stored);
    }
  );
  const getJob = vi.fn(async () => structuredClone(stored));
  const updateModels = vi.fn<
    DeepWriteApi["longBookDecomposition"]["updateModels"]
  >(async (input) => {
    const resolve = (item: {
      modelId: string;
      thinkingLevel: LongBookDecompositionJob["models"]["reading"]["thinkingLevel"];
    }) => {
      const found = availableModels.find((entry) => entry.id === item.modelId);
      if (!found) throw new Error(`拆解模型不可用：${item.modelId}`);
      return {
        modelId: item.modelId,
        thinkingLevel: item.thinkingLevel,
        contextWindow: found.contextWindow ?? 128_000,
        ...(found.maxTokens !== undefined ? { maxTokens: found.maxTokens } : {})
      };
    };
    stored = {
      ...stored,
      models: {
        reading: resolve(input.models.reading),
        integration: resolve(input.models.integration),
        ...(input.models.readingFallbacks?.length
          ? {
              readingFallbacks: input.models.readingFallbacks.map(resolve)
            }
          : {}),
        ...(input.models.integrationFallbacks?.length
          ? {
              integrationFallbacks:
                input.models.integrationFallbacks.map(resolve)
            }
          : {})
      }
    };
    delete stored.lastError;
    return structuredClone(stored);
  });
  const api = {
    extrasAgents: extras.extrasAgents,
    session: { abort: vi.fn(async () => undefined) },
    longBookDecomposition: { control, getJob, updateModels }
  } as unknown as DeepWriteApi;
  const engine = createDecompositionEngine(
    () => api,
    () => availableModels
  );
  engine.job.value = structuredClone(stored);
  function accept() {
    extras.run.mockImplementation(async (request) => {
      stored.status = "running";
      stored.activeAttemptId = "attempt_ui";
      stored.units["chunk:1"]!.attemptId = "attempt_ui";
      setTimeout(
        () =>
          engine.handleEvent(
            runEvent("agent.message_completed", request, {
              content: "已保存",
              stopReason: "stop"
            })
          ),
        0
      );
      return {
        sessionId: request.sessionId,
        runId: `${request.sessionId}-run`,
        acceptedAt: now,
        runtime: { provider: "test", model: "test", mode: "local-faux" }
      };
    });
  }
  return {
    engine,
    extras,
    control,
    getJob,
    updateModels,
    accept,
    api,
    stored: () => stored,
    replace: (job: LongBookDecompositionJob) => {
      stored = job;
    }
  };
}
