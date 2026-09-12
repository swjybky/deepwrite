import type { AgentConversationPersistenceSnapshot } from "./useAgentConversation.test-support";
import {
  createDeferredApi,
  createEditProposal,
  createEnvelope,
  createMemoryStorage,
  describe,
  document,
  expect,
  it,
  reactive,
  runtime,
  storedConversation,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("agent conversation controller: snapshot-persistence", () => {
  it("submits chat-assistant messages without workspace or write context", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.draft.value = "只聊这个问题";

    const sending = controller.sendAssistantMessage();
    expect(deferred.prompts).toEqual([
      expect.objectContaining({
        mode: "chat-assistant",
        message: "只聊这个问题"
      })
    ]);
    expect(deferred.prompts[0]).not.toHaveProperty("workspaceContext");
    expect(deferred.prompts[0]).not.toHaveProperty("writeApprovalMode");

    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_chat_assistant",
      acceptedAt: "2026-08-17T08:00:00.000Z",
      runtime
    });
    await sending;
    controller.dispose();
  });

  it("forwards restored visible messages when continuing a persisted conversation", async () => {
    const deferred = createDeferredApi();
    const snapshot: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-restored-history",
      conversations: [
        {
          ...storedConversation(
            "session-restored-history",
            "2026-08-17T07:58:00.000Z",
            "先帮我规划一段雨夜相遇。"
          ),
          messages: [
            {
              id: "user-restored-history",
              role: "user",
              content: "先帮我规划一段雨夜相遇。",
              createdAt: "2026-08-17T07:58:00.000Z",
              status: "completed"
            },
            {
              id: "assistant-restored-history",
              role: "assistant",
              content: "可以从旧站台的一封错投来信开始。",
              createdAt: "2026-08-17T07:59:00.000Z",
              status: "completed"
            }
          ]
        }
      ]
    };
    const controller = useAgentConversation({
      api: () => deferred.api,
      initialPersistenceSnapshot: snapshot
    });
    controller.draft.value = "我上边说了啥？";

    const sending = controller.sendAssistantMessage();

    expect(deferred.prompts[0]?.conversationHistory).toEqual([
      {
        role: "user",
        content: "先帮我规划一段雨夜相遇。",
        createdAt: "2026-08-17T07:58:00.000Z"
      },
      {
        role: "assistant",
        content: "可以从旧站台的一封错投来信开始。",
        createdAt: "2026-08-17T07:59:00.000Z"
      }
    ]);
    expect(deferred.prompts[0]?.conversationHistory).not.toContainEqual(
      expect.objectContaining({ content: "我上边说了啥？" })
    );

    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_restored_history",
      acceptedAt: "2026-08-17T08:00:00.000Z",
      runtime
    });
    await sending;
    controller.dispose();
  });

  it("restores top-level model identity and real usage for context display", () => {
    const snapshot: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-context-usage",
      conversations: [
        {
          ...storedConversation(
            "session-context-usage",
            "2026-08-28T08:00:00.000Z",
            "继续写"
          ),
          messages: [
            {
              id: "assistant-context-usage",
              role: "assistant",
              content: "已完成。",
              createdAt: "2026-08-28T08:01:00.000Z",
              status: "completed",
              runtime: {
                provider: "example",
                model: "writer-1",
                mode: "provider",
                configId: "model-config-1"
              },
              usage: {
                inputTokens: 12_000,
                outputTokens: 345,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 12_345
              }
            }
          ]
        }
      ]
    };

    const controller = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: snapshot
    });

    expect(controller.messages.value[0]?.runtime).toEqual({
      provider: "example",
      model: "writer-1",
      mode: "provider",
      configId: "model-config-1"
    });
    expect(controller.messages.value[0]?.usage).toEqual({
      inputTokens: 12_000,
      outputTokens: 345,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 12_345
    });
    controller.dispose();
  });

  it("preserves enabled web search in normal chat requests", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.draft.value = "搜索今天的热点";

    const sending = controller.sendAssistantMessage({
      mode: "normal",
      webSearchEnabled: true
    });
    expect(deferred.prompts[0]?.chatAssistant).toEqual({
      mode: "normal",
      webSearchEnabled: true
    });

    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_normal_chat_web_search",
      acceptedAt: "2026-08-17T08:00:00.000Z",
      runtime
    });
    await sending;
    controller.dispose();
  });

  it("normalizes reactive project context before sending it through IPC", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    const project = reactive({
      projectType: "short" as const,
      projectId: "book-1"
    });
    controller.draft.value = "查询人物设定";

    const sending = controller.sendAssistantMessage({
      mode: "project",
      project,
      webSearchEnabled: true
    });
    expect(deferred.prompts[0]?.chatAssistant).toEqual({
      mode: "project",
      project: { projectType: "short", projectId: "book-1" },
      webSearchEnabled: true
    });
    expect(() =>
      structuredClone(deferred.prompts[0]?.chatAssistant)
    ).not.toThrow();

    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_project_chat_assistant",
      acceptedAt: "2026-08-17T08:00:00.000Z",
      runtime
    });
    await sending;
    controller.dispose();
  });

  it("adds and replaces edit proposals with deep-cloned diff state", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.messages.value = [
      {
        id: "run_edit_1_assistant",
        role: "assistant",
        content: "已生成修改建议",
        createdAt: "2026-07-19T11:00:00.000Z",
        runId: "run_edit_1",
        status: "completed"
      }
    ];
    const proposal = createEditProposal();

    controller.upsertEditProposal("run_edit_1", proposal);
    proposal.toolCallIds.push("mutated_outside");
    proposal.hunks[0]!.lines[0]!.text = "外部改写";

    const storedProposal = controller.getEditProposal(
      "run_edit_1",
      "proposal_1"
    );
    expect(storedProposal).toMatchObject({
      summary: "调整雨夜相遇的因果关系",
      toolCallIds: ["tool_edit_1"]
    });
    expect(storedProposal?.hunks[0]?.lines[0]?.text).toBe("旧句");

    controller.upsertEditProposal(
      "run_edit_1",
      createEditProposal({
        summary: "更新后的修改摘要",
        additions: 2,
        updatedAt: "2026-07-19T11:02:00.000Z"
      })
    );

    expect(controller.messages.value[0]?.editProposals).toHaveLength(1);
    expect(
      controller.getEditProposal("run_edit_1", "proposal_1")
    ).toMatchObject({
      summary: "更新后的修改摘要",
      additions: 2,
      updatedAt: "2026-07-19T11:02:00.000Z"
    });
    controller.dispose();
  });

  it("updates completed-run proposal status and blocks sending while review is pending", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.messages.value = [
      {
        id: "run_edit_1_assistant",
        role: "assistant",
        content: "本轮已经完成",
        createdAt: "2026-07-19T11:00:00.000Z",
        runId: "run_edit_1",
        status: "completed"
      }
    ];
    controller.upsertEditProposal("run_edit_1", createEditProposal());
    controller.draft.value = "基于修改继续创作";

    expect(controller.hasPendingEditReview.value).toBe(true);
    expect(controller.canSend.value).toBe(false);
    await controller.sendMessage(document);
    expect(deferred.promptCount()).toBe(0);

    expect(
      controller.updateEditProposal("run_edit_1", "proposal_1", {
        status: "accepting",
        statusMessage: "正在应用"
      })
    ).toMatchObject({ status: "accepting", statusMessage: "正在应用" });
    expect(controller.hasPendingEditReview.value).toBe(true);

    expect(
      controller.updateEditProposal("run_edit_1", "proposal_1", {
        status: "accepted",
        statusMessage: "已应用"
      })
    ).toMatchObject({ status: "accepted", statusMessage: "已应用" });
    expect(controller.hasPendingEditReview.value).toBe(false);
    expect(controller.canSend.value).toBe(true);
    controller.dispose();
  });

  it("unblocks sending after an in-flight proposal save fails", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.messages.value = [
      {
        id: "run_edit_timeout_assistant",
        role: "assistant",
        content: "本轮已经完成",
        createdAt: "2026-07-19T11:00:00.000Z",
        runId: "run_edit_timeout",
        status: "completed"
      }
    ];
    controller.upsertEditProposal(
      "run_edit_timeout",
      createEditProposal({ runId: "run_edit_timeout" })
    );
    controller.draft.value = "保存失败后继续沟通";

    controller.updateEditProposal("run_edit_timeout", "proposal_1", {
      status: "accepting",
      statusMessage: "正在保存"
    });
    expect(controller.canSend.value).toBe(false);

    controller.updateEditProposal("run_edit_timeout", "proposal_1", {
      status: "error",
      statusMessage: "保存超时"
    });
    expect(controller.hasPendingEditReview.value).toBe(false);
    expect(controller.canSend.value).toBe(true);
    controller.dispose();
  });

  it("freezes the selected approval mode for each in-flight run", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.selectApprovalMode("auto-approve");
    controller.draft.value = "自动写入这次正文修改";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);

    expect(deferred.prompts[0]?.writeApprovalMode).toBe("auto-approve");

    expect(controller.acceptsRunEvent(sessionId, "run_auto_approval")).toBe(
      true
    );
    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );

    controller.selectApprovalMode("request-approval");
    expect(controller.approvalMode.value).toBe("request-approval");
    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );

    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_auto_approval",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.approvalModeForRun(sessionId, "run_auto_approval")).toBe(
      "auto-approve"
    );
    controller.dispose();
  });

  it("restores a validated structured snapshot into a pristine controller", async () => {
    const snapshot: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-restored",
      conversations: [
        storedConversation(
          "session-restored",
          "2026-08-14T01:00:00.000Z",
          "从异步存储恢复的消息"
        )
      ]
    };
    snapshot.conversations[0]!.draft = "从异步存储恢复的草稿";
    const controller = useAgentConversation({ api: () => undefined });

    await expect(controller.restorePersistenceSnapshot(snapshot)).resolves.toBe(
      true
    );
    expect(controller.sessionId.value).toBe("session-restored");
    expect(controller.messages.value[0]?.content).toBe("从异步存储恢复的消息");
    expect(controller.draft.value).toBe("从异步存储恢复的草稿");
    controller.dispose();
  });

  it("does not let a late persistence snapshot overwrite a local edit", async () => {
    const snapshot: AgentConversationPersistenceSnapshot = {
      version: 1,
      activeSessionId: "session-stale",
      conversations: [
        storedConversation(
          "session-stale",
          "2026-08-14T01:00:00.000Z",
          "已经过时的历史消息"
        )
      ]
    };
    const controller = useAgentConversation({ api: () => undefined });

    const restoring = controller.restorePersistenceSnapshot(snapshot);
    controller.draft.value = "用户刚刚输入的新草稿";

    await expect(restoring).resolves.toBe(false);
    expect(controller.draft.value).toBe("用户刚刚输入的新草稿");
    expect(controller.messages.value).toEqual([]);
    controller.dispose();
  });

  it("restores a snapshot that omitted draft and temperature", async () => {
    const controller = useAgentConversation({ api: () => undefined });
    await expect(
      controller.restorePersistenceSnapshot({
        version: 1,
        activeSessionId: "session-legacy",
        conversations: [
          {
            sessionId: "session-legacy",
            messages: [
              {
                id: "user-legacy",
                role: "user",
                content: "检查设定冲突",
                createdAt: "2026-08-15T07:51:00.000Z"
              }
            ],
            createdAt: "2026-08-15T07:51:00.000Z",
            updatedAt: "2026-08-15T07:51:09.000Z"
          }
        ]
      })
    ).resolves.toBe(true);
    expect(controller.sessionId.value).toBe("session-legacy");
    expect(controller.messages.value[0]?.content).toBe("检查设定冲突");
    expect(controller.draft.value).toBe("");
    expect(controller.temperature.value).toBe(0.7);
    controller.dispose();
  });

  it("keeps valid conversations when one stored session cannot be parsed", async () => {
    const controller = useAgentConversation({ api: () => undefined });
    await expect(
      controller.restorePersistenceSnapshot({
        version: 1,
        activeSessionId: "session-valid",
        conversations: [
          storedConversation(
            "session-valid",
            "2026-08-15T07:51:00.000Z",
            "检查设定冲突"
          ),
          { sessionId: "session-invalid", messages: "invalid" }
        ]
      })
    ).resolves.toBe(true);
    expect(controller.sessionId.value).toBe("session-valid");
    expect(controller.history.value).toHaveLength(1);
    controller.dispose();
  });

  it("does not persist while hydration is holding writes", () => {
    const snapshots: AgentConversationPersistenceSnapshot[] = [];
    const controller = useAgentConversation({
      api: () => undefined,
      onPersistenceSnapshot(snapshot) {
        snapshots.push(snapshot);
      }
    });

    controller.holdPersistenceEmits();
    controller.messages.value = [
      {
        id: "sent-first",
        role: "user",
        content: "已发送的消息",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    controller.draft.value = "水合完成前不应落盘";
    expect(snapshots).toEqual([]);
    controller.releasePersistenceEmits();
    controller.draft.value = "水合完成后可以落盘";
    expect(snapshots.at(-1)).toMatchObject({
      conversations: [{ draft: "水合完成后可以落盘" }]
    });
    controller.dispose();
  });

  it("rejects malformed snapshots without changing the active conversation", async () => {
    const controller = useAgentConversation({ api: () => undefined });
    const originalSessionId = controller.sessionId.value;

    await expect(
      controller.restorePersistenceSnapshot({
        version: 1,
        activeSessionId: "session-invalid",
        conversations: [{ sessionId: "session-invalid", messages: "invalid" }]
      })
    ).resolves.toBe(false);
    expect(controller.sessionId.value).toBe(originalSessionId);
    expect(controller.messages.value).toEqual([]);
    controller.dispose();
  });

  it("emits structured snapshots on changes but does not write during dispose", () => {
    const snapshots: AgentConversationPersistenceSnapshot[] = [];
    const controller = useAgentConversation({
      api: () => undefined,
      onPersistenceSnapshot(snapshot) {
        snapshots.push(snapshot);
      }
    });

    controller.messages.value = [
      {
        id: "sent-first",
        role: "user",
        content: "已发送的消息",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    controller.draft.value = "需要持久化的草稿";
    expect(snapshots.at(-1)).toMatchObject({
      version: 1,
      activeSessionId: controller.sessionId.value,
      conversations: [{ draft: "需要持久化的草稿" }]
    });
    const writesBeforeDispose = snapshots.length;

    controller.dispose();
    expect(snapshots).toHaveLength(writesBeforeDispose);
  });

  it("can emit a cheap dirty signal and defer structured snapshot capture", () => {
    const changes: string[] = [];
    const eagerSnapshots: AgentConversationPersistenceSnapshot[] = [];
    const controller = useAgentConversation({
      api: () => undefined,
      onPersistenceChange() {
        changes.push("changed");
      },
      onPersistenceSnapshot(snapshot) {
        eagerSnapshots.push(snapshot);
      }
    });

    controller.draft.value = "输入热路径不复制整份历史";
    expect(changes).toEqual(["changed"]);
    expect(eagerSnapshots).toEqual([]);
    expect(controller.capturePersistenceSnapshot()).toMatchObject({
      conversations: []
    });
    controller.dispose();
  });

  it("persists the approval mode with its conversation", () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-approval-mode-test";
    const controller = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(controller.approvalMode.value).toBe("request-approval");
    controller.messages.value = [
      {
        id: "sent-first",
        role: "user",
        content: "已发送的消息",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    controller.draft.value = "保留这份对话草稿";
    controller.selectApprovalMode("auto-approve");
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(restored.approvalMode.value).toBe("auto-approve");
    restored.dispose();
  });

  it("stores and restores the evaluation snapshot on its assistant run", async () => {
    const storage = createMemoryStorage();
    const persistenceKey = "conversation-evaluation-snapshot-test";
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      ...storage.options(persistenceKey),
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "评估这一轮";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    const runId = "run_evaluation_snapshot";

    controller.handleEvent(
      createEnvelope(
        "agent.evaluation_snapshot",
        {
          sessionId,
          runId,
          messageId: `${runId}_assistant`,
          runtime,
          snapshot: {
            schemaVersion: 1 as const,
            capturedAt: "2026-08-13T00:00:00.000Z",
            systemPrompt: "最终系统提示词",
            runtimeContext: {
              kind: "initial-session-context" as const,
              text: "运行时上下文与用户消息"
            },
            tools: [
              {
                name: "read_fixture",
                label: "读取夹具",
                description: "读取评估夹具。",
                inputSchema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"]
                }
              }
            ]
          }
        },
        {
          id: "event_evaluation_snapshot",
          context: { sessionId, runId }
        }
      )
    );
    deferred.resolveAccepted(0, {
      sessionId,
      runId,
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    controller.dispose();

    const restored = useAgentConversation({
      api: () => undefined,
      ...storage.options(persistenceKey)
    });
    expect(
      restored.messages.value.find((message) => message.runId === runId)
    ).toMatchObject({
      evaluationSnapshot: {
        systemPrompt: "最终系统提示词",
        runtimeContext: { text: "运行时上下文与用户消息" },
        tools: [
          {
            name: "read_fixture",
            inputSchema: { type: "object" }
          }
        ]
      }
    });
    restored.dispose({ clearPersistence: true });
  });
});
