import { computed, ref } from "vue";
import { createId } from "@deepwrite/shared";
import type {
  DeepWriteApi,
  ModelConfig,
  ThinkingLevel,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  StyleComparisonInputSchema,
  type StyleComparisonResult
} from "@deepwrite/contracts/renderer";
import { parseStyleComparisonResult, styleComparisonPreview } from "./result";

type Status =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "completed"
  | "error";
interface Options {
  api(): Pick<DeepWriteApi, "session" | "events"> | undefined;
  notifyError(message: string): void;
}

export function createStyleComparisonController(options: Options) {
  const referenceText = ref("");
  const comparisonText = ref("");
  const method = ref(DEFAULT_STYLE_COMPARISON_METHOD);
  const modelId = ref("");
  const thinkingLevel = ref<ThinkingLevel>("off");
  let thinkingModelId = "";
  const status = ref<Status>("idle");
  const activity = ref("");
  const output = ref("");
  const result = ref<StyleComparisonResult | null>(null);
  const lastInput = ref("");
  const resultModel = ref("");
  const isBusy = computed(() =>
    ["starting", "running", "stopping"].includes(status.value)
  );
  const preview = computed(() => styleComparisonPreview(output.value));
  const inputSnapshot = () =>
    JSON.stringify({
      referenceText: referenceText.value.trim(),
      comparisonText: comparisonText.value.trim(),
      method: method.value.trim()
    });
  const isStale = computed(() =>
    Boolean(lastInput.value && lastInput.value !== inputSnapshot())
  );
  let sessionId = "";
  let runId = "";
  let stopRequested = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  function fail(cause: unknown): void {
    status.value = "error";
    activity.value = "比对未完成";
    options.notifyError(
      cause instanceof Error ? cause.message : "文风比对失败，请重试。"
    );
  }

  function handleEvent(event: SystemEventEnvelope): void {
    if (
      disposed ||
      !isBusy.value ||
      !("sessionId" in event.payload) ||
      !("runId" in event.payload)
    )
      return;
    if (
      event.payload.sessionId !== sessionId ||
      (runId && event.payload.runId !== runId)
    )
      return;
    if (
      ![
        "agent.turn_started",
        "agent.retry_scheduled",
        "agent.thinking_delta",
        "agent.message_delta",
        "agent.message_completed",
        "agent.error"
      ].includes(event.type)
    )
      return;
    runId = String(event.payload.runId);
    if (stopRequested) return;
    switch (event.type) {
      case "agent.turn_started":
        status.value = "running";
        output.value = "";
        activity.value =
          event.payload.attempt > 1 ? "正在重新连接模型…" : "正在阅读两份文本…";
        break;
      case "agent.retry_scheduled":
        output.value = "";
        activity.value = `连接暂时中断，${Math.ceil(event.payload.delayMs / 1000)} 秒后重试…`;
        break;
      case "agent.message_delta":
        output.value += event.payload.delta;
        activity.value = "正在整理关键发现与评分…";
        break;
      case "agent.thinking_delta":
        activity.value = "正在思考，分析两份文本的文风…";
        break;
      case "agent.message_completed":
        if (event.payload.stopReason === "aborted") {
          status.value = "stopped";
          activity.value = "已停止比对";
          break;
        }
        output.value = event.payload.content;
        try {
          if (event.payload.stopReason === "length")
            throw new Error(
              "模型输出达到长度上限，未完成比对，请调整模型输出长度后重试。"
            );
          result.value = parseStyleComparisonResult(output.value);
          status.value = "completed";
          activity.value = "比对完成";
        } catch (error) {
          fail(error);
        }
        break;
      case "agent.error":
        fail(new Error(event.payload.message));
        break;
    }
  }

  async function abortRun(
    api: ReturnType<Options["api"]>,
    currentSession: string,
    currentRun: string
  ): Promise<void> {
    if (!api || !currentRun) return;
    await api.session.abort({ sessionId: currentSession, runId: currentRun });
  }

  async function start(model: ModelConfig | undefined): Promise<void> {
    if (disposed || isBusy.value) return;
    const api = options.api();
    if (!api) {
      options.notifyError("当前环境无法调用智能体。");
      return;
    }
    if (!model || model.enabled === false) {
      options.notifyError("请先配置并选择一个可用模型。");
      return;
    }
    syncThinkingModel(model);
    const parsed = StyleComparisonInputSchema.safeParse({
      referenceText: referenceText.value,
      comparisonText: comparisonText.value,
      method: method.value
    });
    if (!parsed.success) {
      options.notifyError(
        "请填写两份文本，每份不超过 30,000 字，比对方法不超过 8,000 字。"
      );
      return;
    }
    // Conservative input estimate; never silently truncate either sample.
    const estimatedTokens = JSON.stringify(parsed.data).length * 2 + 2500;
    if (
      model.contextWindow &&
      estimatedTokens + (model.maxTokens ?? 4096) > model.contextWindow
    ) {
      options.notifyError(
        "两份文本可能超出当前模型的上下文容量，请缩短文本或选择更大上下文的模型。"
      );
      return;
    }
    unsubscribe ??= api.events.subscribe(handleEvent);
    const currentSession = createId("style_comparison");
    sessionId = currentSession;
    runId = "";
    stopRequested = false;
    status.value = "starting";
    activity.value = "正在连接比对智能体…";
    output.value = "";
    result.value = null;
    lastInput.value = JSON.stringify(parsed.data);
    resultModel.value = model.label;
    try {
      const accepted = await api.session.prompt({
        sessionId: currentSession,
        message: "请比较两份文本的文风，给出关键依据和最终相似度评分。",
        modelId: model.id,
        thinkingLevel: thinkingLevel.value,
        webSearchEnabled: false,
        workspaceContext: { styleComparison: parsed.data }
      });
      if (disposed || stopRequested || sessionId !== currentSession) {
        await abortRun(api, currentSession, accepted.runId);
        if (!disposed && sessionId === currentSession) {
          status.value = "stopped";
          activity.value = "已停止比对";
        }
        return;
      }
      if (
        accepted.sessionId !== currentSession ||
        (runId && accepted.runId !== runId)
      )
        throw new Error("比对会话不一致，请重试。");
      runId = accepted.runId;
      // Terminal events can arrive before the prompt acceptance.
      if (status.value === "starting") status.value = "running";
    } catch (error) {
      if (!disposed && sessionId === currentSession) fail(error);
    }
  }

  async function stop(): Promise<void> {
    if (!isBusy.value || stopRequested) return;
    stopRequested = true;
    status.value = "stopping";
    activity.value = "正在停止…";
    if (!runId) return; // start() aborts as soon as acceptance arrives.
    try {
      await abortRun(options.api(), sessionId, runId);
      status.value = "stopped";
      activity.value = "已停止比对";
    } catch (error) {
      stopRequested = false;
      status.value = "running";
      activity.value = "比对仍在进行，可再次停止";
      options.notifyError(
        error instanceof Error ? error.message : "停止比对失败，请重试。"
      );
    }
  }

  function dispose(): void {
    disposed = true;
    unsubscribe?.();
    if (isBusy.value && runId)
      void abortRun(options.api(), sessionId, runId).catch(() => undefined);
  }

  function syncThinkingModel(model: ModelConfig | undefined): void {
    if (isBusy.value) return;
    if (
      thinkingModelId !== (model?.id ?? "") ||
      (thinkingLevel.value !== "off" &&
        !model?.thinkingLevelOptions.includes(thinkingLevel.value))
    ) {
      thinkingLevel.value = model?.defaultThinkingLevel ?? "off";
    }
    thinkingModelId = model?.id ?? "";
  }

  return {
    referenceText,
    comparisonText,
    method,
    modelId,
    thinkingLevel,
    syncThinkingModel,
    status,
    activity,
    result,
    resultModel,
    preview,
    isBusy,
    isStale,
    start,
    stop,
    dispose,
    handleEvent
  };
}
