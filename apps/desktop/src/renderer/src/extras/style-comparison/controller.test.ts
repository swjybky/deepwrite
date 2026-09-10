import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type ModelConfig,
  type DeepWriteApi,
  type SessionPromptCommandPayload,
  type SessionPromptAcceptedPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createStyleComparisonController } from "./controller";
import { parseStyleComparisonResult, styleComparisonPreview } from "./result";

const model: ModelConfig = {
  id: "test-model",
  label: "测试模型",
  provider: "custom",
  modelId: "test",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0, 0.7, 1],
  hasApiKey: false
};
const runtime = {
  provider: "custom",
  model: "test",
  mode: "provider" as const
};
const result = {
  summary: "两段的短句节奏接近，但意象不同。",
  dimensions: ["用词", "节奏", "语气"].map((name) => ({
    name,
    score: 70,
    reason: "A 的“雨停”与 B 的“风停”都很简短。"
  })),
  similarities: ["短句为主。"],
  differences: ["意象不同。"],
  score: 70
};

function setup(
  customPrompt?: (
    payload: SessionPromptCommandPayload
  ) => Promise<SessionPromptAcceptedPayload>
) {
  let listener: ((event: SystemEventEnvelope) => void) | undefined;
  let request: SessionPromptCommandPayload | undefined;
  let counter = 0;
  const unsubscribe = vi.fn();
  const notifyError = vi.fn();
  const abort = vi.fn(async () => ({
    sessionId: request!.sessionId,
    runId: `run-${counter}`,
    abortedAt: "2026-09-09T00:00:00.000Z"
  }));
  const prompt = vi.fn(async (payload: SessionPromptCommandPayload) => {
    request = payload;
    counter++;
    return customPrompt
      ? customPrompt(payload)
      : {
          sessionId: payload.sessionId,
          runId: `run-${counter}`,
          acceptedAt: "2026-09-09T00:00:00.000Z",
          runtime
        };
  });
  const api = {
    session: { prompt, abort, submitUserInput: vi.fn() },
    events: {
      subscribe: (cb: (event: SystemEventEnvelope) => void) => {
        listener = cb;
        return unsubscribe;
      }
    }
  } as Pick<DeepWriteApi, "session" | "events">;
  const controller = createStyleComparisonController({
    api: () => api,
    notifyError
  });
  controller.referenceText.value = "雨停了。街上很静。";
  controller.comparisonText.value = "风停了。屋里没有声音。";
  const emit = (type: string, payload: Record<string, unknown> = {}) =>
    listener?.(
      createEnvelope(
        type,
        {
          sessionId: request!.sessionId,
          runId: `run-${counter}`,
          messageId: "message",
          runtime,
          ...payload
        },
        { id: "test-event" }
      ) as SystemEventEnvelope
    );
  return { controller, prompt, abort, notifyError, emit, unsubscribe };
}

describe("文风比对运行与结果", () => {
  it("updates activity from reading through thinking and findings to completion", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    expect(ctx.controller.activity.value).toBe("正在连接比对智能体…");
    ctx.emit("agent.turn_started", { attempt: 1 });
    expect(ctx.controller.activity.value).toBe("正在阅读两份文本…");
    ctx.emit("agent.thinking_delta", { delta: "测试思考内容" });
    expect(ctx.controller.activity.value).toBe("正在思考，分析两份文本的文风…");
    expect(ctx.controller.preview.value).toEqual({
      summary: "",
      dimensions: []
    });
    ctx.emit("agent.message_delta", { delta: JSON.stringify(result) });
    expect(ctx.controller.activity.value).toBe("正在整理关键发现与评分…");
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    expect(ctx.controller.activity.value).toBe("比对完成");
    ctx.emit("agent.thinking_delta", { delta: "迟到的思考事件" });
    expect(ctx.controller.activity.value).toBe("比对完成");
  });
  it("isolates thinking activity by session and run and preserves retry and stop states", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emit("agent.turn_started", { attempt: 1 });
    for (const context of [
      { sessionId: "unrelated-session" },
      { runId: "unrelated-run" }
    ]) {
      ctx.emit("agent.thinking_delta", { ...context, delta: "无关思考" });
      expect(ctx.controller.activity.value).toBe("正在阅读两份文本…");
    }
    ctx.emit("agent.thinking_delta", { delta: "测试思考" });
    ctx.emit("agent.retry_scheduled", {
      delayMs: 1000,
      nextAttempt: 2,
      maxAttempts: 3
    });
    expect(ctx.controller.activity.value).toBe("连接暂时中断，1 秒后重试…");
    ctx.emit("agent.turn_started", { attempt: 2 });
    expect(ctx.controller.activity.value).toBe("正在重新连接模型…");
    ctx.emit("agent.thinking_delta", { delta: "重试中的思考" });
    expect(ctx.controller.activity.value).toBe("正在思考，分析两份文本的文风…");
    const stopping = ctx.controller.stop();
    ctx.emit("agent.thinking_delta", { delta: "停止期间的思考" });
    expect(ctx.controller.activity.value).toBe("正在停止…");
    await stopping;
    expect(ctx.controller.activity.value).toBe("已停止比对");
  });
  it("sends the selected thinking level, including off and custom levels", async () => {
    const reasoningModel: ModelConfig = {
      ...model,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["medium", "high", "custom-effort"]
    };
    for (const level of ["high", "off", "custom-effort"]) {
      const ctx = setup();
      ctx.controller.syncThinkingModel(reasoningModel);
      expect(ctx.controller.thinkingLevel.value).toBe("medium");
      ctx.controller.thinkingLevel.value = level;
      await ctx.controller.start(reasoningModel);
      expect(ctx.prompt.mock.calls[0]![0].thinkingLevel).toBe(level);
    }
  });
  it("preserves a valid selection and resets it for model changes or removed levels", () => {
    const ctx = setup();
    ctx.controller.syncThinkingModel(model);
    ctx.controller.thinkingLevel.value = "high";
    ctx.controller.syncThinkingModel({ ...model });
    expect(ctx.controller.thinkingLevel.value).toBe("high");
    const nextModel: ModelConfig = {
      ...model,
      id: "another-model",
      reasoning: true,
      defaultThinkingLevel: "medium"
    };
    ctx.controller.syncThinkingModel(nextModel);
    expect(ctx.controller.thinkingLevel.value).toBe("medium");
    ctx.controller.thinkingLevel.value = "high";
    ctx.controller.syncThinkingModel({
      ...nextModel,
      thinkingLevelOptions: ["medium"]
    });
    expect(ctx.controller.thinkingLevel.value).toBe("medium");
    ctx.controller.syncThinkingModel(undefined);
    expect(ctx.controller.thinkingLevel.value).toBe("off");
  });
  it("uses the model default when starting directly and keeps the running selection stable", async () => {
    const ctx = setup();
    await ctx.controller.start({
      ...model,
      reasoning: true,
      defaultThinkingLevel: "high"
    });
    expect(ctx.prompt.mock.calls[0]![0].thinkingLevel).toBe("high");
    ctx.controller.syncThinkingModel({ ...model, id: "other-model" });
    expect(ctx.controller.thinkingLevel.value).toBe("high");
  });
  it("sends method and samples, streams only public findings, and requires the terminal score", async () => {
    const ctx = setup();
    ctx.controller.method.value = "关注短句";
    await ctx.controller.start(model);
    expect(ctx.prompt.mock.calls[0]![0]).toMatchObject({
      webSearchEnabled: false,
      workspaceContext: {
        styleComparison: {
          method: "关注短句",
          referenceText: "雨停了。街上很静。"
        }
      }
    });
    ctx.emit("agent.thinking_delta", { delta: "内部思考不会展示" });
    expect(ctx.controller.preview.value.summary).toBe("");
    ctx.emit("agent.message_delta", {
      delta: JSON.stringify(result).slice(0, -1)
    });
    expect(ctx.controller.preview.value.summary).toBe(result.summary);
    expect(ctx.controller.preview.value.dimensions).toEqual(result.dimensions);
    expect(ctx.controller.result.value).toBeNull();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    expect(ctx.controller.result.value?.score).toBe(70);
    expect(ctx.controller.status.value).toBe("completed");
    ctx.controller.referenceText.value += "新的句子。";
    expect(ctx.controller.isStale.value).toBe(true);
  });
  it("rejects empty input and unavailable models without submitting a run", async () => {
    const ctx = setup();
    ctx.controller.comparisonText.value = "  ";
    await ctx.controller.start(model);
    expect(ctx.prompt).not.toHaveBeenCalled();
    expect(ctx.notifyError).toHaveBeenCalled();
  });
  it("does not manufacture a score for malformed, truncated or out-of-range results", async () => {
    for (const content of [
      "相似度很高",
      JSON.stringify({ ...result, score: 120 }),
      JSON.stringify(result).slice(0, -1)
    ]) {
      const ctx = setup();
      await ctx.controller.start(model);
      ctx.emit("agent.message_completed", { role: "assistant", content });
      expect(ctx.controller.result.value).toBeNull();
      expect(ctx.controller.status.value).toBe("error");
      expect(ctx.notifyError).toHaveBeenCalled();
    }
  });
  it("ignores unrelated and late events and clears partial output for retries", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emit("agent.message_delta", {
      sessionId: "another-session",
      delta: JSON.stringify(result)
    });
    expect(ctx.controller.preview.value.summary).toBe("");
    ctx.emit("agent.message_delta", { delta: JSON.stringify(result) });
    ctx.emit("agent.retry_scheduled", {
      delayMs: 1000,
      nextAttempt: 2,
      maxAttempts: 3
    });
    expect(ctx.controller.preview.value.summary).toBe("");
    await ctx.controller.stop();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    expect(ctx.controller.result.value).toBeNull();
    expect(ctx.controller.status.value).toBe("stopped");
  });
  it("stops a run requested before prompt acceptance", async () => {
    let accept: (value: SessionPromptAcceptedPayload) => void = () => undefined;
    let request: SessionPromptCommandPayload | undefined;
    const ctx = setup((payload) => {
      request = payload;
      return new Promise((resolve) => {
        accept = resolve;
      });
    });
    const started = ctx.controller.start(model);
    await ctx.controller.stop();
    expect(ctx.controller.status.value).toBe("stopping");
    accept({
      sessionId: request!.sessionId,
      runId: "delayed-run",
      acceptedAt: "2026-09-09T00:00:00.000Z",
      runtime
    });
    await started;
    expect(ctx.abort).toHaveBeenCalledWith({
      sessionId: request!.sessionId,
      runId: "delayed-run"
    });
    expect(ctx.controller.status.value).toBe("stopped");
  });
  it("does not return to running when completion precedes acceptance", async () => {
    let accept: (value: SessionPromptAcceptedPayload) => void = () => undefined;
    let request: SessionPromptCommandPayload | undefined;
    const ctx = setup((payload) => {
      request = payload;
      return new Promise((resolve) => {
        accept = resolve;
      });
    });
    const started = ctx.controller.start(model);
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    accept({
      sessionId: request!.sessionId,
      runId: "run-1",
      acceptedAt: "2026-09-09T00:00:00.000Z",
      runtime
    });
    await started;
    expect(ctx.controller.status.value).toBe("completed");
    ctx.controller.dispose();
    expect(ctx.unsubscribe).toHaveBeenCalled();
  });
  it("accepts a fenced JSON result and handles quoted evidence in incremental output", () => {
    expect(
      parseStyleComparisonResult(
        `\x60\x60\x60json\n${JSON.stringify(result)}\n\x60\x60\x60`
      ).score
    ).toBe(70);
    expect(
      styleComparisonPreview(JSON.stringify(result).slice(0, -1)).dimensions
    ).toEqual(result.dimensions);
  });
});
