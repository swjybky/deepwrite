import type { PromptLocale } from "@deepwrite/contracts";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
  isPrematureReadinessReply,
  sanitizeSubagentContextMessages
} from "./subagent-reply-guard";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { inspectTranscript } from "./transcript.test-support";

type Responses = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];

async function runChild(
  responses: Responses,
  options: { locale?: PromptLocale } = {}
) {
  const faux = fauxProvider({
    api: `reply-guard-${Math.random()}`,
    provider: `reply-guard-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "child-model", name: "Child", reasoning: true }]
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const requests: string[] = [];
  const contexts: Context[] = [];
  const streamFn: StreamFn = (model, context, streamOptions) => {
    const inspected = inspectTranscript(context);
    contexts.push(inspected);
    requests.push(JSON.stringify(inspected.messages));
    return models.streamSimple(model, context, streamOptions);
  };
  let saved = 0;
  const submit: AgentTool = {
    name: "submit_items",
    label: "提交",
    description: "测试提交工具。",
    parameters: Type.Object({ items: Type.Array(Type.String()) }),
    execute: async () => {
      saved += 1;
      return { content: [{ type: "text", text: "已保存" }], details: {} };
    }
  };
  const spawn = buildSpawnSubagentTool({
    ...(options.locale ? { promptLocale: options.locale } : {}),
    parentSessionId: "parent-session",
    model: faux.getModel("child-model") as Model<Api>,
    thinkingLevel: "high",
    streamFn,
    definitions: [
      {
        id: "registrar",
        name: "名册员",
        description: "整理名册。",
        systemPrompt: "整理名册。",
        enabled: true,
        modelMode: "inherit"
      }
    ],
    buildChildTools: () => [submit]
  });
  if (!spawn) throw new Error("spawn_subagent was not built");
  const result = await spawn.execute("parent-call", {
    subagent_id: "registrar",
    task: "提交名册"
  } as never);
  const text = result.content.find((item) => item.type === "text");
  return {
    text: text?.type === "text" ? text.text : "",
    requests,
    contexts,
    calls: () => faux.state.callCount,
    saved: () => saved
  };
}

const cut = (content: Parameters<typeof fauxAssistantMessage>[0]) =>
  fauxAssistantMessage(content, { stopReason: "length" });

describe("subagent replies that end without a result", () => {
  it("asks for smaller batches after a reply cut off while reasoning", async () => {
    const child = await runChild([
      cut(fauxThinking("逐条推敲一千个名字……")),
      fauxAssistantMessage(fauxToolCall("submit_items", { items: ["c1"] }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage(fauxText("名册已分批提交。"))
    ]);
    expect(child.text).toBe("名册已分批提交。");
    expect(child.saved()).toBe(1);
    expect(child.requests[1]).toContain("超过了模型单次输出上限");
  });

  it("never runs a tool call cut off at the limit and asks again", async () => {
    const child = await runChild([
      cut(fauxToolCall("submit_items", { items: ["c1"] })),
      fauxAssistantMessage(fauxToolCall("submit_items", { items: ["c1"] }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage(fauxText("已提交。"))
    ]);
    expect(child.text).toBe("已提交。");
    expect(child.saved()).toBe(1);
    expect(child.requests[1]).toContain("把提交拆成更小的批次");
  });

  it("fails with the cut-off reason once the continuations are spent", async () => {
    const child = await runChild([
      cut(fauxThinking("第一次")),
      cut(fauxThinking("第二次")),
      cut(fauxThinking("第三次"))
    ]);
    expect(child.text).toContain("连续 3 次超过模型单次输出上限被截断");
    expect(child.text).not.toContain("没有生成可交接的摘要");
  });

  it("nudges an empty reply once before giving up on a handoff", async () => {
    const child = await runChild([
      fauxAssistantMessage(fauxThinking("想完了但没写。")),
      fauxAssistantMessage(fauxText("没有需要提交的名字。"))
    ]);
    expect(child.text).toBe("没有需要提交的名字。");
    expect(child.requests[1]).toContain("上一条回复是空的");
    // The thinking-only assistant turn is stripped and adjacent user turns are merged.
    const secondMessages = child.contexts[1]!.messages;
    expect(secondMessages.map((m) => m.role)).toEqual(["user"]);
  });

  it.each(["任务就绪", "【已准备就绪，请下达任务。】", "Task ready."])(
    "nudges premature readiness acknowledgement (%s) once and finishes the task",
    async (reply) => {
      const english = reply === "Task ready.";
      const child = await runChild(
        [
          fauxAssistantMessage(fauxText(reply)),
          fauxAssistantMessage(
            fauxToolCall("submit_items", { items: ["c1"] }),
            {
              stopReason: "toolUse"
            }
          ),
          fauxAssistantMessage(fauxText("已提交完成。"))
        ],
        english ? { locale: "en-US" } : {}
      );
      expect(child.saved()).toBe(1);
      expect(child.text).toBe("已提交完成。");
      expect(child.calls()).toBe(3);
      expect(child.requests[1]).toContain(
        english
          ? "only acknowledged readiness"
          : "上一条回复只是确认就绪，还没有执行任务"
      );
    }
  );

  it("nudges premature readiness at most once and does not loop after tool calls", async () => {
    const repeated = await runChild([
      fauxAssistantMessage(fauxText("任务就绪")),
      fauxAssistantMessage(fauxText("收到，请下达任务"))
    ]);
    expect(repeated.calls()).toBe(2);
    expect(repeated.text).toBe("收到，请下达任务");

    const afterTool = await runChild([
      fauxAssistantMessage(fauxToolCall("submit_items", { items: ["c1"] }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage(fauxText("收到。"))
    ]);
    expect(afterTool.calls()).toBe(2);
    expect(afterTool.saved()).toBe(1);
    expect(afterTool.text).toBe("收到。");
  });

  it.each([
    "完成",
    "已完成",
    "第三章完成",
    "草稿1",
    "已提交。",
    "已保存",
    "done",
    "child done",
    "ok",
    "唯一成功",
    "我觉得第二份更好。",
    "收到，经核查第一章无矛盾。"
  ])(
    "does not treat valid short handoff %s as premature readiness",
    async (reply) => {
      expect(isPrematureReadinessReply(reply)).toBe(false);
      const child = await runChild([fauxAssistantMessage(fauxText(reply))]);
      expect(child.calls()).toBe(1);
      expect(child.text).toBe(reply);
    }
  );

  it("recovers after two consecutive thinking-only turns and resets the budget after tool use", async () => {
    const twoEmpties = await runChild([
      fauxAssistantMessage(fauxThinking("先想一下。")),
      fauxAssistantMessage(fauxThinking("再想一下。")),
      fauxAssistantMessage(fauxText("思考结束，这是交接结果。"))
    ]);
    expect(twoEmpties.text).toBe("思考结束，这是交接结果。");
    expect(twoEmpties.calls()).toBe(3);
    expect(twoEmpties.requests[2]).toContain("上一条回复仍然是空的");
    expect(twoEmpties.contexts[2]!.messages.map((m) => m.role)).toEqual([
      "user"
    ]);

    const acrossTools = await runChild([
      fauxAssistantMessage(fauxThinking("工具前只思考。")),
      fauxAssistantMessage(fauxToolCall("submit_items", { items: ["c1"] }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage(fauxThinking("工具后又只思考 1。")),
      fauxAssistantMessage(fauxThinking("工具后又只思考 2。")),
      fauxAssistantMessage(fauxText("工具后恢复并交接完成。"))
    ]);
    expect(acrossTools.saved()).toBe(1);
    expect(acrossTools.calls()).toBe(5);
    expect(acrossTools.text).toBe("工具后恢复并交接完成。");
    // Thinking-only turn after toolResult must be stripped without consecutive user messages.
    expect(acrossTools.contexts[4]!.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "user"
    ]);
  });

  it("fails with an explicit empty-reply error when consecutive thinking-only turns exceed the limit", async () => {
    const child = await runChild([
      fauxAssistantMessage(fauxThinking("第1次")),
      fauxAssistantMessage(fauxThinking("第2次")),
      fauxAssistantMessage(fauxThinking("第3次"))
    ]);
    expect(child.calls()).toBe(3);
    expect(child.text).toContain("子智能体连续返回空回复");
    expect(child.text).toContain("没有生成可交接的摘要");
  });

  it("strips thinking-only assistant turns and merges adjacent user turns without dropping images", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "第一段" },
          { type: "image" as const, data: "AQID", mimeType: "image/png" }
        ],
        timestamp: 1
      },
      fauxAssistantMessage(fauxThinking("仅思考")),
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "第二段" }],
        timestamp: 2
      }
    ];
    const sanitized = sanitizeSubagentContextMessages(messages);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "第一段" },
        { type: "image", data: "AQID", mimeType: "image/png" },
        { type: "text", text: "第二段" }
      ],
      timestamp: 2
    });
  });
});
