import { nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { mountConversationTestSetup } from "./conversation-view.test-support";
import { useConversationTurnNavigator } from "./useConversationTurnNavigator";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("conversation navigation geometry", () => {
  it("preserves the ID and pixel anchor across width and font changes without fighting normal content growth", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    let fontSize = "14px";
    vi.stubGlobal("getComputedStyle", () => ({ fontSize }));
    let followsTail = false;
    let elementTop = 100;
    const container = {
      scrollTop: 50,
      clientWidth: 900,
      clientHeight: 500,
      scrollHeight: 5_000,
      getBoundingClientRect: () => ({ top: 0 })
    };
    const element = {
      dataset: { conversationMessageId: "message-1" },
      getBoundingClientRect: () => ({ top: elementTop - container.scrollTop })
    };
    const { unmount } = mountConversationTestSetup(() =>
      useConversationTurnNavigator({
        messages: () => [
          {
            id: "message-1",
            role: "user",
            content: "测试",
            createdAt: "2026-09-11T00:00:00.000Z"
          }
        ],
        currentSessionId: () => "session-1",
        scroller: shallowRef(container as unknown as HTMLElement),
        messageList: shallowRef({
          querySelectorAll: () => [element]
        } as unknown as HTMLElement),
        beforeNavigate() {},
        followsTail: () => followsTail
      })
    );
    await nextTick();
    elementTop = 150;
    fontSize = "20px";
    resize!();
    expect(container.scrollTop).toBe(100);
    expect(element.getBoundingClientRect().top).toBe(50);
    vi.runOnlyPendingTimers();
    elementTop = 200;
    container.clientWidth = 600;
    resize!();
    expect(container.scrollTop).toBe(150);
    vi.runAllTimers();
    elementTop = 250;
    resize!();
    expect(container.scrollTop).toBe(150);
    followsTail = true;
    container.clientWidth = 800;
    resize!();
    expect(container.scrollTop).toBe(4_500);
    unmount();
  });

  it("indexes the DOM once and locates turns with logarithmic geometry reads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    const messages = shallowRef<ChatMessage[]>(
      Array.from({ length: 1_000 }, (_, i) => ({
        id: `message-${i}`,
        role: "user",
        content: `第 ${i} 问`,
        createdAt: "2026-09-11T00:00:00.000Z"
      }))
    );
    const scrollTo = vi.fn();
    const container = {
      scrollTop: 0,
      clientHeight: 1_000,
      getBoundingClientRect: () => ({ top: 0 }),
      scrollTo
    };
    const geometryRead = vi.fn();
    let elements = messages.value.map((message, i) => ({
      dataset: { conversationMessageId: message.id },
      getBoundingClientRect: () => {
        geometryRead();
        return { top: i * 100 - container.scrollTop };
      }
    }));
    const querySelectorAll = vi.fn(() => elements);
    const beforeNavigate = vi.fn();
    const { result, unmount } = mountConversationTestSetup(() =>
      useConversationTurnNavigator({
        messages: () => messages.value,
        currentSessionId: () => "session-1",
        scroller: shallowRef(container as unknown as HTMLElement),
        messageList: shallowRef({ querySelectorAll } as unknown as HTMLElement),
        beforeNavigate
      })
    );
    await nextTick();
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
    geometryRead.mockClear();
    container.scrollTop = 50_000;
    result.scheduleActiveTurnUpdate();
    vi.runOnlyPendingTimers();
    expect(result.activeTurnId.value).toBe("message-503");
    expect(geometryRead.mock.calls.length).toBeLessThanOrEqual(11);
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
    result.scrollToTurn("message-900");
    expect(beforeNavigate).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 89_978, behavior: "auto" });
    // Rewriting equal-length history must refresh IDs, too.
    messages.value = messages.value.map((message, i) =>
      i === 900 ? { ...message, id: "replacement" } : message
    );
    elements = elements.map((element, i) =>
      i === 900
        ? { ...element, dataset: { conversationMessageId: "replacement" } }
        : element
    );
    await nextTick();
    await nextTick();
    result.scrollToTurn("replacement");
    expect(beforeNavigate).toHaveBeenCalledTimes(2);
    expect(querySelectorAll).toHaveBeenCalledTimes(2);
    unmount();
  });
});
