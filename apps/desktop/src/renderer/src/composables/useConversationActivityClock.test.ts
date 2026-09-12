import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConversationActivityClock } from "./useConversationActivityClock";

afterEach(() => vi.useRealTimers());

describe("conversation activity clock", () => {
  it("runs only for active labels and releases its timer on completion or unmount", async () => {
    vi.useFakeTimers();
    const active = ref(false);
    const scope = effectScope();
    const now = scope.run(() =>
      useConversationActivityClock(() => active.value)
    )!;
    expect(vi.getTimerCount()).toBe(0);
    active.value = true;
    await nextTick();
    const start = now.value;
    vi.advanceTimersByTime(2_000);
    expect(now.value).toBe(start + 2_000);
    expect(vi.getTimerCount()).toBe(1);
    active.value = false;
    await nextTick();
    expect(vi.getTimerCount()).toBe(0);
    active.value = true;
    await nextTick();
    scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
