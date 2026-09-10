import type { Ref } from "vue";
import type { DeepWriteApi } from "@deepwrite/contracts";

interface StopContext {
  api(): DeepWriteApi | undefined;
  epoch(): number;
  sessionId: Ref<string>;
  activeRunId: Ref<string | null>;
  stopping: Ref<boolean>;
  flushText(): void;
  stopped(runId: string): void;
}

/** An acknowledged abort is authoritative even if the terminal event is lost. */
export function createConversationStopper(context: StopContext) {
  const {
    api: resolveApi,
    epoch: getEpoch,
    sessionId: currentSessionId,
    activeRunId,
    stopping,
    flushText,
    stopped
  } = context;
  let pending: { runId: string; task: Promise<boolean> } | undefined;
  return function stopGeneration(): Promise<boolean> {
    flushText();
    const api = resolveApi();
    const runId = activeRunId.value;
    if (!api || !runId) return Promise.resolve(false);
    if (pending?.runId === runId) return pending.task;
    const epoch = getEpoch();
    const sessionId = currentSessionId.value;
    const ownsRun = () =>
      getEpoch() === epoch &&
      currentSessionId.value === sessionId &&
      activeRunId.value === runId;
    stopping.value = true;
    const task = Promise.resolve().then(async () => {
      try {
        const accepted = await api.session.abort({ sessionId, runId });
        if (accepted.sessionId !== sessionId || accepted.runId !== runId) {
          throw new Error("智能体停止结果与当前运行不一致。");
        }
        if (ownsRun()) stopped(runId);
        return true;
      } catch (error: unknown) {
        if (!ownsRun()) return false;
        stopping.value = false;
        throw error;
      } finally {
        if (pending?.task === task) pending = undefined;
      }
    });
    pending = { runId, task };
    return task;
  };
}
