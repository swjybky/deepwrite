import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, shallowRef } from "vue";
import { useConversationStore } from "../stores/conversationStore";
import { uiMessage } from "../ui-feedback";
import type { CurrentExportOperation } from "../utils/conversation-export/action";
import { deepwriteApi } from "../api/deepwrite";

const t = createScopedTranslator("workspace.currentConversationExport");
const active = shallowRef<CurrentExportOperation>();

export function useCurrentConversationExport(sessionId: () => string) {
  const store = useConversationStore();
  const available = computed(() => !!deepwriteApi()?.conversationExport);
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
        t("chooseAnotherLocationAndTryAgain", {
          value: formatError(error, t("exportIncomplete"))
        })
      );
    }
  }
  function cancel(): void {
    if (exporting.value) active.value?.abort.abort();
  }
  return { available, exporting, start, cancel };
}
