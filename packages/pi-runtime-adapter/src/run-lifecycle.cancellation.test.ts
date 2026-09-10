import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type Model
} from "@earendil-works/pi-ai";
import { RunLifecycle } from "./run-lifecycle";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import type { SubagentToolProgress } from "./subagent-types";

const model: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test",
  provider: "custom",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 16000,
  maxTokens: 2000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
const runtime = {
  provider: "custom",
  model: "test-model",
  mode: "provider" as const
};

afterEach(() => vi.useRealTimers());

describe("parent cancellation reaches the actual child", () => {
  it.each(["stop", "failure", "dispose"] as const)(
    "aborts child model transport on parent %s without relying on the SDK tool signal",
    async (kind) => {
      const lifecycle = new RunLifecycle();
      const controller = new AbortController();
      const aborted = vi.fn();
      lifecycle.bindAbort(controller.signal, aborted);
      let childSignal: AbortSignal | undefined;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const progress: SubagentToolProgress[] = [];
      const tool = buildSpawnSubagentTool({
        parentSessionId: "session-cancel",
        parentSignal: lifecycle.signal,
        parentRuntime: runtime,
        model,
        thinkingLevel: "off",
        streamFn: (_model, _context, options) => {
          childSignal = options?.signal;
          started();
          return createAssistantMessageEventStream();
        },
        definitions: [
          {
            id: "writer",
            name: "写手",
            description: "写作",
            systemPrompt: "编写内容",
            enabled: true,
            modelMode: "inherit"
          }
        ],
        buildChildTools: () => [],
        createRunId: () => "child-cancel"
      })!;
      const execution = tool.execute(
        "spawn-cancel",
        { subagent_id: "writer", task: "生成规则" },
        undefined,
        (update) => {
          const details = update.details as { progress: SubagentToolProgress };
          progress.push(details.progress);
        }
      );
      await ready;
      if (kind === "stop") controller.abort();
      else if (kind === "dispose") lifecycle.dispose();
      else
        lifecycle.observe({
          type: "agent.error",
          runId: "parent",
          sessionId: "session-cancel",
          payload: { code: "test.failed", message: "模拟父任务失败", runtime }
        });
      expect(childSignal?.aborted).toBe(true);
      await execution;
      expect(progress.at(-1)).toMatchObject({
        type: "completed",
        status: "aborted"
      });
      lifecycle.dispose();
    }
  );

  it("stops initialization while a child context query is unresponsive", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const streamFn = vi.fn();
    const tool = buildSpawnSubagentTool({
      parentSessionId: "session-prepare",
      parentSignal: controller.signal,
      model,
      thinkingLevel: "off",
      streamFn,
      definitions: [
        {
          id: "manager",
          name: "管理员",
          description: "管理",
          systemPrompt: "整理",
          enabled: true,
          modelMode: "inherit",
          toolSource: "library-management"
        }
      ],
      prepareChild: () => {
        started();
        return new Promise(() => {});
      },
      buildChildTools: () => []
    })!;
    const execution = tool.execute("spawn-prepare", {
      subagent_id: "manager",
      task: "整理资料"
    });
    await ready;
    controller.abort();
    await expect(execution).resolves.toMatchObject({
      details: { kind: "subagent-result" }
    });
    expect(streamFn).not.toHaveBeenCalled();
  });
});
