import { nextTick, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { mountConversationTestSetup } from "./conversation-view.test-support";
import { useConversationScrollFollow } from "./useConversationScrollFollow";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("conversation scroll following", () => {
  it("keeps upward reading locked through streamed updates and unlocks for the next response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const state = reactive({
      responding: true,
      session: "session-1",
      messages: [
        {
          id: "assistant",
          role: "assistant",
          status: "streaming",
          content: "测试回复",
          createdAt: "2026-09-11T00:00:00.000Z"
        }
      ] as ChatMessage[]
    });
    const { result, unmount } = mountConversationTestSetup(() =>
      useConversationScrollFollow({
        messages: () => state.messages,
        responding: () => state.responding,
        currentSessionId: () => state.session
      })
    );
    const element = {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 1_000,
      classList: { add: vi.fn(), remove: vi.fn() }
    };
    result.scroller.value = element as unknown as HTMLElement;
    await nextTick();
    vi.runOnlyPendingTimers();
    expect(element.scrollTop).toBe(800);
    result.handleConversationWheel({ deltaY: -10 } as WheelEvent);
    element.scrollTop = 300;
    result.handleConversationScroll();
    state.messages[0]!.content += "继续生成";
    element.scrollHeight = 1_500;
    await nextTick();
    vi.runOnlyPendingTimers();
    expect(element.scrollTop).toBe(300);
    expect(result.tailFollowLockedForResponse.value).toBe(true);
    state.responding = false;
    state.messages[0]!.status = "completed";
    await nextTick();
    await nextTick();
    expect(element.scrollTop).toBe(300);
    state.responding = true;
    await nextTick();
    await nextTick();
    vi.runOnlyPendingTimers();
    expect(result.tailFollowLockedForResponse.value).toBe(false);
    expect(element.scrollTop).toBe(1_300);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
