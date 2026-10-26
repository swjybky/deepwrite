import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { parseStoredMessage } from "../composables/agent-conversation/parse-message";
import type { ChatMessage } from "../types/conversation";
import ConversationMessageItem from "./ConversationMessageItem.vue";
import SubagentRunDetail from "./SubagentRunDetail.vue";

const at = "2026-10-07T12:00:00.000Z";
const reason = "模型返回了空回复，任务尚未完成。";

function failedMessage(withActivity: boolean): ChatMessage {
  return {
    id: "failed-message",
    role: "assistant",
    content: "",
    createdAt: at,
    status: "error",
    errorMessage: reason,
    ...(withActivity
      ? {
          processingStartedAt: at,
          processingCompletedAt: "2026-10-07T12:02:56.000Z",
          thinking: "测试思考过程",
          toolCalls: [
            {
              id: "read",
              name: "read",
              args: { id: "fixture", kind: "plot_stage" },
              status: "completed" as const,
              requestedAt: at
            }
          ]
        }
      : {})
  };
}

async function render(message: ChatMessage) {
  return renderToString(
    createSSRApp({ render: () => h(ConversationMessageItem, { message }) })
  );
}

describe("persistent conversation errors", () => {
  it("explains a stored Gemini block without rewriting its diagnostics or partial output", async () => {
    const raw = "Provider stopped with: PROHIBITED_CONTENT";
    const message = { ...failedMessage(true), errorMessage: raw };
    const restored = parseStoredMessage(JSON.parse(JSON.stringify(message)))!;
    const html = await render({ ...restored, content: "已经生成的部分正文。" });
    expect(html).toContain("内容限制");
    expect(html).toContain("PROHIBITED_CONTENT");
    expect(html).toContain("已经生成的部分正文。");
    expect(html).not.toContain(raw);
    expect(restored.errorMessage).toBe(raw);
  });

  it("explains a failed subagent summary once when it repeats the provider error", async () => {
    const raw = "Provider stopped with: PROHIBITED_CONTENT";
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(SubagentRunDetail, {
            run: {
              parentToolCallId: "spawn",
              subagentRunId: "blocked-child",
              subagentId: "fixture-child",
              name: "Fixture child",
              task: "Fixture task",
              status: "error",
              runtime: {
                mode: "local-faux",
                provider: "fixture",
                model: "fixture"
              },
              startedAt: at,
              summary: raw,
              errorMessage: raw,
              toolCalls: [],
              processingSteps: []
            }
          })
      })
    );
    expect(html).toContain("内容限制");
    expect(html.match(/PROHIBITED_CONTENT/gu)).toHaveLength(1);
    expect(html).not.toContain(raw);
  });

  it.each([false, true])(
    "shows the failure outside collapsed work details (activity: %s)",
    async (withActivity) => {
      const html = await render(failedMessage(withActivity));
      expect(html).toContain("message-error-copy");
      expect(html).not.toContain("运行失败：");
      expect(html).toContain(reason);
      expect(html).not.toContain("is-empty-error");
      expect(html.lastIndexOf(reason)).toBeGreaterThan(
        html.lastIndexOf("</details>")
      );
    }
  );

  it("keeps the failure when leaving and restoring the conversation", async () => {
    const persisted = JSON.stringify(failedMessage(true));
    const another: ChatMessage = {
      ...failedMessage(false),
      id: "another-conversation",
      status: "completed"
    };
    delete another.errorMessage;
    await render(another);
    const restored = parseStoredMessage(JSON.parse(persisted));
    expect(restored?.status).toBe("error");
    expect(await render(restored!)).toContain(reason);
  });

  it("places the failure after partial output and its actions", async () => {
    const html = await render({
      ...failedMessage(true),
      content: "已经生成的部分正文。"
    });
    expect(html).toContain("已经生成的部分正文。");
    expect(html.lastIndexOf(reason)).toBeGreaterThan(
      html.indexOf("message-actions")
    );
  });

  it("provides a lasting fallback when an older failure has no details", async () => {
    const message = failedMessage(false);
    delete message.errorMessage;
    const html = await render(message);
    expect(html).toContain("message-error-copy");
    expect(html).toContain("本轮未完成，请重试。");
  });

  it.each(["streaming", "completed", "stopped"] as const)(
    "does not show a failure for a %s run",
    async (status) => {
      const html = await render({ ...failedMessage(false), status });
      expect(html).not.toContain("message-error-copy");
      expect(html).not.toContain(reason);
    }
  );
});
