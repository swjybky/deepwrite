import { afterEach } from "vitest";
import {
  createDeferredApi,
  createEnvelope,
  document,
  eventOptions,
  describe,
  expect,
  it,
  runtime,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

afterEach(() => vi.useRealTimers());

describe("conversation idle timeout during delegation", () => {
  it.each(["completed", "error"] as const)(
    "keeps a silent child alive and resumes idle detection after %s",
    async (status) => {
      vi.useFakeTimers();
      const deferred = createDeferredApi();
      const controller = useAgentConversation({ api: () => deferred.api });
      const sessionId = controller.sessionId.value;
      const runId = "run-child-idle";
      controller.draft.value = "写测试小节";
      const sending = controller.sendMessage(document);
      deferred.resolveAccepted(0, {
        sessionId,
        runId,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      await sending;
      const base = {
        sessionId,
        runId,
        parentToolCallId: "spawn",
        subagentRunId: "child",
        subagentId: "writer",
        name: "写手",
        runtime
      };
      controller.handleEvent(
        createEnvelope(
          "subagent.started",
          { ...base, task: "测试" },
          eventOptions(sessionId, runId, "started")
        )
      );
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(controller.isBusy.value).toBe(true);
      expect(controller.conversationError.value).toBeNull();
      expect(controller.messages.value.at(-1)?.subagentRuns?.[0]?.status).toBe(
        "running"
      );
      controller.handleEvent(
        createEnvelope(
          "subagent.completed",
          { ...base, status, summary: "测试结束" },
          eventOptions(sessionId, runId, "completed")
        )
      );
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(controller.isBusy.value).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.isBusy.value).toBe(false);
      expect(controller.conversationError.value).toBe(
        "智能体长时间没有返回新事件，请稍后重试。"
      );
      controller.dispose();
    }
  );
});
