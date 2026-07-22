import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  LearningImitationDocumentsSchema,
  LearningImitationResultSchema,
  applyLearningImitationWrite,
  cloneEmptyLearningImitationResult,
  type DeepWriteApi,
  type LearningImitationDocument,
  type LearningImitationResult,
  type LearningImitationStageId,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts";

export const LEARNING_IMITATION_PRESET_PROMPTS = {
  material_split: [
    "请执行「一键拆素材」。",
    "先调用 list_learning_documents 了解全部样本，再按需要逐篇读取正文。",
    "提炼可复用的人设、梗、剧情设计、导语设计、剧情细化和优秀正文片段。",
    "最后必须调用 write_learning_result，mode 使用 replace，并尽量完整写入 character、gimmick、pacing、intro、plot_refine、draft_excerpt。"
  ].join("\n"),
  plot_learning: [
    "请执行「一键学习剧情设计」。",
    "先调用 list_learning_documents 了解所有样本，再按需要读取样本正文，归纳它们可复用的剧情组织方法。",
    "最后必须调用 write_learning_result，mode 使用 replace，并写入 plot_design_skill 和 plot_refine_skill。",
    "结果要像技能库条目，包含方法、步骤、判断标准和可执行模板。"
  ].join("\n"),
  style_learning: [
    "请执行「一键文风学习」。",
    "先调用 list_learning_documents 了解所有样本，再按需要读取样本正文，归纳能指导分节写手产出新正文的文风规则。",
    "最后必须调用 write_learning_result，mode 使用 replace，并写入 style_skill_title 和 style_skill_body。",
    "不要大段复制原文，以规则、模板、检查清单和短示例为主。"
  ].join("\n")
} as const satisfies Record<LearningImitationStageId, string>;

export type LearningImitationRunStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "stopped"
  | "error";

export type LearningImitationMessageStatus =
  | "streaming"
  | "completed"
  | "stopped"
  | "error";

export interface LearningImitationChatMessage {
  id: string;
  runId?: string;
  messageId?: string;
  stageId: LearningImitationStageId;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  status: LearningImitationMessageStatus;
  createdAt: string;
  updatedAt: string;
}

export type LearningImitationToolStatus =
  | "preparing"
  | "running"
  | "completed"
  | "error";

export interface LearningImitationToolState {
  id: string;
  runId: string;
  stageId: LearningImitationStageId;
  name: string;
  status: LearningImitationToolStatus;
  argumentsText?: string;
  args?: unknown;
  resultSummary?: string;
  requestedAt: string;
  completedAt?: string;
}

export interface LearningImitationStartOptions {
  prompt?: string;
  modelId?: string;
}

export interface UseLearningImitationOptions {
  api: () => DeepWriteApi | undefined;
  initialDocuments?: readonly LearningImitationDocument[];
  initialResult?: LearningImitationResult;
  initialModelId?: string;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export interface LearningImitationController {
  sessionId: Readonly<Ref<string>>;
  documents: Ref<LearningImitationDocument[]>;
  result: Ref<LearningImitationResult>;
  messages: Ref<LearningImitationChatMessage[]>;
  tools: Ref<LearningImitationToolState[]>;
  selectedModelId: Ref<string>;
  runningStage: Readonly<Ref<LearningImitationStageId | null>>;
  activeRunId: Readonly<Ref<string | null>>;
  lastCompletedRunId: Readonly<Ref<string | null>>;
  lastCompletedStage: Readonly<Ref<LearningImitationStageId | null>>;
  status: Readonly<Ref<LearningImitationRunStatus>>;
  error: Readonly<Ref<string | null>>;
  isBusy: ComputedRef<boolean>;
  canStop: ComputedRef<boolean>;
  setConfiguredModels(models: readonly ModelConfig[], defaultModelId?: string): void;
  addDocuments(nextDocuments: readonly LearningImitationDocument[]): boolean;
  removeDocument(documentId: string): boolean;
  clearDocuments(): boolean;
  setResult(nextResult: LearningImitationResult): void;
  newSession(): boolean;
  start(
    stageId: LearningImitationStageId,
    options?: LearningImitationStartOptions
  ): Promise<boolean>;
  stop(): Promise<boolean>;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

type LearningImitationRuntimeEvent = Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "learning_imitation.result_updated";
  }
>;

const MAX_TRACKED_EVENT_IDS = 1_000;

function fallbackId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${randomId}`;
}

function cloneDocument(document: LearningImitationDocument): LearningImitationDocument {
  return { ...document };
}

function cloneResult(result: LearningImitationResult): LearningImitationResult {
  return {
    material_split: { ...result.material_split },
    plot_learning: { ...result.plot_learning },
    style_learning: { ...result.style_learning }
  };
}

function isRuntimeEvent(event: SystemEventEnvelope): event is LearningImitationRuntimeEvent {
  return (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "learning_imitation.result_updated"
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function useLearningImitation(
  options: UseLearningImitationOptions
): LearningImitationController {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? fallbackId;
  const sessionId = ref(createId("learning_imitation_session"));
  const documents = ref<LearningImitationDocument[]>(
    (options.initialDocuments ?? []).map(cloneDocument)
  );
  const result = ref<LearningImitationResult>(
    options.initialResult
      ? LearningImitationResultSchema.parse(cloneResult(options.initialResult))
      : cloneEmptyLearningImitationResult()
  );
  const messages = ref<LearningImitationChatMessage[]>([]);
  const tools = ref<LearningImitationToolState[]>([]);
  const selectedModelId = ref(options.initialModelId ?? "");
  const configuredModelIds = new Set<string>();
  const runningStage = ref<LearningImitationStageId | null>(null);
  const activeRunId = ref<string | null>(null);
  const lastCompletedRunId = ref<string | null>(null);
  const lastCompletedStage = ref<LearningImitationStageId | null>(null);
  const status = ref<LearningImitationRunStatus>("idle");
  const error = ref<string | null>(null);
  const isBusy = computed(() =>
    status.value === "starting" ||
    status.value === "running" ||
    status.value === "stopping"
  );
  const canStop = computed(() => isBusy.value);

  let disposed = false;
  let attemptSequence = 0;
  let pendingAttemptId: number | null = null;
  let observedRunId: string | null = null;
  let stopRequested = false;
  const handledEventIds = new Set<string>();
  const finishedRunIds = new Set<string>();

  function rememberHandledEvent(eventId: string): void {
    handledEventIds.add(eventId);
    if (handledEventIds.size <= MAX_TRACKED_EVENT_IDS) return;
    const oldest = handledEventIds.values().next().value as string | undefined;
    if (oldest) handledEventIds.delete(oldest);
  }

  function setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void {
    configuredModelIds.clear();
    models.forEach((model) => configuredModelIds.add(model.id));
    if (selectedModelId.value && configuredModelIds.has(selectedModelId.value)) {
      return;
    }
    selectedModelId.value =
      (defaultModelId && configuredModelIds.has(defaultModelId)
        ? defaultModelId
        : models[0]?.id) ?? "";
  }

  function setMutationError(message: string): false {
    error.value = message;
    return false;
  }

  function addDocuments(
    nextDocuments: readonly LearningImitationDocument[]
  ): boolean {
    if (isBusy.value) {
      return setMutationError("学习任务运行中，不能修改本次运行使用的样本文档。");
    }
    try {
      documents.value = LearningImitationDocumentsSchema.parse([
        ...documents.value.map(cloneDocument),
        ...nextDocuments.map(cloneDocument)
      ]);
      error.value = null;
      return true;
    } catch (cause: unknown) {
      return setMutationError(errorMessage(cause, "添加样本文档失败。"));
    }
  }

  function removeDocument(documentId: string): boolean {
    if (isBusy.value) {
      return setMutationError("学习任务运行中，不能移除本次运行使用的样本文档。");
    }
    documents.value = documents.value.filter(
      (document) => document.id !== documentId
    );
    error.value = null;
    return true;
  }

  function clearDocuments(): boolean {
    if (isBusy.value) {
      return setMutationError("学习任务运行中，不能清空本次运行使用的样本文档。");
    }
    documents.value = [];
    error.value = null;
    return true;
  }

  function setResult(nextResult: LearningImitationResult): void {
    result.value = LearningImitationResultSchema.parse(cloneResult(nextResult));
  }

  function newSession(): boolean {
    if (disposed) return setMutationError("学习仿写控制器已释放。");
    if (isBusy.value) {
      return setMutationError("学习任务运行中，不能新建学习会话。");
    }
    sessionId.value = createId("learning_imitation_session");
    documents.value = [];
    result.value = cloneEmptyLearningImitationResult();
    messages.value = [];
    tools.value = [];
    runningStage.value = null;
    activeRunId.value = null;
    lastCompletedRunId.value = null;
    lastCompletedStage.value = null;
    status.value = "idle";
    error.value = null;
    pendingAttemptId = null;
    observedRunId = null;
    stopRequested = false;
    handledEventIds.clear();
    finishedRunIds.clear();
    return true;
  }

  function bindRun(runId: string): boolean {
    if (finishedRunIds.has(runId)) return false;
    if (activeRunId.value && activeRunId.value !== runId) {
      error.value = "同一次学习请求收到了多个运行标识。";
      status.value = "error";
      return false;
    }
    if (observedRunId && observedRunId !== runId) {
      error.value = "同一次学习请求收到了多个运行标识。";
      status.value = "error";
      return false;
    }
    observedRunId = runId;
    activeRunId.value = runId;
    if (!stopRequested) status.value = "running";
    return true;
  }

  function ensureAssistantMessage(
    runId: string,
    messageId: string | undefined,
    timestamp: string
  ): LearningImitationChatMessage | undefined {
    const stageId = runningStage.value;
    if (!stageId) return undefined;
    const existing = [...messages.value].reverse().find(
      (message) =>
        message.role === "assistant" &&
        message.runId === runId &&
        (!messageId || message.messageId === messageId)
    );
    if (existing) return existing;
    const created: LearningImitationChatMessage = {
      id: createId("learning_imitation_message"),
      runId,
      ...(messageId ? { messageId } : {}),
      stageId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    messages.value.push(created);
    return created;
  }

  function upsertTool(input: {
    runId: string;
    toolCallId?: string;
    streamId?: string;
    name?: string;
    timestamp: string;
  }): LearningImitationToolState | undefined {
    const stageId = runningStage.value;
    if (!stageId) return undefined;
    const identity = input.toolCallId ?? input.streamId;
    if (!identity) return undefined;
    let tool = tools.value.find(
      (candidate) =>
        candidate.runId === input.runId &&
        (candidate.id === identity ||
          (input.streamId !== undefined && candidate.id === input.streamId))
    );
    if (!tool && input.streamId && input.toolCallId) {
      tool = tools.value.find(
        (candidate) =>
          candidate.runId === input.runId && candidate.id === input.streamId
      );
    }
    if (!tool) {
      tool = {
        id: identity,
        runId: input.runId,
        stageId,
        name: input.name ?? "tool_call",
        status: input.toolCallId ? "running" : "preparing",
        requestedAt: input.timestamp
      };
      tools.value.push(tool);
    } else {
      if (input.toolCallId) tool.id = input.toolCallId;
      if (input.name) tool.name = input.name;
    }
    return tool;
  }

  function finishRun(
    runId: string,
    nextStatus: Extract<
      LearningImitationRunStatus,
      "completed" | "stopped" | "error"
    >,
    message?: string
  ): void {
    const finishedStage = runningStage.value;
    finishedRunIds.add(runId);
    const timestamp = now();
    for (const chatMessage of messages.value) {
      if (chatMessage.runId !== runId || chatMessage.status !== "streaming") continue;
      chatMessage.status =
        nextStatus === "completed"
          ? "completed"
          : nextStatus === "stopped"
            ? "stopped"
            : "error";
      chatMessage.updatedAt = timestamp;
    }
    for (const tool of tools.value) {
      if (
        tool.runId === runId &&
        (tool.status === "preparing" || tool.status === "running")
      ) {
        tool.status = nextStatus === "error" ? "error" : "completed";
        tool.completedAt = timestamp;
      }
    }
    activeRunId.value = null;
    if (nextStatus === "completed" && finishedStage) {
      lastCompletedRunId.value = runId;
      lastCompletedStage.value = finishedStage;
    }
    runningStage.value = null;
    pendingAttemptId = null;
    observedRunId = null;
    stopRequested = false;
    status.value = nextStatus;
    error.value = nextStatus === "error" ? message ?? "学习任务运行失败。" : null;
  }

  async function requestAbort(runId: string): Promise<boolean> {
    const api = options.api();
    if (!api) {
      error.value = "浏览器预览没有桌面 Agent Runtime。";
      status.value = "running";
      return false;
    }
    try {
      await api.session.abort({ sessionId: sessionId.value, runId });
      return true;
    } catch (cause: unknown) {
      error.value = errorMessage(cause, "停止学习任务失败。");
      status.value = "running";
      stopRequested = false;
      return false;
    }
  }

  async function start(
    stageId: LearningImitationStageId,
    startOptions: LearningImitationStartOptions = {}
  ): Promise<boolean> {
    if (disposed) return setMutationError("学习仿写控制器已释放。");
    if (isBusy.value) return setMutationError("已有学习任务正在运行。");
    const api = options.api();
    if (!api) {
      return setMutationError(
        "浏览器预览没有桌面 Agent Runtime，请使用桌面客户端运行学习任务。"
      );
    }
    let requestDocuments: LearningImitationDocument[];
    try {
      requestDocuments = LearningImitationDocumentsSchema.parse(
        documents.value.map(cloneDocument)
      );
    } catch (cause: unknown) {
      return setMutationError(
        errorMessage(cause, "请先上传 1-5 个可读取的样本文档。")
      );
    }
    const prompt = (
      startOptions.prompt ?? LEARNING_IMITATION_PRESET_PROMPTS[stageId]
    ).trim();
    if (!prompt) return setMutationError("请输入学习任务内容。");
    if (prompt.length > 20_000) {
      return setMutationError("学习任务内容不能超过 20,000 个字符。");
    }
    const modelId = (startOptions.modelId ?? selectedModelId.value).trim();
    if (!modelId) {
      return setMutationError("请先在模型设置中配置并选择模型。");
    }
    if (modelId && configuredModelIds.size && !configuredModelIds.has(modelId)) {
      return setMutationError("所选模型已不在当前模型列表中，请重新选择。");
    }

    const attemptId = ++attemptSequence;
    pendingAttemptId = attemptId;
    observedRunId = null;
    stopRequested = false;
    runningStage.value = stageId;
    activeRunId.value = null;
    status.value = "starting";
    error.value = null;
    if (modelId) selectedModelId.value = modelId;
    const timestamp = now();
    messages.value.push({
      id: createId("learning_imitation_message"),
      stageId,
      role: "user",
      content: prompt,
      status: "completed",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    try {
      const accepted = await api.session.prompt({
        sessionId: sessionId.value,
        message: prompt,
        modelId,
        writeApprovalMode: "request-approval",
        workspaceContext: {
          learningImitation: {
            stageId,
            documents: requestDocuments.map(cloneDocument),
            result: cloneResult(result.value)
          }
        }
      });
      if (pendingAttemptId !== attemptId && !finishedRunIds.has(accepted.runId)) {
        return false;
      }
      if (accepted.sessionId !== sessionId.value) {
        throw new Error("学习任务返回了不匹配的会话标识。");
      }
      if (observedRunId && observedRunId !== accepted.runId) {
        throw new Error("学习任务事件与请求响应的运行标识不一致。");
      }
      if (finishedRunIds.has(accepted.runId)) return true;
      if (!bindRun(accepted.runId)) return false;
      const userMessage = [...messages.value].reverse().find(
        (message) =>
          message.role === "user" &&
          message.stageId === stageId &&
          message.runId === undefined
      );
      if (userMessage) userMessage.runId = accepted.runId;
      if (stopRequested) {
        status.value = "stopping";
        return requestAbort(accepted.runId);
      }
      return true;
    } catch (cause: unknown) {
      if (pendingAttemptId !== attemptId) return false;
      const message = errorMessage(cause, "启动学习任务失败。");
      const runId = activeRunId.value ?? observedRunId;
      if (runId) {
        finishRun(runId, stopRequested ? "stopped" : "error", message);
      } else {
        pendingAttemptId = null;
        observedRunId = null;
        runningStage.value = null;
        activeRunId.value = null;
        status.value = stopRequested ? "stopped" : "error";
        error.value = stopRequested ? null : message;
        stopRequested = false;
      }
      return false;
    }
  }

  async function stop(): Promise<boolean> {
    if (!isBusy.value) return false;
    stopRequested = true;
    status.value = "stopping";
    const runId = activeRunId.value ?? observedRunId;
    if (!runId) return true;
    return requestAbort(runId);
  }

  function handleEvent(event: SystemEventEnvelope): void {
    if (
      disposed ||
      !isRuntimeEvent(event) ||
      event.payload.sessionId !== sessionId.value ||
      handledEventIds.has(event.id) ||
      finishedRunIds.has(event.payload.runId) ||
      pendingAttemptId === null ||
      runningStage.value === null
    ) {
      return;
    }
    const runId = event.payload.runId;
    if (!bindRun(runId)) return;
    rememberHandledEvent(event.id);

    if (event.type === "agent.message_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.timestamp
      );
      if (message) {
        message.content += event.payload.delta;
        message.updatedAt = event.timestamp;
      }
      return;
    }

    if (event.type === "agent.thinking_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.timestamp
      );
      if (message) {
        message.thinking = `${message.thinking ?? ""}${event.payload.delta}`;
        message.updatedAt = event.timestamp;
      }
      return;
    }

    if (event.type === "tool.call_stream") {
      const tool = upsertTool({
        runId,
        ...(event.payload.toolCallId
          ? { toolCallId: event.payload.toolCallId }
          : {}),
        streamId: event.payload.streamId,
        ...(event.payload.toolName ? { name: event.payload.toolName } : {}),
        timestamp: event.timestamp
      });
      if (tool) {
        tool.argumentsText = `${tool.argumentsText ?? ""}${event.payload.argumentsDelta}`;
        if (event.payload.args !== undefined) tool.args = event.payload.args;
        tool.status = event.payload.phase === "end" ? "running" : "preparing";
      }
      return;
    }

    if (event.type === "tool.call_requested") {
      const tool = upsertTool({
        runId,
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        timestamp: event.timestamp
      });
      if (tool) {
        tool.args = event.payload.args;
        tool.status = "running";
      }
      return;
    }

    if (event.type === "learning_imitation.result_updated") {
      if (event.payload.stageId !== runningStage.value) {
        return;
      }
      const tool = upsertTool({
        runId,
        toolCallId: event.payload.toolCallId,
        name: "write_learning_result",
        timestamp: event.timestamp
      });
      try {
        result.value = applyLearningImitationWrite(
          cloneResult(result.value),
          runningStage.value,
          event.payload.update
        );
      } catch (cause: unknown) {
        const message = errorMessage(cause, "学习结果超过可保存范围，已保留此前预览。");
        error.value = message;
        if (tool) {
          tool.status = "error";
          tool.resultSummary = message;
          tool.completedAt = event.timestamp;
        }
        return;
      }
      if (tool && tool.status !== "completed" && tool.status !== "error") {
        tool.status = "running";
      }
      return;
    }

    if (event.type === "tool.execution_completed") {
      const tool = upsertTool({
        runId,
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        timestamp: event.timestamp
      });
      if (tool) {
        tool.status = event.payload.isError ? "error" : "completed";
        tool.resultSummary = event.payload.resultSummary;
        tool.completedAt = event.timestamp;
      }
      return;
    }

    if (event.type === "agent.message_completed") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.timestamp
      );
      if (message) {
        message.content = event.payload.content;
        if (event.payload.thinking?.trim()) {
          message.thinking = event.payload.thinking;
        }
        message.status = "completed";
        message.updatedAt = event.timestamp;
      }
      finishRun(runId, "completed");
      return;
    }

    if (event.type === "agent.error") {
      if (event.payload.code === "pi_agent.aborted") {
        finishRun(runId, "stopped");
      } else {
        finishRun(runId, "error", event.payload.message);
      }
    }
  }

  function dispose(): void {
    // Intentionally do not abort here. The controller belongs to App's lifetime,
    // while opening and closing the dialog only changes its visibility.
    disposed = true;
  }

  return {
    sessionId,
    documents,
    result,
    messages,
    tools,
    selectedModelId,
    runningStage,
    activeRunId,
    lastCompletedRunId,
    lastCompletedStage,
    status,
    error,
    isBusy,
    canStop,
    setConfiguredModels,
    addDocuments,
    removeDocument,
    clearDocuments,
    setResult,
    newSession,
    start,
    stop,
    handleEvent,
    dispose
  };
}
