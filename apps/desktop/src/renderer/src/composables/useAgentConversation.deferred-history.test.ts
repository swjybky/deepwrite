import { expect, it } from "vitest";
import { useAgentConversation } from "./useAgentConversation";

it("retains loaded book history when the user types before hydration completes", async () => {
  const previous = useAgentConversation({ api: () => undefined });
  previous.draft.value = "书本之前的对话";
  const previousId = previous.sessionId.value;
  const snapshot = previous.capturePersistenceSnapshot();
  previous.dispose();
  const current = useAgentConversation({ api: () => undefined });
  const currentId = current.sessionId.value;
  current.holdPersistenceEmits();
  try {
    const loading = current.restorePersistenceSnapshot(snapshot);
    current.draft.value = "用户刚输入的新内容";
    expect(await loading).toBe(false);
    current.releasePersistenceEmits();
    expect(current.sessionId.value).toBe(currentId);
    expect(current.draft.value).toBe("用户刚输入的新内容");
    expect(current.history.value.map(({ sessionId }) => sessionId)).toContain(
      previousId
    );
    const restored = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: current.capturePersistenceSnapshot()
    });
    try {
      expect(restored.history.value).toHaveLength(2);
      expect(restored.selectConversation(previousId)).toBe(true);
      expect(restored.draft.value).toBe("书本之前的对话");
    } finally {
      restored.dispose();
    }
  } finally {
    current.dispose();
  }
});
