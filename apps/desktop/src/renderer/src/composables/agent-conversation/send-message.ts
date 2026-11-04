import { formatError, getErrorCode, getErrorDetail } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { preparePromptContext } from "./request-context";
import type { AgentConversationContext } from "./context";
import type {
  ExtrasChatTask,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import { conversationPromptError } from "../../utils/conversationPromptBudget";
import { workspaceWebSearchPromptFields } from "./web-search";
import { buildConversationRestore } from "./history";
import {
  cancelContextCompaction,
  pendingContextCompaction
} from "./context-compaction";
import {
  conversationMessageRewriteIsCurrent,
  prepareConversationMessageRewrite
} from "./history-rewrite";
import type { WorkspaceContextAttachments } from "./types";
import {
  claimPendingActivityPlaceholder,
  createPendingAssistantMessage,
  discardPendingAssistantMessage
} from "./message-identity";
import { id, rememberBounded } from "./shared";
import { cloneChatTask, submitConversationTurn } from "./send-transport";
import { collectProposalSettlements } from "./proposal-settlements";

const t = createScopedTranslator("workspace.sendMessage");

type SendMessageContext = Pick<
  AgentConversationContext,
  | "options"
  | "messages"
  | "draft"
  | "conversationError"
  | "isBusy"
  | "hasPendingEditReview"
  | "deferredPersistenceSessions"
  | "resetTransientConversationState"
  | "unconfirmedUserMessageId"
  | "epoch"
  | "sessionId"
  | "sessionsRequiringHistoryReplacement"
  | "attemptSequence"
  | "agentTeamMode"
  | "runPersistenceBatch"
  | "pendingAttemptId"
  | "approvalModeByAttempt"
  | "approvalMode"
  | "submitting"
  | "scheduleIdleTimeout"
  | "configuredModels"
  | "selectedModelId"
  | "thinkingLevel"
  | "temperature"
  | "webSearchEnabled"
  | "observedRunByAttempt"
  | "failProtocol"
  | "messageMutations"
  | "runMessageIds"
  | "clearIdleTimer"
  | "finishedRunIds"
  | "runtime"
  | "rememberRunApprovalMode"
  | "activeRunId"
  | "markRunError"
  | "queuedDispatch"
  | "nextApprovalMode"
  | "nextAgentTeamMode"
>;
export async function sendMessage(
  ctx: SendMessageContext,
  activeDocument: WorkspaceDocument | null,
  workspaceDocuments: WorkspaceDocument[] = [],
  attachments: WorkspaceContextAttachments = {},
  promptAttachments: UserPromptAttachment[] = [],
  contextOverride?: WorkspaceRuntimeContext,
  chatTask?: ExtrasChatTask,
  rewriteRequest?: ConversationMessageRewriteRequest
): Promise<void> {
  const api = ctx.options.api();
  const preparedRewrite = rewriteRequest
    ? prepareConversationMessageRewrite(ctx.messages.value, rewriteRequest)
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
  const requestChatTask = chatTask ? cloneChatTask(chatTask) : undefined;
  // A queued follow-up brings its own words; the draft may hold the next one.
  const queued = preparedRewrite ? null : ctx.queuedDispatch;
  const content =
    preparedRewrite?.content ??
    (queued?.content ||
      ctx.draft.value.trim() ||
      (requestAttachments.length
        ? t("pleaseReadAndAnalyzeTheAttachmentsIUploaded")
        : ""));
  if (!api) {
    ctx.conversationError.value = t(
      "theBrowserPreviewHasNoDesktopAgentRuntimeStart"
    );
    return;
  }
  if (
    !content ||
    ctx.isBusy.value ||
    ctx.hasPendingEditReview.value ||
    ctx.deferredPersistenceSessions.value.has(ctx.sessionId.value)
  ) {
    return;
  }
  const promptError = conversationPromptError(
    content,
    ctx.options.contextCompactionBudgetTokens?.(),
    requestAttachments
  );
  if (promptError) {
    ctx.conversationError.value = promptError;
    return;
  }
  if (preparedRewrite) {
    ctx.resetTransientConversationState();
  }
  const persistenceRetryIndex = ctx.unconfirmedUserMessageId
    ? ctx.messages.value.findIndex(
        (message) => message.id === ctx.unconfirmedUserMessageId
      )
    : -1;
  const priorMessages = preparedRewrite
    ? ctx.messages.value.slice(0, preparedRewrite.targetIndex)
    : persistenceRetryIndex >= 0
      ? ctx.messages.value.slice(0, persistenceRetryIndex)
      : ctx.messages.value;
  const proposalSettlements = chatTask
    ? undefined
    : collectProposalSettlements(priorMessages);
  let conversationRestore: ReturnType<typeof buildConversationRestore>;
  try {
    conversationRestore = buildConversationRestore(priorMessages);
  } catch (error) {
    ctx.conversationError.value = formatError(
      error,
      t("couldNotRestoreHistory")
    );
    return;
  }
  const sendEpoch = ctx.epoch;
  const sendSessionId = ctx.sessionId.value;
  const replaceConversationHistory = Boolean(
    preparedRewrite ||
    ctx.sessionsRequiringHistoryReplacement.has(sendSessionId)
  );
  const attemptId = ++ctx.attemptSequence;
  const requestedAgentTeamMode =
    ctx.nextAgentTeamMode ?? ctx.agentTeamMode.value;
  const preparedContext = preparePromptContext(
    ctx,
    api,
    activeDocument,
    workspaceDocuments,
    attachments,
    contextOverride,
    requestChatTask !== undefined,
    sendEpoch,
    sendSessionId
  );
  const resolvedContext =
    preparedContext instanceof Promise
      ? await preparedContext
      : preparedContext;
  if (!resolvedContext) return;
  const { contextSnapshot } = resolvedContext;
  if (
    preparedRewrite &&
    !conversationMessageRewriteIsCurrent(ctx.messages.value, preparedRewrite)
  ) {
    return;
  }
  const userMessage: ChatMessage = {
    id: persistenceRetryIndex >= 0 ? ctx.unconfirmedUserMessageId! : id("user"),
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
  let pendingAssistantId: string | undefined;
  if (preparedRewrite) {
    ctx.runPersistenceBatch(() => {
      ctx.messages.value.splice(preparedRewrite.targetIndex);
      ctx.messages.value.push(userMessage);
      pendingAssistantId = createPendingAssistantMessage(ctx).id;
    });
    ctx.sessionsRequiringHistoryReplacement.add(sendSessionId);
  } else {
    if (persistenceRetryIndex >= 0)
      ctx.messages.value.splice(persistenceRetryIndex, 1, userMessage);
    else ctx.messages.value.push(userMessage);
    pendingAssistantId = createPendingAssistantMessage(ctx).id;
    if (queued) queued.markSent();
    else ctx.draft.value = "";
  }
  ctx.unconfirmedUserMessageId = userMessage.id;
  ctx.conversationError.value = null;
  ctx.pendingAttemptId.value = attemptId;
  ctx.approvalModeByAttempt.set(
    attemptId,
    ctx.nextApprovalMode ?? ctx.approvalMode.value
  );
  ctx.nextApprovalMode = null;
  ctx.nextAgentTeamMode = null;
  ctx.submitting.value = true;
  ctx.scheduleIdleTimeout({
    expectedEpoch: sendEpoch,
    expectedSessionId: sendSessionId,
    attemptId
  });
  let savedBeforeSending = !ctx.options.flushPersistence;
  try {
    if (ctx.options.flushPersistence) {
      await ctx.options.flushPersistence({ allowDeferred: true });
      savedBeforeSending = true;
      if (
        ctx.epoch !== sendEpoch ||
        ctx.sessionId.value !== sendSessionId ||
        ctx.pendingAttemptId.value !== attemptId
      ) {
        discardPendingAssistantMessage(ctx, pendingAssistantId);
        return;
      }
    }
    ctx.unconfirmedUserMessageId = undefined;
    const selectedModel = ctx.configuredModels.value.find(
      (model) => model.id === ctx.selectedModelId.value
    );
    const compaction = pendingContextCompaction(sendSessionId);
    const turn = {
      sessionId: sendSessionId,
      message: content,
      history: conversationRestore.history,
      ...(conversationRestore.checkpoint
        ? { checkpoint: conversationRestore.checkpoint }
        : {}),
      ...(compaction ? { compaction: { ...compaction } } : {}),
      replaceHistory: replaceConversationHistory,
      attachments: requestAttachments,
      model: {
        ...(ctx.selectedModelId.value
          ? { modelId: ctx.selectedModelId.value }
          : {}),
        ...(ctx.thinkingLevel.value === "off"
          ? {
              thinkingLevel: "off" as const,
              ...(selectedModel ? { temperature: ctx.temperature.value } : {})
            }
          : { thinkingLevel: ctx.thinkingLevel.value })
      }
    };
    const accepted = await submitConversationTurn(
      api,
      turn,
      requestChatTask
        ? { chatTask: requestChatTask }
        : {
            workspace: {
              writeApprovalMode: ctx.approvalModeByAttempt.get(attemptId),
              ...(proposalSettlements ? { proposalSettlements } : {}),
              ...(contextSnapshot?.shortWorkspace ||
              contextSnapshot?.scriptWorkspace ||
              contextSnapshot?.longWorkspace
                ? { agentTeamMode: requestedAgentTeamMode }
                : {}),
              autoApproveCrossStageOperations:
                ctx.options.autoApproveCrossStageOperations?.() === true,
              ...workspaceWebSearchPromptFields(ctx.webSearchEnabled.value),
              ...(contextSnapshot ? { workspaceContext: contextSnapshot } : {})
            }
          }
    );
    if (replaceConversationHistory && accepted.sessionId === sendSessionId) {
      ctx.sessionsRequiringHistoryReplacement.delete(sendSessionId);
    }
    if (compaction && accepted.sessionId === sendSessionId) {
      cancelContextCompaction(sendSessionId);
    }
    if (
      ctx.epoch !== sendEpoch ||
      ctx.sessionId.value !== sendSessionId ||
      ctx.pendingAttemptId.value !== attemptId
    ) {
      if (accepted.sessionId === sendSessionId) {
        void api.session
          .abort({
            sessionId: accepted.sessionId,
            runId: accepted.runId
          })
          .catch(() => undefined);
      }
      discardPendingAssistantMessage(ctx, pendingAssistantId);
      return;
    }
    if (accepted.sessionId !== sendSessionId) {
      const observedRunId = ctx.observedRunByAttempt.get(attemptId);
      if (observedRunId) {
        ctx.failProtocol(
          observedRunId,
          t("theAgentAcceptanceResponseReturnedTheWrongSessionId"),
          accepted.runtime
        );
      }
      ctx.pendingAttemptId.value = null;
      ctx.approvalModeByAttempt.delete(attemptId);
      ctx.submitting.value = false;
      ctx.clearIdleTimer();
      discardPendingAssistantMessage(ctx, pendingAssistantId);
      ctx.conversationError.value = t(
        "theAgentAcceptanceResponseReturnedTheWrongSessionId"
      );
      return;
    }
    const observedRunId = ctx.observedRunByAttempt.get(attemptId);
    if (observedRunId && observedRunId !== accepted.runId) {
      ctx.failProtocol(
        observedRunId,
        t("theAgentAcceptanceResponseHasADifferentRunId"),
        accepted.runtime
      );
      ctx.pendingAttemptId.value = null;
      ctx.observedRunByAttempt.delete(attemptId);
      ctx.approvalModeByAttempt.delete(attemptId);
      rememberBounded(ctx.finishedRunIds, accepted.runId);
      return;
    }
    ctx.runtime.value = accepted.runtime;
    const acceptedApprovalMode = ctx.approvalModeByAttempt.get(attemptId);
    if (acceptedApprovalMode) {
      ctx.rememberRunApprovalMode(accepted.runId, acceptedApprovalMode);
    }
    ctx.pendingAttemptId.value = null;
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    ctx.submitting.value = false;
    claimPendingActivityPlaceholder(ctx, accepted.runId, accepted.runtime);
    if (!ctx.finishedRunIds.has(accepted.runId)) {
      ctx.activeRunId.value = accepted.runId;
      ctx.scheduleIdleTimeout({
        expectedEpoch: sendEpoch,
        expectedSessionId: sendSessionId,
        runId: accepted.runId
      });
    } else {
      ctx.clearIdleTimer();
    }
  } catch (error: unknown) {
    if (
      ctx.epoch !== sendEpoch ||
      ctx.sessionId.value !== sendSessionId ||
      ctx.pendingAttemptId.value !== attemptId
    ) {
      discardPendingAssistantMessage(ctx, pendingAssistantId);
      return;
    }
    if (queued) queued.failed = true;
    else if (
      ctx.unconfirmedUserMessageId === userMessage.id &&
      !ctx.draft.value
    ) {
      ctx.draft.value = content;
    }
    const failureHeadline = t(
      savedBeforeSending
        ? "theAgentRequestCouldNotBeAccepted"
        : "couldNotSaveBeforeSending"
    );
    // Main rejects with the concrete reason (e.g. a team member's unknown
    // model); the headline alone would hide it.
    const rejectionDetail =
      getErrorCode(error) === "ipc.agent_command_failed"
        ? getErrorDetail(error)
        : undefined;
    const messageText = rejectionDetail
      ? `${failureHeadline} ${rejectionDetail}`
      : formatError(error, failureHeadline);
    const observedRunId = ctx.observedRunByAttempt.get(attemptId);
    if (observedRunId) {
      ctx.markRunError(
        observedRunId,
        messageText,
        ctx.runtime.value ?? undefined
      );
      if (ctx.activeRunId.value === observedRunId) {
        ctx.activeRunId.value = null;
      }
    }
    ctx.pendingAttemptId.value = null;
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    ctx.submitting.value = false;
    ctx.clearIdleTimer();
    discardPendingAssistantMessage(ctx, pendingAssistantId);
    ctx.conversationError.value = messageText;
  }
}
