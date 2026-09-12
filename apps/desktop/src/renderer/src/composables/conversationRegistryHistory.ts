import type { ConversationHistoryApi } from "@deepwrite/contracts";
import { loadConversationHistoryRecord } from "../utils/conversationHistoryRecordLoader";
import { listConversationHistoryIndex } from "../utils/conversationHistoryIndex";
import type { UseAgentConversationOptions } from "./useAgentConversation";

type Management = NonNullable<UseAgentConversationOptions["historyManagement"]>;

export function createConversationRegistryHistory(
  api: ConversationHistoryApi,
  key: string
) {
  // Management is opened by the user; restoring the active conversation needs
  // only the paginated reader, not deletion receipts and recovery orchestration.
  let management: Promise<Management> | undefined;
  function getManagement(): Promise<Management> {
    management ??= import("./conversationRegistryHistoryManagement")
      .then(({ createRegistryHistoryManagement }) =>
        createRegistryHistoryManagement(api, key)
      )
      .catch((error: unknown) => {
        management = undefined;
        throw error;
      });
    return management;
  }
  const hooks: Pick<
    UseAgentConversationOptions,
    "loadHistoryRecord" | "historyManagement"
  > = {
    loadHistoryRecord: (sessionId) =>
      loadConversationHistoryRecord(api, key, sessionId),
    historyManagement: {
      delete: async (sessionId) => (await getManagement()).delete(sessionId),
      restore: async (sessionId) => (await getManagement()).restore(sessionId),
      listDeleted: async () => (await getManagement()).listDeleted()
    }
  };
  async function initialHistory(fallbackSessionId: string) {
    const index = await listConversationHistoryIndex(api, key);
    const activeSessionId = index.items.some(
      (item) => item.sessionId === index.activeSessionId
    )
      ? index.activeSessionId!
      : (index.items[0]?.sessionId ?? fallbackSessionId);
    const active = index.items.length
      ? await loadConversationHistoryRecord(api, key, activeSessionId)
      : undefined;
    return { ...index, activeSessionId, ...(active ? { active } : {}) };
  }
  return { hooks, initialHistory };
}
