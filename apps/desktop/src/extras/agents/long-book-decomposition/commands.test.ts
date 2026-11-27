import { expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_DECOMPOSITION_PROFILE,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { handleDecompositionCommands } from "./commands";
import { decompositionCore } from "./core-bridge";
import type { ExtrasAgentCommandContext } from "../index";
import type { ExtrasAgentConfigStore } from "../config-store";

vi.mock("electron", () => ({ utilityProcess: { fork: vi.fn() } }));
import { UtilityCommandTimeoutError } from "../../../main/supervisor";

function fixture() {
  const confirmation = {
    id: "confirm_timeout_test",
    sourceId: "long_book_analysis_source_timeout_test",
    sourceRevision: 1,
    fingerprint: "a".repeat(64),
    range: { start: 1, end: 1 },
    confirmedAt: new Date().toISOString()
  };
  const accepted = async (
    command: CommandEnvelope
  ): Promise<CommandResult> => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "longBookAnalysis.coreSource"
        ? {
            confirmation,
            source: {
              id: confirmation.sourceId,
              kind: "txt",
              name: "合成超时样书",
              revision: 1,
              fingerprint: confirmation.fingerprint,
              diagnostics: [],
              chapters: [
                {
                  id: "source_chapter_1",
                  order: 1,
                  title: "第一章",
                  sourceName: "合成超时样书.txt",
                  text: "合成正文。",
                  charCount: 5
                }
              ]
            }
          }
        : command.type === "longBookDecomposition.coreCreate"
          ? command.payload.job
          : {}
  });
  const core = vi.fn(accepted);
  const coreLong = vi.fn(accepted);
  const context = {
    core,
    coreLong,
    activeRuns: new Map(),
    getWorkspaceDirectory: async () => "/synthetic-workspace",
    resolveModel: async () => undefined,
    evaluationMode: true
  } as unknown as ExtrasAgentCommandContext;
  const config = {
    resolve: async () => DEFAULT_DECOMPOSITION_PROFILE
  } as unknown as ExtrasAgentConfigStore;
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.createJob",
      {
        confirmation,
        profileId: DEFAULT_DECOMPOSITION_PROFILE.id,
        mode: "continuation",
        targetSelection: { action: "create", kind: "long", title: "合成诊断" },
        models: {
          reading: { modelId: "faux", thinkingLevel: "off" },
          integration: { modelId: "faux", thinkingLevel: "off" }
        },
        autoContinue: false
      },
      { id: "cmd_timeout_test" }
    )
  );
  return { context, config, command, core, coreLong };
}

it("整书目标准备使用长任务通道，来源确认仍使用普通通道", async () => {
  const f = fixture();
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({
    status: "accepted",
    requestId: f.command.id
  });
  expect(f.core.mock.calls.map(([command]) => command.type)).toEqual([
    "longBookAnalysis.coreSource"
  ]);
  expect(f.coreLong.mock.calls.map(([command]) => command.type)).toEqual([
    "longBookDecomposition.coreCreate"
  ]);
});

it("创建超时返回结构化错误和原任务 ID，异步错误不再逃出 IPC", async () => {
  const f = fixture();
  f.coreLong.mockRejectedValueOnce(new UtilityCommandTimeoutError("合成超时"));
  const result = await handleDecompositionCommands(
    f.context,
    f.config,
    f.command
  );
  const sent = f.coreLong.mock.calls[0]![0];
  if (sent.type !== "longBookDecomposition.coreCreate")
    throw new Error("错误命令");
  expect(result).toMatchObject({
    status: "rejected",
    requestId: f.command.id,
    error: {
      code: "decomposition.command_timeout",
      message: expect.stringContaining("点击继续"),
      details: { jobId: sent.payload.job.id }
    }
  });
  expect(f.coreLong).toHaveBeenCalledTimes(1);
});

it("Core 拒绝创建时仍附带任务 ID 和原始错误详情", async () => {
  const f = fixture();
  f.coreLong.mockImplementationOnce(async (command) => ({
    status: "rejected",
    requestId: command.id,
    error: {
      code: "decomposition.command_failed",
      message: "模拟写入失败",
      details: { storageCode: "disk_full" }
    }
  }));
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({
    status: "rejected",
    error: {
      message: "模拟写入失败",
      details: {
        jobId: expect.stringMatching(/^ldjob_/u),
        storageCode: "disk_full"
      }
    }
  });
});

it.each([
  ["get", undefined, true],
  ["save-registry", undefined, true],
  ["control", "resume", true],
  ["control", "advance", true],
  ["control", "stop", false],
  ["control", "finish-package", false],
  ["list", undefined, false]
] as const)("Core %s/%s 选择对应等待期限", async (operation, action, long) => {
  const f = fixture();
  await decompositionCore(f.context, f.command, {
    operation,
    jobId: "ldjob_timeout_test",
    ...(action ? { control: { jobId: "ldjob_timeout_test", action } } : {})
  });
  expect(long ? f.coreLong : f.core).toHaveBeenCalledTimes(1);
  expect(long ? f.core : f.coreLong).not.toHaveBeenCalled();
});

it("继续任务的异步超时也经过统一错误处理", async () => {
  const f = fixture();
  f.coreLong.mockRejectedValueOnce(
    new UtilityCommandTimeoutError("合成恢复超时")
  );
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.control",
      { jobId: "ldjob_timeout_test", action: "resume" },
      { id: "cmd_resume_timeout" }
    )
  );
  expect(
    await handleDecompositionCommands(f.context, f.config, command)
  ).toMatchObject({
    status: "rejected",
    error: { code: "decomposition.command_timeout" }
  });
});

it("未提供长任务通道的调用方仍可创建任务", async () => {
  const f = fixture();
  delete f.context.coreLong;
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({ status: "accepted" });
  expect(f.core).toHaveBeenCalledTimes(2);
});

it("创建带备选模型任务时按通读链最小窗口切块并保存完整模型链", async () => {
  const f = fixture();
  const big = "合成大章正文。".repeat(3000);
  const confirmedAt = "2026-11-24T00:00:00.000Z";
  const windows: Record<string, number> = {
    primary_128k: 128_000,
    fallback_32k: 32_000,
    integrator_128k: 128_000
  };
  f.core.mockImplementation(async (command) => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "longBookAnalysis.coreSource"
        ? {
            confirmation: {
              id: "confirm_timeout_test",
              sourceId: "long_book_analysis_source_timeout_test",
              sourceRevision: 1,
              fingerprint: "a".repeat(64),
              range: { start: 1, end: 1 },
              confirmedAt
            },
            source: {
              id: "long_book_analysis_source_timeout_test",
              kind: "txt",
              name: "合成样书",
              revision: 1,
              fingerprint: "a".repeat(64),
              diagnostics: [],
              chapters: [
                {
                  id: "source_chapter_1",
                  order: 1,
                  title: "第一章",
                  sourceName: "合成样书.txt",
                  text: big,
                  charCount: big.length
                }
              ]
            }
          }
        : {}
  }));
  f.context.resolveModel = async (id) =>
    id
      ? ({
          id,
          label: id,
          provider: "test",
          modelId: id,
          api: "openai-completions",
          baseUrl: "https://example.test",
          apiKey: "invalid-test-key",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low"],
          temperatureOptions: [0.1, 0.7, 1]
        } as Awaited<ReturnType<ExtrasAgentCommandContext["resolveModel"]>>)
      : undefined;
  f.context.requestAgent = vi.fn(async (command) => {
    if (command.type !== "agent.model_capacity")
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {}
      };
    const id = command.payload.runtimeConfig.id;
    return {
      status: "accepted" as const,
      requestId: command.id,
      payload: {
        modelId: command.payload.runtimeConfig.modelId,
        contextWindow: windows[id] ?? 128_000,
        maxTokens: 4096
      }
    };
  });
  const createCmd = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.createJob",
      {
        confirmation: {
          id: "confirm_timeout_test",
          sourceId: "long_book_analysis_source_timeout_test",
          sourceRevision: 1,
          fingerprint: "a".repeat(64),
          range: { start: 1, end: 1 },
          confirmedAt
        },
        profileId: DEFAULT_DECOMPOSITION_PROFILE.id,
        mode: "continuation",
        targetSelection: { action: "create", kind: "long", title: "合成诊断" },
        models: {
          reading: { modelId: "primary_128k", thinkingLevel: "off" },
          readingFallbacks: [{ modelId: "fallback_32k", thinkingLevel: "off" }],
          integration: { modelId: "integrator_128k", thinkingLevel: "off" }
        },
        autoContinue: false
      },
      { id: "cmd_create_fallback" }
    )
  );
  const result = await handleDecompositionCommands(
    f.context,
    f.config,
    createCmd
  );
  expect(result?.status).toBe("accepted");
  const sent = f.coreLong.mock.calls[0]![0];
  if (sent.type !== "longBookDecomposition.coreCreate")
    throw new Error("错误命令");
  expect(sent.payload.job.chunks.length).toBeGreaterThan(1);
  expect(sent.payload.job.models.readingFallbacks).toEqual([
    {
      modelId: "fallback_32k",
      thinkingLevel: "off",
      contextWindow: 32_000,
      maxTokens: 4096
    }
  ]);
});

it("updateModels 校验运行态、完成态，并在整合阶段允许旧通读模型已被删除", async () => {
  const f = fixture();
  const baseJob = {
    schemaVersion: 1 as const,
    id: "ldjob_update_models",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "materials" as const,
    outputVersion: 1,
    targetSelection: {
      kind: "material-group" as const,
      action: "create" as const,
      title: "合成资料"
    },
    target: {
      kind: "material-group" as const,
      groupId: "g1",
      libraryIds: {
        character: "c",
        plot: "p",
        draft: "d",
        other: "o",
        gimmick: "g"
      },
      baseRevisions: {},
      state: "ready" as const
    },
    source: {
      sourceId: "long_book_analysis_source_timeout_test",
      sourceRevision: 1,
      title: "合成样书",
      fingerprint: "a".repeat(64),
      confirmationId: "confirm_timeout_test",
      confirmedAt: new Date().toISOString(),
      chapterCount: 1,
      characterCount: 5,
      range: { start: 1, end: 1 }
    },
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    models: {
      reading: {
        modelId: "deleted_reader",
        thinkingLevel: "off" as const,
        contextWindow: 128_000,
        maxTokens: 8192
      },
      integration: {
        modelId: "old_integrator",
        thinkingLevel: "off" as const,
        contextWindow: 128_000,
        maxTokens: 8192
      }
    },
    chunks: [
      {
        id: "chunk:1",
        startOrder: 1,
        endOrder: 1,
        chapterIds: ["source_chapter_1"],
        estimatedTokens: 5
      }
    ],
    chronicleSegments: [],
    phase: "integrate" as const,
    status: "stopped" as const,
    autoContinue: false,
    units: {}
  };
  f.coreLong.mockImplementation(async (command) => ({
    status: "accepted",
    requestId: command.id,
    payload: baseJob
  }));
  f.core.mockImplementation(async (command) => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "longBookDecomposition.coreAccess" &&
      command.payload.operation === "update-models"
        ? { ...baseJob, models: command.payload.models }
        : baseJob
  }));
  f.context.evaluationMode = false;
  f.context.resolveModel = async (id) =>
    id === "new_integrator"
      ? ({
          id,
          label: id,
          provider: "test",
          modelId: id,
          api: "openai-completions",
          baseUrl: "https://example.test",
          apiKey: "invalid-test-key",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low"],
          temperatureOptions: [0.1, 0.7, 1]
        } as Awaited<ReturnType<ExtrasAgentCommandContext["resolveModel"]>>)
      : undefined;
  f.context.requestAgent = vi.fn(async (command) => ({
    status: "accepted" as const,
    requestId: command.id,
    payload: {
      modelId:
        command.type === "agent.model_capacity"
          ? command.payload.runtimeConfig.modelId
          : "new_integrator",
      contextWindow: 200_000,
      maxTokens: 8192
    }
  }));

  const updateCmd = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.updateModels",
      {
        jobId: baseJob.id,
        models: {
          reading: { modelId: "deleted_reader", thinkingLevel: "off" },
          integration: { modelId: "new_integrator", thinkingLevel: "off" }
        }
      },
      { id: "cmd_update_models" }
    )
  );
  // Active run blocks switching
  f.context.activeRuns.set("run_1", {
    sessionId: "s1",
    correlationId: "c1",
    runtime: { provider: "test", model: "test", mode: "provider" },
    accepted: true,
    decompositionJobId: baseJob.id
  });
  expect(
    await handleDecompositionCommands(f.context, f.config, updateCmd)
  ).toMatchObject({ status: "rejected" });
  f.context.activeRuns.clear();

  // Succeeds even though deleted_reader no longer resolves in integrate phase
  const res = await handleDecompositionCommands(f.context, f.config, updateCmd);
  expect(res).toMatchObject({
    status: "accepted",
    payload: {
      models: {
        reading: { modelId: "deleted_reader", contextWindow: 128_000 },
        integration: { modelId: "new_integrator", contextWindow: 200_000 }
      }
    }
  });
});
