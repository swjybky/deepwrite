import { computed, ref } from "vue";
import { useConversationStore } from "../stores/conversationStore";
import type { ConversationPersistenceProgress } from "../stores/conversationPersistenceQueue";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistenceKeys";
import { uiMessage } from "../ui-feedback";
import type { AgentConversationController } from "./useAgentConversation";

interface ConversationSaveStatusStore {
  controllers: ReadonlyMap<string, AgentConversationController>;
  persistenceProgress: ReadonlyMap<string, ConversationPersistenceProgress>;
  persistenceErrors: ReadonlyMap<string, unknown>;
  scheduleControllerPersistence(
    key: string,
    controller: AgentConversationController
  ): void;
  flushPersistence(key?: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "对话暂时无法保存到本机，请重试。";
}

export function createConversationSaveStatus(options: {
  sessionId: () => string;
  store: ConversationSaveStatusStore;
  showError: (message: string) => void;
}) {
  const retryingKey = ref<string>();
  const owner = computed(() => {
    const sessionId = options.sessionId();
    for (const [key, controller] of options.store.controllers) {
      if (controller.sessionId.value === sessionId)
        return { key: conversationHistoryPersistenceKey(key), controller };
    }
    return undefined;
  });
  const progress = computed(() =>
    owner.value
      ? options.store.persistenceProgress.get(owner.value.key)
      : undefined
  );
  const error = computed(() =>
    owner.value
      ? options.store.persistenceErrors.get(owner.value.key)
      : undefined
  );
  const status = computed(() => {
    if (error.value !== undefined || progress.value?.status === "error")
      return "error";
    const current = progress.value;
    if (current?.status === "saved" && current.confirmed < current.requested)
      return "pending";
    return current?.status;
  });
  const labels = {
    pending: "等待保存",
    saving: "正在保存",
    saved: "已保存",
    error: "保存失败"
  } as const;
  const label = computed(() => (status.value ? labels[status.value] : ""));
  const retrying = computed(
    () => !!owner.value && retryingKey.value === owner.value.key
  );
  function showError(): void {
    if (status.value === "error") options.showError(errorMessage(error.value));
  }
  async function retry(): Promise<void> {
    const current = owner.value;
    if (!current || retrying.value) return;
    retryingKey.value = current.key;
    try {
      options.store.scheduleControllerPersistence(
        current.key,
        current.controller
      );
      await options.store.flushPersistence(current.key);
    } catch (reason) {
      options.showError(errorMessage(reason));
    } finally {
      if (retryingKey.value === current.key) retryingKey.value = undefined;
    }
  }
  return { status, label, retrying, retry, showError };
}

export function useConversationSaveStatus(sessionId: () => string) {
  return createConversationSaveStatus({
    sessionId,
    store: useConversationStore(),
    showError: uiMessage.error
  });
}
