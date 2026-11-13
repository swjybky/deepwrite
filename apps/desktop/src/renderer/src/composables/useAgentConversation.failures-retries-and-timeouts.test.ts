import {
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createDeferredApi,
  createDraftCoordinatorDocument,
  createEnvelope,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  shortStageTitle,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

describe("agent conversation controller: failures-retries-and-timeouts", () => {
  it("releases busy state and exposes a clear agent error", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "验证错误";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_error",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId: "run_error",
          code: "agent.failed",
          message: "本地运行失败",
          runtime
        },
        eventOptions(sessionId, "run_error", "evt_error")
      )
    );

    expect(controller.conversationError.value).toBe("本地运行失败");
    expect(controller.messages.value.at(-1)?.status).toBe("error");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("rolls a failed model turn back to its checkpoint and stays stoppable while retrying", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "先查资料再回答";
    const sessionId = controller.sessionId.value;
    const runId = "run_retry";
    const messageId = "message_retry";
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId,
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "agent.turn_started",
        {
          sessionId,
          runId,
          messageId,
          turnId: "turn_1",
          attempt: 1,
          maxAttempts: 6,
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_turn_1")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId,
          toolCallId: "tool_kept",
          toolName: "read_file",
          args: { path: "notes.md" },
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_tool_requested")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.execution_completed",
        {
          sessionId,
          runId,
          toolCallId: "tool_kept",
          toolName: "read_file",
          resultSummary: "已读取 notes.md",
          isError: false,
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_tool_completed")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.turn_started",
        {
          sessionId,
          runId,
          messageId,
          turnId: "turn_2",
          attempt: 1,
          maxAttempts: 6,
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_turn_2")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        { sessionId, runId, messageId, delta: "这段思考会被撤销", runtime },
        eventOptions(sessionId, runId, "evt_retry_partial_thinking")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        { sessionId, runId, messageId, delta: "这段回复会被撤销", runtime },
        eventOptions(sessionId, runId, "evt_retry_partial_message")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.call_stream",
        {
          sessionId,
          runId,
          streamId: "retry_stream",
          toolCallId: "tool_partial",
          toolName: "write_workspace_editor",
          phase: "delta" as const,
          argumentsDelta: '{"text":"未完成',
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_partial_tool")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.retry_scheduled",
        {
          sessionId,
          runId,
          messageId,
          turnId: "turn_2",
          failedAttempt: 1,
          nextAttempt: 2,
          maxAttempts: 6,
          delayMs: 30_000,
          retryAt: new Date(Date.now() + 30_000).toISOString(),
          reason: "连接被重置",
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_scheduled")
      )
    );

    const waitingMessage = controller.messages.value.at(-1);
    expect(waitingMessage).toMatchObject({
      id: messageId,
      content: "",
      status: "streaming",
      retry: {
        state: "scheduled",
        attempt: 2,
        maxAttempts: 6,
        delayMs: 30_000,
        reason: "连接被重置"
      }
    });
    expect(waitingMessage?.thinking).toBeUndefined();
    expect(waitingMessage?.toolCalls).toMatchObject([
      { id: "tool_kept", status: "completed" }
    ]);
    expect(
      waitingMessage?.toolCalls?.some((tool) => tool.id === "tool_partial")
    ).toBe(false);
    expect(controller.isBusy.value).toBe(true);
    expect(controller.canStop.value).toBe(true);

    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        { sessionId, runId, messageId, delta: "失败尝试的迟到内容", runtime },
        eventOptions(sessionId, runId, "evt_retry_late_delta")
      )
    );
    expect(controller.messages.value.at(-1)?.content).toBe("");

    controller.handleEvent(
      createEnvelope(
        "agent.turn_started",
        {
          sessionId,
          runId,
          messageId,
          turnId: "turn_2",
          attempt: 2,
          maxAttempts: 6,
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_turn_2_attempt_2")
      )
    );
    expect(controller.messages.value.at(-1)?.retry?.state).toBe("trying");

    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        { sessionId, runId, messageId, delta: "重试成功", runtime },
        eventOptions(sessionId, runId, "evt_retry_success_delta")
      )
    );
    expect(controller.messages.value.at(-1)?.retry).toBeUndefined();
    expect(controller.messages.value.at(-1)?.content).toBe("重试成功");

    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId,
          messageId,
          role: "assistant" as const,
          content: "重试成功",
          runtime
        },
        eventOptions(sessionId, runId, "evt_retry_completed")
      )
    );
    expect(controller.messages.value.at(-1)?.retry).toBeUndefined();
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it.each([
    ["pi_agent.aborted", "stopped", null],
    ["agent.failed", "error", "重试最终失败"]
  ] as const)(
    "clears retry state when a waiting run ends with %s",
    async (code, expectedStatus, expectedError) => {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({
        api: () => deferred.api,
        idleTimeoutMs: 10_000
      });
      controller.draft.value = "验证重试终态";
      const sessionId = controller.sessionId.value;
      const runId = `run_retry_terminal_${expectedStatus}`;
      const messageId = `message_retry_terminal_${expectedStatus}`;
      const sending = controller.sendMessage(document);
      deferred.resolveAccepted(0, {
        sessionId,
        runId,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      await sending;
      controller.handleEvent(
        createEnvelope(
          "agent.turn_started",
          {
            sessionId,
            runId,
            messageId,
            turnId: "terminal_turn",
            attempt: 1,
            maxAttempts: 6,
            runtime
          },
          eventOptions(sessionId, runId, `evt_terminal_turn_${expectedStatus}`)
        )
      );
      controller.handleEvent(
        createEnvelope(
          "agent.retry_scheduled",
          {
            sessionId,
            runId,
            messageId,
            turnId: "terminal_turn",
            failedAttempt: 1,
            nextAttempt: 2,
            maxAttempts: 6,
            delayMs: 30_000,
            retryAt: new Date(Date.now() + 30_000).toISOString(),
            reason: "暂时断线",
            runtime
          },
          eventOptions(sessionId, runId, `evt_terminal_retry_${expectedStatus}`)
        )
      );
      expect(controller.messages.value.at(-1)?.retry?.state).toBe("scheduled");

      controller.handleEvent(
        createEnvelope(
          "agent.error",
          {
            sessionId,
            runId,
            code,
            message: expectedError ?? "Agent run aborted.",
            runtime
          },
          eventOptions(sessionId, runId, `evt_terminal_end_${expectedStatus}`)
        )
      );

      expect(controller.messages.value.at(-1)?.status).toBe(expectedStatus);
      expect(controller.messages.value.at(-1)?.retry).toBeUndefined();
      expect(controller.conversationError.value).toBe(expectedError);
      expect(controller.isBusy.value).toBe(false);
      controller.dispose();
    }
  );

  it("rolls back failed subagent turns without discarding earlier tool results", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "让子智能体核对资料";
    const sessionId = controller.sessionId.value;
    const runId = "run_subagent_retry";
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
      parentToolCallId: "spawn_retry",
      subagentRunId: "subrun_retry",
      subagentId: "researcher",
      name: "资料员",
      runtime
    };
    const activity = (
      value:
        | {
            type: "turn_started";
            turnId: string;
            attempt: number;
            maxAttempts: number;
          }
        | {
            type: "retry_scheduled";
            turnId: string;
            failedAttempt: number;
            nextAttempt: number;
            maxAttempts: number;
            delayMs: number;
            retryAt: string;
            reason: string;
          }
        | { type: "thinking_delta"; delta: string }
        | { type: "message_delta"; delta: string }
        | {
            type: "tool_requested";
            toolCallId: string;
            toolName: string;
            args: unknown;
          }
        | {
            type: "tool_completed";
            toolCallId: string;
            toolName: string;
            resultSummary: string;
            isError: boolean;
          },
      eventId: string
    ) =>
      controller.handleEvent(
        createEnvelope(
          "subagent.activity",
          { ...base, activity: value },
          eventOptions(sessionId, runId, eventId)
        )
      );

    controller.handleEvent(
      createEnvelope(
        "subagent.started",
        { ...base, task: "核对背景资料" },
        eventOptions(sessionId, runId, "evt_sub_retry_started")
      )
    );
    activity(
      { type: "turn_started", turnId: "subturn_1", attempt: 1, maxAttempts: 6 },
      "evt_sub_retry_turn_1"
    );
    activity(
      {
        type: "tool_requested",
        toolCallId: "subtool_kept",
        toolName: "read_file",
        args: { path: "facts.md" }
      },
      "evt_sub_retry_tool_requested"
    );
    activity(
      {
        type: "tool_completed",
        toolCallId: "subtool_kept",
        toolName: "read_file",
        resultSummary: "已读取 facts.md",
        isError: false
      },
      "evt_sub_retry_tool_completed"
    );
    activity(
      { type: "turn_started", turnId: "subturn_2", attempt: 1, maxAttempts: 6 },
      "evt_sub_retry_turn_2"
    );
    activity(
      { type: "thinking_delta", delta: "未完成思考" },
      "evt_sub_retry_partial_thinking"
    );
    activity(
      { type: "message_delta", delta: "未完成回复" },
      "evt_sub_retry_partial_message"
    );
    activity(
      {
        type: "retry_scheduled",
        turnId: "subturn_2",
        failedAttempt: 1,
        nextAttempt: 2,
        maxAttempts: 6,
        delayMs: 30_000,
        retryAt: new Date(Date.now() + 30_000).toISOString(),
        reason: "上游暂时不可用"
      },
      "evt_sub_retry_scheduled"
    );

    const waitingRun = controller.messages.value.at(-1)?.subagentRuns?.[0];
    expect(waitingRun).toMatchObject({
      status: "running",
      retry: { state: "scheduled", attempt: 2, maxAttempts: 6 },
      toolCalls: [{ id: "subtool_kept", status: "completed" }]
    });
    expect(waitingRun?.thinking).toBeUndefined();
    expect(waitingRun?.output).toBeUndefined();
    expect(controller.isBusy.value).toBe(true);

    activity(
      { type: "turn_started", turnId: "subturn_2", attempt: 2, maxAttempts: 6 },
      "evt_sub_retry_turn_2_attempt_2"
    );
    expect(
      controller.messages.value.at(-1)?.subagentRuns?.[0]?.retry?.state
    ).toBe("trying");
    activity(
      { type: "thinking_delta", delta: "重试后的思考" },
      "evt_sub_retry_success_thinking"
    );
    expect(
      controller.messages.value.at(-1)?.subagentRuns?.[0]?.retry
    ).toBeUndefined();
    expect(controller.messages.value.at(-1)?.subagentRuns?.[0]?.thinking).toBe(
      "重试后的思考"
    );
    controller.dispose();
  });

  it("stops the active run and keeps a partial reply without treating it as an error", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "生成一段长回复";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_stop",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_stop",
          messageId: "message_stop",
          delta: "已经生成的部分",
          runtime
        },
        eventOptions(sessionId, "run_stop", "evt_stop_delta")
      )
    );

    expect(controller.canStop.value).toBe(true);
    await expect(controller.stopGeneration()).resolves.toBe(true);
    expect(deferred.aborts).toEqual([{ sessionId, runId: "run_stop" }]);
    expect(controller.canStop.value).toBe(false);

    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId: "run_stop",
          code: "pi_agent.aborted",
          message: "Agent run aborted.",
          runtime
        },
        eventOptions(sessionId, "run_stop", "evt_stopped")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "已经生成的部分",
      status: "stopped"
    });
    expect(controller.conversationError.value).toBeNull();
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("isolates a timed-out acceptance from the next send", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 50
    });
    const sessionId = controller.sessionId.value;
    controller.draft.value = "第一轮";
    const first = controller.sendMessage(document);
    await vi.advanceTimersByTimeAsync(60);
    expect(controller.isBusy.value).toBe(false);

    controller.draft.value = "第二轮";
    const second = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_late",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await first;
    expect(controller.isBusy.value).toBe(true);

    deferred.resolveAccepted(1, {
      sessionId,
      runId: "run_current",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await second;
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("backs up the Agent's five-minute deadline with a six-minute UI timeout", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.draft.value = "验证默认空闲超时";
    void controller.sendMessage(document);

    await vi.advanceTimersByTimeAsync(6 * 60_000 - 1);
    expect(controller.isBusy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.isBusy.value).toBe(false);
    expect(controller.conversationError.value).toBe(
      "智能体长时间没有返回新事件，请稍后重试。"
    );
    controller.dispose();
  });

  it("marks an existing streaming message as error on idle timeout", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 50
    });
    controller.draft.value = "验证流超时";
    const sessionId = controller.sessionId.value;
    void controller.sendMessage(document);
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_timeout",
          messageId: "message_timeout",
          delta: "未完成",
          runtime
        },
        eventOptions(sessionId, "run_timeout", "evt_timeout")
      )
    );
    await vi.advanceTimersByTimeAsync(60);

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "未完成",
      status: "error"
    });
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("rejects an acceptance that disagrees with an already observed run", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "验证身份";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_observed",
          messageId: "message_observed",
          delta: "先到事件",
          runtime
        },
        eventOptions(sessionId, "run_observed", "evt_observed")
      )
    );
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_other",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.conversationError.value).toContain("运行标识不一致");
    expect(controller.messages.value.at(-1)?.status).toBe("error");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("builds the default text stages plus the physical expert-draft directory", async () => {
    for (const [index, activeStageId] of SHORT_WORKSPACE_STAGE_IDS.entries()) {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({
        api: () => deferred.api,
        idleTimeoutMs: 10_000
      });
      const workspaceDocuments = createShortWorkspaceDocuments();
      const activeDocument =
        activeStageId === "draft"
          ? createDraftCoordinatorDocument(workspaceDocuments)
          : workspaceDocuments.find(
              (candidate) => candidate.stageId === activeStageId
            );
      if (!activeDocument)
        throw new Error(`Missing stage document: ${activeStageId}`);

      controller.draft.value = `检查 ${activeStageId}`;
      const sending = controller.sendMessage(
        activeDocument,
        [...workspaceDocuments].reverse()
      );
      const sessionId = controller.sessionId.value;
      deferred.resolveAccepted(0, {
        sessionId,
        runId: `run_short_snapshot_${index}`,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      await sending;

      const context = deferred.prompts[0]?.workspaceContext;
      expect(context?.shortWorkspace).toMatchObject({
        id: "short_story_1",
        title: "雨夜来信",
        categories: ["都市", "悬疑"],
        activeStageId,
        stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
          stageId,
          title: shortStageTitle(stageId),
          content: `${stageId} 的实时内容`,
          revision: createShortWorkspaceContentRevision(`${stageId} 的实时内容`)
        })),
        expertDraft: {
          id: "draft",
          title: "正文",
          sections: [
            expect.objectContaining({
              id: "intro",
              body: expect.objectContaining({
                documentId: "short_draft_intro_body",
                content: ""
              }),
              characterState: expect.objectContaining({
                documentId: "short_draft_intro_state",
                content: ""
              })
            }),
            expect.objectContaining({
              id: "section-1",
              body: expect.objectContaining({
                documentId: "short_draft_section-1_body",
                content: "draft 的实时内容"
              }),
              characterState: expect.objectContaining({
                documentId: "short_draft_section-1_state",
                content: "第一节人物状态"
              })
            })
          ]
        }
      });
      expect(context?.activeResource?.content).toBe(
        activeStageId === "draft" ? "" : `${activeStageId} 的实时内容`
      );
      if (activeStageId === "draft") {
        expect(context?.activeResource?.id).toBe("draft");
        expect(context?.shortWorkspace?.activeAgentId).toBe("short");
      }
      controller.dispose();
    }
  });
});
