import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Context,
  type Model,
  type UserMessage
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { WRITE_APPROVAL_QUESTION_ID } from "@deepwrite/contracts";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import type { AgentUserInputRequest } from "./runtime-types";
import { WRITE_APPROVAL_RESULTS_HEADING } from "./write-approval";

const write: AgentTool = {
  name: "write",
  label: "写入",
  description: "测试写入工具。",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: "text", text: "已形成修改，等待用户审阅。" }],
    details: {
      kind: "workspace-editor-mutation",
      workspaceId: "book",
      stageId: "character_design",
      text: "林岚，二十七岁。",
      baseRevision: "revision",
      summary: "补充人物年龄"
    }
  })
};

function userTexts(context: Context): string[] {
  return context.messages.flatMap((message) => {
    const user = message as UserMessage;
    return user.role === "user" && typeof user.content === "string"
      ? [user.content]
      : [];
  });
}

function harness(pausesForWriteApproval: boolean) {
  const seen: string[][] = [];
  const faux = fauxProvider({
    api: `child-approval-${Math.random()}`,
    provider: `child-approval-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "child-model", name: "Child", reasoning: true }]
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", {}), { stopReason: "toolUse" }),
    (context) => {
      seen.push(userTexts(context));
      return fauxAssistantMessage("人物年龄已补充。");
    }
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const requests: AgentUserInputRequest[] = [];
  const spawn = buildSpawnSubagentTool({
    parentSessionId: "child-approval-parent",
    model: faux.getModel("child-model") as Model<Api>,
    streamFn: models.streamSimple.bind(models) as StreamFn,
    thinkingLevel: "off",
    definitions: [
      {
        id: "writer",
        name: "writer",
        description: "完成指定子任务。",
        systemPrompt: "完成指定子任务。",
        enabled: true,
        modelMode: "inherit" as const
      }
    ],
    buildChildTools: () => [write],
    pausesForWriteApproval,
    requestUserInput: async (request) => {
      requests.push(request);
      return {
        sessionId: "child-approval-parent",
        runId: "run",
        requestId: "approval",
        answers: [{ id: WRITE_APPROVAL_QUESTION_ID, text: "settled" }],
        writeApproval: { items: [{ title: "人物设计", status: "rejected" }] }
      };
    },
    retryPolicy: { delaysMs: [], sleep: async () => {} }
  })!;
  return {
    run: () =>
      spawn.execute("spawn-writer", {
        subagent_id: "writer",
        task: "补充林岚的年龄。"
      } as never),
    requests,
    seen
  };
}

describe("subagent writes in user-review mode", () => {
  it("pause the child until the user settled its proposals", async () => {
    const child = harness(true);
    await child.run();
    expect(child.requests).toHaveLength(1);
    expect(child.requests[0]).toMatchObject({
      source: "write_approval",
      writeApproval: {
        toolCallIds: [expect.stringMatching(/^subrun_.+:tool:/)]
      }
    });
    const outcome = child.seen[0]!.find((text) =>
      text.startsWith(WRITE_APPROVAL_RESULTS_HEADING)
    );
    expect(outcome).toContain("用户已拒绝，未写入");
  });

  it("keep running in auto-save mode", async () => {
    const child = harness(false);
    await child.run();
    expect(child.requests).toHaveLength(0);
    expect(
      child.seen[0]!.some((text) =>
        text.startsWith(WRITE_APPROVAL_RESULTS_HEADING)
      )
    ).toBe(false);
  });
});
