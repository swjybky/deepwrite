import type { AgentConversationContext } from "./context";
import {
  applyHistoryRecord,
  validateHistoryRecord,
  type ConversationHistoryLoader
} from "./history-loading";
import {
  HistoryDeletionNotCommittedError,
  HistoryPersistenceDeferredError
} from "./history-management-errors";
import { id } from "./shared";
import type { AgentConversationPersistenceRecord } from "./types";

type ManagementContext = Parameters<typeof applyHistoryRecord>[0] &
  Pick<
    AgentConversationContext,
    | "history"
    | "nextConversationTimestamp"
    | "emitPersistenceSnapshot"
    | "deferredPersistenceSessions"
  >;
interface PendingDeletion {
  revision: number;
  successor?: AgentConversationPersistenceRecord;
}

export function createHistoryManagement(
  ctx: ManagementContext,
  loader: ConversationHistoryLoader
) {
  const backend = ctx.options.historyManagement;
  const pendingDeletions = new Map<string, PendingDeletion>();

  function newRecord(): AgentConversationPersistenceRecord {
    const timestamp = ctx.nextConversationTimestamp();
    return {
      sessionId: id("session"),
      messages: [],
      draft: "",
      approvalMode: ctx.approvalMode.value,
      temperature: ctx.temperature.value,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
  function setDeferred(sessionId: string, deferred: boolean) {
    const sessions = new Set(ctx.deferredPersistenceSessions.value);
    if (sessions.has(sessionId) === deferred) return;
    if (deferred) sessions.add(sessionId);
    else sessions.delete(sessionId);
    ctx.deferredPersistenceSessions.value = sessions;
    // Capture membership changed even when no message did. Its checkpoint must
    // differ from an in-flight capture that excluded this session.
    ctx.persistenceMutationRevision++;
  }
  function finishDeletion(sessionId: string, deletion: PendingDeletion) {
    const active = ctx.sessionId.value === sessionId;
    const changed = ctx.persistenceJournal.hasChangesAfter(
      sessionId,
      deletion.revision
    );
    const source = active
      ? {
          sessionId,
          messages: ctx.messages.value,
          draft: ctx.draft.value,
          approvalMode: ctx.approvalMode.value,
          temperature: ctx.temperature.value,
          createdAt: ctx.currentCreatedAt.value,
          updatedAt: ctx.currentUpdatedAt.value
        }
      : ctx.storedConversations.value.find(
          (record) => record.sessionId === sessionId
        );
    const identity = changed && source ? newRecord() : undefined;
    const replacement =
      identity && source
        ? {
            ...source,
            sessionId: identity.sessionId,
            createdAt: identity.createdAt,
            updatedAt: identity.updatedAt
          }
        : undefined;
    ctx.applyingPersistenceSnapshot = true;
    try {
      ctx.storedConversations.value = ctx.storedConversations.value.filter(
        (record) => record.sessionId !== sessionId
      );
      ctx.remoteHistoryItems.value = ctx.remoteHistoryItems.value.filter(
        (item) => item.sessionId !== sessionId
      );
      ctx.persistenceJournal.forgetSession(sessionId);
      if (active) {
        if (replacement) {
          // Transfer late edits to a fresh identity; never submit them to the deleted generation.
          ctx.resetTransientConversationState();
          ctx.sessionId.value = replacement.sessionId;
          ctx.currentCreatedAt.value = replacement.createdAt;
          ctx.currentUpdatedAt.value = replacement.updatedAt;
        } else {
          const stored = ctx.storedConversations.value.find(
            (record) => record.sessionId === deletion.successor?.sessionId
          );
          const successor = stored ?? deletion.successor;
          if (successor && !stored) loader.installRecord(successor);
          applyHistoryRecord(ctx, successor ?? newRecord());
        }
      } else if (replacement) {
        // The user may have switched away while the deletion acknowledgement was unresolved.
        ctx.storedConversations.value = [
          ...ctx.storedConversations.value,
          replacement
        ];
      }
      pendingDeletions.delete(sessionId);
      setDeferred(sessionId, false);
    } finally {
      ctx.applyingPersistenceSnapshot = false;
    }
    ctx.persistenceMutationRevision++;
    if (active) ctx.persistenceJournal.record({ type: "structure" });
    // Also release a deferred queue entry when an inactive session had no late edits.
    ctx.emitPersistenceSnapshot();
  }
  async function deleteConversation(sessionId: string): Promise<boolean> {
    if (!backend || ctx.isBusy.value || !ctx.persistenceNotificationsEnabled)
      return false;
    ctx.epoch++;
    ctx.historyOperationPending.value = true;
    try {
      let deletion = pendingDeletions.get(sessionId);
      if (!deletion) {
        await ctx.options.flushPersistence?.({ allowDeferred: true });
        const nextId =
          ctx.sessionId.value === sessionId
            ? ctx.history.value.find(
                (item) =>
                  item.sessionId !== sessionId &&
                  !pendingDeletions.has(item.sessionId)
              )?.sessionId
            : undefined;
        const successor = nextId ? await loader.loadRecord(nextId) : undefined;
        await ctx.options.flushPersistence?.({ allowDeferred: true });
        deletion = {
          revision: ctx.persistenceMutationRevision,
          ...(successor ? { successor } : {})
        };
        // The preceding flush drained this session's ordinary writer. All subsequent
        // captures exclude it until the exact management batch has been resolved.
        pendingDeletions.set(sessionId, deletion);
        setDeferred(sessionId, true);
        ctx.emitPersistenceSnapshot();
      }
      try {
        // A retry resolves the original management request BEFORE any ordinary flush.
        await backend.delete(sessionId);
      } catch (error: unknown) {
        if (error instanceof HistoryDeletionNotCommittedError) {
          pendingDeletions.delete(sessionId);
          setDeferred(sessionId, false);
          ctx.emitPersistenceSnapshot();
        }
        throw error;
      }
      if (ctx.persistenceNotificationsEnabled)
        finishDeletion(sessionId, deletion);
      return true;
    } finally {
      ctx.historyOperationPending.value = false;
    }
  }
  async function restoreConversation(sessionId: string): Promise<boolean> {
    if (!backend || ctx.isBusy.value || !ctx.persistenceNotificationsEnabled)
      return false;
    if (pendingDeletions.has(sessionId))
      throw new HistoryPersistenceDeferredError([sessionId]);
    ctx.epoch++;
    ctx.historyOperationPending.value = true;
    try {
      await ctx.options.flushPersistence?.({ allowDeferred: true });
      const record = validateHistoryRecord(
        await backend.restore(sessionId),
        sessionId
      );
      if (ctx.persistenceNotificationsEnabled) loader.installRecord(record);
      return true;
    } finally {
      ctx.historyOperationPending.value = false;
    }
  }
  return {
    historyManagementAvailable: Boolean(backend),
    async listDeletedConversations() {
      return ((await backend?.listDeleted()) ?? []).filter(
        (item) => !pendingDeletions.has(item.sessionId)
      );
    },
    deleteConversation,
    restoreConversation
  };
}
