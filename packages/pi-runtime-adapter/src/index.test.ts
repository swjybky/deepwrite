import { describe, expect, it } from "vitest";
import { PiAgentRuntimeAdapter, type AgentRuntimeEvent } from "./index";

describe("DeepWrite Pi runtime adapter", () => {
  it("streams thinking and text through pi-agent-core without an API key", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_1",
      sessionId: "session_1",
      prompt: "续写当前章节",
      thinkingLevel: "medium",
      workspaceContext: {
        activeResource: {
          id: "chapter_3",
          domain: "creation",
          title: "第三章 雨夜回声",
          path: ["雾港来信", "第三章 雨夜回声"],
          format: "正文",
          source: "live-editor",
          content: "雨是在午夜以后落下来的。"
        }
      }
    })) {
      events.push(event);
    }

    const deltas = events
      .filter((event): event is Extract<AgentRuntimeEvent, { type: "agent.delta" }> => event.type === "agent.delta")
      .map((event) => event.payload.delta)
      .join("");
    const thinking = events.filter((event) => event.type === "agent.thinking_delta");
    const completed = events.find((event) => event.type === "agent.completed");

    expect(thinking.length).toBeGreaterThan(0);
    expect(deltas).toBe(completed?.payload.content);
    expect(completed?.payload.content).toContain("第三章 雨夜回声");
    expect(completed?.payload.runtime.mode).toBe("local-faux");
    expect(events.filter((event) => event.type === "agent.completed" || event.type === "agent.error")).toHaveLength(1);
    expect(events.every((event) => event.runId === "run_1" && event.sessionId === "session_1")).toBe(true);
  });

  it("emits one error terminal when the run times out", async () => {
    const runtime = new PiAgentRuntimeAdapter({ requestTimeoutMs: 1, tokensPerSecond: 0.01 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_timeout",
      sessionId: "session_timeout",
      prompt: "验证超时"
    })) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "agent.error")).toHaveLength(1);
    expect(events.some((event) => event.type === "agent.completed")).toBe(false);
  });

  it("does not emit thinking when thinking is disabled", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_no_thinking",
      sessionId: "session_no_thinking",
      prompt: "只验证回复流",
      thinkingLevel: "off"
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "agent.thinking_delta")).toBe(false);
    expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
  });

  it("keeps multi-turn history but removes per-run context wrappers", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

    for (const [index, prompt] of ["先检查人物", "再检查剧情"].entries()) {
      for await (const _event of runtime.start({
        runId: `run_history_${index}`,
        sessionId: "session_history",
        prompt,
        thinkingLevel: "off",
        workspaceContext: {
          activeResource: {
            id: "chapter_history",
            domain: "creation",
            title: "历史测试",
            path: ["历史测试"],
            source: "live-editor",
            content: `第 ${index + 1} 轮快照`
          }
        }
      })) {
        // Consume the complete run before inspecting the cached transcript.
      }
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get("session_history:default");
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );

    expect(userMessages?.map((message) => message.content)).toEqual([
      "先检查人物",
      "再检查剧情"
    ]);
    expect(
      agent?.state.messages.some((message) =>
        String(message.content).includes("run_history_")
      )
    ).toBe(false);
  });

  it("aborts an active run through the caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0.01 });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_aborted",
      sessionId: "session_aborted",
      prompt: "验证主动中止",
      signal: controller.signal
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agent.error",
      payload: { code: "pi_agent.aborted" }
    });
  });
});
