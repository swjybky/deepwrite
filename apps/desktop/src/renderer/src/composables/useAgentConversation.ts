import { computed, ref, watch, type Ref } from "vue";
import type {
  AgentRuntimeRef,
  AgentUsage,
  DeepWriteApi,
  ModelConfig,
  ModelSettings,
  SystemEventEnvelope,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  LibraryAgentWorkspaceSnapshotSchema,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type {
  AgentApprovalMode,
  AgentEditProposal,
  AgentSubagentProcessingStep,
  AgentSubagentRun,
  AgentTextDiffHunk,
  AgentTextDiffLine,
  AgentToolTrace,
  ChatMessage,
  ConversationHistoryItem
} from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

interface ConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface UseAgentConversationOptions {
  api: () => DeepWriteApi | undefined;
  initialMessages?: ChatMessage[];
  idleTimeoutMs?: number;
  persistenceKey?: string;
  storage?: ConversationStorage;
  onPersistenceError?: () => void;
}

export interface AgentRunSettings {
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  approvalMode: AgentApprovalMode;
}

interface StoredConversation {
  sessionId: string;
  messages: ChatMessage[];
  draft: string;
  approvalMode: AgentApprovalMode;
  createdAt: string;
  updatedAt: string;
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
}

interface StoredConversationEnvelope {
  version: 1;
  activeSessionId: string;
  conversations: StoredConversation[];
}

type SubagentEventEnvelope = Extract<
  SystemEventEnvelope,
  { type: "subagent.started" | "subagent.activity" | "subagent.completed" }
>;
type SubagentEventPayload = SubagentEventEnvelope["payload"];

const MAX_STORED_CONVERSATIONS = 20;
const PERSISTENCE_DEBOUNCE_MS = 180;

export interface AgentConversationController {
  messages: Ref<ChatMessage[]>;
  draft: Ref<string>;
  sessionId: Ref<string>;
  approvalMode: Ref<AgentApprovalMode>;
  thinkingLevel: Ref<ThinkingLevel>;
  temperature: Ref<number>;
  configuredModels: Ref<ModelConfig[]>;
  selectedModelId: Ref<string>;
  runtime: Ref<AgentRuntimeRef | null>;
  conversationError: Ref<string | null>;
  history: Readonly<Ref<ConversationHistoryItem[]>>;
  isBusy: Readonly<Ref<boolean>>;
  hasPendingEditReview: Readonly<Ref<boolean>>;
  canSend: Readonly<Ref<boolean>>;
  canSendAttachments: Readonly<Ref<boolean>>;
  canStop: Readonly<Ref<boolean>>;
  acceptsRunEvent(sessionId: string, runId: string): boolean;
  approvalModeForRun(sessionId: string, runId: string): AgentApprovalMode | undefined;
  markToolConflict(runId: string, toolCallId: string, summary: string): void;
  getEditProposal(runId: string, proposalId: string): AgentEditProposal | undefined;
  upsertEditProposal(runId: string, proposal: AgentEditProposal): AgentEditProposal;
  updateEditProposal(
    runId: string,
    proposalId: string,
    patch: Partial<AgentEditProposal>
  ): AgentEditProposal | undefined;
  handleEvent(event: SystemEventEnvelope): void;
  sendMessage(
    activeDocument: WorkspaceDocument,
    workspaceDocuments?: WorkspaceDocument[],
    attachments?: WorkspaceContextAttachments,
    promptAttachments?: UserPromptAttachment[]
  ): Promise<void>;
  stopGeneration(): Promise<boolean>;
  newConversation(): void;
  selectConversation(sessionId: string): boolean;
  applyModelSettings(settings: ModelSettings): void;
  applyRunSettings(settings: AgentRunSettings): void;
  selectModel(modelId: string): void;
  selectThinkingLevel(level: ThinkingLevel): void;
  selectTemperature(temperature: number): void;
  selectApprovalMode(mode: AgentApprovalMode): void;
  useSuggestion(value: string): void;
  dispose(): void;
}

export type WorkspaceContextAttachments = Pick<
  WorkspaceRuntimeContext,
  "attachedSkills" | "attachedMaterials" | "libraryWorkspace"
>;

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function cloneTextDiffLine(line: AgentTextDiffLine): AgentTextDiffLine {
  return { ...line };
}

function cloneTextDiffHunk(hunk: AgentTextDiffHunk): AgentTextDiffHunk {
  return {
    ...hunk,
    lines: hunk.lines.map(cloneTextDiffLine)
  };
}

function cloneEditProposal(proposal: AgentEditProposal): AgentEditProposal {
  return {
    ...proposal,
    ...(proposal.libraryTarget
      ? { libraryTarget: { ...proposal.libraryTarget } }
      : {}),
    toolCallIds: [...proposal.toolCallIds],
    hunks: proposal.hunks.map(cloneTextDiffHunk)
  };
}

function parseStoredLibraryTarget(
  value: unknown
): AgentEditProposal["libraryTarget"] | undefined {
  if (
    !isRecord(value) ||
    (value.operation !== "create" && value.operation !== "edit") ||
    (value.domain !== "material" && value.domain !== "skill") ||
    typeof value.libraryId !== "string" ||
    typeof value.stageId !== "string" ||
    (value.baseProjectRevision !== undefined &&
      !nonnegativeInteger(value.baseProjectRevision)) ||
    (value.entryId !== undefined && typeof value.entryId !== "string") ||
    (value.operation === "edit" && typeof value.entryId !== "string")
  ) {
    return undefined;
  }
  return {
    operation: value.operation,
    domain: value.domain,
    libraryId: value.libraryId,
    stageId: value.stageId,
    ...(value.baseProjectRevision === undefined
      ? {}
      : { baseProjectRevision: value.baseProjectRevision }),
    ...(value.entryId === undefined ? {} : { entryId: value.entryId })
  };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...(message.attachments
      ? { attachments: message.attachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(message.tools
      ? { tools: message.tools.map((tool) => ({ ...tool })) }
      : {}),
    ...(message.toolCalls
      ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
      : {}),
    ...(message.processingSteps
      ? { processingSteps: message.processingSteps.map((step) => ({ ...step })) }
      : {}),
    ...(message.subagentRuns
      ? {
          subagentRuns: message.subagentRuns.map((run) => ({
            ...run,
            runtime: { ...run.runtime },
            ...(run.usage ? { usage: { ...run.usage } } : {}),
            toolCalls: run.toolCalls.map((toolCall) => ({ ...toolCall })),
            processingSteps: run.processingSteps.map((step) => ({ ...step }))
          }))
        }
      : {}),
    ...(message.editProposals
      ? { editProposals: message.editProposals.map(cloneEditProposal) }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseStoredTextDiffLine(value: unknown): AgentTextDiffLine | undefined {
  if (
    !isRecord(value) ||
    !["context", "addition", "deletion"].includes(String(value.type)) ||
    typeof value.text !== "string" ||
    (value.oldLineNumber !== undefined && !nonnegativeInteger(value.oldLineNumber)) ||
    (value.newLineNumber !== undefined && !nonnegativeInteger(value.newLineNumber))
  ) {
    return undefined;
  }
  return {
    type: value.type as AgentTextDiffLine["type"],
    text: value.text,
    ...(value.oldLineNumber === undefined
      ? {}
      : { oldLineNumber: value.oldLineNumber as number }),
    ...(value.newLineNumber === undefined
      ? {}
      : { newLineNumber: value.newLineNumber as number })
  };
}

function parseStoredTextDiffHunk(value: unknown): AgentTextDiffHunk | undefined {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.oldStart) ||
    !nonnegativeInteger(value.oldLines) ||
    !nonnegativeInteger(value.newStart) ||
    !nonnegativeInteger(value.newLines) ||
    !Array.isArray(value.lines)
  ) {
    return undefined;
  }
  const lines = value.lines
    .map(parseStoredTextDiffLine)
    .filter((line): line is AgentTextDiffLine => line !== undefined);
  if (lines.length !== value.lines.length) return undefined;
  return {
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    lines
  };
}

function parseStoredEditProposal(value: unknown): AgentEditProposal | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.workspaceId !== "string" ||
    (value.stageId !== "library" &&
      !SHORT_WORKSPACE_STAGE_IDS.includes(
        value.stageId as (typeof SHORT_WORKSPACE_STAGE_IDS)[number]
      )) ||
    typeof value.documentId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    !["pending", "accepting", "accepted", "rejected", "conflict", "error"].includes(
      String(value.status)
    ) ||
    typeof value.baseRevision !== "string" ||
    typeof value.proposedRevision !== "string" ||
    (value.proposedText !== undefined && typeof value.proposedText !== "string") ||
    !Array.isArray(value.toolCallIds) ||
    !value.toolCallIds.every((toolCallId) => typeof toolCallId === "string") ||
    !nonnegativeInteger(value.additions) ||
    !nonnegativeInteger(value.deletions) ||
    !Array.isArray(value.hunks) ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean") ||
    (value.statusMessage !== undefined && typeof value.statusMessage !== "string") ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  ) {
    return undefined;
  }
  const libraryTarget = parseStoredLibraryTarget(value.libraryTarget);
  if (
    (value.stageId === "library" && !libraryTarget) ||
    (value.stageId !== "library" && value.libraryTarget !== undefined)
  ) {
    return undefined;
  }
  const hunks = value.hunks
    .map(parseStoredTextDiffHunk)
    .filter((hunk): hunk is AgentTextDiffHunk => hunk !== undefined);
  if (hunks.length !== value.hunks.length) return undefined;
  return {
    id: value.id,
    runId: value.runId,
    workspaceId: value.workspaceId,
    stageId: value.stageId as AgentEditProposal["stageId"],
    documentId: value.documentId,
    title: value.title,
    summary: value.summary,
    status: value.status === "accepting"
      ? "pending"
      : value.status as AgentEditProposal["status"],
    baseRevision: value.baseRevision,
    proposedRevision: value.proposedRevision,
    ...(value.proposedText === undefined ? {} : { proposedText: value.proposedText }),
    toolCallIds: [...value.toolCallIds] as string[],
    additions: value.additions,
    deletions: value.deletions,
    hunks,
    ...(value.truncated === undefined ? {} : { truncated: value.truncated }),
    ...(value.statusMessage === undefined ? {} : { statusMessage: value.statusMessage }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(libraryTarget ? { libraryTarget } : {})
  };
}

function parseStoredRuntime(value: unknown): AgentRuntimeRef | undefined {
  if (
    !isRecord(value) ||
    typeof value.provider !== "string" ||
    !value.provider ||
    typeof value.model !== "string" ||
    !value.model ||
    (value.mode !== "local-faux" && value.mode !== "provider")
  ) {
    return undefined;
  }
  return {
    provider: value.provider,
    model: value.model,
    mode: value.mode
  };
}

function parseStoredUsage(value: unknown): AgentUsage | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens"
  ] as const;
  if (!keys.every((key) => nonnegativeInteger(value[key]))) return undefined;
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheWriteTokens: value.cacheWriteTokens as number,
    totalTokens: value.totalTokens as number
  };
}

function parseStoredToolTrace(value: unknown): AgentToolTrace | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !["preparing", "running", "completed", "error"].includes(String(value.status)) ||
    typeof value.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ...(typeof value.streamId === "string" ? { streamId: value.streamId } : {}),
    name: value.name,
    args: value.args,
    ...(typeof value.argumentsText === "string"
      ? { argumentsText: value.argumentsText }
      : {}),
    ...(typeof value.argumentsComplete === "boolean"
      ? { argumentsComplete: value.argumentsComplete }
      : {}),
    status: value.status as AgentToolTrace["status"],
    requestedAt: value.requestedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.resultSummary === "string"
      ? { resultSummary: value.resultSummary }
      : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {})
  };
}

function parseStoredSubagentStep(
  value: unknown
): AgentSubagentProcessingStep | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  if (value.type === "thinking" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "thinking",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "response" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "response",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "tool" && typeof value.toolCallId === "string") {
    return {
      id: value.id,
      type: "tool",
      toolCallId: value.toolCallId,
      createdAt: value.createdAt
    };
  }
  return undefined;
}

function parseStoredSubagentRun(value: unknown): AgentSubagentRun | undefined {
  if (
    !isRecord(value) ||
    typeof value.parentToolCallId !== "string" ||
    typeof value.subagentRunId !== "string" ||
    typeof value.subagentId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.task !== "string" ||
    !["running", "completed", "error", "stopped", "interrupted"].includes(
      String(value.status)
    ) ||
    !validDate(value.startedAt) ||
    !Array.isArray(value.toolCalls) ||
    !Array.isArray(value.processingSteps)
  ) {
    return undefined;
  }
  const runtime = parseStoredRuntime(value.runtime);
  if (!runtime) return undefined;
  const toolCalls = value.toolCalls
    .map(parseStoredToolTrace)
    .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  const processingSteps = value.processingSteps
    .map(parseStoredSubagentStep)
    .filter((step): step is AgentSubagentProcessingStep => step !== undefined);
  if (
    toolCalls.length !== value.toolCalls.length ||
    processingSteps.length !== value.processingSteps.length
  ) {
    return undefined;
  }

  const restoredWhileRunning = value.status === "running";
  const restoredAt = new Date().toISOString();
  const normalizedToolCalls = restoredWhileRunning
    ? toolCalls.map((toolCall) =>
        toolCall.status === "preparing" || toolCall.status === "running"
          ? {
              ...toolCall,
              status: "error" as const,
              completedAt: restoredAt,
              resultSummary: toolCall.resultSummary ?? "会话恢复时子任务已停止。",
              isError: true
            }
          : toolCall
      )
    : toolCalls;
  const usage = parseStoredUsage(value.usage);
  return {
    parentToolCallId: value.parentToolCallId,
    subagentRunId: value.subagentRunId,
    subagentId: value.subagentId,
    name: value.name,
    task: value.task,
    status:
      restoredWhileRunning || value.status === "interrupted"
        ? "stopped"
        : value.status as AgentSubagentRun["status"],
    runtime,
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    toolCalls: normalizedToolCalls,
    processingSteps,
    startedAt: value.startedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : restoredWhileRunning
        ? { completedAt: restoredAt }
        : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : restoredWhileRunning
        ? { errorMessage: "应用关闭或对话恢复时，子任务仍在运行。" }
        : {}),
    ...(usage ? { usage } : {})
  };
}

function parseStoredMessage(value: unknown): ChatMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    !validDate(value.createdAt)
  ) {
    return undefined;
  }

  const status = ["streaming", "completed", "stopped", "error"].includes(
    String(value.status)
  )
    ? (value.status as ChatMessage["status"])
    : undefined;
  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    ...(status ? { status: status === "streaming" ? "stopped" : status } : {})
  };

  if (Array.isArray(value.attachments)) {
    message.attachments = value.attachments.flatMap((attachment) => {
      if (
        !isRecord(attachment) ||
        typeof attachment.id !== "string" ||
        typeof attachment.name !== "string" ||
        (attachment.kind !== "text" && attachment.kind !== "image") ||
        typeof attachment.mediaType !== "string" ||
        !nonnegativeInteger(attachment.size)
      ) {
        return [];
      }
      return [{
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        mediaType: attachment.mediaType,
        size: attachment.size,
        ...(attachment.truncated === true ? { truncated: true } : {})
      }];
    });
  }

  for (const key of [
    "runId",
    "thinking",
    "processingStartedAt",
    "processingCompletedAt",
    "errorMessage"
  ] as const) {
    if (typeof value[key] === "string") {
      message[key] = value[key];
    }
  }
  if (value.activityOnly === true) message.activityOnly = true;

  if (Array.isArray(value.tools)) {
    message.tools = value.tools.flatMap((tool) => {
      if (
        !isRecord(tool) ||
        typeof tool.id !== "string" ||
        typeof tool.name !== "string" ||
        !["running", "completed", "error"].includes(String(tool.status))
      ) {
        return [];
      }
      return [{
        id: tool.id,
        name: tool.name,
        status: tool.status as "running" | "completed" | "error",
        ...(typeof tool.summary === "string" ? { summary: tool.summary } : {})
      }];
    });
  }

  if (Array.isArray(value.toolCalls)) {
    message.toolCalls = value.toolCalls
      .map(parseStoredToolTrace)
      .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  }

  if (Array.isArray(value.processingSteps)) {
    const processingSteps: NonNullable<ChatMessage["processingSteps"]> = [];
    for (const step of value.processingSteps) {
      if (
        !isRecord(step) ||
        typeof step.id !== "string" ||
        typeof step.createdAt !== "string"
      ) {
        continue;
      }
      if (step.type === "thinking" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "thinking",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "response" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "response",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "tool" && typeof step.toolCallId === "string") {
        processingSteps.push({
          id: step.id,
          type: "tool",
          toolCallId: step.toolCallId,
          createdAt: step.createdAt
        });
      }
    }
    message.processingSteps = processingSteps;
  }

  if (Array.isArray(value.subagentRuns)) {
    message.subagentRuns = value.subagentRuns
      .map(parseStoredSubagentRun)
      .filter((run): run is AgentSubagentRun => run !== undefined);
  }

  if (Array.isArray(value.editProposals)) {
    const editProposals = value.editProposals
      .map(parseStoredEditProposal)
      .filter((proposal): proposal is AgentEditProposal => proposal !== undefined);
    if (
      editProposals.length !== value.editProposals.length ||
      editProposals.some((proposal) => proposal.runId !== message.runId)
    ) {
      return undefined;
    }
    message.editProposals = editProposals;
  }

  if (message.status === "stopped" && message.processingStartedAt && !message.processingCompletedAt) {
    message.processingCompletedAt = new Date().toISOString();
  }
  return message;
}

function parseStoredConversation(value: unknown): StoredConversation | undefined {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !Array.isArray(value.messages) ||
    typeof value.draft !== "string" ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt) ||
    typeof value.selectedModelId !== "string" ||
    (value.approvalMode !== undefined &&
      value.approvalMode !== "request-approval" &&
      value.approvalMode !== "auto-approve") ||
    typeof value.thinkingLevel !== "string" ||
    typeof value.temperature !== "number" ||
    !Number.isFinite(value.temperature)
  ) {
    return undefined;
  }
  const messages = value.messages
    .map(parseStoredMessage)
    .filter((message): message is ChatMessage => message !== undefined);
  if (messages.length !== value.messages.length) return undefined;
  return {
    sessionId: value.sessionId,
    messages,
    draft: value.draft,
    approvalMode:
      value.approvalMode === "auto-approve" ? "auto-approve" : "request-approval",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    selectedModelId: value.selectedModelId,
    thinkingLevel: value.thinkingLevel,
    temperature: value.temperature
  };
}

function loadStoredEnvelope(
  storage: ConversationStorage | undefined,
  key: string | undefined
): StoredConversationEnvelope | undefined {
  if (!storage || !key) return undefined;
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.activeSessionId !== "string" ||
      !Array.isArray(value.conversations)
    ) {
      return undefined;
    }
    const conversations = value.conversations
      .map(parseStoredConversation)
      .filter((conversation): conversation is StoredConversation => conversation !== undefined);
    return {
      version: 1,
      activeSessionId: value.activeSessionId,
      conversations: conversations.slice(0, MAX_STORED_CONVERSATIONS)
    };
  } catch {
    return undefined;
  }
}

function resolveConversationStorage(
  preferred: ConversationStorage | undefined
): ConversationStorage | undefined {
  if (preferred) return preferred;
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function compactConversationText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function historyItemFor(
  conversation: StoredConversation,
  currentSessionId: string
): ConversationHistoryItem {
  const firstUserMessage = conversation.messages.find((message) => message.role === "user");
  const lastVisibleMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.content.trim());
  return {
    sessionId: conversation.sessionId,
    title: compactConversationText(firstUserMessage?.content ?? "未命名对话", 42),
    preview: compactConversationText(lastVisibleMessage?.content ?? conversation.draft, 76),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    turnCount: conversation.messages.filter((message) => message.role === "user").length,
    current: conversation.sessionId === currentSessionId
  };
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
  const persistenceStorage = resolveConversationStorage(options.storage);
  const storedEnvelope = loadStoredEnvelope(persistenceStorage, options.persistenceKey);
  const storedActive = storedEnvelope?.conversations.find(
    (conversation) => conversation.sessionId === storedEnvelope.activeSessionId
  );
  let hasRunSettingsPreference = storedActive !== undefined;
  let modelSettingsApplied = false;
  let conversationClock = Math.max(
    Date.now(),
    ...(storedEnvelope?.conversations.map((conversation) => Date.parse(conversation.updatedAt)) ?? [])
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
  const thinkingLevel = ref<ThinkingLevel>(storedActive?.thinkingLevel ?? "medium");
  const temperature = ref(storedActive?.temperature ?? 0.7);
  const configuredModels = ref<ModelConfig[]>([]);
  const defaultModelId = ref("");
  const selectedModelId = ref(storedActive?.selectedModelId ?? "");
  const runtime = ref<AgentRuntimeRef | null>(null);
  const conversationError = ref<string | null>(null);
  const storedConversations = ref<StoredConversation[]>(
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
  const observedRunByAttempt = new Map<number, string>();
  const approvalModeByAttempt = new Map<number, AgentApprovalMode>();
  const approvalModeByRun = new Map<string, AgentApprovalMode>();
  let epoch = 0;
  let attemptSequence = 0;
  const pendingAttemptId = ref<number | null>(null);
  let idleTimer: number | undefined;
  let persistenceTimer: number | undefined;
  let persistenceErrorReported = false;

  const isBusy = computed(
    () => pendingAttemptId.value !== null || submitting.value || activeRunId.value !== null
  );
  const hasPendingEditReview = computed(() =>
    messages.value.some((message) =>
      message.editProposals?.some(
        (proposal) => proposal.status === "pending" || proposal.status === "accepting"
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
    () =>
      Boolean(options.api()) &&
      !isBusy.value &&
      !hasPendingEditReview.value
  );
  const canStop = computed(
    () => Boolean(options.api()) && activeRunId.value !== null && !stopping.value
  );
  const history = computed<ConversationHistoryItem[]>(() => {
    const activeSnapshot = currentStoredConversation();
    const conversations = storedConversations.value.filter(
      (conversation) => conversation.sessionId !== sessionId.value
    );
    if (hasConversationContent(activeSnapshot)) {
      conversations.push(activeSnapshot);
    }
    return conversations
      .map((conversation) => historyItemFor(conversation, sessionId.value))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  });

  function currentStoredConversation(): StoredConversation {
    return {
      sessionId: sessionId.value,
      messages: messages.value.map(cloneMessage),
      draft: draft.value,
      approvalMode: approvalMode.value,
      createdAt: currentCreatedAt.value,
      updatedAt: currentUpdatedAt.value,
      selectedModelId: selectedModelId.value,
      thinkingLevel: thinkingLevel.value,
      temperature: temperature.value
    };
  }

  function hasConversationContent(conversation: StoredConversation): boolean {
    return conversation.messages.length > 0 || conversation.draft.trim().length > 0;
  }

  function storeCurrentConversation(): void {
    const current = currentStoredConversation();
    const next = storedConversations.value.filter(
      (conversation) => conversation.sessionId !== current.sessionId
    );
    if (hasConversationContent(current)) {
      next.push(current);
    }
    storedConversations.value = next
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, MAX_STORED_CONVERSATIONS);
  }

  function persistConversations(): void {
    if (!persistenceStorage || !options.persistenceKey) return;
    storeCurrentConversation();
    const envelope: StoredConversationEnvelope = {
      version: 1,
      activeSessionId: sessionId.value,
      conversations: storedConversations.value
    };
    try {
      persistenceStorage.setItem(options.persistenceKey, JSON.stringify(envelope));
      persistenceErrorReported = false;
    } catch {
      if (!persistenceErrorReported) {
        persistenceErrorReported = true;
        options.onPersistenceError?.();
      }
    }
  }

  function scheduleConversationPersistence(): void {
    if (!persistenceStorage || !options.persistenceKey) return;
    if (persistenceTimer !== undefined) {
      globalThis.clearTimeout(persistenceTimer);
    }
    persistenceTimer = globalThis.setTimeout(() => {
      persistenceTimer = undefined;
      persistConversations();
    }, PERSISTENCE_DEBOUNCE_MS);
  }

  function flushConversationPersistence(): void {
    if (persistenceTimer !== undefined) {
      globalThis.clearTimeout(persistenceTimer);
      persistenceTimer = undefined;
    }
    persistConversations();
  }

  watch(
    [messages, draft, approvalMode, selectedModelId, thinkingLevel, temperature],
    () => {
      currentUpdatedAt.value = nextConversationTimestamp();
      scheduleConversationPersistence();
    },
    { deep: true, flush: "sync" }
  );

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      globalThis.clearTimeout(idleTimer);
      idleTimer = undefined;
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
    const completedAt = new Date().toISOString();
    finalizeRunningSubagents(message, "error", completedAt, messageText);
    if (message.processingStartedAt) {
      message.processingCompletedAt = completedAt;
    }
    rememberBounded(finishedRunIds, runId);
  }

  function markRunStopped(runId: string, eventRuntime?: AgentRuntimeRef): void {
    const messageId = runMessageIds.get(runId) ?? `${runId}_assistant`;
    let message = messages.value.find(
      (item) => item.id === messageId && item.role === "assistant" && item.runId === runId
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
    if (message.processingStartedAt) {
      message.processingCompletedAt = completedAt;
    }
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
        approvalModeByAttempt.delete(scope.attemptId);
      }
      submitting.value = false;
      stopping.value = false;
      conversationError.value = messageText;
      idleTimer = undefined;
    }, options.idleTimeoutMs ?? 5 * 60_000);
  }

  function failProtocol(runId: string, messageText: string, eventRuntime?: AgentRuntimeRef): void {
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
      if (!placeholder || messages.value.some((message) => message.id === messageId)) {
        failProtocol(runId, "智能体为同一运行返回了不一致的消息标识。", eventRuntime);
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
    return message;
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
    return message;
  }

  function ensureSubagentMessage(runId: string, createdAt: string): ChatMessage {
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
    return message;
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
    if (message.subagentRuns?.some((run) => run.parentToolCallId === toolCallId)) {
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
          : message.errorMessage ?? "父智能体运行异常结束，子任务同步停止。";
    }

    if (event.type === "subagent.started") {
      return;
    }

    if (event.type === "subagent.activity") {
      const activity = event.payload.activity;
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
                        resultSummary:
                          run.errorMessage ?? "子任务已经结束。",
                        isError: true
                      }
                    : {})
                })
          };
          run.toolCalls.push(toolCall);
        }
        if (!run.processingSteps.some(
          (step) => step.type === "tool" && step.toolCallId === activity.toolCallId
        )) {
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
      if (!run.processingSteps.some(
        (step) => step.type === "tool" && step.toolCallId === activity.toolCallId
      )) {
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
    rememberBounded(finishedRunIds, runId);
    if (activeRunId.value === runId) {
      activeRunId.value = null;
    }
    submitting.value = false;
    stopping.value = false;
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

  function rememberRunApprovalMode(runId: string, mode: AgentApprovalMode): void {
    approvalModeByRun.set(runId, mode);
    while (approvalModeByRun.size > 2_000) {
      const oldest = approvalModeByRun.keys().next().value as string | undefined;
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
    const tool = message?.tools?.find((candidate) => candidate.id === toolCallId);
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
    return mapped ?? messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    );
  }

  function ensureEditProposalMessage(runId: string, createdAt: string): ChatMessage {
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
    return message;
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

  function upsertEditProposal(
    runId: string,
    proposal: AgentEditProposal
  ): AgentEditProposal {
    const normalized = cloneEditProposal({ ...proposal, runId });
    const message = ensureEditProposalMessage(runId, normalized.createdAt);
    const proposals = message.editProposals ?? [];
    const existingIndex = proposals.findIndex((candidate) => candidate.id === normalized.id);
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
    const proposalIndex = message?.editProposals?.findIndex(
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
    if (finishedRunIds.has(runId) && !lateSubagentEvent) {
      return;
    }
    if (activeRunId.value && activeRunId.value !== runId && !lateSubagentEvent) {
      return;
    }
    if (!activeRunId.value && !lateSubagentEvent) {
      if (pendingAttemptId.value === null) {
        return;
      }
      const observedRunId = observedRunByAttempt.get(pendingAttemptId.value);
      if (observedRunId && observedRunId !== runId) {
        failProtocol(observedRunId, "同一次请求收到了多个运行标识。", runtime.value ?? undefined);
        return;
      }
      observedRunByAttempt.set(pendingAttemptId.value, runId);
      const pendingMode = approvalModeByAttempt.get(pendingAttemptId.value);
      if (pendingMode) rememberRunApprovalMode(runId, pendingMode);
      activeRunId.value = runId;
    }

    rememberBounded(handledEventIds, event.id);
    if (!lateSubagentEvent) {
      submitting.value = false;
      scheduleIdleTimeout({
        expectedEpoch: epoch,
        expectedSessionId: sessionId.value,
        runId
      });
    }

    if (subagentEvent) {
      handleSubagentEvent(event);
      return;
    }

    if (event.type === "agent.message_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime,
        event.timestamp
      );
      if (message) {
        message.content += event.payload.delta;
        message.processingStartedAt ??= event.timestamp;
        const lastStep = message.processingSteps?.at(-1);
        if (lastStep?.type === "response") {
          lastStep.content += event.payload.delta;
        } else {
          (message.processingSteps ??= []).push({
            id: event.id,
            type: "response",
            content: event.payload.delta,
            createdAt: event.timestamp
          });
        }
      }
      return;
    }

    if (event.type === "agent.thinking_delta") {
      const message = ensureAssistantMessage(
        runId,
        event.payload.messageId,
        event.payload.runtime,
        event.timestamp
      );
      if (message) {
        message.processingStartedAt ??= event.timestamp;
        const lastStep = message.processingSteps?.at(-1);
        if (lastStep?.type === "thinking") {
          lastStep.content += event.payload.delta;
          message.thinking = `${message.thinking ?? ""}${event.payload.delta}`;
        } else {
          (message.processingSteps ??= []).push({
            id: event.id,
            type: "thinking",
            content: event.payload.delta,
            createdAt: event.timestamp
          });
          message.thinking = message.thinking
            ? `${message.thinking}\n\n${event.payload.delta}`
            : event.payload.delta;
        }
      }
      return;
    }

    if (event.type === "tool.call_stream") {
      const message = ensureActivityMessage(runId, event.payload.runtime, event.timestamp);
      message.processingStartedAt ??= event.timestamp;
      let toolCall = event.payload.toolCallId
        ? message.toolCalls?.find((candidate) => candidate.id === event.payload.toolCallId)
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
        if (event.payload.toolCallId && previousId !== event.payload.toolCallId) {
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
      const message = ensureActivityMessage(runId, event.payload.runtime, event.timestamp);
      if (event.payload.toolName === "spawn_subagent") {
        ensurePendingSubagentRunForTool(
          message,
          event.payload.toolCallId,
          event.payload.args,
          event.payload.runtime,
          event.timestamp
        );
      }
      if (!message.tools?.some((tool) => tool.id === event.payload.toolCallId)) {
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
      const existing = message.toolCalls?.find(
        (toolCall) => toolCall.id === event.payload.toolCallId
      ) ?? [...(message.toolCalls ?? [])].reverse().find(
        (toolCall) =>
          toolCall.status === "preparing" && toolCall.name === event.payload.toolName
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
      if (!message.processingSteps?.some(
        (step) => step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )) {
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
      const message = ensureActivityMessage(runId, event.payload.runtime, event.timestamp);
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
      const existingTool = tools.find((tool) => tool.id === event.payload.toolCallId);
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
      if (!message.processingSteps?.some(
        (step) => step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )) {
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
    activeDocument: WorkspaceDocument,
    workspaceDocuments: WorkspaceDocument[] = [],
    attachments: WorkspaceContextAttachments = {},
    promptAttachments: UserPromptAttachment[] = []
  ): Promise<void> {
    const api = options.api();
    // Vue refs wrap objects in proxies, which Electron IPC cannot structured-clone.
    // Normalize at the API boundary so callers cannot accidentally leak proxies.
    const requestAttachments = promptAttachments.map((attachment) => ({ ...attachment }));
    const content = draft.value.trim() || (requestAttachments.length ? "请阅读并分析我上传的附件。" : "");
    if (!api) {
      conversationError.value = "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。";
      return;
    }
    if (!content || isBusy.value || hasPendingEditReview.value) {
      return;
    }

    const sendEpoch = epoch;
    const sendSessionId = sessionId.value;
    const attemptId = ++attemptSequence;
    const originalLength = activeDocument.content.length;
    const snapshotContent =
      activeDocument.workspaceType === "short" && activeDocument.stageId === "draft"
        ? activeDocument.content
        : activeDocument.content.slice(0, 20_000);
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
    if (attachments.attachedSkills?.length) {
      contextSnapshot.attachedSkills = attachments.attachedSkills.map((skill) => ({
        ...skill
      }));
    }
    if (attachments.attachedMaterials?.length) {
      contextSnapshot.attachedMaterials = attachments.attachedMaterials.map((material) => ({
        ...material
      }));
    }
    if (attachments.libraryWorkspace) {
      contextSnapshot.libraryWorkspace = LibraryAgentWorkspaceSnapshotSchema.parse(
        attachments.libraryWorkspace
      );
    }
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
      const stages = SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => {
        const document = liveStages.find(
          (candidate) =>
            candidate.stageId === stageId && candidate.draftFileKind === undefined
        );
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
      const draftSections = new Map<
        string,
        {
          id: string;
          order: number;
          title: string;
          wordCountRequirement: string;
          body?: WorkspaceDocument;
          characterState?: WorkspaceDocument;
        }
      >();
      for (const document of liveStages) {
        if (
          document.stageId !== "draft" ||
          !document.expertSectionId ||
          !document.draftFileKind
        ) {
          continue;
        }
        const current = draftSections.get(document.expertSectionId) ?? {
          id: document.expertSectionId,
          order: document.expertSectionOrder ?? Number.MAX_SAFE_INTEGER,
          title:
            document.draftFileKind === "body"
              ? document.title
              : document.title.replace(/\s*·\s*人物状态$/u, ""),
          wordCountRequirement: document.expertWordCountRequirement ?? ""
        };
        if (document.draftFileKind === "body") {
          current.title = document.title;
          current.wordCountRequirement = document.expertWordCountRequirement ?? "";
          current.body = document;
        } else {
          current.characterState = document;
        }
        draftSections.set(document.expertSectionId, current);
      }
      const completeDraftSections = [...draftSections.values()]
        .sort((left, right) => left.order - right.order)
        .flatMap((section) => {
        if (!section.body || !section.characterState) return [];
        return [
          {
            id: section.id,
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            body: {
              documentId: section.body.id,
              title: section.body.title,
              content: section.body.content,
              revision: createShortWorkspaceContentRevision(section.body.content)
            },
            characterState: {
              documentId: section.characterState.id,
              title: section.characterState.title,
              content: section.characterState.content,
              revision: createShortWorkspaceContentRevision(
                section.characterState.content
              )
            }
          }
        ];
        });
      if (
        completeStages.length === SHORT_WORKSPACE_TEXT_STAGE_IDS.length &&
        completeDraftSections.length > 0
      ) {
        const expertDraftRevision = createShortWorkspaceContentRevision(
          completeDraftSections
            .map(
              (section) =>
                `${section.id}\u0000${section.title}\u0000${section.wordCountRequirement}\u0000${section.body.revision}\u0000${section.characterState.revision}`
            )
            .join("\u0001")
        );
        contextSnapshot.shortWorkspace = {
          id: activeDocument.workspaceId,
          title: activeDocument.workspaceTitle,
          categories: [...(activeDocument.workspaceCategories ?? [])],
          activeStageId: activeDocument.stageId,
          ...(activeDocument.shortAgentId
            ? { activeAgentId: activeDocument.shortAgentId }
            : {}),
          ...(activeDocument.expertSectionId
            ? { activeSectionId: activeDocument.expertSectionId }
            : {}),
          expertDraft: {
            id: "draft",
            title: "正文",
            revision: expertDraftRevision,
            sections: completeDraftSections
          },
          stages: completeStages
        };
      }
    }

    messages.value.push({
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
    });
    draft.value = "";
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
        ...(requestAttachments.length ? { attachments: requestAttachments } : {}),
        writeApprovalMode: approvalModeByAttempt.get(attemptId),
        ...(selectedModelId.value ? { modelId: selectedModelId.value } : {}),
        ...(thinkingLevel.value === "off"
          ? {
              thinkingLevel: "off" as const,
              ...(selectedModel ? { temperature: temperature.value } : {})
            }
          : { thinkingLevel: thinkingLevel.value }),
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
        approvalModeByAttempt.delete(attemptId);
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
      approvalModeByAttempt.delete(attemptId);
      submitting.value = false;
      clearIdleTimer();
      conversationError.value = messageText;
    }
  }

  async function stopGeneration(): Promise<boolean> {
    const api = options.api();
    const runId = activeRunId.value;
    if (!api || !runId || stopping.value) {
      return false;
    }

    const stopEpoch = epoch;
    const stopSessionId = sessionId.value;
    stopping.value = true;
    try {
      const accepted = await api.session.abort({
        sessionId: stopSessionId,
        runId
      });
      if (
        accepted.sessionId !== stopSessionId ||
        accepted.runId !== runId
      ) {
        throw new Error("智能体停止结果与当前运行不一致。");
      }
      return true;
    } catch (error: unknown) {
      if (
        epoch !== stopEpoch ||
        sessionId.value !== stopSessionId ||
        activeRunId.value !== runId
      ) {
        return false;
      }
      stopping.value = false;
      throw error;
    }
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
    observedRunByAttempt.clear();
    approvalModeByAttempt.clear();
    approvalModeByRun.clear();
  }

  function stopStreamingMessages(): void {
    const completedAt = new Date().toISOString();
    for (const message of messages.value) {
      if (message.status !== "streaming") continue;
      message.status = "stopped";
      if (message.processingStartedAt && !message.processingCompletedAt) {
        message.processingCompletedAt = completedAt;
      }
    }
  }

  function newConversation(): void {
    stopStreamingMessages();
    flushConversationPersistence();
    resetTransientConversationState();
    const timestamp = nextConversationTimestamp();
    sessionId.value = id("session");
    messages.value = [];
    draft.value = "";
    currentCreatedAt.value = timestamp;
    currentUpdatedAt.value = timestamp;
    flushConversationPersistence();
  }

  function selectConversation(nextSessionId: string): boolean {
    if (nextSessionId === sessionId.value) return true;
    if (isBusy.value) return false;

    flushConversationPersistence();
    const selectedConversation = storedConversations.value.find(
      (conversation) => conversation.sessionId === nextSessionId
    );
    if (!selectedConversation) return false;

    resetTransientConversationState();
    sessionId.value = selectedConversation.sessionId;
    messages.value = selectedConversation.messages.map(cloneMessage);
    draft.value = selectedConversation.draft;
    currentCreatedAt.value = selectedConversation.createdAt;
    currentUpdatedAt.value = nextConversationTimestamp();
    flushConversationPersistence();
    return true;
  }

  function applyRunSettings(settings: AgentRunSettings): void {
    hasRunSettingsPreference = true;
    approvalMode.value = settings.approvalMode;
    if (configuredModels.value.length === 0) {
      if (modelSettingsApplied) {
        selectedModelId.value = "";
        thinkingLevel.value = "medium";
        temperature.value = 0.7;
      } else {
        selectedModelId.value = settings.selectedModelId;
        thinkingLevel.value = settings.thinkingLevel;
        temperature.value = settings.temperature;
      }
      return;
    }

    const preferredModel = configuredModels.value.find(
      (model) => model.id === settings.selectedModelId
    );
    const selected =
      preferredModel ??
      configuredModels.value.find((model) => model.id === defaultModelId.value) ??
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
      preferredModel && selected.temperatureOptions.includes(settings.temperature)
        ? settings.temperature
        : selected.temperatureOptions[1] ?? 0.7;
  }

  function applyModelSettings(settings: ModelSettings): void {
    const currentRunSettings: AgentRunSettings = {
      selectedModelId: selectedModelId.value,
      thinkingLevel: thinkingLevel.value,
      temperature: temperature.value,
      approvalMode: approvalMode.value
    };
    configuredModels.value = settings.models;
    defaultModelId.value = settings.defaultModelId;
    modelSettingsApplied = true;
    if (settings.models.length === 0) {
      selectedModelId.value = "";
      thinkingLevel.value = "medium";
      temperature.value = 0.7;
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
    hasRunSettingsPreference = true;
  }

  function selectModel(modelId: string): void {
    const selected = configuredModels.value.find((model) => model.id === modelId);
    if (!selected) {
      return;
    }
    selectedModelId.value = selected.id;
    thinkingLevel.value = selected.defaultThinkingLevel;
    temperature.value = selected.temperatureOptions[1];
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

  return {
    messages,
    draft,
    sessionId,
    approvalMode,
    thinkingLevel,
    temperature,
    configuredModels,
    selectedModelId,
    runtime,
    conversationError,
    history,
    isBusy,
    hasPendingEditReview,
    canSend,
    canSendAttachments,
    canStop,
    acceptsRunEvent,
    approvalModeForRun,
    markToolConflict,
    getEditProposal,
    upsertEditProposal,
    updateEditProposal,
    handleEvent,
    sendMessage,
    stopGeneration,
    newConversation,
    selectConversation,
    applyModelSettings,
    applyRunSettings,
    selectModel,
    selectThinkingLevel,
    selectTemperature,
    selectApprovalMode,
    useSuggestion(value: string): void {
      draft.value = value;
    },
    dispose(): void {
      flushConversationPersistence();
      epoch += 1;
      pendingAttemptId.value = null;
      activeRunId.value = null;
      approvalModeByAttempt.clear();
      approvalModeByRun.clear();
      stopping.value = false;
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
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
> {
  return (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}

function isSubagentEvent(event: SystemEventEnvelope): event is SubagentEventEnvelope {
  return (
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}
