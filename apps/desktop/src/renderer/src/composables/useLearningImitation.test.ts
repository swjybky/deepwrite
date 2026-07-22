import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type DeepWriteApi,
  type LearningImitationDocument,
  type SessionPromptCommandPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { useLearningImitation } from "./useLearningImitation";

const runtime = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux" as const
};

const document: LearningImitationDocument = {
  id: "learning_document_1",
  name: "雨夜样本.md",
  extension: "md",
  mediaType: "text/markdown",
  size: 128,
  text: "雨是在午夜以后落下来的。",
  charCount: 13
};

function event<T extends SystemEventEnvelope["type"]>(
  type: T,
  payload: Extract<SystemEventEnvelope, { type: T }>["payload"],
  id: string
): Extract<SystemEventEnvelope, { type: T }> {
  const identity = payload as { sessionId?: string; runId?: string };
  return createEnvelope(type, payload, {
    id,
    timestamp: "2026-07-22T08:00:00.000Z",
    context: {
      ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
      ...(identity.runId ? { runId: identity.runId } : {})
    }
  }) as unknown as Extract<SystemEventEnvelope, { type: T }>;
}

function setup() {
  const prompts: SessionPromptCommandPayload[] = [];
  const prompt = vi.fn(async (payload: SessionPromptCommandPayload) => {
    prompts.push(payload);
    return {
      sessionId: payload.sessionId,
      runId: `run_${prompts.length}`,
      acceptedAt: "2026-07-22T08:00:00.000Z",
      runtime
    };
  });
  const abort = vi.fn(async (payload: { sessionId: string; runId: string }) => ({
    ...payload,
    abortedAt: "2026-07-22T08:01:00.000Z"
  }));
  const api = { session: { prompt, abort } } as unknown as DeepWriteApi;
  let id = 0;
  const controller = useLearningImitation({
    api: () => api,
    initialDocuments: [document],
    initialModelId: "model_a",
    createId: (prefix) => `${prefix}_${++id}`,
    now: () => "2026-07-22T08:00:00.000Z"
  });
  return { controller, prompt, abort, prompts };
}

describe("useLearningImitation", () => {
  it("rejects a run without an explicitly configured model", async () => {
    const api = { session: { prompt: vi.fn(), abort: vi.fn() } } as unknown as DeepWriteApi;
    const controller = useLearningImitation({
      api: () => api,
      initialDocuments: [document],
      createId: (prefix) => `${prefix}_no_model`
    });

    await expect(controller.start("material_split")).resolves.toBe(false);
    expect(controller.error.value).toBe("请先在模型设置中配置并选择模型。");
    expect(api.session.prompt).not.toHaveBeenCalled();
  });

  it("starts every stage in one dedicated session with a frozen runtime snapshot", async () => {
    const { controller, prompts } = setup();

    await expect(
      controller.start("material_split", {
        prompt: "按当前样本拆解素材。",
        modelId: "model_a"
      })
    ).resolves.toBe(true);

    expect(controller.status.value).toBe("running");
    expect(controller.runningStage.value).toBe("material_split");
    expect(controller.activeRunId.value).toBe("run_1");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      sessionId: controller.sessionId.value,
      message: "按当前样本拆解素材。",
      modelId: "model_a",
      workspaceContext: {
        learningImitation: {
          stageId: "material_split",
          documents: [document]
        }
      }
    });

    const liveDocument = controller.documents.value[0];
    if (!liveDocument) throw new Error("missing test document");
    liveDocument.text = "控制器内的样本后续被修改";
    expect(
      prompts[0]?.workspaceContext?.learningImitation?.documents[0]?.text
    ).toBe("雨是在午夜以后落下来的。");
  });

  it("only applies result updates for the active session, run and frozen stage", async () => {
    const { controller } = setup();
    await controller.start("material_split");

    controller.handleEvent(
      event(
        "tool.execution_completed",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          toolCallId: "write_material",
          toolName: "write_learning_result",
          resultSummary: "预览已更新",
          isError: false,
          runtime
        },
        "event_tool_completed"
      )
    );
    controller.handleEvent(
      event(
        "learning_imitation.result_updated",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          toolCallId: "write_wrong_stage",
          stageId: "style_learning",
          update: { style_skill_body: "不应写入" },
          runtime
        },
        "event_wrong_stage"
      )
    );
    expect(controller.result.value.style_learning.body).toBe("");
    expect(controller.runningStage.value).toBe("material_split");

    controller.handleEvent(
      event(
        "learning_imitation.result_updated",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          toolCallId: "write_material",
          stageId: "material_split",
          update: {
            mode: "replace",
            gimmick: "雨夜来信的核心钩子",
            character: "克制而多疑的调查者"
          },
          runtime
        },
        "event_result"
      )
    );

    expect(controller.result.value.material_split.gimmick).toBe(
      "雨夜来信的核心钩子"
    );
    expect(controller.result.value.material_split.character).toBe(
      "克制而多疑的调查者"
    );
    expect(controller.tools.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "write_material",
          name: "write_learning_result",
          status: "completed"
        })
      ])
    );
  });

  it("keeps streaming chat and tool state until the terminal agent event", async () => {
    const { controller } = setup();
    await controller.start("plot_learning");

    controller.handleEvent(
      event(
        "agent.thinking_delta",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          messageId: "assistant_1",
          delta: "先识别冲突。",
          runtime
        },
        "event_thinking"
      )
    );
    controller.handleEvent(
      event(
        "agent.message_delta",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          messageId: "assistant_1",
          delta: "正在提炼剧情结构",
          runtime
        },
        "event_delta"
      )
    );
    controller.handleEvent(
      event(
        "tool.call_requested",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          toolCallId: "tool_read",
          toolName: "read_learning_document",
          args: { documentId: document.id },
          runtime
        },
        "event_tool"
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      role: "assistant",
      thinking: "先识别冲突。",
      content: "正在提炼剧情结构",
      status: "streaming"
    });
    expect(controller.tools.value.at(-1)).toMatchObject({
      id: "tool_read",
      status: "running"
    });

    controller.handleEvent(
      event(
        "agent.message_completed",
        {
          sessionId: controller.sessionId.value,
          runId: "run_1",
          messageId: "assistant_1",
          role: "assistant",
          content: "剧情学习已完成。",
          runtime
        },
        "event_completed"
      )
    );

    expect(controller.status.value).toBe("completed");
    expect(controller.runningStage.value).toBeNull();
    expect(controller.activeRunId.value).toBeNull();
    expect(controller.lastCompletedRunId.value).toBe("run_1");
    expect(controller.lastCompletedStage.value).toBe("plot_learning");
    expect(controller.messages.value.at(-1)).toMatchObject({
      content: "剧情学习已完成。",
      status: "completed"
    });
  });

  it("stops explicitly but never aborts merely because the controller is disposed", async () => {
    const { controller, abort } = setup();
    await controller.start("style_learning");

    controller.dispose();
    expect(abort).not.toHaveBeenCalled();

    const second = setup();
    await second.controller.start("style_learning");
    await expect(second.controller.stop()).resolves.toBe(true);
    expect(second.controller.status.value).toBe("stopping");
    expect(second.abort).toHaveBeenCalledWith({
      sessionId: second.controller.sessionId.value,
      runId: "run_1"
    });

    second.controller.handleEvent(
      event(
        "agent.error",
        {
          sessionId: second.controller.sessionId.value,
          runId: "run_1",
          code: "pi_agent.aborted",
          message: "Agent run aborted.",
          runtime
        },
        "event_aborted"
      )
    );
    expect(second.controller.status.value).toBe("stopped");
  });

  it("creates a fresh dedicated session only through an explicit idle reset", async () => {
    const { controller } = setup();
    const firstSessionId = controller.sessionId.value;
    await controller.start("material_split");

    expect(controller.newSession()).toBe(false);
    expect(controller.sessionId.value).toBe(firstSessionId);
    controller.handleEvent(
      event(
        "agent.message_completed",
        {
          sessionId: firstSessionId,
          runId: "run_1",
          messageId: "assistant_reset",
          role: "assistant",
          content: "完成。",
          runtime
        },
        "event_before_reset"
      )
    );

    expect(controller.newSession()).toBe(true);
    expect(controller.sessionId.value).not.toBe(firstSessionId);
    expect(controller.documents.value).toEqual([]);
    expect(controller.messages.value).toEqual([]);
    expect(controller.tools.value).toEqual([]);
    expect(controller.status.value).toBe("idle");
  });

  it("keeps the event subscription alive when an appended result exceeds its field limit", async () => {
    const { controller } = setup();
    controller.setResult({
      ...controller.result.value,
      material_split: {
        ...controller.result.value.material_split,
        gimmick: "钩".repeat(200_000)
      }
    });
    await controller.start("material_split");

    expect(() =>
      controller.handleEvent(
        event(
          "learning_imitation.result_updated",
          {
            sessionId: controller.sessionId.value,
            runId: "run_1",
            toolCallId: "write_too_much",
            stageId: "material_split",
            update: { mode: "append", gimmick: "新增内容" },
            runtime
          },
          "event_too_much"
        )
      )
    ).not.toThrow();
    expect(controller.status.value).toBe("running");
    expect(controller.error.value).toBeTruthy();
    expect(controller.result.value.material_split.gimmick).toHaveLength(200_000);
    expect(controller.tools.value.at(-1)?.status).toBe("error");
  });
});
