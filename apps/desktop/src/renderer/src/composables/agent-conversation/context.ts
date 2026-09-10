import {
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from "vue";
import type {
  AgentRuntimeRef,
  AgentUserInputRequestedPayload,
  ModelConfig,
  ThinkingLevel
} from "@deepwrite/contracts";
import type { AgentApprovalMode, ChatMessage } from "../../types/conversation";
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

export interface AgentConversationState {
  options: UseAgentConversationOptions;
  storedEnvelope: AgentConversationPersistenceSnapshot | undefined;
  messages: Ref<ChatMessage[]>;
  draft: Ref<string>;
  sessionId: Ref<string>;
  approvalMode: Ref<AgentApprovalMode>;
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
  pendingAttemptId: Ref<number | null>;
  hasRunSettingsPreference: boolean;
  modelSettingsApplied: boolean;
  conversationClock: number;
  epoch: number;
  attemptSequence: number;
  idleTimer: number | undefined;
  persistenceErrorReported: boolean;
  persistenceMutationRevision: number;
  persistenceBatchDepth: number;
  persistenceBatchChanged: boolean;
  applyingPersistenceSnapshot: boolean;
  persistenceNotificationsEnabled: boolean;
  persistenceEmitHold: number;
  pendingAgentTextDelta: PendingAgentTextDelta | undefined;
  streamPresentationFrame: number | undefined;
  streamPresentationFallbackTimer: number | undefined;
}

export type AgentConversationContext = AgentConversationState & {
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
  const messages = ref<ChatMessage[]>(
    (storedActive?.messages ?? options.initialMessages ?? []).map(cloneMessage)
  );
  return {
    options,
    storedEnvelope,
    messages,
    draft: ref(storedActive?.draft ?? ""),
    sessionId: ref(storedActive?.sessionId ?? id("session")),
    approvalMode: ref<AgentApprovalMode>(
      storedActive?.approvalMode ?? "request-approval"
    ),
    thinkingLevel: ref<ThinkingLevel>("medium"),
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
    pendingAttemptId: ref<number | null>(null),
    hasRunSettingsPreference: false,
    modelSettingsApplied: false,
    conversationClock,
    epoch: 0,
    attemptSequence: 0,
    idleTimer: undefined,
    persistenceErrorReported: false,
    persistenceMutationRevision: 0,
    persistenceBatchDepth: 0,
    persistenceBatchChanged: false,
    applyingPersistenceSnapshot: false,
    persistenceNotificationsEnabled: true,
    persistenceEmitHold: 0,
    pendingAgentTextDelta: undefined,
    streamPresentationFrame: undefined,
    streamPresentationFallbackTimer: undefined
  };
}

export function nextConversationTimestamp(
  ctx: AgentConversationContext
): string {
  ctx.conversationClock = Math.max(Date.now(), ctx.conversationClock + 1);
  return new Date(ctx.conversationClock).toISOString();
}
