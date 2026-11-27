import { afterEach, expect, it, vi } from "vitest";
import { createSSRApp, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import type {
  LongBookDecompositionJob,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import { runEvent } from "../agent-runtime/extrasAgent.test-support";
import {
  decompositionEngineFixture as fixture,
  model
} from "./engine.test-support";
import { createScopedTranslator } from "../../i18n";
import DecompositionProgress from "./DecompositionProgress.vue";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";

const t = createScopedTranslator("extras.longBookDecomposition");
afterEach(() => vi.restoreAllMocks());

function fail(f: ReturnType<typeof fixture>, child = false) {
  f.extras.run.mockImplementation(async (request) => {
    const unit = f.stored().units["chunk:1"]!;
    f.stored().status = "running";
    f.stored().activeAttemptId = "attempt_ui";
    Object.assign(unit, { status: "running", attemptId: "attempt_ui" });
    const runtime = { provider: "test", model: "test", mode: "provider" };
    setTimeout(() => {
      if (child) {
        const base = {
          parentToolCallId: "call_reader",
          subagentRunId: "run_reader",
          subagentId: "reader",
          name: "通读员",
          runtime
        };
        f.engine.handleEvent(
          runEvent("subagent.started", request, { ...base, task: "chunk:1" })
        );
        f.engine.handleEvent(
          runEvent("subagent.completed", request, {
            ...base,
            status: "error",
            summary: "子智能体执行失败：用户额度已用尽",
            errorMessage: "用户额度已用尽"
          })
        );
      } else {
        f.engine.handleEvent(
          runEvent("agent.error", request, {
            code: "pi_agent.error",
            message: "429 insufficient_quota"
          })
        );
      }
    }, 0);
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { ...runtime, mode: "provider" as const }
    };
  });
}

it("额度耗尽不等待卡住的任务读取，显示继续且丢弃迟到的运行快照", async () => {
  const f = fixture();
  fail(f);
  let resolve!: (job: LongBookDecompositionJob) => void;
  let claimed!: LongBookDecompositionJob;
  f.getJob.mockImplementationOnce(() => {
    claimed = structuredClone(f.stored());
    return new Promise((done) => (resolve = done));
  });
  const run = f.engine.run();
  try {
    await vi.waitFor(() => expect(f.engine.isBusy.value).toBe(false));
    await run;
    expect(f.extras.run).toHaveBeenCalledTimes(1);
    expect(f.control.mock.calls.map(([input]) => input.action)).toEqual([
      "resume",
      "stop"
    ]);
    expect(f.engine.job.value).toMatchObject({
      status: "stopped",
      lastError: expect.stringContaining("insufficient_quota")
    });
    expect(f.stored().units["chunk:1"]).toMatchObject({
      status: "pending",
      attempts: 0
    });
    expect(f.engine.error.value).toContain("insufficient_quota");
    const html = await renderToString(
      createSSRApp(DecompositionProgress, {
        controller: {
          ...f.engine,
          registry: shallowRef(null)
        } as unknown as LongBookDecompositionController,
        disabled: false
      })
    );
    expect(html).toMatch(
      new RegExp(
        `<button(?![^>]*disabled)[^>]*>\\s*${t("resume")}\\s*</button>`,
        "u"
      )
    );
    expect(html).toContain(t("quotaPaused"));
    expect(html).not.toContain(t("stop"));
    resolve(claimed);
    await Promise.resolve();
    expect(f.engine.job.value?.status).toBe("stopped");
  } finally {
    f.engine.dispose();
  }
});

it("子智能体额度耗尽时中止整包，不等主控回复，补充额度后继续原任务", async () => {
  const f = fixture();
  const completed = structuredClone({
    ...f.stored().units["chunk:1"]!,
    status: "done" as const
  });
  f.stored().units["chunk:saved"] = completed;
  fail(f, true);
  try {
    await f.engine.run();
    expect(f.api.session.abort).toHaveBeenCalledTimes(1);
    expect(f.engine.isBusy.value).toBe(false);
    expect(f.engine.job.value?.status).toBe("stopped");
    expect(f.engine.error.value).toContain("用户额度已用尽");
    expect(f.engine.subtasks.packages.value[0]).toMatchObject({
      outcome: "stopped"
    });
    expect(f.extras.run).toHaveBeenCalledTimes(1);
    expect(f.stored().units["chunk:saved"]).toEqual(completed);
    f.accept();
    await f.engine.run();
    expect(f.extras.run).toHaveBeenCalledTimes(2);
    expect(f.engine.job.value?.phase).toBe("registry_review");
    expect(f.engine.error.value).toBeNull();
    expect(f.stored().units["chunk:saved"]).toEqual(completed);
  } finally {
    f.engine.dispose();
  }
});

it("启动拒绝和运行错误保留结构化额度错误码，不进入并发等待或普通重试", async () => {
  for (const beforeAcceptance of [true, false]) {
    const f = fixture();
    if (beforeAcceptance)
      f.extras.run.mockRejectedValue({
        code: "insufficient_quota",
        message: "合成请求失败"
      });
    else {
      fail(f);
      const original = f.engine.handleEvent;
      f.engine.handleEvent = (event) =>
        original(
          event.type === "agent.error"
            ? {
                ...event,
                payload: {
                  ...event.payload,
                  code: "insufficient_quota",
                  message: "合成请求失败"
                }
              }
            : event
        );
    }
    try {
      await f.engine.run();
      expect(f.extras.run).toHaveBeenCalledTimes(1);
      expect(f.engine.waitingForSlot.value).toBe(false);
      expect(f.engine.job.value?.status).toBe("stopped");
      expect(f.engine.error.value).toContain("合成请求失败");
      expect(f.engine.error.value).toBe(
        t("quotaError", { reason: "合成请求失败" })
      );
    } finally {
      f.engine.dispose();
    }
  }
});

const altModel = (id: string, label = id): ModelConfig => ({
  ...model,
  id,
  label,
  modelId: id
});

it("配置备选模型后，主模型额度耗尽自动切换下一个模型并接续完成", async () => {
  const models = [
    altModel("primary", "主模型"),
    altModel("fallback_1", "备选一"),
    altModel("fallback_2", "备选二")
  ];
  const f = fixture(models);
  const completed = structuredClone({
    ...f.stored().units["chunk:1"]!,
    status: "done" as const
  });
  f.stored().units["chunk:saved"] = completed;
  f.stored().models.readingFallbacks = [
    {
      modelId: "fallback_1",
      thinkingLevel: "low",
      contextWindow: 128_000,
      maxTokens: 8192
    },
    {
      modelId: "fallback_2",
      thinkingLevel: "off",
      contextWindow: 128_000,
      maxTokens: 8192
    }
  ];
  f.engine.job.value = structuredClone(f.stored());

  let attempt = 0;
  f.accept();
  const baseAccept = f.extras.run.getMockImplementation()!;
  f.extras.run.mockImplementation(async (request) => {
    attempt++;
    if (attempt === 1) {
      expect(request.modelId).toBe("primary");
      setTimeout(
        () =>
          f.engine.handleEvent(
            runEvent("agent.error", request, {
              code: "insufficient_quota",
              message: "primary out of quota"
            })
          ),
        0
      );
      return {
        sessionId: request.sessionId,
        runId: `${request.sessionId}-run`,
        acceptedAt: new Date().toISOString(),
        runtime: { provider: "test", model: "primary", mode: "provider" }
      };
    }
    expect(request.modelId).toBe("fallback_1");
    expect(request.thinkingLevel).toBe("low");
    return baseAccept(request);
  });

  try {
    await f.engine.run();
    expect(f.extras.run).toHaveBeenCalledTimes(2);
    expect(f.updateModels).toHaveBeenCalledTimes(1);
    expect(f.engine.lastModelSwitch.value).toMatchObject({
      slot: "reading",
      fromModelId: "primary",
      toModelId: "fallback_1"
    });
    expect(f.engine.job.value?.phase).toBe("registry_review");
    expect(f.engine.job.value?.models.reading.modelId).toBe("fallback_1");
    expect(f.engine.job.value?.models.readingFallbacks).toHaveLength(1);
    expect(f.engine.error.value).toBeNull();
    expect(f.stored().units["chunk:saved"]).toEqual(completed);
  } finally {
    f.engine.dispose();
  }
});

it("子智能体连续额度耗尽时跳过失效备选按序推进，全部耗尽才暂停", async () => {
  const models = [
    altModel("m1", "模型一"),
    altModel("m2", "模型二"),
    altModel("m3", "模型三")
  ];
  const f = fixture(models);
  f.stored().models.readingFallbacks = [
    {
      modelId: "deleted_model",
      thinkingLevel: "off",
      contextWindow: 128_000,
      maxTokens: 8192
    },
    {
      modelId: "m2",
      thinkingLevel: "off",
      contextWindow: 128_000,
      maxTokens: 8192
    },
    {
      modelId: "m3",
      thinkingLevel: "off",
      contextWindow: 128_000,
      maxTokens: 8192
    }
  ];
  f.engine.job.value = structuredClone(f.stored());
  const usedModels: string[] = [];
  f.extras.run.mockImplementation(async (request) => {
    usedModels.push(request.modelId ?? "");
    const base = {
      parentToolCallId: "call_reader",
      subagentRunId: `run_${usedModels.length}`,
      subagentId: "reader",
      name: "通读员",
      runtime: {
        provider: "test",
        model: request.modelId ?? "",
        mode: "provider"
      }
    };
    setTimeout(() => {
      f.engine.handleEvent(
        runEvent("subagent.started", request, { ...base, task: "chunk:1" })
      );
      f.engine.handleEvent(
        runEvent("subagent.completed", request, {
          ...base,
          status: "error",
          summary: "子智能体执行失败：用户额度已用尽",
          errorMessage: "用户额度已用尽"
        })
      );
    }, 0);
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "test", model: "test", mode: "provider" }
    };
  });

  try {
    await f.engine.run();
    expect(usedModels).toEqual(["m1", "m2", "m3"]);
    expect(f.engine.job.value?.status).toBe("stopped");
    expect(f.engine.job.value?.models.reading.modelId).toBe("m3");
    expect(f.engine.job.value?.models.readingFallbacks ?? []).toEqual([]);
    expect(f.engine.error.value).toContain("用户额度已用尽");
  } finally {
    f.engine.dispose();
  }
});

it("任务停止后渲染模型切换区并支持保存新模型接续执行", async () => {
  const models = [altModel("m1", "模型一"), altModel("m2", "模型二")];
  const f = fixture(models);
  f.stored().status = "stopped";
  f.engine.job.value = structuredClone(f.stored());

  const html = await renderToString(
    createSSRApp(DecompositionProgress, {
      controller: {
        ...f.engine,
        registry: shallowRef(null)
      } as unknown as LongBookDecompositionController,
      models,
      disabled: false
    })
  );
  expect(html).toContain(t("readingModel"));
  expect(html).toContain(t("integrationModel"));
  expect(html).toContain("模型一");
  expect(html).toContain(t("modelsHintPaused"));

  f.engine.job.value = await f.api.longBookDecomposition.updateModels({
    jobId: f.stored().id,
    models: {
      reading: { modelId: "m2", thinkingLevel: "low" },
      integration: { modelId: "m1", thinkingLevel: "off" }
    }
  });
  f.accept();
  const baseAccept = f.extras.run.getMockImplementation()!;
  f.extras.run.mockImplementation(async (request) => {
    expect(request.modelId).toBe("m2");
    expect(request.thinkingLevel).toBe("low");
    return baseAccept(request);
  });

  try {
    await f.engine.run();
    expect(f.engine.job.value?.phase).toBe("registry_review");
  } finally {
    f.engine.dispose();
  }
});
