import { ref, shallowReactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "./useAgentConversation";
import type { ConversationPersistenceProgress } from "../stores/conversationPersistenceQueue";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistenceKeys";
import { createConversationSaveStatus } from "./useConversationSaveStatus";

function setup() {
  const sessionId = ref("session-a");
  const controllerSession = ref("session-a");
  const detailsRead = vi.fn(() => {
    throw new Error("History details must not be scanned for save status.");
  });
  const controller = {
    sessionId: controllerSession,
    get messages() {
      return detailsRead();
    }
  } as unknown as AgentConversationController;
  const store = shallowReactive({
    controllers: new Map([["scope-a", controller]]),
    persistenceProgress: new Map<string, ConversationPersistenceProgress>(),
    persistenceErrors: new Map<string, unknown>(),
    scheduleControllerPersistence: vi.fn(
      (_key: string, _controller: AgentConversationController) => undefined
    ),
    flushPersistence: vi.fn(async (): Promise<void> => undefined)
  });
  const showError = vi.fn();
  const state = createConversationSaveStatus({
    store,
    sessionId: () => sessionId.value,
    showError
  });
  return {
    state,
    store,
    sessionId,
    controllerSession,
    controller,
    showError,
    detailsRead,
    key: conversationHistoryPersistenceKey("scope-a")
  };
}

describe("conversation save status", () => {
  it("does not call an unknown persistence state saved", () => {
    const test = setup();
    expect(test.state.label.value).toBe("");
    expect(test.detailsRead).not.toHaveBeenCalled();
  });

  it("keeps an error visible while new data or a retry is waiting and clears only after acknowledgement", async () => {
    const test = setup();
    test.store.persistenceErrors = new Map([
      [test.key, new Error("测试磁盘写入失败")]
    ]);
    test.store.persistenceProgress = new Map([
      [test.key, { status: "pending", requested: 2, confirmed: 1 }]
    ]);
    expect(test.state.label.value).toBe("保存失败");
    let complete: (() => void) | undefined;
    test.store.flushPersistence.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const retry = test.state.retry();
    expect(test.state.retrying.value).toBe(true);
    expect(test.state.label.value).toBe("保存失败");
    const scheduled = test.store.scheduleControllerPersistence.mock.calls[0];
    expect(scheduled?.[0]).toBe(test.key);
    expect(scheduled?.[1]).toBe(test.controller);
    test.store.persistenceProgress = new Map([
      [test.key, { status: "saving", requested: 3, confirmed: 1 }]
    ]);
    expect(test.state.label.value).toBe("保存失败");
    test.store.persistenceErrors = new Map();
    test.store.persistenceProgress = new Map([
      [test.key, { status: "saved", requested: 3, confirmed: 3 }]
    ]);
    complete!();
    await retry;
    expect(test.state.label.value).toBe("已保存");
    expect(test.state.retrying.value).toBe(false);
    expect(test.detailsRead).not.toHaveBeenCalled();
  });

  it("tracks the selected history session and reports retry failures without clearing them", async () => {
    const test = setup();
    test.controllerSession.value = "session-b";
    expect(test.state.label.value).toBe("");
    test.sessionId.value = "session-b";
    test.store.persistenceProgress = new Map([
      [test.key, { status: "saved", requested: 2, confirmed: 1 }]
    ]);
    expect(test.state.label.value).toBe("等待保存");
    test.store.flushPersistence.mockRejectedValue(new Error("测试保存失败"));
    await test.state.retry();
    expect(test.showError).toHaveBeenCalledWith("测试保存失败");
    expect(test.state.label.value).toBe("等待保存");
  });
});
