import * as persistenceController from "./persistence-controller";
import * as runLifecycle from "./run-lifecycle";
import * as messageIdentity from "./message-identity";
import * as turnRetry from "./turn-retry";
import * as subagentIdentity from "./subagent-identity";
import * as subagentRetry from "./subagent-retry";
import * as subagentEvents from "./subagent-events";
import * as approvals from "./approvals";
import * as streaming from "./streaming";
import * as events from "./events";
import * as sendMessage from "./send-message";
import * as sendEntrypoints from "./send-entrypoints";
import * as sessionLifecycle from "./session-lifecycle";
import * as runSettings from "./run-settings";
import type { AgentConversationContext } from "./context";
export function bindConversationOperations(
  ctx: AgentConversationContext
): void {
  ctx.nextConversationTimestamp =
    persistenceController.nextConversationTimestamp.bind(undefined, ctx);
  ctx.storeCurrentConversation =
    persistenceController.storeCurrentConversation.bind(undefined, ctx);
  ctx.capturePersistenceSnapshot =
    persistenceController.capturePersistenceSnapshot.bind(undefined, ctx);
  ctx.reportPersistenceError =
    persistenceController.reportPersistenceError.bind(undefined, ctx);
  ctx.observePersistenceResult =
    persistenceController.observePersistenceResult.bind(undefined, ctx);
  ctx.holdPersistenceEmits = persistenceController.holdPersistenceEmits.bind(
    undefined,
    ctx
  );
  ctx.releasePersistenceEmits =
    persistenceController.releasePersistenceEmits.bind(undefined, ctx);
  ctx.emitPersistenceSnapshot =
    persistenceController.emitPersistenceSnapshot.bind(undefined, ctx);
  ctx.runPersistenceBatch = (operation) =>
    persistenceController.runPersistenceBatch(ctx, operation);
  ctx.restorePersistenceSnapshot =
    persistenceController.restorePersistenceSnapshot.bind(undefined, ctx);
  ctx.clearIdleTimer = runLifecycle.clearIdleTimer.bind(undefined, ctx);
  ctx.clearRetryStateForRun = runLifecycle.clearRetryStateForRun.bind(
    undefined,
    ctx
  );
  ctx.finalizeRunningSubagents = runLifecycle.finalizeRunningSubagents.bind(
    undefined,
    ctx
  );
  ctx.markRunError = runLifecycle.markRunError.bind(undefined, ctx);
  ctx.markRunStopped = runLifecycle.markRunStopped.bind(undefined, ctx);
  ctx.invalidateAttemptForRun = runLifecycle.invalidateAttemptForRun.bind(
    undefined,
    ctx
  );
  ctx.scheduleIdleTimeout = runLifecycle.scheduleIdleTimeout.bind(
    undefined,
    ctx
  );
  ctx.failProtocol = runLifecycle.failProtocol.bind(undefined, ctx);
  ctx.finishRun = runLifecycle.finishRun.bind(undefined, ctx);
  ctx.assistantMessageForRun = messageIdentity.assistantMessageForRun.bind(
    undefined,
    ctx
  );
  ctx.ensureAssistantMessage = messageIdentity.ensureAssistantMessage.bind(
    undefined,
    ctx
  );
  ctx.ensureActivityMessage = messageIdentity.ensureActivityMessage.bind(
    undefined,
    ctx
  );
  ctx.ensureSubagentMessage = messageIdentity.ensureSubagentMessage.bind(
    undefined,
    ctx
  );
  ctx.retryMetadata = turnRetry.retryMetadata.bind(undefined, ctx);
  ctx.restoreMessageCheckpoint = turnRetry.restoreMessageCheckpoint.bind(
    undefined,
    ctx
  );
  ctx.handleTurnStarted = turnRetry.handleTurnStarted.bind(undefined, ctx);
  ctx.handleRetryScheduled = turnRetry.handleRetryScheduled.bind(
    undefined,
    ctx
  );
  ctx.acceptsRetryActivity = turnRetry.acceptsRetryActivity.bind(
    undefined,
    ctx
  );
  ctx.subagentTurnKey = subagentIdentity.subagentTurnKey.bind(undefined, ctx);
  ctx.earlierTimestamp = subagentIdentity.earlierTimestamp.bind(undefined, ctx);
  ctx.ensurePendingSubagentRunForTool =
    subagentIdentity.ensurePendingSubagentRunForTool.bind(undefined, ctx);
  ctx.ensureSubagentRun = subagentIdentity.ensureSubagentRun.bind(
    undefined,
    ctx
  );
  ctx.restoreSubagentCheckpoint = subagentRetry.restoreSubagentCheckpoint.bind(
    undefined,
    ctx
  );
  ctx.handleSubagentTurnStarted = subagentRetry.handleSubagentTurnStarted.bind(
    undefined,
    ctx
  );
  ctx.handleSubagentRetryScheduled =
    subagentRetry.handleSubagentRetryScheduled.bind(undefined, ctx);
  ctx.acceptsSubagentRetryActivity =
    subagentRetry.acceptsSubagentRetryActivity.bind(undefined, ctx);
  ctx.handleSubagentEvent = subagentEvents.handleSubagentEvent.bind(
    undefined,
    ctx
  );
  ctx.acceptsRunEvent = approvals.acceptsRunEvent.bind(undefined, ctx);
  ctx.rememberRunApprovalMode = approvals.rememberRunApprovalMode.bind(
    undefined,
    ctx
  );
  ctx.approvalModeForRun = approvals.approvalModeForRun.bind(undefined, ctx);
  ctx.markToolConflict = approvals.markToolConflict.bind(undefined, ctx);
  ctx.messageForEditProposal = approvals.messageForEditProposal.bind(
    undefined,
    ctx
  );
  ctx.ensureEditProposalMessage = approvals.ensureEditProposalMessage.bind(
    undefined,
    ctx
  );
  ctx.getEditProposal = approvals.getEditProposal.bind(undefined, ctx);
  ctx.listEditProposals = approvals.listEditProposals.bind(undefined, ctx);
  ctx.upsertEditProposal = approvals.upsertEditProposal.bind(undefined, ctx);
  ctx.updateEditProposal = approvals.updateEditProposal.bind(undefined, ctx);
  ctx.clearStreamPresentationSchedule =
    streaming.clearStreamPresentationSchedule.bind(undefined, ctx);
  ctx.applyAgentTextDelta = streaming.applyAgentTextDelta.bind(undefined, ctx);
  ctx.flushPendingAgentTextDelta = streaming.flushPendingAgentTextDelta.bind(
    undefined,
    ctx
  );
  ctx.scheduleStreamPresentation = streaming.scheduleStreamPresentation.bind(
    undefined,
    ctx
  );
  ctx.queueAgentTextDelta = streaming.queueAgentTextDelta.bind(undefined, ctx);
  ctx.handleEvent = events.handleEvent.bind(undefined, ctx);
  ctx.sendMessage = sendMessage.sendMessage.bind(undefined, ctx);
  ctx.sendAssistantMessage = sendEntrypoints.sendAssistantMessage.bind(
    undefined,
    ctx
  );
  ctx.resendMessage = sendEntrypoints.resendMessage.bind(undefined, ctx);
  ctx.sendLongMessage = sendEntrypoints.sendLongMessage.bind(undefined, ctx);
  ctx.resendLongMessage = sendEntrypoints.resendLongMessage.bind(
    undefined,
    ctx
  );
  ctx.cancelPendingGeneration = sessionLifecycle.cancelPendingGeneration.bind(
    undefined,
    ctx
  );
  ctx.resetTransientConversationState =
    sessionLifecycle.resetTransientConversationState.bind(undefined, ctx);
  ctx.stopStreamingMessages = sessionLifecycle.stopStreamingMessages.bind(
    undefined,
    ctx
  );
  ctx.newConversation = sessionLifecycle.newConversation.bind(undefined, ctx);
  ctx.selectConversation = sessionLifecycle.selectConversation.bind(
    undefined,
    ctx
  );
  ctx.applyRunSettings = runSettings.applyRunSettings.bind(undefined, ctx);
  ctx.applyModelSettings = runSettings.applyModelSettings.bind(undefined, ctx);
  ctx.selectModel = runSettings.selectModel.bind(undefined, ctx);
  ctx.selectThinkingLevel = runSettings.selectThinkingLevel.bind(
    undefined,
    ctx
  );
  ctx.selectWebSearchEnabled = runSettings.selectWebSearchEnabled.bind(
    undefined,
    ctx
  );
  ctx.selectTemperature = runSettings.selectTemperature.bind(undefined, ctx);
  ctx.selectApprovalMode = runSettings.selectApprovalMode.bind(undefined, ctx);
  ctx.selectAgentTeamMode = runSettings.selectAgentTeamMode.bind(
    undefined,
    ctx
  );
}
