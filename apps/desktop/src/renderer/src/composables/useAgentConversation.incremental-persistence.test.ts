import { describe, expect, it, vi } from "vitest";
import { toRaw, watch } from "vue";
import type { ChatMessage } from "../types/conversation";
import { useAgentConversation } from "./useAgentConversation";
import { createLongConversationFixture } from "./agent-conversation/performance-fixture.test-support";

function message(id: string, content = "正文"): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    createdAt: "2026-09-11T00:00:00.000Z",
    status: "completed"
  };
}
function acknowledgeBaseline(
  controller: ReturnType<typeof useAgentConversation>
) {
  const changes = controller.capturePersistenceChanges();
  controller.acknowledgePersistenceChanges(changes.revision);
}

describe("incremental conversation persistence", () => {
  it("initializes a loaded baseline from IDs without reading message details", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("a")]
    });
    try {
      const raw = toRaw(controller.messages.value[0]!);
      const content = raw.content;
      const read = vi.fn(() => content);
      Object.defineProperty(raw, "content", {
        enumerable: true,
        configurable: true,
        get: read
      });
      expect(controller.initializePersistenceBaseline()).toBe(true);
      expect(controller.capturePersistenceChanges().conversations).toEqual([]);
      expect(read).not.toHaveBeenCalled();
      controller.draft.value = "加载完成后输入";
      expect(controller.initializePersistenceBaseline()).toBe(false);
      expect(
        controller.capturePersistenceChanges().conversations[0]?.metadata.draft
      ).toBe("加载完成后输入");
    } finally {
      controller.dispose();
    }
  });

  it("preserves running state for durable business indexes while restored UI is stopped", async () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [{ ...message("a"), status: "streaming" }]
    });
    const restored = useAgentConversation({ api: () => undefined });
    try {
      const changes = controller.capturePersistenceChanges();
      const operation = changes.conversations[0]!.operations[0]!;
      expect(operation).toMatchObject({
        type: "putMessage",
        value: { status: "streaming" }
      });
      if (operation.type !== "putMessage")
        throw new Error("Expected message baseline");
      await restored.restorePersistenceSnapshot({
        version: 1,
        activeSessionId: changes.activeSessionId,
        conversations: [
          { ...changes.conversations[0]!.metadata, messages: [operation.value] }
        ]
      });
      expect(restored.messages.value[0]?.status).toBe("stopped");
      controller.acknowledgePersistenceChanges(changes.revision);
      controller.messages.value[0]!.status = "completed";
      expect(
        controller.capturePersistenceChanges().conversations[0]?.operations
      ).toEqual([
        {
          type: "patchMessage",
          messageId: "a",
          changes: [{ op: "set", path: ["status"], value: "completed" }]
        }
      ]);
    } finally {
      controller.dispose();
      restored.dispose();
    }
  });

  it.each([100, 1000])(
    "does not inspect historical payloads during updates and capture with %i rounds",
    (rounds) => {
      const initialMessages = createLongConversationFixture(rounds, 120);
      const onPersistenceChange = vi.fn();
      const controller = useAgentConversation({
        api: () => undefined,
        initialMessages,
        onPersistenceChange
      });
      try {
        acknowledgeBaseline(controller);
        const oldReads = vi.fn();
        for (const old of controller.messages.value.slice(0, rounds)) {
          const raw = toRaw(old);
          const content = raw.content;
          const proposals = raw.editProposals;
          Object.defineProperty(raw, "content", {
            enumerable: true,
            configurable: true,
            get() {
              oldReads();
              return content;
            }
          });
          Object.defineProperty(raw, "editProposals", {
            enumerable: true,
            configurable: true,
            get() {
              oldReads();
              return proposals;
            }
          });
        }
        const active = controller.messages.value.at(-1)!;
        const rendered = vi.fn();
        const stop = watch(() => active.content, rendered, { flush: "sync" });
        for (let index = 0; index < 20; index += 1) active.content += "增量";
        const changes = controller.capturePersistenceChanges();
        expect(oldReads).not.toHaveBeenCalled();
        expect(rendered).toHaveBeenCalledTimes(20);
        expect(onPersistenceChange).toHaveBeenCalledTimes(20);
        expect(changes.conversations[0]?.operations).toEqual([
          {
            type: "patchMessage",
            messageId: "active",
            changes: [
              { op: "append", path: ["content"], text: "增量".repeat(20) }
            ]
          }
        ]);
        expect(JSON.stringify(changes).length).toBeLessThan(1000);
        stop();
      } finally {
        controller.dispose();
      }
    }
  );

  it("retains new appends when an older capture is acknowledged", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("a", "A")]
    });
    try {
      acknowledgeBaseline(controller);
      controller.messages.value[0]!.content += "B";
      const first = controller.capturePersistenceChanges();
      controller.messages.value[0]!.content += "C";
      controller.acknowledgePersistenceChanges(first.revision);
      const second = controller.capturePersistenceChanges();
      expect(second.conversations[0]?.operations).toEqual([
        {
          type: "patchMessage",
          messageId: "a",
          changes: [{ op: "append", path: ["content"], text: "C" }]
        }
      ]);
      controller.acknowledgePersistenceChanges(first.revision);
      expect(controller.capturePersistenceChanges()).toEqual(second);
      controller.acknowledgePersistenceChanges(second.revision);
      expect(controller.capturePersistenceChanges().conversations).toEqual([]);
    } finally {
      controller.dispose();
    }
  });

  it("keeps failed captures available and avoids duplicating text below object replacements", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("a")]
    });
    try {
      acknowledgeBaseline(controller);
      const current = controller.messages.value[0]!;
      current.processingSteps = [
        {
          id: "response",
          type: "response",
          content: "A",
          createdAt: current.createdAt
        }
      ];
      const step = current.processingSteps[0]!;
      if (step.type !== "response") throw new Error("Expected response step");
      step.content += "B";
      const first = controller.capturePersistenceChanges();
      expect(first.conversations[0]?.operations).toEqual([
        {
          type: "patchMessage",
          messageId: "a",
          changes: [
            {
              op: "set",
              path: ["processingSteps"],
              value: [
                {
                  id: "response",
                  type: "response",
                  content: "AB",
                  createdAt: current.createdAt
                }
              ]
            }
          ]
        }
      ]);
      expect(controller.capturePersistenceChanges()).toEqual(first);
      step.content += "C";
      controller.acknowledgePersistenceChanges(first.revision);
      expect(
        controller.capturePersistenceChanges().conversations[0]?.operations
      ).toEqual([
        {
          type: "patchMessage",
          messageId: "a",
          changes: [
            { op: "append", path: ["processingSteps", 0, "content"], text: "C" }
          ]
        }
      ]);
    } finally {
      controller.dispose();
    }
  });

  it("persists replacement messages with stable IDs and removes rewritten suffixes", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("a"), message("b"), message("c")]
    });
    try {
      acknowledgeBaseline(controller);
      controller.messages.value[0] = message("a", "新内容");
      controller.messages.value.splice(1);
      const changes = controller.capturePersistenceChanges();
      expect(changes.conversations[0]?.operations).toEqual([
        {
          type: "putMessage",
          messageId: "a",
          position: 0,
          value: message("a", "新内容")
        },
        { type: "removeMessages", messageIds: ["b", "c"] }
      ]);
      controller.acknowledgePersistenceChanges(changes.revision);
      controller.messages.value[0]!.content += "尾部";
      expect(
        controller.capturePersistenceChanges().conversations[0]?.operations
      ).toEqual([
        {
          type: "patchMessage",
          messageId: "a",
          changes: [{ op: "append", path: ["content"], text: "尾部" }]
        }
      ]);
    } finally {
      controller.dispose();
    }
  });
});
