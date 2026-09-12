import { createId } from "@deepwrite/shared";
import type {
  ConversationHistoryApi,
  ConversationHistoryBatch,
  ConversationHistorySession
} from "@deepwrite/contracts";
import { loadConversationHistoryRecord } from "../utils/conversationHistoryRecordLoader";
import { listConversationHistoryIndex } from "../utils/conversationHistoryIndex";
import { invalidateConversationHistoryCursor } from "../utils/conversationHistoryWriter";
import { HistoryDeletionNotCommittedError } from "./agent-conversation/history-management-errors";
import type {
  AgentConversationPersistenceRecord,
  UseAgentConversationOptions
} from "./useAgentConversation";

type PendingMutation = {
  batch: ConversationHistoryBatch;
  record?: AgentConversationPersistenceRecord;
};

export function createRegistryHistoryManagement(
  api: ConversationHistoryApi,
  key: string
): NonNullable<UseAgentConversationOptions["historyManagement"]> {
  const pending = new Map<string, PendingMutation>();
  const preparing = new Map<string, Promise<PendingMutation>>();
  async function prepare(
    sessionId: string,
    deleted: boolean
  ): Promise<PendingMutation> {
    const identity = JSON.stringify([sessionId, deleted]);
    const previous = pending.get(identity);
    const session: ConversationHistorySession | null = await api.session({
      key,
      sessionId,
      maxBytes: 64 * 1024
    });
    if (!session) throw new Error("此历史对话已不存在。");
    // Preserve the exact request after an uncertain acknowledgement. A rejected
    // operation can be prepared again once a later write changed its precondition.
    if (
      previous &&
      (session.revision === previous.batch.expectedRevision ||
        session.deleted === deleted)
    )
      return previous;
    pending.delete(identity);
    // Validate every restored message before changing the soft-deleted state.
    const record = deleted
      ? undefined
      : await loadConversationHistoryRecord(api, key, sessionId, {
          session,
          allowDeleted: true
        });
    const operation: PendingMutation = {
      batch: {
        key,
        sessionId,
        batchId: createId("history_management"),
        expectedRevision: session.revision,
        generation: session.generation,
        sequence: session.sequence + 1,
        operations: [{ type: "setDeleted", deleted }]
      },
      ...(record ? { record } : {})
    };
    pending.set(identity, operation);
    return operation;
  }
  async function change(sessionId: string, deleted: boolean) {
    const identity = JSON.stringify([sessionId, deleted]);
    let preparation = preparing.get(identity);
    if (!preparation) {
      preparation = prepare(sessionId, deleted);
      preparing.set(identity, preparation);
    }
    let operation: PendingMutation;
    try {
      operation = await preparation;
    } finally {
      if (preparing.get(identity) === preparation) preparing.delete(identity);
    }
    const receipt = await api.commit(operation.batch);
    if (receipt.batchId !== operation.batch.batchId)
      throw new Error("历史管理确认编号不匹配，请重试。");
    const current = await api.session({ key, sessionId, maxBytes: 4096 });
    if (!current || current.deleted !== deleted) {
      pending.delete(identity);
      throw new Error("会话状态已变化，请刷新历史后重试。");
    }
    const record =
      !deleted && current.revision !== receipt.revision
        ? await loadConversationHistoryRecord(api, key, sessionId, {
            session: current
          })
        : operation.record;
    invalidateConversationHistoryCursor(api, key, sessionId);
    pending.delete(identity);
    return record;
  }
  return {
    async delete(sessionId) {
      try {
        await change(sessionId, true);
      } catch (error: unknown) {
        // Core serializes writes and these reads. An authoritative undeleted
        // state releases isolation; an unreadable/committed state keeps the batch.
        let current: ConversationHistorySession | null | undefined;
        try {
          current = await api.session({ key, sessionId, maxBytes: 4096 });
        } catch {
          /* The acknowledgement remains uncertain. */
        }
        if (current !== undefined && !current?.deleted) {
          pending.delete(JSON.stringify([sessionId, true]));
          invalidateConversationHistoryCursor(api, key, sessionId);
          throw new HistoryDeletionNotCommittedError(error);
        }
        throw error;
      }
    },
    async restore(sessionId) {
      return (await change(sessionId, false))!;
    },
    async listDeleted() {
      return (await listConversationHistoryIndex(api, key, true)).items;
    }
  };
}
