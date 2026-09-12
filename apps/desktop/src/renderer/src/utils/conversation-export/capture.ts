import { toRaw } from "vue";
import type { AgentConversationController } from "../../composables/useAgentConversation";

function emptyClone(value: object): unknown[] | Record<string, unknown> {
  if (Array.isArray(value)) return new Array(value.length);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype)
    throw new Error("会话包含非 JSON 对象，无法完整导出。");
  return Object.create(null);
}
function cloneVisibleData(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const root = toRaw(value);
  const copy = emptyClone(root);
  const seen = new WeakMap<object, unknown>([[root, copy]]);
  const pending = [{ source: root, target: copy }];
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const key of Object.keys(source)) {
      const current = (source as Record<string, unknown>)[key];
      let cloned = current;
      if (current !== null && typeof current === "object") {
        const raw = toRaw(current);
        if (raw instanceof Date) cloned = raw.toISOString();
        else if (seen.has(raw)) cloned = seen.get(raw);
        else {
          cloned = emptyClone(raw);
          seen.set(raw, cloned);
          pending.push({ source: raw, target: cloned as typeof copy });
        }
      }
      Object.defineProperty(target, key, {
        value: cloned,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  return copy;
}

/** Explicit user action: capture only the current in-memory session, never all history. */
export function captureCurrentConversation(
  controller: AgentConversationController
) {
  const timestamp = new Date().toISOString();
  const summary = controller.history.value.find(
    (item) => item.sessionId === controller.sessionId.value
  );
  const record = cloneVisibleData({
    sessionId: controller.sessionId.value,
    createdAt: summary?.createdAt ?? timestamp,
    updatedAt: summary?.updatedAt ?? timestamp,
    messages: controller.messages.value,
    draft: controller.draft.value,
    approvalMode: controller.approvalMode.value,
    temperature: controller.temperature.value
  });
  return {
    format: "deepwrite.conversation-recovery",
    version: 1,
    capturedAt: timestamp,
    scope: "current-controller-session",
    includesUnconfirmedChanges: true,
    unknownDatabaseFieldsIncluded: false,
    description:
      "当前客户端已加载的完整会话记录，包括未确认保存的内容；不包含其他会话或未加载的数据库原始字段，不是完整数据库备份。",
    runSettings: {
      selectedModelId: controller.selectedModelId.value,
      thinkingLevel: controller.thinkingLevel.value,
      temperature: controller.temperature.value,
      approvalMode: controller.approvalMode.value,
      agentTeamMode: controller.agentTeamMode.value,
      webSearchEnabled: controller.webSearchEnabled.value
    },
    record
  };
}
