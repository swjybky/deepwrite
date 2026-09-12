import type { AgentRuntimeEvent } from "./index.test-support";
import {
  PiAgentRuntimeAdapter,
  Type,
  buildAgentEvaluationSnapshot,
  describe,
  evaluationConversationHistory,
  expect,
  it,
  screenplayWorkspace,
  scriptAgentProfile,
  toolCallMessage
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: evaluation snapshots", () => {
  it("captures exact prompt, injected context, and tool schemas only in evaluation mode", async () => {
    const runtime = new PiAgentRuntimeAdapter({
      evaluationMode: true,
      tokensPerSecond: 0
    });
    const events: AgentRuntimeEvent[] = [];
    const workspace = screenplayWorkspace();

    for await (const event of runtime.start({
      runId: "run_evaluation_capture",
      sessionId: "session_evaluation_capture",
      prompt: "检查第一集并继续写作",
      thinkingLevel: "off",
      scriptAgentProfile: scriptAgentProfile(),
      workspaceContext: { scriptWorkspace: workspace }
    })) {
      events.push(event);
    }

    const captured = events.find(
      (
        event
      ): event is Extract<
        AgentRuntimeEvent,
        { type: "agent.evaluation_snapshot" }
      > => event.type === "agent.evaluation_snapshot"
    );
    expect(captured?.payload.snapshot).toMatchObject({
      schemaVersion: 1,
      runtimeContext: { kind: "initial-session-context" }
    });
    expect(captured?.payload.snapshot.systemPrompt).toContain(
      "用户在设置中编辑的剧本正文专家提示词"
    );
    expect(captured?.payload.snapshot.runtimeContext.text).toContain(
      "检查第一集并继续写作"
    );
    expect(captured?.payload.snapshot.runtimeContext.text).toContain(
      "剧本作品: 《雾港剧本》"
    );
    const snapshots = events.filter(
      (
        event
      ): event is Extract<
        AgentRuntimeEvent,
        { type: "agent.evaluation_snapshot" }
      > => event.type === "agent.evaluation_snapshot"
    );
    expect(
      snapshots
        .at(-1)
        ?.payload.snapshot.conversationHistory?.some(
          (message) =>
            message.role === "user" &&
            message.text.includes("检查第一集并继续写作")
        )
    ).toBe(true);
    expect(
      captured?.payload.snapshot.tools.find((tool) => tool.name === "edit")
    ).toMatchObject({
      label: expect.any(String),
      description: expect.any(String),
      inputSchema: { type: "object" }
    });
  });

  it("serializes evaluation tool schemas without executable TypeBox metadata", () => {
    const parameters = Type.Object({ query: Type.String({ minLength: 1 }) });
    const snapshot = buildAgentEvaluationSnapshot(
      "system",
      "runtime context",
      false,
      [
        {
          name: "search_fixture",
          label: "搜索夹具",
          description: "Searches a test fixture.",
          parameters,
          executionMode: "sequential"
        }
      ],
      "2026-08-13T00:00:00.000Z"
    );

    expect(snapshot).toEqual({
      schemaVersion: 1,
      capturedAt: "2026-08-13T00:00:00.000Z",
      systemPrompt: "system",
      runtimeContext: { kind: "turn-context", text: "runtime context" },
      tools: [
        {
          name: "search_fixture",
          label: "搜索夹具",
          description: "Searches a test fixture.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 1 }
            },
            required: ["query"]
          },
          executionMode: "sequential"
        }
      ]
    });
  });

  it("compacts model-visible conversation history for evaluation snapshots", () => {
    expect(
      evaluationConversationHistory([
        { role: "user", content: "继续写第二章", timestamp: 1 },
        toolCallMessage("tool_read", "read_workspace_content"),
        {
          role: "toolResult",
          toolCallId: "tool_read",
          toolName: "read_workspace_content",
          content: [{ type: "text", text: "已读取第二章正文。" }],
          isError: false,
          timestamp: 3
        }
      ])
    ).toEqual([
      { role: "user", text: "继续写第二章" },
      {
        role: "assistant",
        text: "",
        toolName: "read_workspace_content",
        toolCallId: "tool_read"
      },
      {
        role: "tool",
        text: "已读取第二章正文。",
        toolName: "read_workspace_content",
        toolCallId: "tool_read"
      }
    ]);
  });
});
