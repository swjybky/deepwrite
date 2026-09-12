import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { useAgentConversation } from "./useAgentConversation";

function message(
  id: string,
  role: ChatMessage["role"],
  content: string
): ChatMessage {
  return { id, role, content, createdAt: "2026-09-07T00:00:00.000Z" };
}

describe("conversation history summaries", () => {
  it("does not store empty sessions or unsent drafts, then persists the first message", () => {
    const controller = useAgentConversation({ api: () => undefined });
    try {
      expect(controller.capturePersistenceChanges().conversations).toEqual([]);
      controller.draft.value = "未发送的草稿";
      expect(controller.history.value).toEqual([]);
      expect(controller.capturePersistenceSnapshot().conversations).toEqual([]);
      const empty = controller.capturePersistenceChanges();
      expect(empty.conversations).toEqual([]);
      controller.acknowledgePersistenceChanges(empty.revision);
      controller.newConversation();
      expect(controller.capturePersistenceChanges().conversations).toEqual([]);
      controller.messages.value.push(message("first", "user", "第一条消息"));
      expect(controller.history.value[0]?.title).toBe("第一条消息");
      expect(
        controller.capturePersistenceSnapshot().conversations
      ).toHaveLength(1);
      expect(
        controller.capturePersistenceChanges().conversations[0]?.operations
      ).toEqual([
        expect.objectContaining({ type: "putMessage", messageId: "first" })
      ]);
    } finally {
      controller.dispose();
    }
  });

  it("hides previously saved empty conversations without hiding real history", () => {
    const record = {
      draft: "旧草稿",
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z"
    };
    const controller = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: {
        version: 1,
        activeSessionId: "empty",
        conversations: [
          { ...record, sessionId: "empty", messages: [] },
          {
            ...record,
            sessionId: "real",
            messages: [message("first", "user", "保留正文")]
          }
        ]
      }
    });
    try {
      expect(controller.history.value.map((item) => item.sessionId)).toEqual([
        "real"
      ]);
      expect(
        controller
          .capturePersistenceSnapshot()
          .conversations.map((item) => item.sessionId)
      ).toEqual(["real"]);
      expect(
        controller
          .capturePersistenceChanges()
          .conversations.map((item) => item.sessionId)
      ).toEqual(["real"]);
    } finally {
      controller.dispose();
    }
  });

  it("refreshes titles, previews and counts after in-place message changes", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("user", "user", "  规划\n  第一章  ")]
    });
    try {
      expect(controller.history.value[0]).toMatchObject({
        title: "规划 第一章",
        preview: "规划 第一章",
        turnCount: 1,
        messageCount: 1
      });
      controller.messages.value.push(message("assistant", "assistant", "  "));
      expect(controller.history.value[0]?.preview).toBe("规划 第一章");
      controller.messages.value[1]!.content = "雨夜";
      expect(controller.history.value[0]?.preview).toBe("雨夜");
      controller.messages.value[1]!.content += " 来客";
      expect(controller.history.value[0]?.preview).toBe("雨夜 来客");
      controller.messages.value[0]!.content = "题".repeat(50);
      expect(controller.history.value[0]?.title).toBe(`${"题".repeat(41)}…`);
      controller.messages.value.push(message("user-2", "user", "继续下一章"));
      expect(controller.history.value[0]).toMatchObject({
        preview: "继续下一章",
        turnCount: 2,
        messageCount: 3
      });
      controller.messages.value.splice(1);
      expect(controller.history.value[0]).toMatchObject({
        preview: "题".repeat(50),
        turnCount: 1,
        messageCount: 1
      });
      controller.messages.value[0]!.content = " \n ";
      controller.draft.value = "只剩草稿预览";
      expect(controller.history.value[0]?.preview).toBe("只剩草稿预览");
    } finally {
      controller.dispose();
    }
  });

  it("preserves archived summaries and selects restored conversations without duplicates", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("first", "user", "第一段对话")]
    });
    try {
      const firstSessionId = controller.sessionId.value;
      controller.draft.value = "第一段草稿";
      controller.newConversation();
      const secondSessionId = controller.sessionId.value;
      controller.messages.value.push(message("second", "user", "第二段对话"));
      controller.draft.value = "第二段草稿";
      expect(
        controller.history.value.map(({ sessionId }) => sessionId)
      ).toEqual([secondSessionId, firstSessionId]);
      controller.capturePersistenceSnapshot();
      controller.draft.value = "第二段草稿修订";
      expect(controller.history.value).toHaveLength(2);
      expect(controller.history.value[0]?.preview).toBe("第二段对话");
      expect(controller.history.value[1]).toMatchObject({
        title: "第一段对话",
        preview: "第一段对话",
        current: false
      });
      expect(controller.selectConversation(firstSessionId)).toBe(true);
      expect(controller.draft.value).toBe("第一段草稿");
      expect(
        controller.history.value.map(({ sessionId }) => sessionId)
      ).toEqual([secondSessionId, firstSessionId]);
      const snapshot = controller.capturePersistenceSnapshot();
      const loaded = useAgentConversation({
        api: () => undefined,
        initialPersistenceSnapshot: snapshot
      });
      try {
        expect(loaded.history.value).toEqual(controller.history.value);
        expect(loaded.selectConversation(secondSessionId)).toBe(true);
        expect(loaded.draft.value).toBe("第二段草稿修订");
      } finally {
        loaded.dispose();
      }
    } finally {
      controller.dispose();
    }
  });
});
