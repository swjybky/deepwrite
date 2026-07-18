import { computed, ref, type Ref } from "vue";
import type {
  AgentRuntimeRef,
  DeepWriteApi,
  ModelConfig,
  ModelSettings,
  SystemEventEnvelope,
  ThinkingLevel,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  SHORT_WORKSPACE_STAGE_IDS,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type { ChatMessage } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

interface UseAgentConversationOptions {
  api: () => DeepWriteApi | undefined;
  initialMessages?: ChatMessage[];
  idleTimeoutMs?: number;
}

export interface AgentConversationController {
  messages: Ref<ChatMessage[]>;
  draft: Ref<string>;
  sessionId: Ref<string>;
  thinkingLevel: Ref<ThinkingLevel>;
  configuredModels: Ref<ModelConfig[]>;
  selectedModelId: Ref<string>;
  runtime: Ref<AgentRuntimeRef | null>;
  conversationError: Ref<string | null>;
  isBusy: Readonly<Ref<boolean>>;
  canSend: Readonly<Ref<boolean>>;
  acceptsRunEvent(sessionId: string, runId: string): boolean;
  markToolConflict(runId: string, toolCallId: string, summary: string): void;
  handleEvent(event: SystemEventEnvelope): void;
  sendMessage(
    activeDocument: WorkspaceDocument,
    workspaceDocuments?: WorkspaceDocument[]
  ): Promise<void>;
  newConversation(): void;
  applyModelSettings(settings: ModelSettings): void;
  selectModel(modelId: string): void;
  selectThinkingLevel(level: ThinkingLevel): void;
  useSuggestion(value: string): void;
  dispose(): void;
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return { ...message };
}

function rememberBounded(set: Set<string>, value: string, limit = 2_000): void {
  set.add(value);
  while (set.size > limit) {
    const oldest = set.values().next().value as string | undefined;
    if (!oldest) {
      return;
    }
    set.delete(oldest);
  }
}

export function useAgentConversation(
  options: UseAgentConversationOptions
): AgentConversationController {
  const messages = ref<ChatMessage[]>((options.initialMessages ?? []).map(cloneMessage));
  const draft = ref("");
  const sessionId = ref(id("session"));
  const thinkingLevel = ref<ThinkingLevel>("medium");
  const configuredModels = ref<ModelConfig[]>([]);
  const defaultModelId = ref("");
  const selectedModelId = ref("");
  const runtime = ref<AgentRuntimeRef | null>(null);
  const conversationError = ref<string | null>(null);
  const submitting = ref(false);
  const activeRunId = ref<string | null>(null);
  const handledEventIds = new Set<string>();
  const finishedRunIds = new Set<string>();
  const runMessageIds = new Map<string, string>();
  const observedRunByAttempt = new Map<number, string>();
  let epoch = 0;
  let attemptSequence = 0;
  const pendingAttemptId = ref<number | null>(null);
  let idleTimer: number | undefined;

  const isBusy = computed(
    () => pendingAttemptId.value !== null || submitting.value || activeRunId.value !== null
  );
  const canSend = computed(
    () => Boolean(options.api()) && !isBusy.value && draft.value.trim().length > 0
  );

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      globalThis.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function markRunError(
    runId: string,
    messageText: string,
    eventRuntime?: AgentRuntimeRef
  ): void {
    const messageId = runMessageIds.get(runId) ?? `${runId}_assistant`;
    let message = messages.value.find(
      (item) => item.id === messageId && item.role === "assistant" && item.runId === runId
    );
    if (!message) {
      message = {
        id: messages.value.some((item) => item.id === messageId)
          ? `${messageId}_${id("error")}`
          : messageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        runId,
        status: "error",
        errorMessage: messageText,
        ...(eventRuntime ? { runtime: eventRuntime } : {})
      };
      messages.value.push(message);
      runMessageIds.set(runId, message.id);
    }
    message.status = "error";
    message.errorMessage = messageText;
    rememberBounded(finishedRunIds, runId);
  }

  function invalidateAttemptForRun(runId: string): void {
    for (const [attemptId, observedRunId] of observedRunByAttempt) {
      if (observedRunId !== runId) {
        continue;
      }
      observedRunByAttempt.delete(attemptId);
      if (pendingAttemptId.value === attemptId) {
        pendingAttemptId.value = null;
      }
    }
  }

  function scheduleIdleTimeout(scope: {
    expectedEpoch: number;
    expectedSessionId: string;
    attemptId?: number;
    runId?: string;
  }): void {
    clearIdleTimer();
    idleTimer = globalThis.setTimeout(() => {
      if (epoch !== scope.expectedEpoch || sessionId.value !== scope.expectedSessionId) {
        return;
      }
      const ownsRun = scope.runId !== undefined && activeRunId.value === scope.runId;
      const ownsAttempt =
        scope.attemptId !== undefined && pendingAttemptId.value === scope.attemptId;
      if (!ownsRun && !ownsAttempt) {
        return;
      }

      const messageText = "智能体长时间没有返回新事件，请稍后重试。";
      if (scope.runId) {
        markRunError(scope.runId, messageText, runtime.value ?? undefined);
        invalidateAttemptForRun(scope.runId);
        if (activeRunId.value === scope.runId) {
          activeRunId.value = null;
        }
      }
      if (scope.attemptId !== undefined && pendingAttemptId.value === scope.attemptId) {
        pendingAttemptId.value = null;
        observedRunByAttempt.delete(scope.attemptId);
      }
      submitting.value = false;
      conversationError.value = messageText;
      idleTimer = undefined;
    }, options.idleTimeoutMs ?? 55_000);
  }

  function failProtocol(runId: string, messageText: string, eventRuntime?: AgentRuntimeRef): void {
    markRunError(runId, messageText, eventRuntime);
    invalidateAttemptForRun(runId);
    if (activeRunId.value === runId) {
      activeRunId.value = null;
    }
    submitting.value = false;
    conversationError.value = messageText;
    clearIdleTimer();
  }

  function ensureAssistantMessage(
    runId: string,
    messageId: string,
    eventRuntime?: AgentRuntimeRef
  ): ChatMessage | undefined {
    const mappedMessageId = runMessageIds.get(runId);
    if (mappedMessageId && mappedMessageId !== messageId) {
      failProtocol(runId, "智能体为同一运行返回了不一致的消息标识。", eventRuntime);
      return undefined;
    }

    const existing = messages.value.find((message) => message.id === messageId);
    if (existing) {
      if (existing.role !== "assistant" || existing.runId !== runId) {
        failProtocol(runId, "智能体消息标识与现有消息发生冲突。", eventRuntime);
        return undefined;
      }
      runMessageIds.set(runId, messageId);
      return existing;
    }

    const message: ChatMessage = {
      id: messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      runId,
      status: "streaming",
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    runMessageIds.set(runId, messageId);
    messages.value.push(message);
    return message;
  }

  function finishRun(runId: string): void {
    rememberBounded(finishedRunIds, runId);
    if (activeRunId.value === runId) {
      activeRunId.value = null;
    }
    submitting.value = false;
    clearIdleTimer();
  }

  function acceptsRunEvent(eventSessionId: string, runId: string): boolean {
    if (eventSessionId !== sessionId.value || finishedRunIds.has(runId)) {
      return false;
    }
    if (activeRunId.value) {
      return activeRunId.value === runId;
    }
    if (pendingAttemptId.value === null) {
      return false;
    }
    const observedRunId = observedRunByAttempt.get(pendingAttemptId.value);
    return observedRunId === undefined || observedRunId === runId;
  }

  function markToolConflict(
    runId: string,
    toolCallId: string,
    summary: string
  ): void {
    const messageId = runMessageIds.get(runId) ?? `${runId}_assistant`;
    const message = messages.value.find(
      (candidate) =>
        candidate.id === messageId &&
        candidate.role === "assistant" &&
        candidate.runId === runId
    );
    const tool = message?.tools?.find((candidate) => candidate.id === toolCallId);
    if (!tool) return;
    tool.status = "error";
    tool.summary = summary;
  }

  function handleEvent(event: SystemEventEnvelope): void {
    if (!isAgentEvent(event) || event.payload.sessionId !== sessionId.value) {
      return;
    }
    if (handledEventIds.has(event.id) || finishedRunIds.has(event.payload.runId)) {
      return;
    }

    const runId = event.payload.runId;
    if (activeRunId.value && activeRunId.value !== runId) {
      return;
    }
    if (!activeRunId.value) {
      if (pendingAttemptId.value === null) {
        return;
      }
      const observedRunId = observedRunByAttempt.get(pendingAttemptId.value);
      if (observedRunId && observedRunId !== runId) {
        failProtocol(observedRunId, "同一次请求收到了多个运行标识。", runtime.value ?? undefined);
        return;
      }
      observedRunByAttempt.set(pendingAttemptId.value, runId);
      activeRunId.value = runId;
    }

    rememberBounded(handledEventIds, event.id);
    submitting.value = false;
    scheduleIdleTimeout({
      expectedEpoch: epoch,
      expectedSessionId: sessionId.value,
      runId
    });

    if (event.type === "agent.message_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime
      );
      if (message) {
        message.content += event.payload.delta;
      }
      return;
    }

    if (event.type === "tool.call_requested") {
      const message = ensureAssistantMessage(
        runId,
        `${runId}_assistant`,
        event.payload.runtime
      );
      if (message && !message.tools?.some((tool) => tool.id === event.payload.toolCallId)) {
        message.tools = [
          ...(message.tools ?? []),
          {
            id: event.payload.toolCallId,
            name: event.payload.toolName,
            status: "running"
          }
        ];
      }
      return;
    }

    if (event.type === "tool.execution_completed") {
      const message = ensureAssistantMessage(
        runId,
        `${runId}_assistant`,
        event.payload.runtime
      );
      if (message) {
        const tools = message.tools ?? [];
        const existing = tools.find((tool) => tool.id === event.payload.toolCallId);
        if (existing) {
          existing.status = event.payload.isError ? "error" : "completed";
          existing.summary = event.payload.resultSummary;
        } else {
          message.tools = [
            ...tools,
            {
              id: event.payload.toolCallId,
              name: event.payload.toolName,
              status: event.payload.isError ? "error" : "completed",
              summary: event.payload.resultSummary
            }
          ];
        }
      }
      return;
    }

    if (event.type === "agent.thinking_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime
      );
      if (message) {
        message.thinking = `${message.thinking ?? ""}${event.payload.delta}`;
      }
      return;
    }

    if (event.type === "agent.message_completed") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime
      );
      if (!message) {
        return;
      }
      message.content = event.payload.content;
      if (event.payload.thinking !== undefined) {
        message.thinking = event.payload.thinking;
      }
      message.status = "completed";
      message.runtime = event.payload.runtime;
      if (event.payload.usage !== undefined) {
        message.usage = event.payload.usage;
      }
      finishRun(runId);
      return;
    }

    markRunError(runId, event.payload.message, event.payload.runtime);
    conversationError.value = event.payload.message;
    finishRun(runId);
  }

  async function sendMessage(
    activeDocument: WorkspaceDocument,
    workspaceDocuments: WorkspaceDocument[] = []
  ): Promise<void> {
    const api = options.api();
    const content = draft.value.trim();
    if (!api) {
      conversationError.value = "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。";
      return;
    }
    if (!content || isBusy.value) {
      return;
    }

    const sendEpoch = epoch;
    const sendSessionId = sessionId.value;
    const attemptId = ++attemptSequence;
    const originalLength = activeDocument.content.length;
    const snapshotContent = activeDocument.content.slice(0, 20_000);
    const contextSnapshot: WorkspaceRuntimeContext = {
      activeResource: {
        id: activeDocument.id,
        domain: activeDocument.domain,
        title: activeDocument.title,
        path: [...activeDocument.path],
        ...(activeDocument.format ? { format: activeDocument.format } : {}),
        source: "live-editor" as const,
        content: snapshotContent,
        ...(originalLength > snapshotContent.length
          ? { truncated: true as const, originalLength }
          : {})
      }
    };
    if (
      activeDocument.workspaceType === "short" &&
      activeDocument.workspaceId &&
      activeDocument.workspaceTitle &&
      activeDocument.stageId
    ) {
      const liveStages = workspaceDocuments.filter(
        (document) =>
          document.workspaceType === "short" &&
          document.workspaceId === activeDocument.workspaceId &&
          document.stageId
      );
      const stages = SHORT_WORKSPACE_STAGE_IDS.map((stageId) => {
        const document = liveStages.find((candidate) => candidate.stageId === stageId);
        if (!document) return undefined;
        const originalLength = document.content.length;
        const stageContent = document.content.slice(0, 20_000);
        return {
          stageId,
          title: document.title,
          content: stageContent,
          revision: createShortWorkspaceContentRevision(document.content),
          ...(originalLength > stageContent.length
            ? { truncated: true as const, originalLength }
            : {})
        };
      });
      const completeStages = stages.filter(
        (stage): stage is NonNullable<typeof stage> => stage !== undefined
      );
      if (completeStages.length === SHORT_WORKSPACE_STAGE_IDS.length) {
        contextSnapshot.shortWorkspace = {
          id: activeDocument.workspaceId,
          title: activeDocument.workspaceTitle,
          categories: [...(activeDocument.workspaceCategories ?? [])],
          activeStageId: activeDocument.stageId,
          stages: completeStages
        };
      }
    }

    messages.value.push({
      id: id("user"),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      status: "completed"
    });
    draft.value = "";
    conversationError.value = null;
    pendingAttemptId.value = attemptId;
    submitting.value = true;
    scheduleIdleTimeout({
      expectedEpoch: sendEpoch,
      expectedSessionId: sendSessionId,
      attemptId
    });

    try {
      const accepted = await api.session.prompt({
        sessionId: sendSessionId,
        message: content,
        ...(selectedModelId.value ? { modelId: selectedModelId.value } : {}),
        thinkingLevel: thinkingLevel.value,
        workspaceContext: contextSnapshot
      });
      if (
        epoch !== sendEpoch ||
        sessionId.value !== sendSessionId ||
        pendingAttemptId.value !== attemptId
      ) {
        return;
      }
      if (accepted.sessionId !== sendSessionId) {
        const observedRunId = observedRunByAttempt.get(attemptId);
        if (observedRunId) {
          failProtocol(observedRunId, "智能体受理结果返回了错误的会话标识。", accepted.runtime);
        }
        pendingAttemptId.value = null;
        submitting.value = false;
        clearIdleTimer();
        conversationError.value = "智能体受理结果返回了错误的会话标识。";
        return;
      }

      const observedRunId = observedRunByAttempt.get(attemptId);
      if (observedRunId && observedRunId !== accepted.runId) {
        failProtocol(observedRunId, "智能体受理结果与已到达事件的运行标识不一致。", accepted.runtime);
        pendingAttemptId.value = null;
        observedRunByAttempt.delete(attemptId);
        rememberBounded(finishedRunIds, accepted.runId);
        return;
      }

      runtime.value = accepted.runtime;
      pendingAttemptId.value = null;
      observedRunByAttempt.delete(attemptId);
      submitting.value = false;
      if (!finishedRunIds.has(accepted.runId)) {
        activeRunId.value = accepted.runId;
        scheduleIdleTimeout({
          expectedEpoch: sendEpoch,
          expectedSessionId: sendSessionId,
          runId: accepted.runId
        });
      } else {
        clearIdleTimer();
      }
    } catch (error: unknown) {
      if (
        epoch !== sendEpoch ||
        sessionId.value !== sendSessionId ||
        pendingAttemptId.value !== attemptId
      ) {
        return;
      }
      const messageText = error instanceof Error ? error.message : "智能体请求受理失败。";
      const observedRunId = observedRunByAttempt.get(attemptId);
      if (observedRunId) {
        markRunError(observedRunId, messageText, runtime.value ?? undefined);
        if (activeRunId.value === observedRunId) {
          activeRunId.value = null;
        }
      }
      pendingAttemptId.value = null;
      observedRunByAttempt.delete(attemptId);
      submitting.value = false;
      clearIdleTimer();
      conversationError.value = messageText;
    }
  }

  function newConversation(): void {
    epoch += 1;
    clearIdleTimer();
    sessionId.value = id("session");
    messages.value = [];
    draft.value = "";
    submitting.value = false;
    pendingAttemptId.value = null;
    activeRunId.value = null;
    runtime.value = null;
    conversationError.value = null;
    handledEventIds.clear();
    finishedRunIds.clear();
    runMessageIds.clear();
    observedRunByAttempt.clear();
    const selected =
      configuredModels.value.find((model) => model.id === defaultModelId.value) ??
      configuredModels.value[0];
    selectedModelId.value = selected?.id ?? "";
    thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
  }

  function applyModelSettings(settings: ModelSettings): void {
    configuredModels.value = settings.models;
    defaultModelId.value = settings.defaultModelId;
    const selected =
      settings.models.find((model) => model.id === selectedModelId.value) ??
      settings.models.find((model) => model.id === settings.defaultModelId) ??
      settings.models[0];
    selectedModelId.value = selected?.id ?? "";
    thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
  }

  function selectModel(modelId: string): void {
    const selected = configuredModels.value.find((model) => model.id === modelId);
    if (!selected) {
      return;
    }
    selectedModelId.value = selected.id;
    thinkingLevel.value = selected.reasoning ? selected.defaultThinkingLevel : "off";
  }

  function selectThinkingLevel(level: ThinkingLevel): void {
    const selected = configuredModels.value.find(
      (model) => model.id === selectedModelId.value
    );
    thinkingLevel.value = selected && !selected.reasoning ? "off" : level;
  }

  return {
    messages,
    draft,
    sessionId,
    thinkingLevel,
    configuredModels,
    selectedModelId,
    runtime,
    conversationError,
    isBusy,
    canSend,
    acceptsRunEvent,
    markToolConflict,
    handleEvent,
    sendMessage,
    newConversation,
    applyModelSettings,
    selectModel,
    selectThinkingLevel,
    useSuggestion(value: string): void {
      draft.value = value;
    },
    dispose(): void {
      epoch += 1;
      pendingAttemptId.value = null;
      activeRunId.value = null;
      clearIdleTimer();
    }
  };
}

function isAgentEvent(
  event: SystemEventEnvelope
): event is Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.error"
      | "tool.call_requested"
      | "tool.execution_completed";
  }
> {
  return (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed"
  );
}
