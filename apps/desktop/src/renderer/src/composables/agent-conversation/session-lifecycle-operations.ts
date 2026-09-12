export interface SessionLifecycleOperations {
  cancelPendingGeneration(): boolean;
  resetTransientConversationState(): void;
  stopStreamingMessages(): void;
  newConversation(): void;
  selectConversation(nextSessionId: string): boolean;
}
