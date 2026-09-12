import { reactive, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { useConversationContentGroups } from "./useConversationContentGroups";

describe("conversation rendering groups", () => {
  it("keeps short conversations unchanged and skips only settled unprotected groups", () => {
    const messages = reactive(
      Array.from(
        { length: 600 },
        (_, index) =>
          ({
            id: `message-${index}`,
            role: "assistant",
            content: "测试",
            status: "completed",
            createdAt: "2026-09-11T00:00:00.000Z"
          }) as ChatMessage
      )
    );
    const enabled = ref(false);
    const pins = ref<string[]>([]);
    const { groups, canDefer } = useConversationContentGroups({
      messages: () => messages,
      enabled: () => enabled.value,
      pinnedIds: () => pins.value
    });
    expect(groups.value).toHaveLength(38);
    expect(canDefer(groups.value[0]!)).toBe(false);
    enabled.value = true;
    expect(groups.value).toHaveLength(38);
    expect(canDefer(groups.value[0]!)).toBe(true);
    messages[0]!.status = "streaming";
    expect(canDefer(groups.value[0]!)).toBe(false);
    messages[0]!.status = "completed";
    pins.value = ["message-2"];
    expect(canDefer(groups.value[0]!)).toBe(false);
    expect(canDefer(groups.value[1]!)).toBe(true);
    messages.splice(20);
    expect(groups.value).toHaveLength(2);
    expect(canDefer(groups.value[0]!)).toBe(false);
    messages.splice(16);
    expect(canDefer(groups.value[0]!)).toBe(false);
  });
});
