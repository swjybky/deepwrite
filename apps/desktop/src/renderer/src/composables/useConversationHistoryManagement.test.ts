import { effectScope, nextTick, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ConversationHistoryItem } from "../types/conversation";
import {
  createConversationHistoryManagement,
  type ConversationHistoryManagementPort
} from "./useConversationHistoryManagement";

const item: ConversationHistoryItem = {
  sessionId: "session-a",
  title: "测试对话",
  preview: "测试正文",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  messageCount: 2,
  turnCount: 1,
  current: false
};
function setup() {
  const port = {
    historyManagementAvailable: true,
    listDeletedConversations: vi.fn(
      async (): Promise<ConversationHistoryItem[]> => [item]
    ),
    deleteConversation: vi.fn(async () => true),
    restoreConversation: vi.fn(async () => true)
  };
  const owner = shallowRef<ConversationHistoryManagementPort | undefined>(port);
  const notify = vi.fn();
  const scope = effectScope();
  const state = scope.run(() =>
    createConversationHistoryManagement({ owner: () => owner.value, notify })
  )!;
  return { state, port, owner, notify, dispose: () => scope.stop() };
}

describe("conversation history management presentation", () => {
  it("exposes actions only when a durable management backend is available", async () => {
    const test = setup();
    test.owner.value = undefined;
    expect(test.state.available.value).toBe(false);
    expect(await test.state.deleteConversation(item)).toBe(false);
    expect(test.port.deleteConversation).not.toHaveBeenCalled();
    test.dispose();
  });

  it("waits for the durable mutation before refreshing or announcing success, and prevents duplicate mutations", async () => {
    const test = setup();
    let acknowledge: ((value: boolean) => void) | undefined;
    test.port.deleteConversation.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        })
    );
    const deletion = test.state.deleteConversation(item);
    expect(test.state.busy.value).toBe(true);
    expect(await test.state.deleteConversation(item)).toBe(false);
    expect(test.port.deleteConversation).toHaveBeenCalledOnce();
    expect(test.port.listDeletedConversations).not.toHaveBeenCalled();
    expect(test.notify).not.toHaveBeenCalled();
    acknowledge!(true);
    expect(await deletion).toBe(true);
    expect(test.state.busy.value).toBe(false);
    expect(test.state.deletedItems.value).toEqual([item]);
    expect(test.notify).toHaveBeenCalledWith(
      "success",
      "对话已移入已删除，可随时恢复。"
    );
    test.dispose();
  });

  it("keeps the view intact when deletion is refused and reports errors as floating feedback", async () => {
    const test = setup();
    await test.state.refreshDeleted();
    test.port.deleteConversation.mockRejectedValue(
      new Error("测试：仍有待处理提案")
    );
    expect(await test.state.deleteConversation(item)).toBe(false);
    expect(test.state.deletedItems.value).toEqual([item]);
    expect(test.notify).toHaveBeenCalledWith("error", "测试：仍有待处理提案");
    expect(test.state.busy.value).toBe(false);
    test.port.deleteConversation.mockResolvedValue(false);
    expect(await test.state.deleteConversation(item)).toBe(false);
    expect(test.notify).toHaveBeenLastCalledWith(
      "info",
      "请先完成或停止当前回复，再管理对话。"
    );
    test.dispose();
  });

  it("ignores stale deleted lists after selecting another conversation owner", async () => {
    const test = setup();
    let resolve: ((value: ConversationHistoryItem[]) => void) | undefined;
    test.port.listDeletedConversations.mockImplementation(
      () =>
        new Promise((value) => {
          resolve = value;
        })
    );
    const request = test.state.refreshDeleted();
    test.owner.value = undefined;
    await nextTick();
    resolve!([item]);
    await request;
    expect(test.state.deletedItems.value).toEqual([]);
    expect(test.state.loading.value).toBe(false);
    test.dispose();
  });

  it("restores through the same durable port and refreshes the deleted list", async () => {
    const test = setup();
    await test.state.refreshDeleted();
    test.port.listDeletedConversations.mockResolvedValue([]);
    expect(await test.state.restoreConversation(item)).toBe(true);
    expect(test.port.restoreConversation).toHaveBeenCalledWith(item.sessionId);
    expect(test.state.deletedItems.value).toEqual([]);
    expect(test.notify).toHaveBeenCalledWith("success", "对话已恢复。");
    test.dispose();
  });
});
