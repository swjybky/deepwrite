import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";
import { SUBAGENT_SUMMARY_MAX_LENGTH } from "./subagent-helpers";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import type {
  SubagentToolDetails,
  SubagentToolProgress
} from "./subagent-types";

type Responses = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];
const fragment = "已经生成的正文片段，结尾还没写完。";
const rawError = "Provider stopped with: PROHIBITED_CONTENT";

function makeSpawn(model: Model<Api>, streamFn: StreamFn) {
  let executions = 0;
  const progress: SubagentToolProgress[] = [];
  const submit: AgentTool = {
    name: "submit_section",
    label: "提交正文",
    description: "测试提交工具。",
    parameters: Type.Object({ content: Type.String() }),
    execute: async () => {
      executions++;
      return {
        content: [{ type: "text", text: "修改提案已交出，等待用户审阅。" }],
        details: { kind: "fixture-proposal" }
      };
    }
  };
  const spawn = buildSpawnSubagentTool({
    parentSessionId: "blocked-child-parent",
    model,
    streamFn,
    thinkingLevel: "off",
    definitions: ["writer", "dependent", "independent"].map((id) => ({
      id,
      name: id,
      description: "完成指定子任务。",
      systemPrompt: "完成指定子任务。",
      enabled: true,
      modelMode: "inherit" as const
    })),
    buildChildTools: () => [submit],
    retryPolicy: { delaysMs: [0, 0], sleep: async () => {} }
  })!;
  const run = async (args = { subagent_id: "writer", task: "完成正文。" }) => {
    const result = await spawn.execute(
      "spawn-blocked-child",
      args as never,
      undefined,
      (update) => {
        const details = update.details as SubagentToolDetails;
        if (details.kind === "subagent-progress")
          progress.push(details.progress);
      }
    );
    return result.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
  };
  return { run, spawn, progress, executions: () => executions };
}

function harness(responses: Responses) {
  const faux = fauxProvider({
    api: `content-block-${Math.random()}`,
    provider: `content-block-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "child-model", name: "Child", reasoning: true }]
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    ...makeSpawn(
      faux.getModel("child-model") as Model<Api>,
      models.streamSimple.bind(models) as StreamFn
    ),
    calls: () => faux.state.callCount
  };
}

function blocked(text = fragment, errorMessage = rawError) {
  return fauxAssistantMessage(text, { stopReason: "error", errorMessage });
}

afterEach(() => vi.unstubAllGlobals());

describe("subagent handoffs after a content block", () => {
  it("returns partial text and prior tool receipts without retrying or executing blocked calls", async () => {
    const child = harness([
      fauxAssistantMessage(
        fauxToolCall("submit_section", { content: "已经交出的第一节。" }),
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage(
        [
          fauxThinking("不应交给主智能体的内部思考。"),
          fauxText(fragment),
          fauxToolCall("submit_section", { content: "不可执行的尾部调用。" })
        ],
        { stopReason: "error", errorMessage: rawError }
      )
    ]);

    const result = await child.run();
    expect(result).toContain(rawError);
    expect(result).toContain(fragment);
    expect(result).toContain("正文片段（不完整）");
    expect(result).toContain("1 次工具调用成功返回：submit_section × 1");
    expect(result).toContain("以提案审阅与保存状态为准");
    expect(result).not.toContain("内部思考");
    expect(result).not.toContain("不可执行的尾部调用");
    expect(child.calls()).toBe(2);
    expect(child.executions()).toBe(1);
    // The UI already received the partial text as activity; its terminal
    // summary stays the original failure, rather than duplicating that text.
    expect(child.progress.at(-1)).toMatchObject({
      type: "completed",
      status: "error",
      summary: `子智能体执行失败：${rawError}`,
      errorMessage: rawError
    });
    expect(
      child.progress.some(
        (item) =>
          item.type === "activity" && item.activity.type === "retry_scheduled"
      )
    ).toBe(false);
    expect(
      child.progress.filter((item) => item.type === "usage_observed")
    ).toMatchObject([{ status: "completed" }, { status: "error" }]);
  });

  it("keeps successful tool receipts when the blocked postamble has no text", async () => {
    const child = harness([
      fauxAssistantMessage(
        fauxToolCall("submit_section", { content: "正文" }),
        {
          stopReason: "toolUse"
        }
      ),
      blocked("")
    ]);
    const result = await child.run();
    expect(result).toContain("submit_section × 1");
    expect(result).not.toContain("正文片段（不完整）");
    expect(child.calls()).toBe(2);
    expect(child.executions()).toBe(1);
  });

  it("bounds the failed handoff while keeping the reason and incomplete marker", async () => {
    const child = harness([blocked(fragment.repeat(2_000))]);
    const result = await child.run();
    expect(result.length).toBeLessThanOrEqual(SUBAGENT_SUMMARY_MAX_LENGTH);
    expect(result).toContain(rawError);
    expect(result).toContain("正文片段（不完整）");
    expect(result).toContain(fragment);
    expect(result).toContain("已截断");
  });

  it("does not report a stale fragment from a retried request", async () => {
    const child = harness([
      blocked("网络失败的旧片段。", "fetch failed: connection reset"),
      blocked("")
    ]);
    expect(await child.run()).toBe(`子智能体执行失败：${rawError}`);
    expect(child.calls()).toBe(2);
  });

  it.each(["invalid_request_error", "Request was aborted"])(
    "keeps the existing failure outcome for %s",
    async (errorMessage) => {
      const child = harness([blocked(fragment, errorMessage)]);
      expect(await child.run()).toBe(`子智能体执行失败：${errorMessage}`);
    }
  );

  it("skips dependents of an incomplete child and still runs independent tasks", async () => {
    const child = harness([blocked(), fauxAssistantMessage("独立任务完成。")]);
    const result = await child.spawn.execute("spawn-batch", {
      tasks: [
        { key: "writing", subagent_id: "writer", task: "完成正文。" },
        {
          key: "review",
          subagent_id: "dependent",
          task: "审核完整正文。",
          depends_on: ["writing"]
        },
        { key: "other", subagent_id: "independent", task: "独立任务。" }
      ]
    } as never);
    const text = JSON.stringify(result.content);
    expect(text).toContain(fragment);
    expect(text).toContain("完成 1 个，失败 1 个，中止 0 个，跳过 1 个");
    expect(text).toContain("独立任务完成。");
    expect(child.calls()).toBe(2);
  });

  it.each(["google-generative-ai", "openai-completions"] as const)(
    "preserves fragments from the real %s parser and does not execute a blocked tool",
    async (api) => {
      const config: AgentProviderRuntimeConfig = {
        id: "content-block-transport",
        label: "Gemini fixture",
        provider: "custom",
        modelId: "gemini-3.8-flash",
        api,
        baseUrl: "https://gateway.example.test/v1beta",
        apiKey: "invalid-content-block-test-key",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["off"],
        temperatureOptions: [0.1, 0.7, 1]
      };
      const chunk =
        api === "google-generative-ai"
          ? {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      { text: fragment },
                      {
                        functionCall: {
                          name: "submit_section",
                          args: { content: "不可执行的尾部调用。" }
                        }
                      }
                    ]
                  },
                  finishReason: "PROHIBITED_CONTENT"
                }
              ]
            }
          : {
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: fragment,
                    tool_calls: [
                      {
                        index: 0,
                        id: "blocked-tool",
                        type: "function",
                        function: {
                          name: "submit_section",
                          arguments: JSON.stringify({
                            content: "不可执行的尾部调用。"
                          })
                        }
                      }
                    ]
                  },
                  finish_reason: "content_filter"
                }
              ]
            };
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(
            `data: ${JSON.stringify(chunk)}\n\n${api === "openai-completions" ? "data: [DONE]\n\n" : ""}`,
            { headers: { "content-type": "text/event-stream" } }
          )
      );
      vi.stubGlobal("fetch", fetcher);
      const { model, streamFn } = buildProviderRuntime(config);
      const child = makeSpawn(model, streamFn);
      const result = await child.run();
      expect(result).toContain(fragment);
      expect(result).toContain("正文片段（不完整）");
      expect(child.executions()).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(child.progress.at(-1)).toMatchObject({
        type: "completed",
        status: "error"
      });
    }
  );
});
