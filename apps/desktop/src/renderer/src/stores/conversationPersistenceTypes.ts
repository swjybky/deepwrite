import type { ConversationHistoryApi } from "@deepwrite/contracts/renderer";
export interface ConversationPersistenceAdapter {
  history?: ConversationHistoryApi;
  onBeforeClose?(handler: () => Promise<void>): () => void;
  prepareHistory?(logicalKey: string): Promise<void>;
  load(key: string): Promise<unknown | undefined>;
  save(key: string, value: unknown): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface ConversationPersistenceOptions {
  debounceMs?: number;
  onError?: (key: string, error: unknown) => void;
}
