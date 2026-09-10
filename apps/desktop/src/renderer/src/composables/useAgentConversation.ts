import { createConversationStopper } from "./agent-conversation/run-stopping";
import {
  cloneMessage,
  cloneSubagentRun,
  cloneEditProposal
} from "./agent-conversation/clone";
import {
  capturePersistenceSnapshot as captureConversationHistory,
  storeCurrentConversation as storeConversationHistory
} from "./agent-conversation/persistence-history";
import { preserveLoadedConversations } from "./agent-conversation/deferred-history";
import { parseAgentConversationPersistenceSnapshot } from "./agent-conversation/persistence-snapshot";
export {
  parseAgentConversationPersistenceSnapshot,
  mergeAgentConversationPersistenceSnapshots,
  mergeStoredConversationHistories
} from "./agent-conversation/persistence-snapshot";

import {
  expireIdleConversation,
  type IdleTimeoutScope
} from "./agent-conversation/idle-timeout";
import { computed, ref, shallowRef, type Ref } from "vue";
import type {
  AgentRuntimeRef,
  AgentUserInputAnswer,
  AgentUserInputRequestedPayload,
  AgentTeamRunMode,
  ChatAssistantRequestContext,
  DeepWriteApi,
  LongWorkspaceRuntimeContext,
  ModelConfig,
  ModelSettings,
  SystemEventEnvelope,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  AgentEvaluationSnapshotSchema,
  LibraryAgentWorkspaceSnapshotSchema,
  LongWorkspaceRuntimeContextSchema
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type {
  AgentApprovalMode,
  AgentEditProposal,
  AgentRetryMetadata,
  AgentSubagentRun,
  ChatMessage,
  ConversationHistoryItem,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";
import { normalizeChatAssistantRequestContext } from "./agent-conversation/chat-assistant-request";
import {
  WORKSPACE_WEB_SEARCH_AUTO_DISABLED_MESSAGE,
  isWorkspaceWebSearchAvailable,
  resolveWorkspaceWebSearchEnabled,
  workspaceWebSearchAfterModelChange,
  workspaceWebSearchPromptFields
} from "./agent-conversation/web-search";
import { buildConversationHistory } from "./agent-conversation/history";
import { createConversationHistory } from "./agent-conversation/conversation-history";
import { watchConversationPersistence } from "./agent-conversation/persistence-watch";
import {
  conversationMessageRewriteIsCurrent,
  prepareConversationMessageRewrite
} from "./agent-conversation/history-rewrite";
import {
  finalizeUnfinishedMessageTools,
  preserveLiveEditProposals
} from "./agent-conversation/attempt-state";
import { createAgentUserInputController } from "./agent-conversation/user-input";

export interface ConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface UseAgentConversationOptions {
  api: () => DeepWriteApi | undefined;
  autoApproveCrossStageOperations?: () => boolean;
  initialMessages?: ChatMessage[];
  idleTimeoutMs?: number;
  initialPersistenceSnapshot?: unknown;
  onPersistenceSnapshot?: (
    snapshot: AgentConversationPersistenceSnapshot
  ) => void | Promise<void>;
  /**
   * Hot-path notification for stores that defer snapshot capture until their
   * own debounce expires. When supplied, this takes precedence over the
   * eager snapshot callback above.
   */
  onPersistenceChange?: () => void | Promise<void>;
  onPersistenceRemove?: () => void | Promise<void>;
  /** @deprecated Persistence is now coordinated through structured snapshots. */
  persistenceKey?: string;
  /** @deprecated Persistence is now coordinated through structured snapshots. */
  storage?: ConversationStorage;
  onPersistenceError?: () => void;
  onContextWarning?: (message: string) => void;
}

export interface AgentRunSettings {
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  approvalMode: AgentApprovalMode;
  agentTeamMode?: AgentTeamRunMode;
  webSearchEnabled?: boolean;
}

export interface AgentConversationPersistenceRecord {
  sessionId: string;
  messages: ChatMessage[];
  draft: string;
  approvalMode: AgentApprovalMode;
  createdAt: string;
  updatedAt: string;
  temperature: number;
}

export interface AgentConversationPersistenceSnapshot {
  version: 1;
  activeSessionId: string;
  conversations: AgentConversationPersistenceRecord[];
}

interface AgentTurnCheckpoint {
  turnId: string;
  messageId: string;
  attempt: number;
  maxAttempts: number;
  attemptStartedAt: string;
  message: ChatMessage | null;
}

interface SubagentTurnCheckpoint {
  turnId: string;
  attempt: number;
  maxAttempts: number;
  attemptStartedAt: string;
  run: AgentSubagentRun;
}

type SubagentEventEnvelope = Extract<
  SystemEventEnvelope,
  { type: "subagent.started" | "subagent.activity" | "subagent.completed" }
>;
type SubagentEventPayload = SubagentEventEnvelope["payload"];
type SubagentActivityEventEnvelope = Extract<
  SubagentEventEnvelope,
  { type: "subagent.activity" }
>;
type AgentTextDeltaEventEnvelope = Extract<
  SystemEventEnvelope,
  { type: "agent.message_delta" | "agent.thinking_delta" }
>;

interface PendingAgentTextDelta {
  type: AgentTextDeltaEventEnvelope["type"];
  runId: string;
  messageId: string;
  runtime: AgentRuntimeRef;
  eventId: string;
  createdAt: string;
  chunks: string[];
}

const STREAM_PRESENTATION_FALLBACK_MS = 120;

export interface AgentConversationController {
  messages: Ref<ChatMessage[]>;
  draft: Ref<string>;
  sessionId: Ref<string>;
  approvalMode: Ref<AgentApprovalMode>;
  agentTeamMode: Ref<AgentTeamRunMode>;
  thinkingLevel: Ref<ThinkingLevel>;
  temperature: Ref<number>;
  webSearchEnabled: Ref<boolean>;
  configuredModels: Ref<ModelConfig[]>;
  selectedModelId: Ref<string>;
  runtime: Ref<AgentRuntimeRef | null>;
  conversationError: Ref<string | null>;
  pendingUserInput: Ref<AgentUserInputRequestedPayload | null>;
  submittingUserInput: Ref<boolean>;
  history: Readonly<Ref<ConversationHistoryItem[]>>;
  isBusy: Readonly<Ref<boolean>>;
  hasPendingEditReview: Readonly<Ref<boolean>>;
  canSend: Readonly<Ref<boolean>>;
  canSendAttachments: Readonly<Ref<boolean>>;
  canRewriteHistory: Readonly<Ref<boolean>>;
  canStop: Readonly<Ref<boolean>>;
  acceptsRunEvent(sessionId: string, runId: string): boolean;
  approvalModeForRun(
    sessionId: string,
    runId: string
  ): AgentApprovalMode | undefined;
  markToolConflict(runId: string, toolCallId: string, summary: string): void;
  getEditProposal(
    runId: string,
    proposalId: string
  ): AgentEditProposal | undefined;
  listEditProposals(runId: string): AgentEditProposal[];
  upsertEditProposal(
    runId: string,
    proposal: AgentEditProposal
  ): AgentEditProposal;
  updateEditProposal(
    runId: string,
    proposalId: string,
    patch: Partial<AgentEditProposal>
  ): AgentEditProposal | undefined;
  handleEvent(event: SystemEventEnvelope): void;
  submitUserInput(answers: AgentUserInputAnswer[]): Promise<boolean>;
  sendMessage(
    activeDocument: WorkspaceDocument,
    workspaceDocuments?: WorkspaceDocument[],
    attachments?: WorkspaceContextAttachments,
    promptAttachments?: UserPromptAttachment[]
  ): Promise<void>;
  resendMessage(
    request: ConversationMessageRewriteRequest,
    activeDocument: WorkspaceDocument,
    workspaceDocuments?: WorkspaceDocument[],
    attachments?: WorkspaceContextAttachments
  ): Promise<boolean>;
  sendAssistantMessage(context?: ChatAssistantRequestContext): Promise<void>;
  sendLongMessage(
    context: LongWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >,
    promptAttachments?: UserPromptAttachment[]
  ): Promise<void>;
  resendLongMessage(
    request: ConversationMessageRewriteRequest,
    context: LongWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >
  ): Promise<boolean>;
  stopGeneration(): Promise<boolean>;
  cancelPendingGeneration(): boolean;
  newConversation(): void;
  selectConversation(sessionId: string): boolean;
  applyModelSettings(settings: ModelSettings): void;
  applyRunSettings(settings: AgentRunSettings): void;
  selectModel(modelId: string): void;
  selectThinkingLevel(level: ThinkingLevel): void;
  selectWebSearchEnabled(enabled: boolean): void;
  selectTemperature(temperature: number): void;
  selectApprovalMode(mode: AgentApprovalMode): void;
  selectAgentTeamMode(mode: AgentTeamRunMode): void;
  useSuggestion(value: string): void;
  capturePersistenceSnapshot(): AgentConversationPersistenceSnapshot;
  restorePersistenceSnapshot(snapshot: unknown): Promise<boolean>;
  holdPersistenceEmits(): void;
  releasePersistenceEmits(): void;
  dispose(options?: { clearPersistence?: boolean }): void;
}

export type WorkspaceContextAttachments = Pick<
  WorkspaceRuntimeContext,
  "attachedSkills" | "attachedMaterials" | "libraryWorkspace"
>;

function id(prefix: string): string {
  return createId(prefix);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const storedEnvelope = parseAgentConversationPersistenceSnapshot(
    options.initialPersistenceSnapshot
  );
  const storedActive = storedEnvelope?.conversations.find(
    (conversation) => conversation.sessionId === storedEnvelope.activeSessionId
  );
  let hasRunSettingsPreference = false;
  let modelSettingsApplied = false;
  let conversationClock = Math.max(
    Date.now(),
    ...(storedEnvelope?.conversations.map((conversation) =>
      Date.parse(conversation.updatedAt)
    ) ?? [])
  );
  function nextConversationTimestamp(): string {
    conversationClock = Math.max(Date.now(), conversationClock + 1);
    return new Date(conversationClock).toISOString();
  }
  const initialTimestamp = new Date(conversationClock).toISOString();
  const messages = ref<ChatMessage[]>(
    (storedActive?.messages ?? options.initialMessages ?? []).map(cloneMessage)
  );
  const draft = ref(storedActive?.draft ?? "");
  const sessionId = ref(storedActive?.sessionId ?? id("session"));
  const approvalMode = ref<AgentApprovalMode>(
    storedActive?.approvalMode ?? "request-approval"
  );
  const agentTeamMode = ref<AgentTeamRunMode>("normal");
  const thinkingLevel = ref<ThinkingLevel>("medium");
  const temperature = ref(storedActive?.temperature ?? 0.7);
  const webSearchEnabled = ref(false);
  const configuredModels = ref<ModelConfig[]>([]);
  const defaultModelId = ref("");
  const selectedModelId = ref("");
  const runtime = ref<AgentRuntimeRef | null>(null);
  const conversationError = ref<string | null>(null);
  // Completed conversation records are immutable snapshots. Keeping the
  // bounded history shallow avoids proxying every restored message.
  const storedConversations = shallowRef<AgentConversationPersistenceRecord[]>(
    (storedEnvelope?.conversations ?? []).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map(cloneMessage)
    }))
  );
  const currentCreatedAt = ref(
    storedActive?.createdAt ?? messages.value[0]?.createdAt ?? initialTimestamp
  );
  const currentUpdatedAt = ref(storedActive?.updatedAt ?? initialTimestamp);
  const submitting = ref(false);
  const stopping = ref(false);
  const activeRunId = ref<string | null>(null);
  const handledEventIds = new Set<string>();
  const finishedRunIds = new Set<string>();
  const runMessageIds = new Map<string, string>();
  const turnCheckpointByRun = new Map<string, AgentTurnCheckpoint>();
  const subagentTurnCheckpointByRun = new Map<string, SubagentTurnCheckpoint>();
  const seenTurnIds = new Set<string>();
  const seenSubagentTurnIds = new Set<string>();
  const observedRunByAttempt = new Map<number, string>();
  const approvalModeByAttempt = new Map<number, AgentApprovalMode>();
  const approvalModeByRun = new Map<string, AgentApprovalMode>();
  const sessionsRequiringHistoryReplacement = new Set<string>();
  let epoch = 0;
  let attemptSequence = 0;
  const pendingAttemptId = ref<number | null>(null);
  let idleTimer: number | undefined;
  let persistenceErrorReported = false;
  let persistenceMutationRevision = 0;
  let persistenceBatchDepth = 0;
  let persistenceBatchChanged = false;
  let applyingPersistenceSnapshot = false;
  let persistenceNotificationsEnabled = true;
  let persistenceEmitHold = 0;
  let pendingAgentTextDelta: PendingAgentTextDelta | undefined;
  let streamPresentationFrame: number | undefined;
  let streamPresentationFallbackTimer: number | undefined;
  const userInput = createAgentUserInputController({
    api: options.api,
    onResume(runId) {
      if (activeRunId.value !== runId) return;
      scheduleIdleTimeout({
        expectedEpoch: epoch,
        expectedSessionId: sessionId.value,
        runId
      });
    },
    onError(message) {
      conversationError.value = message;
    }
  });

  const isBusy = computed(
    () =>
      pendingAttemptId.value !== null ||
      submitting.value ||
      activeRunId.value !== null
  );
  const hasPendingEditReview = computed(() =>
    messages.value.some((message) =>
      message.editProposals?.some(
        (proposal) =>
          proposal.status === "pending" || proposal.status === "accepting"
      )
    )
  );
  const canSend = computed(
    () =>
      Boolean(options.api()) &&
      !isBusy.value &&
      !hasPendingEditReview.value &&
      draft.value.trim().length > 0
  );
  const canSendAttachments = computed(
    () => Boolean(options.api()) && !isBusy.value && !hasPendingEditReview.value
  );
  const canRewriteHistory = computed(
    () => Boolean(options.api()) && !isBusy.value && !hasPendingEditReview.value
  );
  const canStop = computed(
    () =>
      Boolean(options.api()) && activeRunId.value !== null && !stopping.value
  );
  const history = createConversationHistory({
    messages,
    draft,
    sessionId,
    createdAt: currentCreatedAt,
    updatedAt: currentUpdatedAt,
    storedConversations
  });

  const persistenceHistory = {
    sessionId,
    messages,
    draft,
    approvalMode,
    currentCreatedAt,
    currentUpdatedAt,
    temperature,
    storedConversations
  };

  function storeCurrentConversation(): void {
    storeConversationHistory(persistenceHistory);
  }

  function capturePersistenceSnapshot(): AgentConversationPersistenceSnapshot {
    flushPendingAgentTextDelta();
    return captureConversationHistory(persistenceHistory);
  }

  function reportPersistenceError(): void {
    if (persistenceErrorReported) return;
    persistenceErrorReported = true;
    options.onPersistenceError?.();
  }

  function observePersistenceResult(result: void | Promise<void>): void {
    if (!result || typeof result.then !== "function") {
      persistenceErrorReported = false;
      return;
    }
    void result.then(
      () => {
        persistenceErrorReported = false;
      },
      () => {
        reportPersistenceError();
      }
    );
  }

  function holdPersistenceEmits(): void {
    persistenceEmitHold += 1;
  }

  function releasePersistenceEmits(): void {
    persistenceEmitHold = Math.max(0, persistenceEmitHold - 1);
  }

  function emitPersistenceSnapshot(): void {
    if (
      persistenceEmitHold > 0 ||
      !persistenceNotificationsEnabled ||
      applyingPersistenceSnapshot ||
      (!options.onPersistenceChange && !options.onPersistenceSnapshot)
    ) {
      return;
    }
    try {
      observePersistenceResult(
        options.onPersistenceChange
          ? options.onPersistenceChange()
          : options.onPersistenceSnapshot!(capturePersistenceSnapshot())
      );
    } catch {
      reportPersistenceError();
    }
  }

  function runPersistenceBatch<T>(operation: () => T): T {
    persistenceBatchDepth += 1;
    try {
      return operation();
    } finally {
      persistenceBatchDepth -= 1;
      if (persistenceBatchDepth === 0 && persistenceBatchChanged) {
        persistenceBatchChanged = false;
        emitPersistenceSnapshot();
      }
    }
  }

  async function restorePersistenceSnapshot(
    snapshot: unknown
  ): Promise<boolean> {
    const parsed = parseAgentConversationPersistenceSnapshot(snapshot);
    if (!parsed) return false;
    const expectedRevision = persistenceMutationRevision;

    // Yield once so edits made while an asynchronously loaded snapshot is
    // being handed to the controller win over the older persisted state.
    await Promise.resolve();
    if (!persistenceNotificationsEnabled) return false;
    if (
      expectedRevision !== 0 ||
      persistenceMutationRevision !== expectedRevision ||
      storedEnvelope !== undefined ||
      options.initialMessages?.length ||
      messages.value.length > 0 ||
      draft.value.length > 0 ||
      storedConversations.value.length > 0 ||
      isBusy.value
    ) {
      storedConversations.value = preserveLoadedConversations(
        capturePersistenceSnapshot(),
        parsed
      );
      return false;
    }

    applyingPersistenceSnapshot = true;
    try {
      resetTransientConversationState();
      storedConversations.value = parsed.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map(cloneMessage)
      }));
      const active = storedConversations.value.find(
        (conversation) => conversation.sessionId === parsed.activeSessionId
      );
      const restoredTimestamp =
        active?.updatedAt ?? nextConversationTimestamp();
      conversationClock = Math.max(
        conversationClock,
        ...storedConversations.value.map((conversation) =>
          Date.parse(conversation.updatedAt)
        )
      );
      sessionId.value = active?.sessionId ?? parsed.activeSessionId;
      messages.value = (active?.messages ?? []).map(cloneMessage);
      draft.value = active?.draft ?? "";
      approvalMode.value = active?.approvalMode ?? "request-approval";
      temperature.value = active?.temperature ?? 0.7;
      currentCreatedAt.value = active?.createdAt ?? restoredTimestamp;
      currentUpdatedAt.value = restoredTimestamp;
      persistenceMutationRevision = 0;
      persistenceBatchChanged = false;
    } finally {
      applyingPersistenceSnapshot = false;
    }
    return true;
  }

  const stopPersistenceWatch = watchConversationPersistence(
    messages,
    [
      sessionId,
      draft,
      approvalMode,
      selectedModelId,
      thinkingLevel,
      temperature,
      webSearchEnabled
    ],
    () => {
      if (
        applyingPersistenceSnapshot ||
        !persistenceNotificationsEnabled ||
        persistenceEmitHold > 0
      ) {
        return;
      }
      persistenceMutationRevision += 1;
      currentUpdatedAt.value = nextConversationTimestamp();
      if (persistenceBatchDepth > 0) {
        persistenceBatchChanged = true;
        return;
      }
      emitPersistenceSnapshot();
    }
  );

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      globalThis.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function assistantMessageForRun(runId: string): ChatMessage | undefined {
    const mappedMessageId = runMessageIds.get(runId);
    return (
      (mappedMessageId
        ? messages.value.find(
            (message) =>
              message.id === mappedMessageId &&
              message.role === "assistant" &&
              message.runId === runId
          )
        : undefined) ??
      messages.value.find(
        (message) => message.role === "assistant" && message.runId === runId
      )
    );
  }

  function subagentTurnKey(runId: string, subagentRunId: string): string {
    return `${runId}\u0000${subagentRunId}`;
  }

  function clearRetryStateForRun(runId: string): void {
    turnCheckpointByRun.delete(runId);
    const message = assistantMessageForRun(runId);
    if (message?.retry) delete message.retry;
    for (const run of message?.subagentRuns ?? []) {
      if (run.retry) delete run.retry;
      subagentTurnCheckpointByRun.delete(
        subagentTurnKey(runId, run.subagentRunId)
      );
    }
  }

  function finalizeRunningSubagents(
    message: ChatMessage,
    status: "error" | "stopped",
    completedAt: string,
    reason: string
  ): void {
    for (const run of message.subagentRuns ?? []) {
      if (run.status !== "running") continue;
      run.status = status;
      run.completedAt = completedAt;
      run.errorMessage = reason;
      for (const toolCall of run.toolCalls) {
        if (toolCall.status !== "preparing" && toolCall.status !== "running") {
          continue;
        }
        toolCall.status = "error";
        toolCall.completedAt = completedAt;
        toolCall.resultSummary ??= reason;
        toolCall.isError = true;
      }
    }
  }

  function markRunError(
    runId: string,
    messageText: string,
    eventRuntime?: AgentRuntimeRef
  ): void {
    flushPendingAgentTextDelta();
    const messageId = runMessageIds.get(runId) ?? `${runId}_assistant`;
    let message = messages.value.find(
      (item) =>
        item.id === messageId &&
        item.role === "assistant" &&
        item.runId === runId
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
      message = messages.value.find((item) => item.id === messageId)!;
      runMessageIds.set(runId, message.id);
    }
    message.status = "error";
    message.errorMessage = messageText;
    const completedAt = new Date().toISOString();
    finalizeRunningSubagents(message, "error", completedAt, messageText);
    finalizeUnfinishedMessageTools(message, completedAt, messageText);
    if (message.processingStartedAt) {
      message.processingCompletedAt = completedAt;
    }
    clearRetryStateForRun(runId);
    rememberBounded(finishedRunIds, runId);
  }

  function markRunStopped(runId: string, eventRuntime?: AgentRuntimeRef): void {
    flushPendingAgentTextDelta();
    const messageId = runMessageIds.get(runId) ?? `${runId}_assistant`;
    let message = messages.value.find(
      (item) =>
        item.id === messageId &&
        item.role === "assistant" &&
        item.runId === runId
    );
    if (!message) {
      message = {
        id: messages.value.some((item) => item.id === messageId)
          ? `${messageId}_${id("stopped")}`
          : messageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        runId,
        status: "stopped",
        ...(eventRuntime ? { runtime: eventRuntime } : {})
      };
      messages.value.push(message);
      message = messages.value.find((item) => item.id === messageId)!;
      runMessageIds.set(runId, message.id);
    }
    message.status = "stopped";
    const completedAt = new Date().toISOString();
    finalizeRunningSubagents(
      message,
      "stopped",
      completedAt,
      "父智能体运行已停止，子任务同步停止。"
    );
    finalizeUnfinishedMessageTools(
      message,
      completedAt,
      "智能体运行已停止，工具调用未返回完整终态。"
    );
    if (message.processingStartedAt) {
      message.processingCompletedAt = completedAt;
    }
    clearRetryStateForRun(runId);
    rememberBounded(finishedRunIds, runId);
  }

  function invalidateAttemptForRun(runId: string): void {
    for (const [attemptId, observedRunId] of observedRunByAttempt) {
      if (observedRunId !== runId) {
        continue;
      }
      observedRunByAttempt.delete(attemptId);
      approvalModeByAttempt.delete(attemptId);
      if (pendingAttemptId.value === attemptId) {
        pendingAttemptId.value = null;
      }
    }
  }

  function scheduleIdleTimeout(scope: IdleTimeoutScope): void {
    clearIdleTimer();
    idleTimer = globalThis.setTimeout(
      () => {
        idleTimer = undefined;
        expireIdleConversation(
          {
            epoch,
            sessionId,
            activeRunId,
            pendingAttemptId,
            messages,
            runtime,
            observedRunByAttempt,
            approvalModeByAttempt,
            submitting,
            stopping,
            conversationError
          },
          scope,
          (runId, message, eventRuntime) => {
            markRunError(runId, message, eventRuntime);
            invalidateAttemptForRun(runId);
          }
        );
      },
      options.idleTimeoutMs ?? 5 * 60_000
    );
  }

  function failProtocol(
    runId: string,
    messageText: string,
    eventRuntime?: AgentRuntimeRef
  ): void {
    markRunError(runId, messageText, eventRuntime);
    invalidateAttemptForRun(runId);
    if (activeRunId.value === runId) {
      activeRunId.value = null;
    }
    submitting.value = false;
    stopping.value = false;
    conversationError.value = messageText;
    clearIdleTimer();
  }

  function ensureAssistantMessage(
    runId: string,
    messageId: string,
    eventRuntime?: AgentRuntimeRef,
    createdAt = new Date().toISOString()
  ): ChatMessage | undefined {
    const mappedMessageId = runMessageIds.get(runId);
    if (mappedMessageId && mappedMessageId !== messageId) {
      const placeholder = messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId &&
          message.activityOnly
      );
      if (
        !placeholder ||
        messages.value.some((message) => message.id === messageId)
      ) {
        failProtocol(
          runId,
          "智能体为同一运行返回了不一致的消息标识。",
          eventRuntime
        );
        return undefined;
      }
      placeholder.id = messageId;
      placeholder.activityOnly = false;
      if (eventRuntime) {
        placeholder.runtime = eventRuntime;
      }
      runMessageIds.set(runId, messageId);
      return placeholder;
    }

    const existing = messages.value.find((message) => message.id === messageId);
    if (existing) {
      if (existing.role !== "assistant" || existing.runId !== runId) {
        failProtocol(runId, "智能体消息标识与现有消息发生冲突。", eventRuntime);
        return undefined;
      }
      runMessageIds.set(runId, messageId);
      existing.activityOnly = false;
      if (eventRuntime) {
        existing.runtime = eventRuntime;
      }
      return existing;
    }

    const message: ChatMessage = {
      id: messageId,
      role: "assistant",
      content: "",
      createdAt,
      runId,
      status: "streaming",
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    runMessageIds.set(runId, messageId);
    messages.value.push(message);
    return messages.value.find((candidate) => candidate.id === messageId)!;
  }

  function retryMetadata(input: {
    state: AgentRetryMetadata["state"];
    turnId: string;
    attempt: number;
    maxAttempts: number;
    retryAt?: string;
    delayMs?: number;
    reason?: string;
  }): AgentRetryMetadata {
    return {
      state: input.state,
      turnId: input.turnId,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      ...(input.retryAt ? { retryAt: input.retryAt } : {}),
      ...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
      ...(input.reason ? { reason: input.reason } : {})
    };
  }

  function restoreMessageCheckpoint(
    runId: string,
    messageId: string,
    checkpoint: AgentTurnCheckpoint,
    retry: AgentRetryMetadata,
    eventRuntime: AgentRuntimeRef,
    eventTimestamp: string
  ): ChatMessage | undefined {
    const current = ensureAssistantMessage(
      runId,
      messageId,
      eventRuntime,
      eventTimestamp
    );
    if (!current) return undefined;
    const index = messages.value.indexOf(current);
    if (index < 0) return undefined;

    const restored = checkpoint.message
      ? cloneMessage(checkpoint.message)
      : {
          id: current.id,
          role: "assistant" as const,
          content: "",
          createdAt: current.createdAt,
          runId,
          status: "streaming" as const,
          runtime: { ...eventRuntime }
        };
    preserveLiveEditProposals(current, restored);
    restored.status = "streaming";
    restored.runtime = { ...eventRuntime };
    restored.retry = retry;
    delete restored.errorMessage;
    delete restored.processingCompletedAt;
    messages.value.splice(index, 1, restored);
    runMessageIds.set(runId, restored.id);
    return restored;
  }

  function handleTurnStarted(
    event: Extract<SystemEventEnvelope, { type: "agent.turn_started" }>
  ): void {
    const {
      runId,
      messageId,
      turnId,
      attempt,
      maxAttempts,
      runtime: eventRuntime
    } = event.payload;
    const turnKey = `${runId}\u0000${turnId}`;
    let checkpoint = turnCheckpointByRun.get(runId);

    if (!checkpoint || checkpoint.turnId !== turnId) {
      if (seenTurnIds.has(turnKey)) return;
      const existing = assistantMessageForRun(runId);
      const snapshot = existing ? cloneMessage(existing) : null;
      if (snapshot?.retry) delete snapshot.retry;
      checkpoint = {
        turnId,
        messageId,
        attempt,
        maxAttempts,
        attemptStartedAt: event.timestamp,
        message: snapshot
      };
      turnCheckpointByRun.set(runId, checkpoint);
      rememberBounded(seenTurnIds, turnKey);
    } else {
      if (attempt <= checkpoint.attempt) return;
      checkpoint.attempt = attempt;
      checkpoint.maxAttempts = maxAttempts;
      checkpoint.attemptStartedAt = event.timestamp;
    }

    let message = ensureAssistantMessage(
      runId,
      messageId,
      eventRuntime,
      event.timestamp
    );
    if (!message) return;
    if (attempt > 1) {
      message = restoreMessageCheckpoint(
        runId,
        messageId,
        checkpoint,
        retryMetadata({
          state: "trying",
          turnId,
          attempt,
          maxAttempts
        }),
        eventRuntime,
        event.timestamp
      );
    }
    if (message) {
      message.status = "streaming";
      message.runtime = { ...eventRuntime };
      message.processingStartedAt ??= event.timestamp;
    }
  }

  function handleRetryScheduled(
    event: Extract<SystemEventEnvelope, { type: "agent.retry_scheduled" }>
  ): void {
    const {
      runId,
      messageId,
      turnId,
      failedAttempt,
      nextAttempt,
      maxAttempts,
      delayMs,
      retryAt,
      reason,
      runtime: eventRuntime
    } = event.payload;
    const checkpoint = turnCheckpointByRun.get(runId);
    if (
      !checkpoint ||
      checkpoint.turnId !== turnId ||
      checkpoint.attempt !== failedAttempt
    ) {
      return;
    }
    restoreMessageCheckpoint(
      runId,
      messageId,
      checkpoint,
      retryMetadata({
        state: "scheduled",
        turnId,
        attempt: nextAttempt,
        maxAttempts,
        retryAt,
        delayMs,
        reason
      }),
      eventRuntime,
      event.timestamp
    );
    conversationError.value = null;
  }

  function acceptsRetryActivity(
    runId: string,
    eventTimestamp: string
  ): boolean {
    const message = assistantMessageForRun(runId);
    if (!message?.retry) return true;
    if (message.retry.state === "scheduled") return false;
    const checkpoint = turnCheckpointByRun.get(runId);
    if (
      checkpoint &&
      Date.parse(eventTimestamp) < Date.parse(checkpoint.attemptStartedAt)
    ) {
      return false;
    }
    delete message.retry;
    return true;
  }

  function ensureActivityMessage(
    runId: string,
    eventRuntime: AgentRuntimeRef,
    createdAt: string
  ): ChatMessage {
    const mappedMessageId = runMessageIds.get(runId);
    const existing = mappedMessageId
      ? messages.value.find(
          (message) =>
            message.id === mappedMessageId &&
            message.role === "assistant" &&
            message.runId === runId
        )
      : undefined;
    if (existing) {
      existing.runtime = eventRuntime;
      return existing;
    }

    const message: ChatMessage = {
      id: `${runId}_assistant`,
      role: "assistant",
      content: "",
      createdAt,
      runId,
      status: "streaming",
      runtime: eventRuntime,
      activityOnly: true,
      toolCalls: [],
      processingSteps: []
    };
    runMessageIds.set(runId, message.id);
    messages.value.push(message);
    return messages.value.find((candidate) => candidate.id === message.id)!;
  }

  function ensureSubagentMessage(
    runId: string,
    createdAt: string
  ): ChatMessage {
    const mappedMessageId = runMessageIds.get(runId);
    const existing = mappedMessageId
      ? messages.value.find(
          (message) =>
            message.id === mappedMessageId &&
            message.role === "assistant" &&
            message.runId === runId
        )
      : messages.value.find(
          (message) => message.role === "assistant" && message.runId === runId
        );
    if (existing) {
      runMessageIds.set(runId, existing.id);
      return existing;
    }

    const preferredId = `${runId}_assistant`;
    const message: ChatMessage = {
      id: messages.value.some((candidate) => candidate.id === preferredId)
        ? `${preferredId}_${id("subagent")}`
        : preferredId,
      role: "assistant",
      content: "",
      createdAt,
      runId,
      status: "streaming",
      activityOnly: true,
      toolCalls: [],
      processingSteps: [],
      subagentRuns: []
    };
    runMessageIds.set(runId, message.id);
    messages.value.push(message);
    return messages.value.find((candidate) => candidate.id === message.id)!;
  }

  function earlierTimestamp(current: string, candidate: string): string {
    const currentTime = Date.parse(current);
    const candidateTime = Date.parse(candidate);
    if (!Number.isFinite(currentTime)) return candidate;
    if (!Number.isFinite(candidateTime)) return current;
    return candidateTime < currentTime ? candidate : current;
  }

  function ensurePendingSubagentRunForTool(
    message: ChatMessage,
    toolCallId: string,
    args: unknown,
    eventRuntime: AgentRuntimeRef,
    eventTimestamp: string
  ): void {
    if (
      message.subagentRuns?.some((run) => run.parentToolCallId === toolCallId)
    ) {
      return;
    }
    const record = isRecord(args) ? args : {};
    const subagentId =
      typeof record.subagent_id === "string" && record.subagent_id.trim()
        ? record.subagent_id.trim()
        : "subagent";
    const task =
      typeof record.task === "string" && record.task.trim()
        ? record.task.trim()
        : "正在接收子任务…";
    (message.subagentRuns ??= []).push({
      parentToolCallId: toolCallId,
      subagentRunId: `pending:${toolCallId}`,
      subagentId,
      name: subagentId,
      task,
      status: "running",
      runtime: { ...eventRuntime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp
    });
  }

  function ensureSubagentRun(
    message: ChatMessage,
    payload: SubagentEventPayload,
    eventTimestamp: string,
    task?: string
  ): AgentSubagentRun {
    let run = message.subagentRuns?.find(
      (candidate) => candidate.subagentRunId === payload.subagentRunId
    );
    run ??= message.subagentRuns?.find(
      (candidate) =>
        candidate.parentToolCallId === payload.parentToolCallId &&
        candidate.subagentRunId.startsWith("pending:")
    );
    if (!run) {
      run = {
        parentToolCallId: payload.parentToolCallId,
        subagentRunId: payload.subagentRunId,
        subagentId: payload.subagentId,
        name: payload.name,
        task: task ?? "正在接收子任务…",
        status: "running",
        runtime: { ...payload.runtime },
        toolCalls: [],
        processingSteps: [],
        startedAt: eventTimestamp
      };
      (message.subagentRuns ??= []).push(run);
      return run;
    }

    run.subagentRunId = payload.subagentRunId;
    run.parentToolCallId = payload.parentToolCallId;
    run.subagentId = payload.subagentId;
    run.name = payload.name;
    run.runtime = { ...payload.runtime };
    run.startedAt = earlierTimestamp(run.startedAt, eventTimestamp);
    if (task !== undefined) {
      run.task = task;
    }
    return run;
  }

  function restoreSubagentCheckpoint(
    run: AgentSubagentRun,
    checkpoint: SubagentTurnCheckpoint,
    retry: AgentRetryMetadata,
    eventRuntime: AgentRuntimeRef
  ): void {
    const restored = cloneSubagentRun(checkpoint.run);
    for (const key of [
      "thinking",
      "output",
      "completedAt",
      "summary",
      "errorMessage",
      "usage",
      "retry"
    ] as const) {
      delete run[key];
    }
    Object.assign(run, restored);
    run.status = "running";
    run.runtime = { ...eventRuntime };
    run.retry = retry;
  }

  function handleSubagentTurnStarted(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun,
    activity: Extract<
      SubagentActivityEventEnvelope["payload"]["activity"],
      { type: "turn_started" }
    >
  ): void {
    const key = subagentTurnKey(
      event.payload.runId,
      event.payload.subagentRunId
    );
    const seenKey = `${key}\u0000${activity.turnId}`;
    let checkpoint = subagentTurnCheckpointByRun.get(key);
    if (!checkpoint || checkpoint.turnId !== activity.turnId) {
      if (seenSubagentTurnIds.has(seenKey)) return;
      const snapshot = cloneSubagentRun(run);
      if (snapshot.retry) delete snapshot.retry;
      checkpoint = {
        turnId: activity.turnId,
        attempt: activity.attempt,
        maxAttempts: activity.maxAttempts,
        attemptStartedAt: event.timestamp,
        run: snapshot
      };
      subagentTurnCheckpointByRun.set(key, checkpoint);
      rememberBounded(seenSubagentTurnIds, seenKey);
    } else {
      if (activity.attempt <= checkpoint.attempt) return;
      checkpoint.attempt = activity.attempt;
      checkpoint.maxAttempts = activity.maxAttempts;
      checkpoint.attemptStartedAt = event.timestamp;
    }
    if (activity.attempt > 1) {
      restoreSubagentCheckpoint(
        run,
        checkpoint,
        retryMetadata({
          state: "trying",
          turnId: activity.turnId,
          attempt: activity.attempt,
          maxAttempts: activity.maxAttempts
        }),
        event.payload.runtime
      );
    }
  }

  function handleSubagentRetryScheduled(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun,
    activity: Extract<
      SubagentActivityEventEnvelope["payload"]["activity"],
      { type: "retry_scheduled" }
    >
  ): void {
    const key = subagentTurnKey(
      event.payload.runId,
      event.payload.subagentRunId
    );
    const checkpoint = subagentTurnCheckpointByRun.get(key);
    if (
      !checkpoint ||
      checkpoint.turnId !== activity.turnId ||
      checkpoint.attempt !== activity.failedAttempt
    ) {
      return;
    }
    restoreSubagentCheckpoint(
      run,
      checkpoint,
      retryMetadata({
        state: "scheduled",
        turnId: activity.turnId,
        attempt: activity.nextAttempt,
        maxAttempts: activity.maxAttempts,
        retryAt: activity.retryAt,
        delayMs: activity.delayMs,
        reason: activity.reason
      }),
      event.payload.runtime
    );
  }

  function acceptsSubagentRetryActivity(
    event: SubagentActivityEventEnvelope,
    run: AgentSubagentRun
  ): boolean {
    if (!run.retry) return true;
    if (run.retry.state === "scheduled") return false;
    const checkpoint = subagentTurnCheckpointByRun.get(
      subagentTurnKey(event.payload.runId, event.payload.subagentRunId)
    );
    if (
      checkpoint &&
      Date.parse(event.timestamp) < Date.parse(checkpoint.attemptStartedAt)
    ) {
      return false;
    }
    delete run.retry;
    return true;
  }

  function handleSubagentEvent(event: SubagentEventEnvelope): void {
    const message = ensureSubagentMessage(event.payload.runId, event.timestamp);
    message.processingStartedAt ??= event.timestamp;
    const run = ensureSubagentRun(
      message,
      event.payload,
      event.timestamp,
      event.type === "subagent.started" ? event.payload.task : undefined
    );

    if (
      event.type !== "subagent.completed" &&
      run.status === "running" &&
      (message.status === "stopped" || message.status === "error")
    ) {
      run.status = message.status;
      run.completedAt = message.processingCompletedAt ?? event.timestamp;
      run.errorMessage =
        message.status === "stopped"
          ? "父智能体运行已停止，子任务同步停止。"
          : (message.errorMessage ?? "父智能体运行异常结束，子任务同步停止。");
    }

    if (event.type === "subagent.started") {
      return;
    }

    if (event.type === "subagent.activity") {
      const activity = event.payload.activity;
      if (activity.type === "turn_started") {
        if (run.status === "running") {
          handleSubagentTurnStarted(event, run, activity);
        }
        return;
      }

      if (activity.type === "retry_scheduled") {
        if (run.status === "running") {
          handleSubagentRetryScheduled(event, run, activity);
        }
        return;
      }

      if (!acceptsSubagentRetryActivity(event, run)) return;
      if (activity.type === "thinking_delta") {
        run.thinking = `${run.thinking ?? ""}${activity.delta}`;
        const lastStep = run.processingSteps.at(-1);
        if (lastStep?.type === "thinking") {
          lastStep.content += activity.delta;
        } else {
          run.processingSteps.push({
            id: event.id,
            type: "thinking",
            content: activity.delta,
            createdAt: event.timestamp
          });
        }
        return;
      }

      if (activity.type === "message_delta") {
        run.output = `${run.output ?? ""}${activity.delta}`;
        const lastStep = run.processingSteps.at(-1);
        if (lastStep?.type === "response") {
          lastStep.content += activity.delta;
        } else {
          run.processingSteps.push({
            id: event.id,
            type: "response",
            content: activity.delta,
            createdAt: event.timestamp
          });
        }
        return;
      }

      let toolCall = run.toolCalls.find(
        (candidate) => candidate.id === activity.toolCallId
      );
      if (activity.type === "tool_requested") {
        if (toolCall) {
          toolCall.name = activity.toolName;
          toolCall.args = activity.args;
          toolCall.requestedAt = earlierTimestamp(
            toolCall.requestedAt,
            event.timestamp
          );
          if (toolCall.status !== "completed" && toolCall.status !== "error") {
            toolCall.status = "running";
          }
        } else {
          const terminalStatus =
            run.status === "completed" ? "completed" : "error";
          toolCall = {
            id: activity.toolCallId,
            name: activity.toolName,
            args: activity.args,
            status: run.status === "running" ? "running" : terminalStatus,
            requestedAt: event.timestamp,
            ...(run.status === "running"
              ? {}
              : {
                  completedAt: run.completedAt ?? event.timestamp,
                  ...(terminalStatus === "error"
                    ? {
                        resultSummary: run.errorMessage ?? "子任务已经结束。",
                        isError: true
                      }
                    : {})
                })
          };
          run.toolCalls.push(toolCall);
        }
        if (
          !run.processingSteps.some(
            (step) =>
              step.type === "tool" && step.toolCallId === activity.toolCallId
          )
        ) {
          run.processingSteps.push({
            id: event.id,
            type: "tool",
            toolCallId: activity.toolCallId,
            createdAt: event.timestamp
          });
        }
        return;
      }

      if (!toolCall) {
        toolCall = {
          id: activity.toolCallId,
          name: activity.toolName,
          args: undefined,
          status: activity.isError ? "error" : "completed",
          requestedAt: event.timestamp
        };
        run.toolCalls.push(toolCall);
      }
      if (
        !run.processingSteps.some(
          (step) =>
            step.type === "tool" && step.toolCallId === activity.toolCallId
        )
      ) {
        run.processingSteps.push({
          id: event.id,
          type: "tool",
          toolCallId: activity.toolCallId,
          createdAt: event.timestamp
        });
      }
      toolCall.name = activity.toolName;
      toolCall.status = activity.isError ? "error" : "completed";
      toolCall.completedAt = event.timestamp;
      toolCall.resultSummary = activity.resultSummary;
      toolCall.isError = activity.isError;
      return;
    }

    run.status =
      event.payload.status === "aborted" ? "stopped" : event.payload.status;
    delete run.retry;
    subagentTurnCheckpointByRun.delete(
      subagentTurnKey(event.payload.runId, event.payload.subagentRunId)
    );
    run.completedAt = event.timestamp;
    run.summary = event.payload.summary;
    if (event.payload.errorMessage !== undefined) {
      run.errorMessage = event.payload.errorMessage;
    } else {
      delete run.errorMessage;
    }
    if (event.payload.usage !== undefined) {
      run.usage = { ...event.payload.usage };
    } else {
      delete run.usage;
    }
    for (const toolCall of run.toolCalls) {
      if (toolCall.status !== "preparing" && toolCall.status !== "running") {
        continue;
      }
      toolCall.status = run.status === "completed" ? "completed" : "error";
      toolCall.completedAt = event.timestamp;
      if (run.status !== "completed") {
        toolCall.resultSummary ??= "子任务结束前未返回工具结果。";
        toolCall.isError = true;
      }
    }
  }

  function finishRun(runId: string): void {
    clearRetryStateForRun(runId);
    rememberBounded(finishedRunIds, runId);
    if (activeRunId.value === runId) {
      activeRunId.value = null;
    }
    submitting.value = false;
    stopping.value = false;
    userInput.clear(runId);
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

  function rememberRunApprovalMode(
    runId: string,
    mode: AgentApprovalMode
  ): void {
    approvalModeByRun.set(runId, mode);
    while (approvalModeByRun.size > 2_000) {
      const oldest = approvalModeByRun.keys().next().value as
        string | undefined;
      if (!oldest) break;
      approvalModeByRun.delete(oldest);
    }
  }

  function approvalModeForRun(
    eventSessionId: string,
    runId: string
  ): AgentApprovalMode | undefined {
    if (eventSessionId !== sessionId.value) return undefined;
    const knownMode = approvalModeByRun.get(runId);
    if (knownMode) return knownMode;
    const attemptId = pendingAttemptId.value;
    if (attemptId === null) return undefined;
    const observedRunId = observedRunByAttempt.get(attemptId);
    if (observedRunId && observedRunId !== runId) return undefined;
    const pendingMode = approvalModeByAttempt.get(attemptId);
    if (pendingMode) rememberRunApprovalMode(runId, pendingMode);
    return pendingMode;
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
    const tool = message?.tools?.find(
      (candidate) => candidate.id === toolCallId
    );
    if (tool) {
      tool.status = "error";
      tool.summary = summary;
    }
    const toolCall = message?.toolCalls?.find(
      (candidate) => candidate.id === toolCallId
    );
    if (toolCall) {
      toolCall.status = "error";
      toolCall.resultSummary = summary;
      toolCall.isError = true;
    }
    for (const subagentRun of message?.subagentRuns ?? []) {
      const subagentToolCall = subagentRun.toolCalls.find(
        (candidate) => candidate.id === toolCallId
      );
      if (!subagentToolCall) continue;
      subagentToolCall.status = "error";
      subagentToolCall.completedAt ??= new Date().toISOString();
      subagentToolCall.resultSummary = summary;
      subagentToolCall.isError = true;
    }
  }

  function messageForEditProposal(runId: string): ChatMessage | undefined {
    const mappedMessageId = runMessageIds.get(runId);
    const mapped = mappedMessageId
      ? messages.value.find(
          (message) =>
            message.id === mappedMessageId &&
            message.role === "assistant" &&
            message.runId === runId
        )
      : undefined;
    return (
      mapped ??
      messages.value.find(
        (message) => message.role === "assistant" && message.runId === runId
      )
    );
  }

  function ensureEditProposalMessage(
    runId: string,
    createdAt: string
  ): ChatMessage {
    const existing = messageForEditProposal(runId);
    if (existing) return existing;

    const preferredId = `${runId}_assistant`;
    const message: ChatMessage = {
      id: messages.value.some((candidate) => candidate.id === preferredId)
        ? `${preferredId}_${id("proposal")}`
        : preferredId,
      role: "assistant",
      content: "",
      createdAt,
      runId,
      status: activeRunId.value === runId ? "streaming" : "completed",
      activityOnly: true,
      editProposals: []
    };
    messages.value.push(message);
    runMessageIds.set(runId, message.id);
    return messages.value.find((candidate) => candidate.id === message.id)!;
  }

  function getEditProposal(
    runId: string,
    proposalId: string
  ): AgentEditProposal | undefined {
    const proposal = messageForEditProposal(runId)?.editProposals?.find(
      (candidate) => candidate.id === proposalId
    );
    return proposal ? cloneEditProposal(proposal) : undefined;
  }

  function listEditProposals(runId: string): AgentEditProposal[] {
    return (messageForEditProposal(runId)?.editProposals ?? []).map(
      cloneEditProposal
    );
  }

  function upsertEditProposal(
    runId: string,
    proposal: AgentEditProposal
  ): AgentEditProposal {
    const normalized = cloneEditProposal({ ...proposal, runId });
    const message = ensureEditProposalMessage(runId, normalized.createdAt);
    const proposals = message.editProposals ?? [];
    const existingIndex = proposals.findIndex(
      (candidate) => candidate.id === normalized.id
    );
    if (existingIndex >= 0) {
      proposals[existingIndex] = normalized;
      message.editProposals = proposals;
    } else {
      message.editProposals = [...proposals, normalized];
    }
    return cloneEditProposal(normalized);
  }

  function updateEditProposal(
    runId: string,
    proposalId: string,
    patch: Partial<AgentEditProposal>
  ): AgentEditProposal | undefined {
    const message = messageForEditProposal(runId);
    const proposalIndex =
      message?.editProposals?.findIndex(
        (candidate) => candidate.id === proposalId
      ) ?? -1;
    if (!message?.editProposals || proposalIndex < 0) return undefined;

    const existing = message.editProposals[proposalIndex]!;
    const next = cloneEditProposal({
      ...existing,
      ...patch,
      id: existing.id,
      runId: existing.runId,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    });
    message.editProposals[proposalIndex] = next;
    return cloneEditProposal(next);
  }

  function clearStreamPresentationSchedule(): void {
    if (streamPresentationFrame !== undefined) {
      globalThis.cancelAnimationFrame?.(streamPresentationFrame);
      streamPresentationFrame = undefined;
    }
    if (streamPresentationFallbackTimer !== undefined) {
      globalThis.clearTimeout(streamPresentationFallbackTimer);
      streamPresentationFallbackTimer = undefined;
    }
  }

  function applyAgentTextDelta(pending: PendingAgentTextDelta): void {
    const delta = pending.chunks.join("");
    const message = ensureAssistantMessage(
      pending.runId,
      pending.messageId,
      pending.runtime,
      pending.createdAt
    );
    if (!message) return;

    message.processingStartedAt ??= pending.createdAt;
    const lastStep = message.processingSteps?.at(-1);
    if (pending.type === "agent.message_delta") {
      message.content += delta;
      if (lastStep?.type === "response") {
        lastStep.content += delta;
      } else {
        (message.processingSteps ??= []).push({
          id: pending.eventId,
          type: "response",
          content: delta,
          createdAt: pending.createdAt
        });
      }
      return;
    }

    if (lastStep?.type === "thinking") {
      lastStep.content += delta;
      message.thinking = `${message.thinking ?? ""}${delta}`;
    } else {
      (message.processingSteps ??= []).push({
        id: pending.eventId,
        type: "thinking",
        content: delta,
        createdAt: pending.createdAt
      });
      message.thinking = message.thinking
        ? `${message.thinking}\n\n${delta}`
        : delta;
    }
  }

  function flushPendingAgentTextDelta(): void {
    clearStreamPresentationSchedule();
    const pending = pendingAgentTextDelta;
    pendingAgentTextDelta = undefined;
    if (pending) applyAgentTextDelta(pending);
  }

  function scheduleStreamPresentation(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      flushPendingAgentTextDelta();
      return;
    }
    if (
      streamPresentationFrame !== undefined ||
      streamPresentationFallbackTimer !== undefined
    ) {
      return;
    }

    streamPresentationFrame = globalThis.requestAnimationFrame(() => {
      streamPresentationFrame = undefined;
      if (streamPresentationFallbackTimer !== undefined) {
        globalThis.clearTimeout(streamPresentationFallbackTimer);
        streamPresentationFallbackTimer = undefined;
      }
      flushPendingAgentTextDelta();
    });
    // requestAnimationFrame is paused for hidden Electron windows. Keep a
    // bounded fallback so the complete stream still reaches state/persistence.
    streamPresentationFallbackTimer = globalThis.setTimeout(() => {
      streamPresentationFallbackTimer = undefined;
      if (streamPresentationFrame !== undefined) {
        globalThis.cancelAnimationFrame(streamPresentationFrame);
        streamPresentationFrame = undefined;
      }
      flushPendingAgentTextDelta();
    }, STREAM_PRESENTATION_FALLBACK_MS);
  }

  function queueAgentTextDelta(event: AgentTextDeltaEventEnvelope): void {
    const { runId, messageId, runtime: eventRuntime, delta } = event.payload;
    const pending = pendingAgentTextDelta;
    const sharesPendingStep =
      pending?.type === event.type &&
      pending.runId === runId &&
      pending.messageId === messageId;
    if (!sharesPendingStep) {
      flushPendingAgentTextDelta();
      pendingAgentTextDelta = {
        type: event.type,
        runId,
        messageId,
        runtime: eventRuntime,
        eventId: event.id,
        createdAt: event.timestamp,
        chunks: [delta]
      };
    } else if (pending) {
      pending.chunks.push(delta);
      pending.runtime = eventRuntime;
    }
    scheduleStreamPresentation();
  }

  function handleEvent(event: SystemEventEnvelope): void {
    if (!isAgentEvent(event) || event.payload.sessionId !== sessionId.value) {
      return;
    }
    if (handledEventIds.has(event.id)) {
      return;
    }

    const runId = event.payload.runId;
    const subagentEvent = isSubagentEvent(event);
    const lateSubagentEvent =
      subagentEvent &&
      finishedRunIds.has(runId) &&
      messages.value.some(
        (message) => message.role === "assistant" && message.runId === runId
      );
    const lateEvaluationSnapshot =
      event.type === "agent.evaluation_snapshot" &&
      finishedRunIds.has(runId) &&
      messages.value.some(
        (message) => message.role === "assistant" && message.runId === runId
      );
    if (
      finishedRunIds.has(runId) &&
      !lateSubagentEvent &&
      !lateEvaluationSnapshot
    ) {
      return;
    }
    if (
      activeRunId.value &&
      activeRunId.value !== runId &&
      !lateSubagentEvent &&
      !lateEvaluationSnapshot
    ) {
      return;
    }
    if (!activeRunId.value && !lateSubagentEvent && !lateEvaluationSnapshot) {
      if (pendingAttemptId.value === null) {
        return;
      }
      const observedRunId = observedRunByAttempt.get(pendingAttemptId.value);
      if (observedRunId && observedRunId !== runId) {
        failProtocol(
          observedRunId,
          "同一次请求收到了多个运行标识。",
          runtime.value ?? undefined
        );
        return;
      }
      observedRunByAttempt.set(pendingAttemptId.value, runId);
      const pendingMode = approvalModeByAttempt.get(pendingAttemptId.value);
      if (pendingMode) rememberRunApprovalMode(runId, pendingMode);
      activeRunId.value = runId;
    }

    rememberBounded(handledEventIds, event.id);
    if (!lateSubagentEvent && !lateEvaluationSnapshot) {
      submitting.value = false;
      scheduleIdleTimeout({
        expectedEpoch: epoch,
        expectedSessionId: sessionId.value,
        runId
      });
    }

    if (
      event.type !== "agent.message_delta" &&
      event.type !== "agent.thinking_delta"
    ) {
      // Terminal, retry, tool, and subagent events are ordering boundaries.
      // Settle every preceding text fragment before applying that event.
      flushPendingAgentTextDelta();
    }

    if (subagentEvent) {
      handleSubagentEvent(event);
      return;
    }

    if (event.type === "agent.user_input_requested") {
      userInput.receive(event.payload);
      clearIdleTimer();
      return;
    }

    if (
      event.type === "agent.message_delta" ||
      event.type === "agent.thinking_delta" ||
      event.type === "agent.message_completed"
    ) {
      userInput.clearSubmitted(runId);
    }

    if (event.type === "agent.evaluation_snapshot") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime,
        event.timestamp
      );
      if (message) {
        const parsedEvaluation = AgentEvaluationSnapshotSchema.safeParse(
          event.payload.snapshot
        );
        if (parsedEvaluation.success) {
          message.evaluationSnapshot = parsedEvaluation.data;
        }
      }
      return;
    }

    if (event.type === "agent.turn_started") {
      handleTurnStarted(event);
      return;
    }

    if (event.type === "agent.retry_scheduled") {
      handleRetryScheduled(event);
      return;
    }

    if (
      event.type === "agent.message_delta" ||
      event.type === "agent.thinking_delta"
    ) {
      if (!acceptsRetryActivity(runId, event.timestamp)) return;
      queueAgentTextDelta(event);
      return;
    }

    if (event.type === "tool.call_stream") {
      if (!acceptsRetryActivity(runId, event.timestamp)) return;
      const message = ensureActivityMessage(
        runId,
        event.payload.runtime,
        event.timestamp
      );
      message.processingStartedAt ??= event.timestamp;
      let toolCall = event.payload.toolCallId
        ? message.toolCalls?.find(
            (candidate) => candidate.id === event.payload.toolCallId
          )
        : undefined;
      if (!toolCall) {
        const streamCandidate = message.toolCalls?.find(
          (candidate) => candidate.streamId === event.payload.streamId
        );
        const hasCompatibleIdentity =
          !event.payload.toolCallId ||
          streamCandidate?.id === event.payload.toolCallId ||
          streamCandidate?.id === event.payload.streamId;
        if (streamCandidate && hasCompatibleIdentity) {
          toolCall = streamCandidate;
        }
      }
      if (!toolCall) {
        toolCall = {
          id: event.payload.toolCallId ?? event.payload.streamId,
          streamId: event.payload.streamId,
          name: event.payload.toolName ?? "tool_call",
          args: event.payload.args,
          argumentsText: event.payload.argumentsDelta,
          argumentsComplete: event.payload.phase === "end",
          status: "preparing",
          requestedAt: event.timestamp
        };
        (message.toolCalls ??= []).push(toolCall);
        (message.processingSteps ??= []).push({
          id: event.id,
          type: "tool",
          toolCallId: toolCall.id,
          createdAt: event.timestamp
        });
      } else {
        const previousId = toolCall.id;
        toolCall.streamId = event.payload.streamId;
        toolCall.name = event.payload.toolName ?? toolCall.name;
        toolCall.argumentsText = `${toolCall.argumentsText ?? ""}${event.payload.argumentsDelta}`;
        toolCall.argumentsComplete = event.payload.phase === "end";
        if (event.payload.args !== undefined) {
          toolCall.args = event.payload.args;
        }
        if (
          event.payload.toolCallId &&
          previousId !== event.payload.toolCallId
        ) {
          toolCall.id = event.payload.toolCallId;
          for (const step of message.processingSteps ?? []) {
            if (step.type === "tool" && step.toolCallId === previousId) {
              step.toolCallId = event.payload.toolCallId;
            }
          }
        }
      }
      if (!message.tools?.some((tool) => tool.id === toolCall.id)) {
        message.tools = [
          ...(message.tools ?? []),
          {
            id: toolCall.id,
            name: toolCall.name,
            status: "running"
          }
        ];
      }
      return;
    }

    if (event.type === "tool.call_requested") {
      if (!acceptsRetryActivity(runId, event.timestamp)) return;
      const message = ensureActivityMessage(
        runId,
        event.payload.runtime,
        event.timestamp
      );
      if (event.payload.toolName === "spawn_subagent") {
        ensurePendingSubagentRunForTool(
          message,
          event.payload.toolCallId,
          event.payload.args,
          event.payload.runtime,
          event.timestamp
        );
      }
      if (
        !message.tools?.some((tool) => tool.id === event.payload.toolCallId)
      ) {
        message.tools = [
          ...(message.tools ?? []),
          {
            id: event.payload.toolCallId,
            name: event.payload.toolName,
            status: "running"
          }
        ];
      }
      message.processingStartedAt ??= event.timestamp;
      const existing =
        message.toolCalls?.find(
          (toolCall) => toolCall.id === event.payload.toolCallId
        ) ??
        [...(message.toolCalls ?? [])]
          .reverse()
          .find(
            (toolCall) =>
              toolCall.status === "preparing" &&
              toolCall.name === event.payload.toolName
          );
      if (existing) {
        const previousId = existing.id;
        existing.id = event.payload.toolCallId;
        existing.name = event.payload.toolName;
        existing.args = event.payload.args;
        existing.status = "running";
        existing.argumentsComplete = true;
        for (const step of message.processingSteps ?? []) {
          if (step.type === "tool" && step.toolCallId === previousId) {
            step.toolCallId = event.payload.toolCallId;
          }
        }
      } else {
        (message.toolCalls ??= []).push({
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          args: event.payload.args,
          status: "running",
          requestedAt: event.timestamp
        });
      }
      if (
        !message.processingSteps?.some(
          (step) =>
            step.type === "tool" && step.toolCallId === event.payload.toolCallId
        )
      ) {
        (message.processingSteps ??= []).push({
          id: event.id,
          type: "tool",
          toolCallId: event.payload.toolCallId,
          createdAt: event.timestamp
        });
      }
      return;
    }

    if (event.type === "tool.execution_completed") {
      if (!acceptsRetryActivity(runId, event.timestamp)) return;
      const message = ensureActivityMessage(
        runId,
        event.payload.runtime,
        event.timestamp
      );
      if (event.payload.toolName === "spawn_subagent") {
        const subagentRun = message.subagentRuns?.find(
          (candidate) => candidate.parentToolCallId === event.payload.toolCallId
        );
        if (subagentRun?.status === "running") {
          subagentRun.status = event.payload.isError ? "error" : "completed";
          subagentRun.completedAt = event.timestamp;
          subagentRun.summary = event.payload.resultSummary;
          if (event.payload.isError) {
            subagentRun.errorMessage = event.payload.resultSummary;
          }
        }
      }
      const tools = message.tools ?? [];
      const existingTool = tools.find(
        (tool) => tool.id === event.payload.toolCallId
      );
      if (existingTool) {
        existingTool.status = event.payload.isError ? "error" : "completed";
        existingTool.summary = event.payload.resultSummary;
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
      message.processingStartedAt ??= event.timestamp;
      let toolCall = message.toolCalls?.find(
        (item) => item.id === event.payload.toolCallId
      );
      if (!toolCall) {
        toolCall = {
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          args: undefined,
          status: event.payload.isError ? "error" : "completed",
          requestedAt: event.timestamp
        };
        (message.toolCalls ??= []).push(toolCall);
      }
      if (
        !message.processingSteps?.some(
          (step) =>
            step.type === "tool" && step.toolCallId === event.payload.toolCallId
        )
      ) {
        (message.processingSteps ??= []).push({
          id: event.id,
          type: "tool",
          toolCallId: event.payload.toolCallId,
          createdAt: event.timestamp
        });
      }
      toolCall.name = event.payload.toolName;
      toolCall.status = event.payload.isError ? "error" : "completed";
      toolCall.completedAt = event.timestamp;
      toolCall.resultSummary = event.payload.resultSummary;
      toolCall.isError = event.payload.isError;
      return;
    }

    if (event.type === "agent.message_completed") {
      if (!acceptsRetryActivity(runId, event.timestamp)) return;
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime,
        event.timestamp
      );
      if (!message) {
        return;
      }
      message.content = event.payload.content;
      if (event.payload.thinking?.trim() && !message.thinking) {
        message.thinking = event.payload.thinking;
        (message.processingSteps ??= []).push({
          id: `${event.id}_thinking`,
          type: "thinking",
          content: event.payload.thinking,
          createdAt: event.timestamp
        });
      }
      const lastStep = message.processingSteps?.at(-1);
      if (event.payload.content) {
        if (lastStep?.type === "response") {
          // The terminal payload contains the final assistant turn only. Earlier
          // response turns may have been followed by tools, so keep them as
          // separate chronological steps and replace only the final turn.
          lastStep.content = event.payload.content;
        } else {
          (message.processingSteps ??= []).push({
            id: `${event.id}_response`,
            type: "response",
            content: event.payload.content,
            createdAt: event.timestamp
          });
        }
      }
      finalizeRunningSubagents(
        message,
        "error",
        event.timestamp,
        "父智能体运行已完成，但子任务未返回完整终态。"
      );
      finalizeUnfinishedMessageTools(
        message,
        event.timestamp,
        "智能体运行已完成，但工具调用未返回完整终态。"
      );
      message.status = "completed";
      message.activityOnly = false;
      if (message.processingStartedAt) {
        message.processingCompletedAt = event.timestamp;
      }
      message.runtime = event.payload.runtime;
      if (event.payload.usage !== undefined) {
        message.usage = event.payload.usage;
      }
      finishRun(runId);
      return;
    }

    if (event.type !== "agent.error") {
      return;
    }

    if (event.payload.code === "pi_agent.aborted") {
      markRunStopped(runId, event.payload.runtime);
      conversationError.value = null;
      finishRun(runId);
      return;
    }

    markRunError(runId, event.payload.message, event.payload.runtime);
    conversationError.value = event.payload.message;
    finishRun(runId);
  }

  async function sendMessage(
    activeDocument: WorkspaceDocument | null,
    workspaceDocuments: WorkspaceDocument[] = [],
    attachments: WorkspaceContextAttachments = {},
    promptAttachments: UserPromptAttachment[] = [],
    contextOverride?: WorkspaceRuntimeContext,
    mode: "workspace" | "chat-assistant" = "workspace",
    chatAssistant?: ChatAssistantRequestContext,
    rewriteRequest?: ConversationMessageRewriteRequest
  ): Promise<void> {
    const api = options.api();
    const preparedRewrite = rewriteRequest
      ? prepareConversationMessageRewrite(messages.value, rewriteRequest)
      : undefined;
    if (rewriteRequest && !preparedRewrite) {
      return;
    }
    // Vue refs wrap objects in proxies, which Electron IPC cannot structured-clone.
    // Normalize at the API boundary so callers cannot accidentally leak proxies.
    const requestAttachments = preparedRewrite
      ? []
      : promptAttachments.map((attachment) => ({
          ...attachment
        }));
    const requestChatAssistant =
      normalizeChatAssistantRequestContext(chatAssistant);
    const content =
      preparedRewrite?.content ??
      (draft.value.trim() ||
        (requestAttachments.length ? "请阅读并分析我上传的附件。" : ""));
    if (!api) {
      conversationError.value =
        "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。";
      return;
    }
    if (!content || isBusy.value || hasPendingEditReview.value) {
      return;
    }

    if (preparedRewrite) {
      resetTransientConversationState();
    }
    const conversationHistory = buildConversationHistory(
      preparedRewrite
        ? messages.value.slice(0, preparedRewrite.targetIndex)
        : messages.value
    );

    const sendEpoch = epoch;
    const sendSessionId = sessionId.value;
    const replaceConversationHistory = Boolean(
      preparedRewrite || sessionsRequiringHistoryReplacement.has(sendSessionId)
    );
    const attemptId = ++attemptSequence;
    const requestedAgentTeamMode = agentTeamMode.value;
    const originalLength = activeDocument?.content.length ?? 0;
    const snapshotContent =
      activeDocument &&
      (activeDocument.workspaceType === "short" ||
        activeDocument.workspaceType === "script") &&
      activeDocument.stageId === "draft"
        ? activeDocument.content
        : (activeDocument?.content.slice(0, 20_000) ?? "");
    const contextSnapshot: WorkspaceRuntimeContext | undefined =
      mode === "chat-assistant"
        ? undefined
        : (contextOverride ??
          (activeDocument
            ? {
                activeResource: {
                  id: activeDocument.id,
                  domain: activeDocument.domain,
                  title: activeDocument.title,
                  path: [...activeDocument.path],
                  ...(activeDocument.format
                    ? { format: activeDocument.format }
                    : {}),
                  source: "live-editor" as const,
                  content: snapshotContent,
                  ...(originalLength > snapshotContent.length
                    ? { truncated: true as const, originalLength }
                    : {})
                }
              }
            : undefined));
    if (contextSnapshot && attachments.attachedSkills?.length) {
      contextSnapshot.attachedSkills = attachments.attachedSkills.map(
        (skill) => ({
          ...skill
        })
      );
    }
    if (contextSnapshot && attachments.attachedMaterials?.length) {
      contextSnapshot.attachedMaterials = attachments.attachedMaterials.map(
        (material) => ({
          ...material
        })
      );
    }
    if (!contextOverride && attachments.libraryWorkspace) {
      if (!contextSnapshot) return;
      contextSnapshot.libraryWorkspace =
        LibraryAgentWorkspaceSnapshotSchema.parse(attachments.libraryWorkspace);
    }
    if (
      !contextOverride &&
      contextSnapshot &&
      activeDocument &&
      (activeDocument.workspaceType === "short" ||
        activeDocument.workspaceType === "script") &&
      activeDocument.workspaceId &&
      activeDocument.workspaceTitle &&
      activeDocument.stageId
    ) {
      const { buildCreativeWorkspaceContext, loadWritingContextForPrompt } =
        await import("./agent-conversation/creative-workspace-context");
      if (epoch !== sendEpoch || sessionId.value !== sendSessionId) return;
      const creativeContext = buildCreativeWorkspaceContext(
        activeDocument,
        workspaceDocuments
      );
      if (creativeContext) {
        const agentsMd = await loadWritingContextForPrompt(
          api.catalog,
          activeDocument.workspaceId,
          activeDocument.workspaceType,
          options.onContextWarning
        );
        if (epoch !== sendEpoch || sessionId.value !== sendSessionId) return;
        const creativeWorkspace =
          creativeContext.scriptWorkspace ?? creativeContext.shortWorkspace;
        if (creativeWorkspace && agentsMd !== undefined)
          creativeWorkspace.agentsMd = agentsMd;
        Object.assign(contextSnapshot, creativeContext);
      }
    }

    if (
      preparedRewrite &&
      !conversationMessageRewriteIsCurrent(messages.value, preparedRewrite)
    ) {
      return;
    }
    const userMessage: ChatMessage = {
      id: id("user"),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      ...(requestAttachments.length
        ? {
            attachments: requestAttachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              kind: attachment.kind,
              mediaType: attachment.mediaType,
              size: attachment.size,
              ...(attachment.kind === "text" && attachment.truncated
                ? { truncated: true }
                : {})
            }))
          }
        : {}),
      status: "completed"
    };
    if (preparedRewrite) {
      runPersistenceBatch(() => {
        messages.value.splice(preparedRewrite.targetIndex);
        messages.value.push(userMessage);
      });
      sessionsRequiringHistoryReplacement.add(sendSessionId);
    } else {
      messages.value.push(userMessage);
      draft.value = "";
    }
    conversationError.value = null;
    pendingAttemptId.value = attemptId;
    approvalModeByAttempt.set(attemptId, approvalMode.value);
    submitting.value = true;
    scheduleIdleTimeout({
      expectedEpoch: sendEpoch,
      expectedSessionId: sendSessionId,
      attemptId
    });

    try {
      const selectedModel = configuredModels.value.find(
        (model) => model.id === selectedModelId.value
      );
      const accepted = await api.session.prompt({
        sessionId: sendSessionId,
        message: content,
        ...(conversationHistory.length ? { conversationHistory } : {}),
        ...(replaceConversationHistory
          ? { conversationHistoryMode: "replace" as const }
          : {}),
        ...(mode === "chat-assistant"
          ? {
              mode,
              ...(requestChatAssistant
                ? { chatAssistant: requestChatAssistant }
                : {})
            }
          : {}),
        ...(requestAttachments.length
          ? { attachments: requestAttachments }
          : {}),
        ...(mode === "chat-assistant"
          ? {}
          : {
              writeApprovalMode: approvalModeByAttempt.get(attemptId),
              ...(contextSnapshot?.shortWorkspace ||
              contextSnapshot?.scriptWorkspace ||
              contextSnapshot?.longWorkspace
                ? { agentTeamMode: requestedAgentTeamMode }
                : {}),
              autoApproveCrossStageOperations:
                options.autoApproveCrossStageOperations?.() === true
            }),
        ...(selectedModelId.value ? { modelId: selectedModelId.value } : {}),
        ...(thinkingLevel.value === "off"
          ? {
              thinkingLevel: "off" as const,
              ...(selectedModel ? { temperature: temperature.value } : {})
            }
          : { thinkingLevel: thinkingLevel.value }),
        ...(mode === "chat-assistant"
          ? {}
          : workspaceWebSearchPromptFields(webSearchEnabled.value)),
        ...(contextSnapshot ? { workspaceContext: contextSnapshot } : {})
      });
      if (replaceConversationHistory && accepted.sessionId === sendSessionId) {
        sessionsRequiringHistoryReplacement.delete(sendSessionId);
      }
      if (
        epoch !== sendEpoch ||
        sessionId.value !== sendSessionId ||
        pendingAttemptId.value !== attemptId
      ) {
        if (accepted.sessionId === sendSessionId) {
          void api.session
            .abort({
              sessionId: accepted.sessionId,
              runId: accepted.runId
            })
            .catch(() => undefined);
        }
        return;
      }
      if (accepted.sessionId !== sendSessionId) {
        const observedRunId = observedRunByAttempt.get(attemptId);
        if (observedRunId) {
          failProtocol(
            observedRunId,
            "智能体受理结果返回了错误的会话标识。",
            accepted.runtime
          );
        }
        pendingAttemptId.value = null;
        approvalModeByAttempt.delete(attemptId);
        submitting.value = false;
        clearIdleTimer();
        conversationError.value = "智能体受理结果返回了错误的会话标识。";
        return;
      }

      const observedRunId = observedRunByAttempt.get(attemptId);
      if (observedRunId && observedRunId !== accepted.runId) {
        failProtocol(
          observedRunId,
          "智能体受理结果与已到达事件的运行标识不一致。",
          accepted.runtime
        );
        pendingAttemptId.value = null;
        observedRunByAttempt.delete(attemptId);
        approvalModeByAttempt.delete(attemptId);
        rememberBounded(finishedRunIds, accepted.runId);
        return;
      }

      runtime.value = accepted.runtime;
      const acceptedApprovalMode = approvalModeByAttempt.get(attemptId);
      if (acceptedApprovalMode) {
        rememberRunApprovalMode(accepted.runId, acceptedApprovalMode);
      }
      pendingAttemptId.value = null;
      observedRunByAttempt.delete(attemptId);
      approvalModeByAttempt.delete(attemptId);
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
      const messageText =
        error instanceof Error ? error.message : "智能体请求受理失败。";
      const observedRunId = observedRunByAttempt.get(attemptId);
      if (observedRunId) {
        markRunError(observedRunId, messageText, runtime.value ?? undefined);
        if (activeRunId.value === observedRunId) {
          activeRunId.value = null;
        }
      }
      pendingAttemptId.value = null;
      observedRunByAttempt.delete(attemptId);
      approvalModeByAttempt.delete(attemptId);
      submitting.value = false;
      clearIdleTimer();
      conversationError.value = messageText;
    }
  }

  async function sendAssistantMessage(
    context: ChatAssistantRequestContext = { mode: "normal" }
  ): Promise<void> {
    await sendMessage(null, [], {}, [], undefined, "chat-assistant", context);
  }

  async function resendMessage(
    request: ConversationMessageRewriteRequest,
    activeDocument: WorkspaceDocument,
    workspaceDocuments: WorkspaceDocument[] = [],
    attachments: WorkspaceContextAttachments = {}
  ): Promise<boolean> {
    const sourceSessionId = sessionId.value;
    await sendMessage(
      activeDocument,
      workspaceDocuments,
      attachments,
      [],
      undefined,
      "workspace",
      undefined,
      request
    );
    return (
      sessionId.value === sourceSessionId &&
      !messages.value.some((message) => message.id === request.messageId)
    );
  }

  async function sendLongMessage(
    context: LongWorkspaceRuntimeContext,
    attachments: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    > = {},
    promptAttachments: UserPromptAttachment[] = []
  ): Promise<void> {
    const longWorkspace = LongWorkspaceRuntimeContextSchema.parse(context);
    await sendMessage(
      {
        id: longWorkspace.bookId,
        domain: "creation",
        title: longWorkspace.title,
        eyebrow: "长篇创作",
        path: [longWorkspace.title],
        content: "",
        readOnly: true
      },
      [],
      attachments,
      promptAttachments,
      { longWorkspace }
    );
  }

  async function resendLongMessage(
    request: ConversationMessageRewriteRequest,
    context: LongWorkspaceRuntimeContext,
    attachments: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    > = {}
  ): Promise<boolean> {
    const longWorkspace = LongWorkspaceRuntimeContextSchema.parse(context);
    const sourceSessionId = sessionId.value;
    await sendMessage(
      {
        id: longWorkspace.bookId,
        domain: "creation",
        title: longWorkspace.title,
        eyebrow: "长篇创作",
        path: [longWorkspace.title],
        content: "",
        readOnly: true
      },
      [],
      attachments,
      [],
      { longWorkspace },
      "workspace",
      undefined,
      request
    );
    return (
      sessionId.value === sourceSessionId &&
      !messages.value.some((message) => message.id === request.messageId)
    );
  }

  const stopGeneration = createConversationStopper({
    api: options.api,
    epoch: () => epoch,
    sessionId,
    activeRunId,
    stopping,
    flushText: flushPendingAgentTextDelta,
    stopped: (runId) =>
      runPersistenceBatch(() => {
        markRunStopped(runId, runtime.value ?? undefined);
        conversationError.value = null;
        finishRun(runId);
      })
  });

  function cancelPendingGeneration(): boolean {
    if (pendingAttemptId.value === null || activeRunId.value !== null) {
      return false;
    }
    newConversation();
    return true;
  }

  function resetTransientConversationState(): void {
    epoch += 1;
    clearIdleTimer();
    submitting.value = false;
    stopping.value = false;
    pendingAttemptId.value = null;
    activeRunId.value = null;
    runtime.value = null;
    conversationError.value = null;
    handledEventIds.clear();
    finishedRunIds.clear();
    runMessageIds.clear();
    turnCheckpointByRun.clear();
    subagentTurnCheckpointByRun.clear();
    seenTurnIds.clear();
    seenSubagentTurnIds.clear();
    observedRunByAttempt.clear();
    approvalModeByAttempt.clear();
    approvalModeByRun.clear();
    userInput.clear();
  }

  function stopStreamingMessages(): void {
    flushPendingAgentTextDelta();
    const completedAt = new Date().toISOString();
    for (const message of messages.value) {
      if (message.status !== "streaming") continue;
      message.status = "stopped";
      if (message.retry) delete message.retry;
      finalizeRunningSubagents(
        message,
        "stopped",
        completedAt,
        "会话已切换或关闭，子任务同步停止。"
      );
      finalizeUnfinishedMessageTools(
        message,
        completedAt,
        "会话已切换或关闭，工具调用未返回完整终态。"
      );
      for (const run of message.subagentRuns ?? []) {
        if (run.retry) delete run.retry;
      }
      if (message.processingStartedAt && !message.processingCompletedAt) {
        message.processingCompletedAt = completedAt;
      }
    }
  }

  function newConversation(): void {
    runPersistenceBatch(() => {
      stopStreamingMessages();
      storeCurrentConversation();
      resetTransientConversationState();
      const timestamp = nextConversationTimestamp();
      sessionId.value = id("session");
      messages.value = [];
      draft.value = "";
      currentCreatedAt.value = timestamp;
      currentUpdatedAt.value = timestamp;
    });
  }

  function selectConversation(nextSessionId: string): boolean {
    if (nextSessionId === sessionId.value) return true;
    if (isBusy.value) return false;

    // A selectable conversation should already be idle. Normalize any stale
    // presentation state before persisting so a detached streaming card cannot
    // be restored without an owning run.
    let selected = false;
    runPersistenceBatch(() => {
      stopStreamingMessages();
      storeCurrentConversation();
      const selectedConversation = storedConversations.value.find(
        (conversation) => conversation.sessionId === nextSessionId
      );
      if (!selectedConversation) return;

      resetTransientConversationState();
      sessionId.value = selectedConversation.sessionId;
      messages.value = selectedConversation.messages.map(cloneMessage);
      draft.value = selectedConversation.draft;
      currentCreatedAt.value = selectedConversation.createdAt;
      currentUpdatedAt.value = nextConversationTimestamp();
      selected = true;
    });
    return selected;
  }

  function applyRunSettings(settings: AgentRunSettings): void {
    hasRunSettingsPreference = true;
    approvalMode.value = settings.approvalMode;
    agentTeamMode.value = settings.agentTeamMode ?? "normal";
    if (configuredModels.value.length === 0) {
      if (modelSettingsApplied) {
        selectedModelId.value = "";
        thinkingLevel.value = "medium";
        temperature.value = 0.7;
        webSearchEnabled.value = false;
      } else {
        selectedModelId.value = settings.selectedModelId;
        thinkingLevel.value = settings.thinkingLevel;
        temperature.value = settings.temperature;
        webSearchEnabled.value = settings.webSearchEnabled === true;
      }
      return;
    }

    const preferredModel = configuredModels.value.find(
      (model) => model.id === settings.selectedModelId
    );
    const selected =
      preferredModel ??
      configuredModels.value.find(
        (model) => model.id === defaultModelId.value
      ) ??
      configuredModels.value[0];
    if (!selected) return;

    selectedModelId.value = selected.id;
    thinkingLevel.value =
      preferredModel &&
      (settings.thinkingLevel === "off" ||
        selected.thinkingLevelOptions.includes(settings.thinkingLevel))
        ? settings.thinkingLevel
        : selected.defaultThinkingLevel;
    temperature.value =
      preferredModel &&
      selected.temperatureOptions.includes(settings.temperature)
        ? settings.temperature
        : (selected.temperatureOptions[1] ?? 0.7);
    webSearchEnabled.value = resolveWorkspaceWebSearchEnabled(
      selected,
      settings.webSearchEnabled ?? webSearchEnabled.value
    );
  }

  function applyModelSettings(settings: ModelSettings): void {
    const currentRunSettings: AgentRunSettings = {
      selectedModelId: selectedModelId.value,
      thinkingLevel: thinkingLevel.value,
      temperature: temperature.value,
      approvalMode: approvalMode.value,
      agentTeamMode: agentTeamMode.value,
      webSearchEnabled: webSearchEnabled.value
    };
    configuredModels.value = settings.models;
    defaultModelId.value = settings.defaultModelId;
    modelSettingsApplied = true;
    if (settings.models.length === 0) {
      selectedModelId.value = "";
      thinkingLevel.value = "medium";
      temperature.value = 0.7;
      webSearchEnabled.value = false;
      return;
    }
    if (hasRunSettingsPreference) {
      applyRunSettings(currentRunSettings);
      return;
    }

    const selected =
      settings.models.find((model) => model.id === settings.defaultModelId) ??
      settings.models[0];
    selectedModelId.value = selected?.id ?? "";
    thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
    temperature.value = selected?.temperatureOptions[1] ?? 0.7;
    webSearchEnabled.value = false;
    hasRunSettingsPreference = true;
  }

  function selectModel(modelId: string): void {
    const selected = configuredModels.value.find(
      (model) => model.id === modelId
    );
    if (!selected) {
      return;
    }
    selectedModelId.value = selected.id;
    thinkingLevel.value = selected.defaultThinkingLevel;
    temperature.value = selected.temperatureOptions[1];
    const nextSearch = workspaceWebSearchAfterModelChange(
      selected,
      webSearchEnabled.value
    );
    webSearchEnabled.value = nextSearch.enabled;
    if (nextSearch.autoDisabled) {
      options.onContextWarning?.(WORKSPACE_WEB_SEARCH_AUTO_DISABLED_MESSAGE);
    }
  }

  function selectThinkingLevel(level: ThinkingLevel): void {
    const selected = configuredModels.value.find(
      (model) => model.id === selectedModelId.value
    );
    if (!selected) {
      thinkingLevel.value = level;
      return;
    }
    if (level !== "off" && !selected.thinkingLevelOptions.includes(level)) {
      return;
    }
    thinkingLevel.value = level;
  }

  function selectWebSearchEnabled(enabled: boolean): void {
    const selected = configuredModels.value.find(
      (model) => model.id === selectedModelId.value
    );
    if (enabled && !isWorkspaceWebSearchAvailable(selected)) {
      return;
    }
    webSearchEnabled.value = enabled;
  }

  function selectTemperature(value: number): void {
    const selected = configuredModels.value.find(
      (model) => model.id === selectedModelId.value
    );
    if (
      !selected ||
      thinkingLevel.value !== "off" ||
      !selected.temperatureOptions.includes(value)
    ) {
      return;
    }
    temperature.value = value;
  }

  function selectApprovalMode(mode: AgentApprovalMode): void {
    if (mode === "request-approval" || mode === "auto-approve") {
      approvalMode.value = mode;
    }
  }

  function selectAgentTeamMode(mode: AgentTeamRunMode): void {
    if (mode === "normal" || mode === "team") {
      agentTeamMode.value = mode;
    }
  }

  return {
    messages,
    draft,
    sessionId,
    approvalMode,
    agentTeamMode,
    thinkingLevel,
    temperature,
    webSearchEnabled,
    configuredModels,
    selectedModelId,
    runtime,
    conversationError,
    pendingUserInput: userInput.request,
    submittingUserInput: userInput.submitting,
    history,
    isBusy,
    hasPendingEditReview,
    canSend,
    canSendAttachments,
    canRewriteHistory,
    canStop,
    acceptsRunEvent,
    approvalModeForRun,
    markToolConflict,
    getEditProposal,
    listEditProposals,
    upsertEditProposal,
    updateEditProposal,
    handleEvent,
    submitUserInput: userInput.submit,
    sendMessage,
    resendMessage,
    sendAssistantMessage,
    sendLongMessage,
    resendLongMessage,
    stopGeneration,
    cancelPendingGeneration,
    newConversation,
    selectConversation,
    applyModelSettings,
    applyRunSettings,
    selectModel,
    selectThinkingLevel,
    selectWebSearchEnabled,
    selectTemperature,
    selectApprovalMode,
    selectAgentTeamMode,
    capturePersistenceSnapshot,
    restorePersistenceSnapshot,
    holdPersistenceEmits,
    releasePersistenceEmits,
    useSuggestion(value: string): void {
      draft.value = value;
    },
    dispose(disposeOptions): void {
      persistenceNotificationsEnabled = false;
      stopPersistenceWatch();
      // Disposing invalidates the run ownership below. Settle presentation
      // state first so `status: streaming` cannot outlive `activeRunId`.
      stopStreamingMessages();
      if (disposeOptions?.clearPersistence && options.onPersistenceRemove) {
        void Promise.resolve().then(() => {
          try {
            observePersistenceResult(options.onPersistenceRemove?.());
          } catch {
            reportPersistenceError();
          }
        });
      }
      epoch += 1;
      pendingAttemptId.value = null;
      activeRunId.value = null;
      approvalModeByAttempt.clear();
      approvalModeByRun.clear();
      sessionsRequiringHistoryReplacement.clear();
      turnCheckpointByRun.clear();
      subagentTurnCheckpointByRun.clear();
      seenTurnIds.clear();
      seenSubagentTurnIds.clear();
      stopping.value = false;
      clearIdleTimer();
    }
  };
}

function isAgentEvent(event: SystemEventEnvelope): event is Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.user_input_requested"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
> {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.user_input_requested" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}

function isSubagentEvent(
  event: SystemEventEnvelope
): event is SubagentEventEnvelope {
  return (
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}
