import {
  describe,
  expect,
  it,
  createMemoryStorage,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("conversation history retention", () => {
  it("keeps history order and timestamps when selecting older conversations", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.messages.value = [
      {
        id: "较早的对话",
        role: "user",
        content: "较早的对话",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    const olderId = controller.sessionId.value;
    controller.newConversation();
    controller.messages.value = [
      {
        id: "较新的对话",
        role: "user",
        content: "较新的对话",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    const newerId = controller.sessionId.value;
    const before = controller.history.value.map(({ sessionId, updatedAt }) => ({
      sessionId,
      updatedAt
    }));

    expect(controller.selectConversation(olderId)).toBe(true);
    expect(
      controller.history.value.map(({ sessionId, updatedAt }) => ({
        sessionId,
        updatedAt
      }))
    ).toEqual(before);
    expect(
      controller.history.value.find((item) => item.current)?.sessionId
    ).toBe(olderId);
    expect(controller.selectConversation(newerId)).toBe(true);
    expect(
      controller.history.value.map(({ sessionId, updatedAt }) => ({
        sessionId,
        updatedAt
      }))
    ).toEqual(before);
    controller.dispose();
  });

  it("preserves every conversation beyond the former 50-session limit", () => {
    const storage = createMemoryStorage();
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options("conversation-history-limit-test")
    });

    for (let index = 0; index < 52; index += 1) {
      controller.messages.value = [
        {
          id: `user-${index}`,
          role: "user",
          content: `历史对话 ${index}`,
          createdAt: new Date(Date.UTC(2026, 6, 19, 10, index)).toISOString(),
          status: "completed"
        }
      ];
      controller.newConversation();
    }

    expect(controller.history.value).toHaveLength(52);
    expect(
      controller.history.value.some((item) => item.title === "历史对话 0")
    ).toBe(true);
    expect(
      controller.history.value.some((item) => item.title === "历史对话 1")
    ).toBe(true);
    expect(
      controller.history.value.some((item) => item.title === "历史对话 51")
    ).toBe(true);
    controller.messages.value = [
      {
        id: "第 53 个对话",
        role: "user",
        content: "第 53 个对话",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    expect(controller.history.value).toHaveLength(53);
    expect(controller.history.value[0]?.current).toBe(true);
    const snapshot = controller.capturePersistenceSnapshot();
    expect(snapshot.conversations).toHaveLength(53);
    const restored = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: snapshot
    });
    expect(restored.history.value).toHaveLength(53);
    expect(restored.history.value[0]?.sessionId).toBe(
      controller.sessionId.value
    );
    expect(
      restored.history.value.some((item) => item.title === "历史对话 2")
    ).toBe(true);
    restored.dispose();
    controller.dispose();
  });
});
