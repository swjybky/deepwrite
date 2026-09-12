import type { AgentConversationController } from "../composables/useAgentConversation";
import { createConversationHistoryWrite } from "../utils/conversationHistoryWriter";
import type { ConversationPersistenceWork } from "./conversationPersistenceQueue";
import { HistoryPersistenceDeferredError } from "../composables/agent-conversation/history-management-errors";

interface ControllerPersistencePort {
  supportsIncrementalHistory(): boolean;
  schedulePersistenceWork(
    key: string,
    factory: () => ConversationPersistenceWork
  ): void;
  schedulePersistenceFactory(key: string, factory: () => unknown): void;
  invalidatePersistenceCache(key: string): void;
}

export function createControllerPersistenceScheduler(
  port: ControllerPersistencePort
) {
  return (key: string, controller: AgentConversationController): void => {
    if (!port.supportsIncrementalHistory()) {
      port.schedulePersistenceFactory(
        key,
        controller.capturePersistenceSnapshot
      );
      return;
    }
    port.schedulePersistenceWork(key, () => {
      const changes = controller.capturePersistenceChanges();
      let write: (() => Promise<void>) | undefined;
      return {
        retainOnFailure: true,
        ...(changes.deferredSessionIds?.length
          ? {
              deferredError: new HistoryPersistenceDeferredError(
                changes.deferredSessionIds
              )
            }
          : {}),
        async save(adapter) {
          if (!adapter.history)
            throw new Error("当前存储无法保存增量会话，请重试。");
          write ??= createConversationHistoryWrite(
            adapter.history,
            key,
            changes
          );
          await write();
        },
        confirmed() {
          controller.acknowledgePersistenceChanges(changes.revision);
          port.invalidatePersistenceCache(key);
        }
      };
    });
  };
}
