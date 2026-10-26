import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";
import ConversationMessageItem from "../components/ConversationMessageItem.vue";
import {
  processingDisplayItems,
  workGroupActivityLabel
} from "../components/conversationToolPresentation";

describe("conversation tool activity during delegation", () => {
  it("keeps a streamed parent read waiting while child tools execute, then settles the read independently", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.draft.value = "先设计导语，再继续正文";
    const sessionId = controller.sessionId.value;
    const runId = "run-tool-activity";
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId,
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
    const base = { sessionId, runId, runtime };
    const child = {
      ...base,
      parentToolCallId: "spawn",
      subagentRunId: "child",
      subagentId: "intro-writer",
      name: "导语专家"
    };
    const task = "读取设定，设计导语";
    const spawnArgs = { subagent_id: child.subagentId, task };
    const readArgs = { id: "draft", kind: "draft_directory" };
    const message = () => controller.messages.value.at(-1)!;
    const group = () => {
      const item = processingDisplayItems(message()).find(
        (item) => item.type === "work-group"
      );
      if (item?.type !== "work-group") throw new Error("Missing parent work");
      return item;
    };
    const render = () =>
      renderToString(
        createSSRApp({
          render: () => h(ConversationMessageItem, { message: message() })
        })
      );

    try {
      // The whole parent turn streams before sequential tool execution starts.
      for (const [toolCallId, toolName, args] of [
        ["spawn", "spawn_subagent", spawnArgs],
        ["parent-read", "read", readArgs]
      ] as const) {
        controller.handleEvent(
          createEnvelope(
            "tool.call_stream",
            {
              ...base,
              streamId: `stream:${toolCallId}`,
              toolCallId,
              toolName,
              args,
              argumentsDelta: "",
              phase: "end" as const
            },
            eventOptions(sessionId, runId, `stream:${toolCallId}`)
          )
        );
      }
      controller.handleEvent(
        createEnvelope(
          "tool.call_requested",
          {
            ...base,
            toolCallId: "spawn",
            toolName: "spawn_subagent",
            args: spawnArgs
          },
          eventOptions(sessionId, runId, "spawn-requested")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "subagent.started",
          { ...child, task },
          eventOptions(sessionId, runId, "child-started")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "subagent.activity",
          {
            ...child,
            activity: {
              type: "tool_requested" as const,
              toolCallId: "child:read",
              toolName: "read",
              args: { id: "plot", kind: "plot_stage" }
            }
          },
          eventOptions(sessionId, runId, "child-read")
        )
      );

      expect(message().toolCalls?.map((tool) => tool.id)).toEqual([
        "spawn",
        "parent-read"
      ]);
      expect(message().subagentRuns?.[0]?.toolCalls).toMatchObject([
        { id: "child:read", status: "running" }
      ]);
      expect(workGroupActivityLabel(group())).toBe("等待执行");
      const waitingHtml = await render();
      expect(waitingHtml).toContain("子智能体执行中");
      expect(waitingHtml).toContain("等待执行");
      expect(waitingHtml).not.toContain("读取文件");

      controller.handleEvent(
        createEnvelope(
          "subagent.activity",
          {
            ...child,
            activity: {
              type: "tool_completed" as const,
              toolCallId: "child:read",
              toolName: "read",
              resultSummary: "已读取剧情设定",
              isError: false
            }
          },
          eventOptions(sessionId, runId, "child-read-completed")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "subagent.completed",
          { ...child, status: "completed" as const, summary: "导语设计完成" },
          eventOptions(sessionId, runId, "child-completed")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "tool.execution_completed",
          {
            ...base,
            toolCallId: "spawn",
            toolName: "spawn_subagent",
            resultSummary: "导语设计完成",
            isError: false
          },
          eventOptions(sessionId, runId, "spawn-completed")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "tool.call_requested",
          {
            ...base,
            toolCallId: "parent-read",
            toolName: "read",
            args: readArgs
          },
          eventOptions(sessionId, runId, "read-requested")
        )
      );
      expect(group().running).toBe(true);
      expect(workGroupActivityLabel(group())).toBe("读取文件");
      expect(await render()).toContain("读取文件");

      controller.handleEvent(
        createEnvelope(
          "tool.execution_completed",
          {
            ...base,
            toolCallId: "parent-read",
            toolName: "read",
            resultSummary: "已读取正文目录",
            isError: false
          },
          eventOptions(sessionId, runId, "read-completed")
        )
      );
      expect(message().status).toBe("streaming");
      expect(group().running).toBe(false);
      expect(workGroupActivityLabel(group())).toBe("处理完成");
      const finishedHtml = await render();
      expect(finishedHtml).not.toContain("is-processing-shimmer");
      expect(finishedHtml).not.toContain("读取文件");
    } finally {
      controller.dispose();
    }
  });
});
