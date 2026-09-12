import { computed, shallowRef } from "vue";
import { useConversationStore } from "../stores/conversationStore";
import { uiMessage } from "../ui-feedback";
import type { CurrentExportOperation } from "../utils/conversation-export/action";
const active = shallowRef<CurrentExportOperation>();

export function useCurrentConversationExport(sessionId: () => string) {
  const store = useConversationStore();
  const available = computed(() => !!window.deepwrite?.conversationExport);
  const exporting = computed(() => active.value?.sessionId === sessionId());
  async function start(): Promise<void> {
    const requestedSessionId = sessionId();
    try {
      const { startCurrentConversationExport } =
        await import("../utils/conversation-export/action");
      await startCurrentConversationExport({
        sessionId: requestedSessionId,
        store,
        active
      });
    } catch (error) {
      uiMessage.error(
        `${error instanceof Error ? error.message : "导出未完成。"} 可重新选择位置重试。`
      );
    }
  }
  function cancel(): void {
    if (exporting.value) active.value?.abort.abort();
  }
  return { available, exporting, start, cancel };
}
