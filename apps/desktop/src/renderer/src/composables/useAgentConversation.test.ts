import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type DeepWriteApi,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload
} from "@deepwrite/contracts";
import { useAgentConversation } from "./useAgentConversation";
import type { WorkspaceDocument } from "../types/workspace";

const document: WorkspaceDocument = {
  id: "chapter_3",
  domain: "creation",
  title: "第三章 雨夜回声",
  eyebrow: "长篇正文",
  path: ["雾港来信", "第三章 雨夜回声"],
  format: "正文",
  content: "雨是在午夜以后落下来的。"
};

const runtime = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux" as const
};

function createDeferredApi(): {
  api: DeepWriteApi;
  prompts: SessionPromptCommandPayload[];
  resolveAccepted(index: number, payload: SessionPromptAcceptedPayload): void;
  rejectPrompt(index: number, error: Error): void;
  promptCount(): number;
} {
  const pending: Array<{
    resolve(payload: SessionPromptAcceptedPayload): void;
    reject(error: Error): void;
  }> = [];
  const prompts: SessionPromptCommandPayload[] = [];
  const api: DeepWriteApi = {
    system: {
      async health() {
        return { status: "ok", checkedAt: new Date().toISOString(), workers: [] };
      }
    },
    session: {
      prompt(payload) {
        prompts.push(payload);
        return new Promise<SessionPromptAcceptedPayload>((resolve, reject) => {
          pending.push({ resolve, reject });
        });
      }
    },
    models: {
      async list() {
        return { models: [], defaultModelId: "" };
      },
      async save(settings) {
        return {
          defaultModelId: settings.defaultModelId,
          models: settings.models.map((model) => ({
            id: model.id,
            label: model.label,
            provider: model.provider,
            modelId: model.modelId,
            api: model.api,
            baseUrl: model.baseUrl,
            reasoning: model.reasoning,
            defaultThinkingLevel: model.defaultThinkingLevel,
            hasApiKey: Boolean(model.apiKey)
          }))
        };
      },
      async test(modelId) {
        return {
          modelId,
          ok: true,
          message: "连接成功",
          testedAt: new Date().toISOString()
        };
      }
    },
    events: {
      subscribe() {
        return () => undefined;
      }
    }
  };
  return {
    api,
    prompts,
    resolveAccepted(index, payload) {
      pending[index]?.resolve(payload);
    },
    rejectPrompt(index, error) {
      pending[index]?.reject(error);
    },
    promptCount: () => prompts.length
  };
}

function eventOptions(sessionId: string, runId: string, id: string) {
  return {
    id,
    context: { correlationId: "cmd_1", sessionId, runId }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent conversation controller", () => {
  it("uses the configured default model thinking level and carries model identity", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "openai",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          hasApiKey: true
        }
      ]
    });

    expect(controller.selectedModelId.value).toBe("writer");
    expect(controller.thinkingLevel.value).toBe("high");
    controller.draft.value = "按默认配置运行";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_model",
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "openai", model: "writer-model", mode: "provider" }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "writer",
      thinkingLevel: "high"
    });
    controller.dispose();
  });

  it("accepts events before prompt accepted and prevents duplicate sends", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "续写当前章节";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);

    controller.draft.value = "重复发送";
    await controller.sendMessage(document);
    expect(deferred.promptCount()).toBe(1);

    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "读取上下文",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_1")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "流式回复",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_2")
      )
    );

    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_1",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "流式回复",
      thinking: "读取上下文",
      status: "streaming"
    });
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("ignores accepted and events after a new conversation starts", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "旧会话问题";
    const oldSessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    controller.newConversation();

    deferred.resolveAccepted(0, {
      sessionId: oldSessionId,
      runId: "run_old",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId: oldSessionId,
          runId: "run_old",
          messageId: "message_old",
          delta: "不应出现",
          runtime
        },
        eventOptions(oldSessionId, "run_old", "evt_old")
      )
    );

    expect(controller.messages.value).toEqual([]);
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("deduplicates events and drops late deltas after completion", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证事件";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_1",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const delta = createEnvelope(
      "agent.message_delta",
      {
        sessionId,
        runId: "run_1",
        messageId: "message_1",
        delta: "A",
        runtime
      },
      eventOptions(sessionId, "run_1", "evt_delta")
    );
    controller.handleEvent(delta);
    controller.handleEvent(delta);
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          role: "assistant" as const,
          content: "AB",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_completed")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId,
          runId: "run_1",
          messageId: "message_1",
          delta: "迟到",
          runtime
        },
        eventOptions(sessionId, "run_1", "evt_late")
      )
    );

    expect(controller.messages.value.at(-1)?.content).toBe("AB");
    expect(controller.messages.value.at(-1)?.status).toBe("completed");
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("releases busy state and exposes a clear agent error", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
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

  it("isolates a timed-out acceptance from the next send", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 50 });
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

  it("marks an existing streaming message as error on idle timeout", async () => {
    vi.useFakeTimers();
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 50 });
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
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
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

  it("records truncation metadata for a document over the context limit", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api, idleTimeoutMs: 10_000 });
    controller.draft.value = "验证长文快照";
    void controller.sendMessage({ ...document, content: "长".repeat(20_010) });

    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject({
      truncated: true,
      originalLength: 20_010
    });
    expect(
      deferred.prompts[0]?.workspaceContext?.activeResource?.content
    ).toHaveLength(20_000);
    controller.dispose();
  });
});
