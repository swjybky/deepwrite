import type { AgentConversationPersistenceSnapshot } from "./types";
export interface PersistenceControllerOperations {
  nextConversationTimestamp(): string;
  storeCurrentConversation(): void;
  capturePersistenceSnapshot(): AgentConversationPersistenceSnapshot;
  reportPersistenceError(): void;
  observePersistenceResult(result: void | Promise<void>): void;
  holdPersistenceEmits(): void;
  releasePersistenceEmits(): void;
  emitPersistenceSnapshot(): void;
  runPersistenceBatch<T>(operation: () => T): T;
  restorePersistenceSnapshot(snapshot: unknown): Promise<boolean>;
}
