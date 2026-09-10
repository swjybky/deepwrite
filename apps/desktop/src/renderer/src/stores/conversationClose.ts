import type { AgentConversationController } from "../composables/useAgentConversation";

/** Save before stopping, then save the final parent/child state before acknowledging exit. */
export async function flushConversationsBeforeClose(
  controllers: ReadonlyMap<string, AgentConversationController>,
  schedule: (key: string, snapshot: () => unknown) => void,
  flush: () => Promise<void>
): Promise<void> {
  const closing = [...controllers];
  const capture = () => {
    for (const [key, controller] of closing) {
      if (
        controller.messages.value.length ||
        controller.draft.value ||
        controller.isBusy.value
      ) {
        schedule(key, controller.capturePersistenceSnapshot);
      }
    }
  };
  for (const [, controller] of closing) controller.holdPersistenceEmits();
  try {
    capture();
    await flush();
    const running = closing.filter(([, controller]) => controller.isBusy.value);
    if (running.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A disconnected Agent must not prevent saving. Main still shuts down
        // the utilities after this acknowledgement, with Core kept alive until then.
        await Promise.race([
          Promise.allSettled(
            running.map(([, controller]) => controller.stopGeneration())
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5_000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
      capture();
      await flush();
    }
  } finally {
    for (const [, controller] of closing) controller.releasePersistenceEmits();
  }
}
