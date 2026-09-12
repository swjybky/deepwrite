import {
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import type {
  AgentRuntimeRef,
  AgentTeamRunMode,
  AgentUserInputRequestedPayload,
  ModelConfig,
  ThinkingLevel
} from "@deepwrite/contracts";
import type {
  AgentApprovalMode,
  ChatMessage,
  ConversationHistoryItem
} from "../../types/conversation";
import { cloneMessage } from "./clone";
import { parseAgentConversationPersistenceSnapshot } from "./persistence-snapshot";
import { id } from "./shared";
import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot,
  AgentTurnCheckpoint,
  PendingAgentTextDelta,
  SubagentTurnCheckpoint,
  UseAgentConversationOptions
} from "./types";

import type { AgentConversationOperations } from "./operations";
import type { AgentUserInputController } from "./user-input";

import {
  createTrackedMessages,
  type TrackedMessages
} from "./message-mutations";

import type { ConversationPersistenceJournal } from "./persistence-journal";

export interface AgentConversationState {
  messageMutations: TrackedMessages;
  options: UseAgentConversationOptions;
  storedEnvelope: AgentConversationPersistenceSnapshot | undefined;
  messages: Ref<ChatMessage[]>;
  draft: Ref<string>;
  sessionId: Ref<string>;
  approvalMode: Ref<AgentApprovalMode>;
  agentTeamMode: Ref<AgentTeamRunMode>;
  webSearchEnabled: Ref<boolean>;
  thinkingLevel: Ref<ThinkingLevel>;
  temperature: Ref<number>;
  configuredModels: Ref<ModelConfig[]>;
  defaultModelId: Ref<string>;
  selectedModelId: Ref<string>;
  runtime: Ref<AgentRuntimeRef | null>;
  conversationError: Ref<string | null>;
  pendingUserInput: Ref<AgentUserInputRequestedPayload | null>;
  submittingUserInput: Ref<boolean>;
  storedConversations: ShallowRef<AgentConversationPersistenceRecord[]>;
  remoteHistoryItems: ShallowRef<ConversationHistoryItem[]>;
  historyOperationPending: Ref<boolean>;
  deferredPersistenceSessions: ShallowRef<ReadonlySet<string>>;
  currentCreatedAt: Ref<string>;
  currentUpdatedAt: Ref<string>;
  submitting: Ref<boolean>;
  stopping: Ref<boolean>;
  activeRunId: Ref<string | null>;
  handledEventIds: Set<string>;
  finishedRunIds: Set<string>;
  runMessageIds: Map<string, string>;
  turnCheckpointByRun: Map<string, AgentTurnCheckpoint>;
  subagentTurnCheckpointByRun: Map<string, SubagentTurnCheckpoint>;
  seenTurnIds: Set<string>;
  seenSubagentTurnIds: Set<string>;
  observedRunByAttempt: Map<number, string>;
  approvalModeByAttempt: Map<number, AgentApprovalMode>;
  approvalModeByRun: Map<string, AgentApprovalMode>;
  sessionsRequiringHistoryReplacement: Set<string>;
  pendingAttemptId: Ref<number | null>;
  hasRunSettingsPreference: boolean;
  modelSettingsApplied: boolean;
  conversationClock: number;
  epoch: number;
  attemptSequence: number;
  unconfirmedUserMessageId: string | undefined;
  idleTimer: number | undefined;
  persistenceErrorReported: boolean;
  persistenceMutationRevision: number;
  persistenceBatchDepth: number;
  persistenceBatchChanged: boolean;
  applyingPersistenceSnapshot: boolean;
  persistenceNotificationsEnabled: boolean;
  persistenceEmitHold: number;
  persistenceEmitPending: boolean;
  pendingAgentTextDelta: PendingAgentTextDelta | undefined;
  streamPresentationFrame: number | undefined;
  streamPresentationFallbackTimer: number | undefined;
}

export type AgentConversationContext = AgentConversationState &
  AgentConversationOperations & {
    userInput: AgentUserInputController;
    persistenceJournal: ConversationPersistenceJournal;
    stopPersistenceWatch(): void;
    stopGeneration(): Promise<boolean>;
    history: Readonly<Ref<ConversationHistoryItem[]>>;
    canSend: ComputedRef<boolean>;
    canSendAttachments: ComputedRef<boolean>;
    canRewriteHistory: ComputedRef<boolean>;
    canStop: ComputedRef<boolean>;
    isBusy: ComputedRef<boolean>;
    hasPendingEditReview: ComputedRef<boolean>;
  };

export function createAgentConversationState(
  options: UseAgentConversationOptions
): AgentConversationState {
  const storedEnvelope = parseAgentConversationPersistenceSnapshot(
    options.initialPersistenceSnapshot
  );
  const storedActive = storedEnvelope?.conversations.find(
    (conversation) => conversation.sessionId === storedEnvelope.activeSessionId
  );
  const conversationClock = Math.max(
    Date.now(),
    ...(storedEnvelope?.conversations.map((conversation) =>
      Date.parse(conversation.updatedAt)
    ) ?? [])
  );
  const initialTimestamp = new Date(conversationClock).toISOString();
  const messageMutations = createTrackedMessages(
    (storedActive?.messages ?? options.initialMessages ?? []).map(cloneMessage)
  );
  const messages = messageMutations.messages;
  return {
    options,
    messageMutations,
    storedEnvelope,
    messages,
    draft: ref(storedActive?.draft ?? ""),
    sessionId: ref(storedActive?.sessionId ?? id("session")),
    approvalMode: ref<AgentApprovalMode>(
      storedActive?.approvalMode ?? "request-approval"
    ),
    thinkingLevel: ref<ThinkingLevel>("medium"),
    agentTeamMode: ref<AgentTeamRunMode>("normal"),
    webSearchEnabled: ref(false),
    temperature: ref(storedActive?.temperature ?? 0.7),
    configuredModels: ref<ModelConfig[]>([]),
    defaultModelId: ref(""),
    selectedModelId: ref(""),
    runtime: ref<AgentRuntimeRef | null>(null),
    conversationError: ref<string | null>(null),
    pendingUserInput: ref<AgentUserInputRequestedPayload | null>(null),
    submittingUserInput: ref(false),
    storedConversations: shallowRef<AgentConversationPersistenceRecord[]>(
      (storedEnvelope?.conversations ?? []).map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map(cloneMessage)
      }))
    ),
    remoteHistoryItems: shallowRef<ConversationHistoryItem[]>([]),
    historyOperationPending: ref(false),
    deferredPersistenceSessions: shallowRef<ReadonlySet<string>>(new Set()),
    currentCreatedAt: ref(
      storedActive?.createdAt ??
        messages.value[0]?.createdAt ??
        initialTimestamp
    ),
    currentUpdatedAt: ref(storedActive?.updatedAt ?? initialTimestamp),
    submitting: ref(false),
    stopping: ref(false),
    activeRunId: ref<string | null>(null),
    handledEventIds: new Set<string>(),
    finishedRunIds: new Set<string>(),
    runMessageIds: new Map<string, string>(),
    turnCheckpointByRun: new Map<string, AgentTurnCheckpoint>(),
    subagentTurnCheckpointByRun: new Map<string, SubagentTurnCheckpoint>(),
    seenTurnIds: new Set<string>(),
    seenSubagentTurnIds: new Set<string>(),
    observedRunByAttempt: new Map<number, string>(),
    approvalModeByAttempt: new Map<number, AgentApprovalMode>(),
    approvalModeByRun: new Map<string, AgentApprovalMode>(),
    sessionsRequiringHistoryReplacement: new Set<string>(),
    pendingAttemptId: ref<number | null>(null),
    hasRunSettingsPreference: false,
    modelSettingsApplied: false,
    conversationClock,
    epoch: 0,
    attemptSequence: 0,
    unconfirmedUserMessageId: undefined,
    idleTimer: undefined,
    persistenceErrorReported: false,
    persistenceMutationRevision: 0,
    persistenceBatchDepth: 0,
    persistenceBatchChanged: false,
    applyingPersistenceSnapshot: false,
    persistenceNotificationsEnabled: true,
    persistenceEmitHold: 0,
    persistenceEmitPending: false,
    pendingAgentTextDelta: undefined,
    streamPresentationFrame: undefined,
    streamPresentationFallbackTimer: undefined
  };
}
