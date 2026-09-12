import { describe, expect, it, vi } from "vitest";
import { useChatAssistantHistoryActions } from "./useChatAssistantHistoryActions";

describe("chat assistant history actions", () => {
  it("awaits cold history loading before focusing the composer", async () => {
    let ready: ((value: boolean) => void) | undefined;
    const openConversation = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          ready = resolve;
        })
    );
    const selectConversation = vi.fn(() => true);
    const focusInput = vi.fn();
    const actions = useChatAssistantHistoryActions({
      controller: () => ({
        openConversation,
        selectConversation,
        newConversation: vi.fn()
      }),
      focusInput
    });
    const opening = actions.selectConversation("history-a");
    expect(focusInput).not.toHaveBeenCalled();
    expect(selectConversation).not.toHaveBeenCalled();
    ready!(true);
    await opening;
    expect(openConversation).toHaveBeenCalledWith("history-a");
    expect(focusInput).toHaveBeenCalledOnce();
  });
  it("reports a failed read without invoking the legacy selection or moving focus", async () => {
    const controller = {
      openConversation: vi.fn(async () => {
        throw new Error("测试历史读取失败");
      }),
      selectConversation: vi.fn(() => true),
      newConversation: vi.fn()
    };
    const focusInput = vi.fn();
    const notifications = { error: vi.fn(() => 1), info: vi.fn(() => 1) };
    const actions = useChatAssistantHistoryActions({
      controller: () => controller,
      focusInput,
      notifications
    });
    await actions.selectConversation("history-a");
    expect(notifications.error).toHaveBeenCalledWith("测试历史读取失败");
    expect(controller.selectConversation).not.toHaveBeenCalled();
    expect(focusInput).not.toHaveBeenCalled();
  });
  it("retains legacy selection and new-chat focus behavior", async () => {
    const controller = {
      selectConversation: vi.fn(() => false),
      newConversation: vi.fn()
    };
    const focusInput = vi.fn();
    const notifications = { error: vi.fn(() => 1), info: vi.fn(() => 1) };
    const actions = useChatAssistantHistoryActions({
      controller: () => controller,
      focusInput,
      notifications
    });
    await actions.selectConversation("history-a");
    expect(notifications.info).toHaveBeenCalledOnce();
    expect(focusInput).not.toHaveBeenCalled();
    actions.newConversation();
    expect(controller.newConversation).toHaveBeenCalledOnce();
    expect(focusInput).toHaveBeenCalledOnce();
  });
});
