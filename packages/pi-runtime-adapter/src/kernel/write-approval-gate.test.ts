import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
  type UserMessage
} from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { WRITE_APPROVAL_QUESTION_ID } from "@deepwrite/contracts";
import { AgentUserInputBroker } from "../user-input-broker";
import type { AgentRuntimeEvent } from "../runtime-types";
import { WRITE_APPROVAL_RESULTS_HEADING } from "../write-approval";
import { ConversationAgentCache } from "./run-agent";
import { AgentRunKernel } from "./run-kernel";

const runtime = {
  mode: "local-faux" as const,
  provider: "example",
  model: "fixture"
};

const writeTool: AgentTool = {
  name: "write",
  label: "Write",
  description: "Forms a fixture proposal.",
  parameters: Type.Object({}),
  async execute() {
    return {
      content: [{ type: "text", text: "已形成修改，等待用户审阅。" }],
      details: {
        kind: "workspace-editor-mutation",
        workspaceId: "book",
        stageId: "character_design",
        text: "林岚，二十七岁。",
        baseRevision: "revision",
        summary: "补充人物年龄"
      }
    };
  }
};

const readTool: AgentTool = {
  name: "read",
  label: "Read",
  description: "Reads without writing.",
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: "text", text: "内容" }], details: {} };
  }
};

function userTexts(context: { messages: readonly unknown[] }): string[] {
  return context.messages.flatMap((message) => {
    const user = message as UserMessage;
    return user.role === "user" && typeof user.content === "string"
      ? [user.content]
      : [];
  });
}

async function run(options: {
  pauses: boolean;
  tool: AgentTool;
  responses: FauxResponseStep[];
  answer?: (
    event: Extract<AgentRuntimeEvent, { type: "agent.user_input_requested" }>,
    broker: AgentUserInputBroker
  ) => void;
}): Promise<AgentRuntimeEvent[]> {
  const broker = new AgentUserInputBroker();
  const kernel = new AgentRunKernel({
    agents: new ConversationAgentCache(new Map(), {}),
    userInputBroker: broker,
    idleTimeoutMs: 0,
    tokensPerSecond: 0,
    evaluationMode: false,
    retryPolicy: { delaysMs: [] },
    describe: () => runtime
  });
  const events: AgentRuntimeEvent[] = [];
  for await (const event of kernel.run({
    target: {
      runId: "run",
      sessionId: "session",
      signal: new AbortController().signal
    },
    eventSource: { runId: "run", sessionId: "session" },
    portableToolSchemaProfile: "default",
    pausesForWriteApproval: options.pauses,
    build: () => ({ systemPrompt: "Run the fixture.", tools: [options.tool] }),
    userMessageContent: () => "补充林岚的年龄。",
    fauxResponses: () => options.responses
  })) {
    events.push(event);
    if (event.type === "agent.user_input_requested")
      options.answer?.(event, broker);
  }
  return events;
}

describe("write approval gate", () => {
  it("holds the next model request until the user settled the step", async () => {
    const order: string[] = [];
    const seen: string[][] = [];
    const events = await run({
      pauses: true,
      tool: writeTool,
      responses: [
        fauxAssistantMessage(fauxToolCall("write", {}), {
          stopReason: "toolUse"
        }),
        (context) => {
          order.push("model");
          seen.push(userTexts(context));
          return fauxAssistantMessage("已按你的版本继续。");
        }
      ],
      answer: (event, broker) => {
        order.push("answered");
        queueMicrotask(() =>
          broker.resolve({
            sessionId: "session",
            runId: "run",
            requestId: event.payload.requestId,
            answers: [{ id: WRITE_APPROVAL_QUESTION_ID, text: "settled" }],
            writeApproval: {
              items: [
                {
                  title: "人物设计",
                  status: "saved",
                  edited: true,
                  editedText: "林岚，二十八岁。"
                }
              ]
            }
          })
        );
      }
    });

    const request = events.find(
      (event) => event.type === "agent.user_input_requested"
    );
    expect(request?.payload).toMatchObject({
      source: "write_approval",
      writeApproval: { toolCallIds: [expect.any(String)] }
    });
    const proposalIndex = events.findIndex(
      (event) => event.type === "workspace.editor_mutation"
    );
    expect(proposalIndex).toBeGreaterThan(-1);
    expect(events.indexOf(request!)).toBeGreaterThan(proposalIndex);
    expect(request?.payload).toMatchObject({
      writeApproval: {
        toolCallIds: [
          (events[proposalIndex] as { payload: { toolCallId: string } }).payload
            .toolCallId
        ]
      }
    });
    expect(order).toEqual(["answered", "model"]);
    const outcome = seen[0]!.find((text) =>
      text.startsWith(WRITE_APPROVAL_RESULTS_HEADING)
    );
    expect(outcome).toContain("用户修改后保存");
    expect(outcome).toContain("林岚，二十八岁。");
    expect(events.at(-1)?.type).toBe("agent.completed");
  });

  it("does not pause in auto-save mode or after steps without proposals", async () => {
    for (const options of [
      { pauses: false, tool: writeTool },
      { pauses: true, tool: readTool }
    ]) {
      const events = await run({
        ...options,
        responses: [
          fauxAssistantMessage(fauxToolCall(options.tool.name, {}), {
            stopReason: "toolUse"
          }),
          fauxAssistantMessage("完成。")
        ]
      });
      expect(
        events.some((event) => event.type === "agent.user_input_requested")
      ).toBe(false);
      expect(events.at(-1)?.type).toBe("agent.completed");
    }
  });
});
