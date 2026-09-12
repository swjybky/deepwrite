import type {
  ConversationExportApi,
  ConversationExportFinished
} from "@deepwrite/contracts/renderer";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { captureCurrentConversation } from "./capture";
import { conversationJsonChunks } from "./json-chunks";

async function retry<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    return action();
  }
}
function canceled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("导出已取消。", "AbortError");
}
export async function exportCurrentConversation(
  controller: AgentConversationController,
  api: ConversationExportApi,
  signal: AbortSignal
): Promise<ConversationExportFinished | undefined> {
  canceled(signal);
  const snapshot = captureCurrentConversation(controller);
  const nonce = crypto.randomUUID();
  const beginInput = {
    nonce,
    suggestedName: `DeepWrite-对话-${snapshot.capturedAt.slice(0, 10)}.json`
  };
  const start = await retry(() => api.begin(beginInput));
  if (start.canceled) return;
  let finished = false;
  try {
    canceled(signal);
    let seq = 0;
    for (const text of conversationJsonChunks(snapshot)) {
      canceled(signal);
      const chunk = { token: start.token, seq, text };
      const progress = await retry(() => api.append(chunk));
      if (progress.nextSeq !== seq + 1)
        throw new Error("导出确认顺序不一致，请重新导出。");
      seq += 1;
    }
    canceled(signal);
    // Once atomic completion starts, retrieve its idempotent result even if Cancel is pressed.
    const result = await retry(() => api.finish({ token: start.token, seq }));
    finished = true;
    return result;
  } finally {
    if (!finished)
      await api.cancel({ token: start.token }).catch(() => undefined);
  }
}
