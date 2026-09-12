import type { ShallowRef } from "vue";
import type { useConversationStore } from "../../stores/conversationStore";
import { uiMessage } from "../../ui-feedback";
import { exportCurrentConversation } from "./write";

export interface CurrentExportOperation {
  sessionId: string;
  abort: AbortController;
}
export async function startCurrentConversationExport(options: {
  sessionId: string;
  store: ReturnType<typeof useConversationStore>;
  active: ShallowRef<CurrentExportOperation | undefined>;
}): Promise<void> {
  if (options.active.value) {
    uiMessage.info("请先完成或取消正在进行的导出。");
    return;
  }
  const api = window.deepwrite?.conversationExport;
  if (!api) return;
  const controller = [...options.store.controllers.values()].find(
    (item) => item.sessionId.value === options.sessionId
  );
  if (!controller)
    throw new Error("当前对话已切换，请重新选择需要导出的对话。");
  const operation = {
    sessionId: options.sessionId,
    abort: new AbortController()
  };
  options.active.value = operation;
  try {
    const result = await exportCurrentConversation(
      controller,
      api,
      operation.abort.signal
    );
    if (result) uiMessage.success(`已导出 ${result.fileName}`);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      throw error;
  } finally {
    if (options.active.value === operation) options.active.value = undefined;
  }
}
