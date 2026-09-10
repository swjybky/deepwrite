import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { toRaw } from "vue";
import type { ChatMessage } from "../types/conversation";
import { useConversationStore } from "../stores/conversationStore";
import { useAgentConversation } from "./useAgentConversation";
import { createEditProposal } from "./useAgentConversation.test-support";

function chapterMessages(): ChatMessage[] {
  return Array.from({ length: 15 }, (_, chapter) => ({
    id: `chapter-message-${chapter}`,
    role: "assistant" as const,
    content: `第 ${chapter + 1} 章已保存。`,
    createdAt: "2026-09-07T00:00:00.000Z",
    editProposals: [
      createEditProposal({
        id: `chapter-proposal-${chapter}`,
        status: "accepted",
        stageId: "draft",
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 120,
            lines: Array.from({ length: 120 }, (_, line) => ({
              type: "addition" as const,
              text: "用于输入性能回归的虚构章节正文。",
              newLineNumber: line + 1
            }))
          }
        ]
      })
    ]
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("conversation draft input performance", () => {
  it("does not visit old messages or diff lines when typing and deleting", () => {
    const onPersistenceChange = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: chapterMessages(),
      onPersistenceChange
    });
    try {
      const originalHistory = controller.history.value;
      const readDiff = vi.fn();
      const readMessage = vi.fn();
      for (const message of controller.messages.value) {
        const rawMessage = toRaw(message);
        const content = rawMessage.content;
        Object.defineProperty(rawMessage, "content", {
          enumerable: true,
          configurable: true,
          get() {
            readMessage();
            return content;
          }
        });
        for (const line of message.editProposals![0]!.hunks[0]!.lines) {
          const rawLine = toRaw(line);
          const text = rawLine.text;
          Object.defineProperty(rawLine, "text", {
            enumerable: true,
            configurable: true,
            get() {
              readDiff();
              return text;
            }
          });
        }
      }

      for (const draft of ["继", "继续", "继续写", "继续", ""]) {
        controller.draft.value = draft;
        const history = controller.history.value;
        expect(history[0]?.preview).toBe(originalHistory[0]?.preview);
        expect(history[0]?.messageCount).toBe(15);
      }

      expect(readDiff.mock.calls.length).toBe(0);
      expect(readMessage.mock.calls.length).toBe(0);
      expect(onPersistenceChange).toHaveBeenCalledTimes(5);
      expect(controller.history.value[0]!.updatedAt).not.toBe(
        originalHistory[0]!.updatedAt
      );

      const snapshot = controller.capturePersistenceSnapshot();
      expect(readDiff).toHaveBeenCalled();
      expect(snapshot.conversations[0]?.draft).toBe("");
      expect(snapshot.conversations[0]?.messages[0]?.editProposals).toEqual(
        chapterMessages()[0]?.editProposals
      );
    } finally {
      controller.dispose();
    }
  });

  it("still observes nested edits and stops both observers on disposal", () => {
    const onPersistenceChange = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: chapterMessages().slice(0, 1),
      onPersistenceChange
    });
    try {
      const message = controller.messages.value[0]!;
      const proposal = message.editProposals![0]!;
      proposal.hunks[0]!.lines[0]!.text = "修订后的虚构正文";
      proposal.status = "rejected";
      message.content = "章节修订完成";
      controller.temperature.value = 0.4;
      controller.draft.value = "继续";
      expect(onPersistenceChange).toHaveBeenCalledTimes(5);
      const snapshot =
        controller.capturePersistenceSnapshot().conversations[0]!;
      expect(snapshot).toMatchObject({
        draft: "继续",
        temperature: 0.4
      });
      expect(snapshot.messages[0]?.content).toBe("章节修订完成");
      const savedProposal = snapshot.messages[0]!.editProposals![0]!;
      expect(savedProposal.status).toBe("rejected");
      expect(savedProposal.hunks[0]!.lines[0]!.text).toBe("修订后的虚构正文");
    } finally {
      controller.dispose();
    }
    onPersistenceChange.mockClear();
    controller.draft.value = "关闭后的草稿";
    controller.messages.value[0]!.content = "关闭后的内容";
    expect(onPersistenceChange).not.toHaveBeenCalled();
  });

  it("debounces draft and message changes together and saves the latest state", async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useConversationStore();
    const save = vi.fn(async () => undefined);
    store.configurePersistenceAdapter(
      { load: async () => undefined, save },
      { debounceMs: 180 }
    );
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: chapterMessages().slice(0, 1),
      onPersistenceChange: () =>
        store.schedulePersistenceFactory(
          "test:input",
          controller.capturePersistenceSnapshot
        )
    });
    try {
      controller.draft.value = "继续";
      await vi.advanceTimersByTimeAsync(100);
      controller.messages.value[0]!.editProposals![0]!.status = "rejected";
      controller.draft.value = "继续写下一章";
      await vi.advanceTimersByTimeAsync(179);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await store.flushPersistence();
      expect(save).toHaveBeenCalledExactlyOnceWith(
        "test:input",
        expect.objectContaining({
          conversations: [
            expect.objectContaining({
              draft: "继续写下一章",
              messages: [
                expect.objectContaining({
                  editProposals: [
                    expect.objectContaining({ status: "rejected" })
                  ]
                })
              ]
            })
          ]
        })
      );
    } finally {
      controller.dispose();
      await store.dispose();
      store.$dispose();
    }
  });
});
