import {
  createShortWorkspaceContentRevision,
  describe,
  evaluationConversationHistory,
  expect,
  it,
  providerRuntime,
  toRuntimeEvents,
  toolCallMessage
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: subagent-event-projection", () => {
  it("omits blank tool names from evaluation conversation history", () => {
    expect(
      evaluationConversationHistory([
        toolCallMessage(" ", " "),
        {
          role: "toolResult",
          toolCallId: "   ",
          toolName: "",
          content: [{ type: "text", text: "工具已返回。" }],
          isError: false,
          timestamp: 2
        }
      ])
    ).toEqual([
      { role: "assistant", text: "" },
      { role: "tool", text: "工具已返回。" }
    ]);
  });

  it("maps a chapter deletion result into one reviewable workspace event", () => {
    const baseRevision = createShortWorkspaceContentRevision("draft-directory");
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "delete-chapter",
        toolName: "delete",
        isError: false,
        result: {
          content: [{ type: "text", text: "等待审阅" }],
          details: {
            kind: "workspace-expert-draft-section-deletion",
            workspaceId: "short-1",
            stageId: "draft",
            sectionId: "section-2",
            title: "第二节·暗房",
            baseRevision,
            summary:
              "已生成删除章节「第二节·暗房」及其正文与人物状态文件的变更，等待用户审阅。"
          }
        }
      } as never,
      {
        runId: "run-delete-chapter",
        sessionId: "session-delete-chapter",
        prompt: "删除"
      },
      providerRuntime,
      "assistant-delete-chapter"
    );

    expect(events.at(-1)).toEqual({
      type: "workspace.editor_mutation",
      runId: "run-delete-chapter",
      sessionId: "session-delete-chapter",
      payload: {
        toolCallId: "delete-chapter",
        workspaceId: "short-1",
        stageId: "draft",
        text: "删除：第二节·暗房",
        mutationTarget: {
          kind: "expert-draft-section-deletion",
          sectionId: "section-2",
          title: "第二节·暗房"
        },
        baseRevision,
        summary:
          "已生成删除章节「第二节·暗房」及其正文与人物状态文件的变更，等待用户审阅。",
        runtime: providerRuntime
      }
    });
  });

  it("maps a chapter rename result into one reviewable workspace event", () => {
    const baseRevision = createShortWorkspaceContentRevision("draft-directory");
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "rename-chapter",
        toolName: "rename_draft_section",
        isError: false,
        result: {
          content: [{ type: "text", text: "等待审阅" }],
          details: {
            kind: "workspace-expert-draft-section-rename",
            workspaceId: "short-1",
            stageId: "draft",
            sectionId: "section-2",
            previousTitle: "第二节·暗房",
            title: "第二节·底片",
            baseRevision,
            summary:
              "已生成将章节「第二节·暗房」改名为「第二节·底片」的变更，等待用户审阅。"
          }
        }
      } as never,
      {
        runId: "run-rename-chapter",
        sessionId: "session-rename-chapter",
        prompt: "改名"
      },
      providerRuntime,
      "assistant-rename-chapter"
    );

    expect(events.at(-1)).toEqual({
      type: "workspace.editor_mutation",
      runId: "run-rename-chapter",
      sessionId: "session-rename-chapter",
      payload: {
        toolCallId: "rename-chapter",
        workspaceId: "short-1",
        stageId: "draft",
        text: "第二节·暗房 → 第二节·底片",
        mutationTarget: {
          kind: "expert-draft-section-rename",
          sectionId: "section-2",
          previousTitle: "第二节·暗房",
          title: "第二节·底片"
        },
        baseRevision,
        summary:
          "已生成将章节「第二节·暗房」改名为「第二节·底片」的变更，等待用户审阅。",
        runtime: providerRuntime
      }
    });
  });

  it("maps subagent progress updates in started-activity-completed order", () => {
    const input = {
      runId: "parent-run-order",
      sessionId: "parent-session-order",
      prompt: "委派检查"
    };
    const progress = [
      {
        type: "started",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        task: "检查时间线"
      },
      {
        type: "activity",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        activity: { type: "message_delta", delta: "结论" }
      },
      {
        type: "completed",
        parentToolCallId: "spawn-order",
        subagentRunId: "subrun-order",
        subagentId: "reviewer",
        name: "审校",
        status: "completed",
        summary: "检查完成"
      }
    ];
    const events = progress.flatMap((item) =>
      toRuntimeEvents(
        {
          type: "tool_execution_update",
          toolCallId: "spawn-order",
          toolName: "spawn_subagent",
          args: {},
          partialResult: {
            content: [{ type: "text", text: "progress" }],
            details: { kind: "subagent-progress", progress: item }
          }
        } as never,
        input,
        providerRuntime,
        "parent-assistant-order"
      )
    );

    expect(events.map((event) => event.type)).toEqual([
      "subagent.started",
      "subagent.activity",
      "subagent.completed"
    ]);
    expect(
      events.every(
        (event) =>
          event.runId === input.runId && event.sessionId === input.sessionId
      )
    ).toBe(true);
  });
});
