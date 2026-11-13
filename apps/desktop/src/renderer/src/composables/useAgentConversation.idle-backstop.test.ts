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

async function startRun(runId: string) {
  vi.useFakeTimers();
  const deferred = createDeferredApi();
  const controller = useAgentConversation({ api: () => deferred.api });
  const sessionId = controller.sessionId.value;
  controller.draft.value = "验证界面兜底超时";
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  return { deferred, controller, sessionId };
}

describe("conversation idle backstop", () => {
  it("aborts the Agent run it gives up on", async () => {
    const runId = "run-idle-abort";
    const { deferred, controller, sessionId } = await startRun(runId);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(controller.conversationError.value).toBe(
      "智能体长时间没有返回新事件，请稍后重试。"
    );
    expect(deferred.aborts).toEqual([{ sessionId, runId }]);
    controller.dispose();
  });

  it("waits for the Agent-bounded compaction before giving up", async () => {
    const runId = "run-idle-compaction";
    const { deferred, controller, sessionId } = await startRun(runId);
    controller.handleEvent(
      createEnvelope(
        "agent.context_compaction",
        {
          sessionId,
          runId,
          messageId: `${runId}_assistant`,
          runtime,
          phase: "started" as const,
          reason: "run_limit" as const,
          level: "summary" as const
        },
        eventOptions(sessionId, runId, "compaction-started")
      )
    );

    await vi.advanceTimersByTimeAsync(11 * 60_000 - 1);
    expect(controller.isBusy.value).toBe(true);
    expect(deferred.aborts).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.isBusy.value).toBe(false);
    expect(deferred.aborts).toEqual([{ sessionId, runId }]);
    controller.dispose();
  });
});
