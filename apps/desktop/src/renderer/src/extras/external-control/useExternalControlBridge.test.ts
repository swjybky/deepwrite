import type { ExternalWindowRequest } from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { systemEventCenter } from "../../events/systemEventCenter";
import {
  useExternalControlBridge,
  type ExternalControlBridgePorts
} from "./useExternalControlBridge";

function harness(
  options: Partial<ExternalControlBridgePorts> = {},
  running = false
) {
  const messages = ref<Record<string, unknown>[]>([]);
  const activeRunId = ref<string | null>(null);
  const sessionId = ref("session-1");
  const draft = ref("用户的草稿");
  const pendingUserInput = ref<Record<string, unknown> | null>(null);
  const busy = ref(false);
  const conversationError = ref<string | null>(null);
  const hasPendingEditReview = ref(false);
  const overrideNextApprovalMode = vi.fn();
  const overrideNextAgentTeamMode = vi.fn();
  const sentDrafts: string[] = [];
  const conversation = {
    messages,
    activeRunId,
    sessionId,
    draft,
    pendingUserInput,
    conversationError,
    isBusy: computed(() => busy.value),
    hasPendingEditReview: computed(() => hasPendingEditReview.value),
    overrideNextApprovalMode,
    overrideNextAgentTeamMode,
    newConversation: vi.fn(async () => undefined),
    submitUserInput: vi.fn(async () => true),
    stopGeneration: vi.fn(async () => {
      for (const message of messages.value) {
        if (message.runId === activeRunId.value) message.status = "stopped";
      }
      activeRunId.value = null;
      busy.value = false;
      return true;
    })
  } as unknown as AgentConversationController;
  const respond = vi.fn(
    async (_response: { requestId: string }): Promise<void> => undefined
  );
  const sendForTest = async (): Promise<void> => {
    sentDrafts.push(draft.value);
    draft.value = "";
    const runId = `internal-${messages.value.length}`;
    activeRunId.value = running ? runId : null;
    busy.value = running;
    messages.value.push(
      { id: `user-${runId}`, role: "user", content: "外部消息" },
      {
        id: `assistant-${runId}`,
        runId,
        role: "assistant",
        content: "回复",
        status: running ? "streaming" : "completed",
        editProposals: [{ title: "导语", status: "accepted" }]
      }
    );
  };
  let send = options.send ?? sendForTest;
  const dispose = useExternalControlBridge({
    api: () => ({ externalControl: { respond } }) as never,
    open: async () => true,
    conversation: () => conversation,
    conversationsRestored: async () => undefined,
    teamAvailable: () => true,
    sendReady: () => true,
    longEditorHasUnsavedChanges: () => false,
    ...options,
    send: () => send()
  });
  let sequence = 0;
  async function ask(payload: ExternalWindowRequest) {
    const id = `request-${(sequence += 1)}`;
    systemEventCenter.publish({
      protocolVersion: 1,
      id,
      type: "externalControl.window_request",
      timestamp: new Date().toISOString(),
      context: { correlationId: id },
      payload
    });
    await vi.waitFor(
      () =>
        expect(respond.mock.calls.some(([r]) => r.requestId === id)).toBe(true),
      { timeout: 6_000 }
    );
    return (respond.mock.calls as unknown as [Record<string, unknown>][])
      .map(([response]) => response)
      .filter((response) => response.requestId === id)
      .at(-1) as { ok: boolean; result: Record<string, unknown>; code: string };
  }
  const start = () =>
    ask({
      action: "start_run",
      target: { kind: "short", id: "book" },
      message: "外部消息"
    });
  return {
    ask,
    start,
    dispose,
    conversation,
    activeRunId,
    sessionId,
    messages,
    draft,
    busy,
    pendingUserInput,
    conversationError,
    hasPendingEditReview,
    overrideNextApprovalMode,
    overrideNextAgentTeamMode,
    sentDrafts,
    respond,
    sendForTest,
    setSend(next: () => Promise<void>) {
      send = next;
    }
  };
}

describe("external control bridge", () => {
  it("sends through the composer and gives the draft back", async () => {
    const test = harness();
    const { result } = await test.start();
    expect(test.sentDrafts).toEqual(["外部消息"]);
    expect(test.draft.value).toBe("用户的草稿");
    expect(result).toMatchObject({
      status: "completed",
      reply: "回复",
      changes: ["导语"]
    });
    test.dispose();
  });

  it("forces automatic approval for that one send only", async () => {
    const test = harness();
    await test.start();
    expect(test.overrideNextApprovalMode.mock.calls).toEqual([
      ["auto-approve"],
      [null]
    ]);
    test.dispose();
  });

  it("runs with the team for that one send when there is one", async () => {
    const test = harness();
    const { result } = await test.start();
    expect(test.overrideNextAgentTeamMode.mock.calls).toEqual([
      ["team"],
      [null]
    ]);
    expect(result).toMatchObject({ mode: "team" });
    test.dispose();
  });

  it("falls back to the main agent when there is no team", async () => {
    const test = harness({ teamAvailable: () => false });
    const { result } = await test.start();
    expect(test.overrideNextAgentTeamMode.mock.calls[0]).toEqual(["normal"]);
    expect(result).toMatchObject({ mode: "normal" });
    test.dispose();
  });

  it("refuses an explicit team run without a team", async () => {
    const test = harness({ teamAvailable: () => false });
    expect(
      await test.ask({
        action: "start_run",
        target: { kind: "short", id: "book" },
        message: "外部消息",
        mode: "team"
      })
    ).toMatchObject({ ok: false, code: "external.invalid_input" });
    expect(test.sentDrafts).toEqual([]);
    test.dispose();
  });

  it("keeps an explicit normal run away from the team", async () => {
    const test = harness();
    await test.ask({
      action: "start_run",
      target: { kind: "short", id: "book" },
      message: "外部消息",
      mode: "normal"
    });
    expect(test.overrideNextAgentTeamMode.mock.calls[0]).toEqual(["normal"]);
    test.dispose();
  });

  it("leaves a library run's mode alone", async () => {
    const test = harness();
    const { result } = await test.ask({
      action: "start_run",
      target: { kind: "library", id: "library" },
      message: "外部消息"
    });
    expect(test.overrideNextAgentTeamMode.mock.calls[0]).toEqual([null]);
    expect(result).not.toHaveProperty("mode");
    test.dispose();
  });

  it("waits for a restoring conversation before sending", async () => {
    let finishRestoring = (): void => undefined;
    const restoring = new Promise<void>((resolve) => {
      finishRestoring = resolve;
    });
    const test = harness({ conversationsRestored: () => restoring });
    const started = test.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(test.sentDrafts).toEqual([]);
    finishRestoring();
    expect(await started).toMatchObject({ ok: true });
    expect(test.sentDrafts).toEqual(["外部消息"]);
    test.dispose();
  });

  it("waits for the team catalog before choosing a mode", async () => {
    const catalog: { available?: boolean } = {};
    const test = harness({ teamAvailable: () => catalog.available });
    const started = test.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(test.sentDrafts).toEqual([]);
    catalog.available = true;
    expect(await started).toMatchObject({ result: { mode: "team" } });
    test.dispose();
  });

  it("refuses a target whose conversation is running", async () => {
    const test = harness();
    test.busy.value = true;
    expect(await test.start()).toMatchObject({
      ok: false,
      code: "external.busy"
    });
    expect(test.sentDrafts).toEqual([]);
    test.dispose();
  });

  it("waits for a long work's context before sending", async () => {
    let ready = false;
    const test = harness({ sendReady: () => ready });
    const started = test.ask({
      action: "start_run",
      target: { kind: "long", id: "longbook_1" },
      message: "外部消息"
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(test.sentDrafts).toEqual([]);
    ready = true;
    await started;
    expect(test.sentDrafts).toEqual(["外部消息"]);
    test.dispose();
  });

  it("reports a message that never left", async () => {
    const send = vi.fn(async () => undefined);
    const test = harness({ send });
    test.conversationError.value = "没有可用模型";
    expect(await test.start()).toMatchObject({
      ok: false,
      code: "external.invalid_input",
      message: "没有可用模型"
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(test.draft.value).toBe("用户的草稿");
    test.dispose();
  });

  it("sends again when a settling workspace cancelled the first try", async () => {
    let attempts = 0;
    const test = harness();
    test.setSend(async () => {
      attempts += 1;
      if (attempts > 1) await test.sendForTest();
    });
    expect(await test.start()).toMatchObject({ ok: true });
    expect(attempts).toBe(2);
    test.dispose();
  });

  it("forwards a question with plain data the bridge can carry", async () => {
    const test = harness({}, true);
    const { result } = await test.start();
    test.pendingUserInput.value = {
      source: "ask_user_question",
      questions: [{ id: "q1", question: "主角叫什么？" }]
    };
    const status = await test.ask({
      action: "run_status",
      runId: String(result.runId)
    });
    expect(status.result).toMatchObject({
      status: "waiting_for_input",
      questionSource: "ask_user_question"
    });
    expect(() => structuredClone(status.result)).not.toThrow();
    test.dispose();
  });

  it("reports automatic edits that are waiting on the user", async () => {
    const test = harness({}, true);
    const { result } = await test.start();
    test.hasPendingEditReview.value = true;
    test.messages.value[1]!.editProposals = [
      { title: "导语", status: "pending" }
    ];
    test.messages.value[1]!.status = "completed";
    test.activeRunId.value = null;
    test.busy.value = false;
    expect(
      (await test.ask({ action: "run_status", runId: String(result.runId) }))
        .result
    ).toMatchObject({ status: "waiting_for_user" });
    test.dispose();
  });

  it("marks a stopped run as stopped", async () => {
    const test = harness({}, true);
    const { result } = await test.start();
    const stopped = await test.ask({
      action: "stop_run",
      runId: String(result.runId)
    });
    expect(test.conversation.stopGeneration).toHaveBeenCalledOnce();
    expect(stopped.result).toMatchObject({ status: "stopped" });
    test.dispose();
  });

  it("answers unknown runs instead of hanging", async () => {
    const test = harness();
    expect(
      await test.ask({ action: "run_status", runId: "missing" })
    ).toMatchObject({ ok: false, code: "external.not_found" });
    test.dispose();
  });

  it("answers with an error when a result cannot be delivered", async () => {
    const test = harness();
    test.respond.mockRejectedValueOnce(new Error("could not be cloned"));
    await test.start();
    await vi.waitFor(() => expect(test.respond).toHaveBeenCalledTimes(2));
    expect(test.respond.mock.calls.at(-1)).toMatchObject([
      { ok: false, code: "external.not_ready" }
    ]);
    test.dispose();
  });
});

describe("external run ownership", () => {
  it("keeps the old result and cannot stop or answer a later run", async () => {
    const test = harness({}, true);
    try {
      const first = (await test.start()).result;
      test.messages.value[1]!.status = "completed";
      test.activeRunId.value = null;
      test.busy.value = false;
      // Do not poll the first run before starting the next one.
      await test.start();
      test.messages.value[3]!.content = "第二次回复";
      test.pendingUserInput.value = {
        source: "ask_user_question",
        questions: []
      };
      const old = await test.ask({
        action: "run_status",
        runId: String(first.runId)
      });
      expect(old.result).toMatchObject({ status: "completed", reply: "回复" });
      await test.ask({ action: "stop_run", runId: String(first.runId) });
      expect(test.conversation.stopGeneration).not.toHaveBeenCalled();
      expect(
        await test.ask({
          action: "answer_run",
          runId: String(first.runId),
          answers: []
        })
      ).toMatchObject({ ok: false, code: "external.invalid_input" });
      expect(test.conversation.submitUserInput).not.toHaveBeenCalled();
    } finally {
      test.dispose();
    }
  });

  it("follows a pending placeholder when acceptance renames it", async () => {
    const test = harness({}, true);
    test.setSend(async () => {
      test.messages.value.push({
        id: "pending",
        role: "assistant",
        content: "",
        status: "streaming"
      });
      test.busy.value = true;
      test.draft.value = "";
    });
    try {
      const first = (await test.start()).result;
      expect(first.status).toBe("running");
      Object.assign(test.messages.value[0]!, {
        id: "accepted_assistant",
        runId: "accepted",
        content: "新的回复"
      });
      test.activeRunId.value = "accepted";
      expect(
        (await test.ask({ action: "run_status", runId: String(first.runId) }))
          .result
      ).toMatchObject({ status: "running", reply: "新的回复" });
      await test.ask({ action: "stop_run", runId: String(first.runId) });
      expect(test.conversation.stopGeneration).toHaveBeenCalledOnce();
    } finally {
      test.dispose();
    }
  });

  it("keeps completed results after the conversation is replaced", async () => {
    const test = harness();
    try {
      const first = (await test.start()).result;
      test.sessionId.value = "another-session";
      test.messages.value = [];
      expect(
        (await test.ask({ action: "run_status", runId: String(first.runId) }))
          .result
      ).toEqual(first);
      await test.ask({ action: "stop_run", runId: String(first.runId) });
      expect(test.conversation.stopGeneration).not.toHaveBeenCalled();
    } finally {
      test.dispose();
    }
  });
});
