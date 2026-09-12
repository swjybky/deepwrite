import { describe, expect, it, vi } from "vitest";
import {
  createDeferredApi,
  document,
  runtime
} from "./useAgentConversation.test-support";
import { useAgentConversation } from "./useAgentConversation";

describe("durable user messages", () => {
  it("waits for persistence acknowledgement before contacting the model", async () => {
    const deferred = createDeferredApi();
    let acknowledge!: () => void;
    const flushPersistence = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    );
    const controller = useAgentConversation({
      api: () => deferred.api,
      flushPersistence
    });
    try {
      controller.draft.value = "等待保存的问题";
      const sending = controller.sendMessage(document);
      expect(flushPersistence).toHaveBeenCalledOnce();
      expect(controller.messages.value[0]?.content).toBe("等待保存的问题");
      expect(deferred.promptCount()).toBe(0);
      acknowledge();
      await Promise.resolve();
      expect(deferred.promptCount()).toBe(1);
      deferred.resolveAccepted(0, {
        sessionId: controller.sessionId.value,
        runId: "run-durable",
        acceptedAt: "2026-09-11T00:00:00.000Z",
        runtime
      });
      await sending;
    } finally {
      controller.dispose();
    }
  });

  it("keeps a failed user message and draft, and retries without duplicating the message", async () => {
    const deferred = createDeferredApi();
    const flushPersistence = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("模拟存储不可写"))
      .mockResolvedValue(undefined);
    const controller = useAgentConversation({
      api: () => deferred.api,
      flushPersistence
    });
    try {
      controller.draft.value = "不能丢失的问题";
      await controller.sendMessage(document);
      const messageId = controller.messages.value[0]!.id;
      expect(deferred.promptCount()).toBe(0);
      expect(controller.isBusy.value).toBe(false);
      expect(controller.conversationError.value).toBe("模拟存储不可写");
      expect(controller.draft.value).toBe("不能丢失的问题");
      expect(
        controller.messages.value.map((message) => message.content)
      ).toEqual(["不能丢失的问题"]);
      const retry = controller.sendMessage(document);
      await Promise.resolve();
      expect(controller.messages.value.map((message) => message.id)).toEqual([
        messageId
      ]);
      expect(deferred.prompts[0]?.conversationHistory).toBeUndefined();
      deferred.resolveAccepted(0, {
        sessionId: controller.sessionId.value,
        runId: "run-retry-save",
        acceptedAt: "2026-09-11T00:00:00.000Z",
        runtime
      });
      await retry;
    } finally {
      controller.dispose();
    }
  });

  it("does not dispatch an acknowledged pending prompt after switching sessions", async () => {
    const deferred = createDeferredApi();
    let acknowledge!: () => void;
    const controller = useAgentConversation({
      api: () => deferred.api,
      flushPersistence: () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    });
    try {
      controller.draft.value = "旧会话问题";
      const sending = controller.sendMessage(document);
      controller.newConversation();
      acknowledge();
      await sending;
      expect(deferred.promptCount()).toBe(0);
      expect(controller.messages.value).toEqual([]);
    } finally {
      controller.dispose();
    }
  });
});
