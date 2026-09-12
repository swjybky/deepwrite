import { preparePromptContext } from "./request-context";
import type { AgentConversationContext } from "./context";
import type {
  ChatAssistantRequestContext,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import { normalizeChatAssistantRequestContext } from "./chat-assistant-request";
import { workspaceWebSearchPromptFields } from "./web-search";
import { buildConversationHistory } from "./history";
import {
  conversationMessageRewriteIsCurrent,
  prepareConversationMessageRewrite
} from "./history-rewrite";
import type { WorkspaceContextAttachments } from "./types";
import { id, rememberBounded } from "./shared";

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
  | "clearIdleTimer"
  | "finishedRunIds"
  | "runtime"
  | "rememberRunApprovalMode"
  | "activeRunId"
  | "markRunError"
>;
export async function sendMessage(
  ctx: SendMessageContext,
  activeDocument: WorkspaceDocument | null,
  workspaceDocuments: WorkspaceDocument[] = [],
  attachments: WorkspaceContextAttachments = {},
  promptAttachments: UserPromptAttachment[] = [],
  contextOverride?: WorkspaceRuntimeContext,
  mode: "workspace" | "chat-assistant" = "workspace",
  chatAssistant?: ChatAssistantRequestContext,
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
  const requestChatAssistant =
    normalizeChatAssistantRequestContext(chatAssistant);
  const content =
    preparedRewrite?.content ??
    (ctx.draft.value.trim() ||
      (requestAttachments.length ? "请阅读并分析我上传的附件。" : ""));
  if (!api) {
    ctx.conversationError.value =
      "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。";
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
  if (preparedRewrite) {
    ctx.resetTransientConversationState();
  }
  const persistenceRetryIndex = ctx.unconfirmedUserMessageId
    ? ctx.messages.value.findIndex(
        (message) => message.id === ctx.unconfirmedUserMessageId
      )
    : -1;
  const conversationHistory = buildConversationHistory(
    preparedRewrite
      ? ctx.messages.value.slice(0, preparedRewrite.targetIndex)
      : persistenceRetryIndex >= 0
        ? ctx.messages.value.slice(0, persistenceRetryIndex)
        : ctx.messages.value
  );
  const sendEpoch = ctx.epoch;
  const sendSessionId = ctx.sessionId.value;
  const replaceConversationHistory = Boolean(
    preparedRewrite ||
    ctx.sessionsRequiringHistoryReplacement.has(sendSessionId)
  );
  const attemptId = ++ctx.attemptSequence;
  const requestedAgentTeamMode = ctx.agentTeamMode.value;
  const preparedContext = preparePromptContext(
    ctx,
    api,
    activeDocument,
    workspaceDocuments,
    attachments,
    contextOverride,
    mode,
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
  if (preparedRewrite) {
    ctx.runPersistenceBatch(() => {
      ctx.messages.value.splice(preparedRewrite.targetIndex);
      ctx.messages.value.push(userMessage);
    });
    ctx.sessionsRequiringHistoryReplacement.add(sendSessionId);
  } else {
    if (persistenceRetryIndex >= 0)
      ctx.messages.value.splice(persistenceRetryIndex, 1, userMessage);
    else ctx.messages.value.push(userMessage);
    ctx.draft.value = "";
  }
  ctx.unconfirmedUserMessageId = userMessage.id;
  ctx.conversationError.value = null;
  ctx.pendingAttemptId.value = attemptId;
  ctx.approvalModeByAttempt.set(attemptId, ctx.approvalMode.value);
  ctx.submitting.value = true;
  ctx.scheduleIdleTimeout({
    expectedEpoch: sendEpoch,
    expectedSessionId: sendSessionId,
    attemptId
  });
  try {
    if (ctx.options.flushPersistence) {
      await ctx.options.flushPersistence({ allowDeferred: true });
      if (
        ctx.epoch !== sendEpoch ||
        ctx.sessionId.value !== sendSessionId ||
        ctx.pendingAttemptId.value !== attemptId
      )
        return;
    }
    ctx.unconfirmedUserMessageId = undefined;
    const selectedModel = ctx.configuredModels.value.find(
      (model) => model.id === ctx.selectedModelId.value
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
      ...(requestAttachments.length ? { attachments: requestAttachments } : {}),
      ...(mode === "chat-assistant"
        ? {}
        : {
            writeApprovalMode: ctx.approvalModeByAttempt.get(attemptId),
            ...(contextSnapshot?.shortWorkspace ||
            contextSnapshot?.scriptWorkspace ||
            contextSnapshot?.longWorkspace
              ? { agentTeamMode: requestedAgentTeamMode }
              : {}),
            autoApproveCrossStageOperations:
              ctx.options.autoApproveCrossStageOperations?.() === true
          }),
      ...(ctx.selectedModelId.value
        ? { modelId: ctx.selectedModelId.value }
        : {}),
      ...(ctx.thinkingLevel.value === "off"
        ? {
            thinkingLevel: "off" as const,
            ...(selectedModel ? { temperature: ctx.temperature.value } : {})
          }
        : { thinkingLevel: ctx.thinkingLevel.value }),
      ...(mode === "chat-assistant"
        ? {}
        : workspaceWebSearchPromptFields(ctx.webSearchEnabled.value)),
      ...(contextSnapshot ? { workspaceContext: contextSnapshot } : {})
    });
    if (replaceConversationHistory && accepted.sessionId === sendSessionId) {
      ctx.sessionsRequiringHistoryReplacement.delete(sendSessionId);
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
      return;
    }
    if (accepted.sessionId !== sendSessionId) {
      const observedRunId = ctx.observedRunByAttempt.get(attemptId);
      if (observedRunId) {
        ctx.failProtocol(
          observedRunId,
          "智能体受理结果返回了错误的会话标识。",
          accepted.runtime
        );
      }
      ctx.pendingAttemptId.value = null;
      ctx.approvalModeByAttempt.delete(attemptId);
      ctx.submitting.value = false;
      ctx.clearIdleTimer();
      ctx.conversationError.value = "智能体受理结果返回了错误的会话标识。";
      return;
    }
    const observedRunId = ctx.observedRunByAttempt.get(attemptId);
    if (observedRunId && observedRunId !== accepted.runId) {
      ctx.failProtocol(
        observedRunId,
        "智能体受理结果与已到达事件的运行标识不一致。",
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
      return;
    }
    if (ctx.unconfirmedUserMessageId === userMessage.id && !ctx.draft.value) {
      ctx.draft.value = content;
    }
    const messageText =
      error instanceof Error ? error.message : "智能体请求受理失败。";
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
    ctx.conversationError.value = messageText;
  }
}
