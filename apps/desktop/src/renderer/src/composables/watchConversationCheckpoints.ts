import { watch } from "vue";
import type { AgentConversationController } from "./useAgentConversation";

/** Flush at turn/session boundaries without polling or serializing each delta. */
export function watchConversationCheckpoints(
  controller: AgentConversationController,
  flush: () => Promise<void>
): () => void {
  return watch(
    [
      controller.sessionId,
      () => controller.messages.value.length,
      () => controller.messages.value.at(-1)?.status,
      controller.isBusy
    ],
    () => {
      void flush().catch(() => undefined);
    },
    // The ordinary synchronous dirty watcher schedules the complete mutation
    // before this flush. Multiple changes within a turn boundary collapse.
    { flush: "post" }
  );
}
