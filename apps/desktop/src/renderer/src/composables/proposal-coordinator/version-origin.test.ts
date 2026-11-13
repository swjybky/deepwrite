import { ref } from "vue";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../types/conversation";
import { conversationVersionOrigin } from "./version-origin";

describe("conversation version origins", () => {
  it("uses the parent run and that turn's first user line for every child proposal", () => {
    const conversation = {
      sessionId: ref("parent-session"),
      messages: ref([
        { role: "user", content: "  改写第三章\n保留人物动机  " },
        { role: "assistant", runId: "parent-run", content: "" },
        { role: "user", content: "后续对话不应作为来源" },
        { role: "assistant", runId: "next-run", content: "" }
      ] as ChatMessage[])
    };
    const first = conversationVersionOrigin(
      conversation,
      "parent-run",
      "子任务一"
    );
    const second = conversationVersionOrigin(
      conversation,
      "parent-run",
      "子任务二"
    );
    expect(first).toEqual({
      sessionId: "parent-session",
      runId: "parent-run",
      summary: "改写第三章"
    });
    expect(second).toEqual(first);
  });

  it("limits long summaries and retains a source when an old user turn was compacted", () => {
    const conversation = {
      sessionId: ref("s"),
      messages: ref<ChatMessage[]>([])
    };
    expect(
      conversationVersionOrigin(conversation, "r", "甲".repeat(130)).summary
    ).toHaveLength(120);
    expect(conversationVersionOrigin(conversation, "r", "").summary).toBe("r");
  });
});
