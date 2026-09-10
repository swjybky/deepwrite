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
  it("shows draft-only sessions and removes empty draft-only sessions", () => {
    const controller = useAgentConversation({ api: () => undefined });
    try {
      expect(controller.history.value).toEqual([]);
      controller.draft.value = "  下一章\n  从雨夜开始  ";
      expect(controller.history.value).toEqual([
        expect.objectContaining({
          title: "未命名对话",
          preview: "下一章 从雨夜开始",
          messageCount: 0,
          turnCount: 0,
          current: true
        })
      ]);
      controller.draft.value = "字".repeat(100);
      expect(controller.history.value[0]?.preview).toBe(`${"字".repeat(75)}…`);
      controller.capturePersistenceSnapshot();
      expect(controller.history.value).toHaveLength(1);
      controller.draft.value = " \n ";
      expect(controller.history.value).toEqual([]);
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
      controller.draft.value = "第二段草稿";
      expect(
        controller.history.value.map(({ sessionId }) => sessionId)
      ).toEqual([secondSessionId, firstSessionId]);
      controller.capturePersistenceSnapshot();
      controller.draft.value = "第二段草稿修订";
      expect(controller.history.value).toHaveLength(2);
      expect(controller.history.value[0]?.preview).toBe("第二段草稿修订");
      expect(controller.history.value[1]).toMatchObject({
        title: "第一段对话",
        preview: "第一段对话",
        current: false
      });
      expect(controller.selectConversation(firstSessionId)).toBe(true);
      expect(controller.draft.value).toBe("第一段草稿");
      expect(
        controller.history.value.map(({ sessionId }) => sessionId)
      ).toEqual([firstSessionId, secondSessionId]);
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
