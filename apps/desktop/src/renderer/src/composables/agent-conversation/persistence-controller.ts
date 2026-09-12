import type { AgentConversationContext } from "./context";
import { cloneMessage } from "./clone";
import {
  capturePersistenceSnapshot as captureConversationHistory,
  storeCurrentConversation as storeConversationHistory
} from "./persistence-history";
import { preserveLoadedConversations } from "./deferred-history";
import { parseAgentConversationPersistenceSnapshot } from "./persistence-snapshot";
import type { AgentConversationPersistenceSnapshot } from "./types";

type PersistenceControllerContext = Pick<
  AgentConversationContext,
  | "conversationClock"
  | "flushPendingAgentTextDelta"
  | "persistenceErrorReported"
  | "options"
  | "reportPersistenceError"
  | "persistenceEmitHold"
  | "persistenceEmitPending"
  | "persistenceNotificationsEnabled"
  | "applyingPersistenceSnapshot"
  | "observePersistenceResult"
  | "capturePersistenceSnapshot"
  | "persistenceBatchDepth"
  | "persistenceBatchChanged"
  | "emitPersistenceSnapshot"
  | "persistenceMutationRevision"
  | "storedEnvelope"
  | "messages"
  | "messageMutations"
  | "draft"
  | "storedConversations"
  | "isBusy"
  | "resetTransientConversationState"
  | "nextConversationTimestamp"
  | "sessionId"
  | "approvalMode"
  | "temperature"
  | "currentCreatedAt"
  | "currentUpdatedAt"
  | "persistenceJournal"
> &
  Parameters<typeof storeConversationHistory>[0];
export function nextConversationTimestamp(
  ctx: PersistenceControllerContext
): string {
  ctx.conversationClock = Math.max(Date.now(), ctx.conversationClock + 1);
  return new Date(ctx.conversationClock).toISOString();
}
export function storeCurrentConversation(
  ctx: PersistenceControllerContext
): void {
  storeConversationHistory(ctx);
}
export function capturePersistenceSnapshot(
  ctx: PersistenceControllerContext
): AgentConversationPersistenceSnapshot {
  ctx.flushPendingAgentTextDelta();
  return captureConversationHistory(ctx);
}
export function reportPersistenceError(
  ctx: PersistenceControllerContext
): void {
  if (ctx.persistenceErrorReported) return;
  ctx.persistenceErrorReported = true;
  ctx.options.onPersistenceError?.();
}
export function observePersistenceResult(
  ctx: PersistenceControllerContext,
  result: void | Promise<void>
): void {
  if (!result || typeof result.then !== "function") {
    ctx.persistenceErrorReported = false;
    return;
  }
  void result.then(
    () => {
      ctx.persistenceErrorReported = false;
    },
    () => {
      ctx.reportPersistenceError();
    }
  );
}
export function holdPersistenceEmits(ctx: PersistenceControllerContext): void {
  ctx.persistenceEmitHold += 1;
}
export function releasePersistenceEmits(
  ctx: PersistenceControllerContext
): void {
  if (ctx.persistenceEmitHold === 0) return;
  ctx.persistenceEmitHold = Math.max(0, ctx.persistenceEmitHold - 1);
  if (ctx.persistenceEmitHold === 0 && ctx.persistenceEmitPending) {
    if (ctx.persistenceBatchDepth > 0) ctx.persistenceBatchChanged = true;
    else ctx.emitPersistenceSnapshot();
  }
}
export function emitPersistenceSnapshot(
  ctx: PersistenceControllerContext
): void {
  if (
    !ctx.persistenceNotificationsEnabled ||
    ctx.applyingPersistenceSnapshot ||
    (!ctx.options.onPersistenceChange && !ctx.options.onPersistenceSnapshot)
  ) {
    return;
  }
  // Hydration delays automatic writes, but local edits and run events must
  // still advance the journal, including after an explicit durable send ACK.
  if (ctx.persistenceEmitHold > 0) {
    ctx.persistenceEmitPending = true;
    return;
  }
  ctx.persistenceEmitPending = false;
  try {
    ctx.observePersistenceResult(
      ctx.options.onPersistenceChange
        ? ctx.options.onPersistenceChange()
        : ctx.options.onPersistenceSnapshot!(ctx.capturePersistenceSnapshot())
    );
  } catch {
    ctx.reportPersistenceError();
  }
}
export function runPersistenceBatch<T>(
  ctx: PersistenceControllerContext,
  operation: () => T
): T {
  ctx.persistenceBatchDepth += 1;
  try {
    return operation();
  } finally {
    ctx.persistenceBatchDepth -= 1;
    if (ctx.persistenceBatchDepth === 0 && ctx.persistenceBatchChanged) {
      ctx.persistenceBatchChanged = false;
      ctx.emitPersistenceSnapshot();
    }
  }
}
export async function restorePersistenceSnapshot(
  ctx: PersistenceControllerContext,
  snapshot: unknown
): Promise<boolean> {
  const parsed = parseAgentConversationPersistenceSnapshot(snapshot);
  if (!parsed) return false;
  const expectedRevision = ctx.persistenceMutationRevision;
  // Yield once so edits made while an asynchronously loaded snapshot is
  // being handed to the controller win over the older persisted state.
  await Promise.resolve();
  if (!ctx.persistenceNotificationsEnabled) return false;
  if (
    expectedRevision !== 0 ||
    ctx.persistenceMutationRevision !== expectedRevision ||
    ctx.storedEnvelope !== undefined ||
    ctx.options.initialMessages?.length ||
    ctx.messages.value.length > 0 ||
    ctx.draft.value.length > 0 ||
    ctx.storedConversations.value.length > 0 ||
    ctx.isBusy.value
  ) {
    ctx.storedConversations.value = preserveLoadedConversations(
      ctx.capturePersistenceSnapshot(),
      parsed
    );
    return false;
  }
  ctx.applyingPersistenceSnapshot = true;
  try {
    ctx.resetTransientConversationState();
    ctx.storedConversations.value = parsed.conversations.map(
      (conversation) => ({
        ...conversation,
        messages: conversation.messages.map(cloneMessage)
      })
    );
    const active = ctx.storedConversations.value.find(
      (conversation) => conversation.sessionId === parsed.activeSessionId
    );
    const restoredTimestamp =
      active?.updatedAt ?? ctx.nextConversationTimestamp();
    ctx.conversationClock = Math.max(
      ctx.conversationClock,
      ...ctx.storedConversations.value.map((conversation) =>
        Date.parse(conversation.updatedAt)
      )
    );
    ctx.sessionId.value = active?.sessionId ?? parsed.activeSessionId;
    ctx.messageMutations.replaceLoaded(
      (active?.messages ?? []).map(cloneMessage)
    );
    ctx.draft.value = active?.draft ?? "";
    ctx.approvalMode.value = active?.approvalMode ?? "request-approval";
    ctx.temperature.value = active?.temperature ?? 0.7;
    ctx.currentCreatedAt.value = active?.createdAt ?? restoredTimestamp;
    ctx.currentUpdatedAt.value = restoredTimestamp;
    ctx.persistenceMutationRevision = 0;
    ctx.persistenceJournal.reset();
    ctx.persistenceBatchChanged = false;
  } finally {
    ctx.applyingPersistenceSnapshot = false;
  }
  return true;
}
