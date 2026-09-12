import { describe, expect, it, vi } from "vitest";
import {
  useAgentConversation,
  type AgentConversationController,
  type AgentConversationPersistenceRecord
} from "./useAgentConversation";
import { historyItemFor } from "./agent-conversation/conversation-history";

const stored: AgentConversationPersistenceRecord = {
  sessionId: "stored-session",
  draft: "此前保存的草稿",
  approvalMode: "request-approval",
  temperature: 0.7,
  messages: [],
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z"
};
const restore = {
  snapshot: (controller: AgentConversationController) =>
    controller.restorePersistenceSnapshot({
      version: 1,
      activeSessionId: stored.sessionId,
      conversations: [stored]
    }),
  history: (controller: AgentConversationController) =>
    controller.restorePersistenceHistory({
      activeSessionId: stored.sessionId,
      active: stored,
      items: [historyItemFor(stored, stored.sessionId)]
    })
};

describe("persistence during asynchronous hydration", () => {
  it("tracks held changes and emits once after the last hold, without losing a later edit to an older ACK", () => {
    const changed = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      onPersistenceChange: changed,
      initialMessages: [
        {
          id: "sent-first",
          role: "user",
          content: "已发送的消息",
          createdAt: "2026-09-07T00:00:00.000Z"
        }
      ]
    });
    try {
      const baseline = controller.capturePersistenceChanges();
      controller.acknowledgePersistenceChanges(baseline.revision);
      controller.holdPersistenceEmits();
      controller.holdPersistenceEmits();
      controller.draft.value = "已捕获";
      const captured = controller.capturePersistenceChanges();
      controller.draft.value = "确认期间再次编辑";
      controller.acknowledgePersistenceChanges(captured.revision);
      expect(changed).not.toHaveBeenCalled();
      controller.releasePersistenceEmits();
      expect(changed).not.toHaveBeenCalled();
      controller.releasePersistenceEmits();
      expect(changed).toHaveBeenCalledOnce();
      const pending = controller.capturePersistenceChanges();
      expect(pending.revision).toBeGreaterThan(captured.revision);
      expect(pending.conversations[0]?.metadata.draft).toBe("确认期间再次编辑");
      controller.releasePersistenceEmits();
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });

  it.each(["snapshot", "history"] as const)(
    "does not overwrite a draft edited and cleared while %s hydration yields",
    async (format) => {
      const changed = vi.fn();
      const controller = useAgentConversation({
        api: () => undefined,
        onPersistenceChange: changed
      });
      try {
        const sessionId = controller.sessionId.value;
        controller.holdPersistenceEmits();
        const loading = restore[format](controller);
        controller.draft.value = "用户已开始编辑";
        controller.draft.value = "";
        expect(await loading).toBe(false);
        expect(controller.sessionId.value).toBe(sessionId);
        expect(controller.draft.value).toBe("");
        expect(controller.initializePersistenceBaseline()).toBe(false);
        expect(changed).not.toHaveBeenCalled();
        controller.releasePersistenceEmits();
        expect(changed).toHaveBeenCalledOnce();
      } finally {
        controller.dispose();
      }
    }
  );

  it.each(["snapshot", "history"] as const)(
    "does not mark the applied %s data as a local mutation",
    async (format) => {
      const changed = vi.fn();
      const controller = useAgentConversation({
        api: () => undefined,
        onPersistenceChange: changed
      });
      try {
        controller.holdPersistenceEmits();
        expect(await restore[format](controller)).toBe(true);
        expect(controller.initializePersistenceBaseline()).toBe(true);
        controller.releasePersistenceEmits();
        expect(changed).not.toHaveBeenCalled();
        expect(controller.capturePersistenceChanges().conversations).toEqual(
          []
        );
      } finally {
        controller.dispose();
      }
    }
  );

  it("does not publish held work after disposal", () => {
    const changed = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      onPersistenceChange: changed
    });
    controller.holdPersistenceEmits();
    controller.draft.value = "停止发布";
    controller.dispose();
    controller.releasePersistenceEmits();
    expect(changed).not.toHaveBeenCalled();
  });
});
