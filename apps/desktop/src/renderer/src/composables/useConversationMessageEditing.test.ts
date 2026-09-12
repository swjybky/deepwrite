import { effectScope, reactive } from "vue";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { useConversationMessageEditing } from "./useConversationMessageEditing";

function message(id: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return {
    id,
    role,
    content: "测试文本",
    createdAt: "2026-09-11T00:00:00.000Z"
  };
}

function setup(messages: ChatMessage[]) {
  const state = reactive({
    messages,
    responding: false,
    sessionId: "session-1",
    canRewrite: true
  });
  const scope = effectScope();
  const editing = scope.run(() =>
    useConversationMessageEditing({
      messages: () => state.messages,
      responding: () => state.responding,
      sessionId: () => state.sessionId,
      canRewrite: () => state.canRewrite
    })
  )!;
  return { state, editing, stop: () => scope.stop() };
}

describe("conversation message editing subscriptions", () => {
  it("never reads historical content during streaming with no editor", () => {
    let historyReads = 0;
    const messages = Array.from({ length: 2_000 }, (_, index) => ({
      ...message(`old-${index}`),
      get content() {
        historyReads += 1;
        return "旧消息正文";
      }
    }));
    const { state, editing, stop } = setup([
      ...messages,
      message("live", "assistant")
    ]);
    for (let i = 0; i < 100; i += 1) state.messages.at(-1)!.content += "新增";
    expect(editing.editingMessageId.value).toBeNull();
    expect(historyReads).toBe(0);
    stop();
  });

  it("preserves the editor during unrelated content changes and cancels when its target changes", () => {
    const { state, editing, stop } = setup([
      message("user"),
      message("assistant", "assistant")
    ]);
    editing.requestEdit("user");
    state.messages[1]!.content += "继续回复";
    expect(editing.editingMessageId.value).toBe("user");
    state.messages[0]!.content = "其他操作修改后的文本";
    expect(editing.editingMessageId.value).toBeNull();
    stop();
  });

  it.each(["session", "response", "removed", "attachment", "permission"])(
    "cancels safely after %s changes",
    (reason) => {
      const { state, editing, stop } = setup([message("user")]);
      editing.requestEdit("user");
      if (reason === "session") state.sessionId = "session-2";
      if (reason === "response") state.responding = true;
      if (reason === "removed") state.messages = [];
      if (reason === "permission") state.canRewrite = false;
      if (reason === "attachment")
        state.messages[0]!.attachments = [
          {
            id: "attachment",
            name: "sample.txt",
            kind: "text",
            mediaType: "text/plain",
            size: 12
          }
        ];
      expect(editing.editingMessageId.value).toBeNull();
      stop();
    }
  );
});
