import { describe, expect, it } from "vitest";
import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  jitterAgentTurnRetryDelay,
  runAgentWithTurnRetries,
  sleepForAgentTurnRetry,
  type AgentTurnAttempt,
  type AgentTurnRetrySchedule
} from "./agent-turn-retry";

const model: Model<"openai-completions"> = {
  id: "retry-test-model",
  name: "Retry Test Model",
  api: "openai-completions",
  provider: "custom",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
  maxTokens: 1_000
};

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function assistantMessage(
  stopReason: AssistantMessage["stopReason"],
  content: AssistantMessage["content"],
  errorMessage?: string
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now()
  };
}

function responseStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  if (message.stopReason === "pending") {
    throw new Error(
      "A pending assistant message is not a terminal test response."
    );
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    stream.push({
      type: "done",
      reason: message.stopReason,
      message
    });
  }
  return stream;
}

describe("agent turn retry coordinator", () => {
  it.each([
    "Provider stopped with: PROHIBITED_CONTENT",
    "503 Provider returned error: Provider stopped with: PROHIBITED_CONTENT",
    "502 gateway error: Provider stopped with: SAFETY"
  ])(
    "does not retry content restrictions, including gateway wrappers: %s",
    async (errorMessage) => {
      let calls = 0;
      const failure = assistantMessage("error", [], errorMessage);
      const agent = new Agent({
        initialState: { model, systemPrompt: "test", thinkingLevel: "off" },
        streamFn: () => {
          calls++;
          return responseStream(failure);
        }
      });
      const retries: AgentTurnRetrySchedule[] = [];
      const failures: AssistantMessage[] = [];
      let observations = 0;
      let overflowChecks = 0;
      await runAgentWithTurnRetries({
        agent,
        initialPrompt: { role: "user", content: "fixture task", timestamp: 1 },
        runId: "run_content_block",
        retryPolicy: { delaysMs: [0, 0], sleep: async () => {} },
        // A caller's broad classifier must not override a content restriction.
        classifyFailure: () => "503 upstream error",
        contextOverflow: {
          matches: () => {
            overflowChecks++;
            return true;
          },
          recover: async () => true
        },
        onRetryScheduled: (schedule) => {
          retries.push(schedule);
        },
        onAssistantMessageEnded: () => {
          observations++;
        },
        onEvent: (event) => {
          if (
            event.type === "message_end" &&
            event.message.role === "assistant"
          )
            failures.push(event.message);
        }
      });
      expect(calls).toBe(1);
      expect(retries).toEqual([]);
      expect(observations).toBe(1);
      expect(overflowChecks).toBe(0);
      expect(failures).toEqual([failure]);
      expect(agent.state.messages.at(-1)).toBe(failure);
      expect(failure.errorMessage).toBe(errorMessage);
    }
  );

  it("applies bounded +/-20% jitter", () => {
    expect(jitterAgentTurnRetryDelay(10_000, () => 0)).toBe(8_000);
    expect(jitterAgentTurnRetryDelay(10_000, () => 0.5)).toBe(10_000);
    expect(jitterAgentTurnRetryDelay(10_000, () => 1)).toBe(12_000);
    expect(jitterAgentTurnRetryDelay(10_000, () => Number.NaN)).toBe(10_000);
  });

  it("cancels an in-progress backoff immediately", async () => {
    const controller = new AbortController();
    const waiting = sleepForAgentTurnRetry(30_000, controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries a transient provider failure under one logical turn id", async () => {
    let calls = 0;
    const contexts: Context[] = [];
    const streamFn: StreamFn = async (_model, context) => {
      calls += 1;
      contexts.push(context);
      return calls < 3
        ? responseStream(
            assistantMessage(
              "error",
              [{ type: "text", text: `partial-${calls}` }],
              "fetch failed: connection reset"
            )
          )
        : responseStream(
            assistantMessage("stop", [{ type: "text", text: "recovered" }])
          );
    };
    const agent = new Agent({
      initialState: { model, systemPrompt: "test", thinkingLevel: "off" },
      streamFn
    });
    const attempts: AgentTurnAttempt[] = [];
    const retries: AgentTurnRetrySchedule[] = [];
    const forwardedFailures: AgentEvent[] = [];
    const observedMessages: Array<{
      attempt: number;
      stopReason: AssistantMessage["stopReason"];
    }> = [];
    const slept: number[] = [];

    await runAgentWithTurnRetries({
      agent,
      initialPrompt: {
        role: "user",
        content: "retry this turn",
        timestamp: 1
      },
      runId: "run_retry",
      retryPolicy: {
        random: () => 0.5,
        now: () => Date.parse("2026-07-26T12:00:00.000Z"),
        sleep: async (delayMs) => {
          slept.push(delayMs);
        }
      },
      onTurnStarted: (attempt) => {
        attempts.push({ ...attempt });
      },
      onAssistantMessageEnded: (message, attempt) => {
        observedMessages.push({
          attempt: attempt.attempt,
          stopReason: message.stopReason
        });
      },
      onRetryScheduled: (schedule) => {
        retries.push({ ...schedule });
      },
      onEvent: (event) => {
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "error"
        ) {
          forwardedFailures.push(event);
        }
      }
    });

    expect(calls).toBe(3);
    expect(slept).toEqual([2_000, 5_000]);
    expect(
      attempts.map(({ turnId, attempt, maxAttempts }) => ({
        turnId,
        attempt,
        maxAttempts
      }))
    ).toEqual([
      { turnId: "run_retry:turn:1", attempt: 1, maxAttempts: 6 },
      { turnId: "run_retry:turn:1", attempt: 2, maxAttempts: 6 },
      { turnId: "run_retry:turn:1", attempt: 3, maxAttempts: 6 }
    ]);
    expect(retries).toMatchObject([
      {
        failedAttempt: 1,
        nextAttempt: 2,
        delayMs: 2_000,
        retryAt: "2026-07-26T12:00:02.000Z"
      },
      {
        failedAttempt: 2,
        nextAttempt: 3,
        delayMs: 5_000,
        retryAt: "2026-07-26T12:00:05.000Z"
      }
    ]);
    expect(forwardedFailures).toEqual([]);
    expect(observedMessages).toEqual([
      { attempt: 1, stopReason: "error" },
      { attempt: 2, stopReason: "error" },
      { attempt: 3, stopReason: "stop" }
    ]);
    expect(
      contexts.map((context) => context.messages.map((message) => message.role))
    ).toEqual([
      ["system", "user"],
      ["system", "user"],
      ["system", "user"]
    ]);
    expect(agent.state.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant"
    ]);
  });

  it("keeps completed tool results and does not replay their tool call", async () => {
    let requests = 0;
    let toolExecutions = 0;
    const requestRoles: string[][] = [];
    const streamFn: StreamFn = async (_model, context) => {
      requests += 1;
      requestRoles.push(context.messages.map((message) => message.role));
      if (requests === 1) {
        return responseStream(
          assistantMessage("toolUse", [
            {
              type: "toolCall",
              id: "tool_once",
              name: "read_once",
              arguments: {}
            }
          ])
        );
      }
      if (requests === 2) {
        return responseStream(
          assistantMessage(
            "error",
            [{ type: "text", text: "" }],
            "503 Service Unavailable"
          )
        );
      }
      return responseStream(
        assistantMessage("stop", [{ type: "text", text: "done" }])
      );
    };
    const tool: AgentTool = {
      name: "read_once",
      label: "Read once",
      description: "Returns one durable tool result.",
      parameters: Type.Object({}),
      execute: async () => {
        toolExecutions += 1;
        return {
          content: [{ type: "text", text: "durable result" }],
          details: {}
        };
      }
    };
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: "test",
        thinkingLevel: "off",
        tools: [tool]
      },
      streamFn,
      toolExecution: "sequential"
    });
    const attempts: AgentTurnAttempt[] = [];

    await runAgentWithTurnRetries({
      agent,
      initialPrompt: { role: "user", content: "use tool", timestamp: 1 },
      runId: "run_tool_retry",
      retryPolicy: {
        delaysMs: [0],
        random: () => 0.5,
        sleep: async () => {}
      },
      onTurnStarted: (attempt) => {
        attempts.push({ ...attempt });
      }
    });

    expect(toolExecutions).toBe(1);
    expect(requestRoles).toEqual([
      ["system", "user"],
      ["system", "user", "assistant", "toolResult"],
      ["system", "user", "assistant", "toolResult"]
    ]);
    expect(attempts).toEqual([
      { turnId: "run_tool_retry:turn:1", attempt: 1, maxAttempts: 2 },
      { turnId: "run_tool_retry:turn:2", attempt: 1, maxAttempts: 2 },
      { turnId: "run_tool_retry:turn:2", attempt: 2, maxAttempts: 2 }
    ]);
  });

  it("forwards only the final provider error after five retries are exhausted", async () => {
    let calls = 0;
    const streamFn: StreamFn = async () => {
      calls += 1;
      return responseStream(
        assistantMessage(
          "error",
          [{ type: "text", text: "" }],
          "socket hang up"
        )
      );
    };
    const agent = new Agent({
      initialState: { model, systemPrompt: "test", thinkingLevel: "off" },
      streamFn
    });
    const failures: AssistantMessage[] = [];
    const retries: AgentTurnRetrySchedule[] = [];

    await runAgentWithTurnRetries({
      agent,
      initialPrompt: { role: "user", content: "keep trying", timestamp: 1 },
      runId: "run_exhausted",
      retryPolicy: {
        delaysMs: [0, 0, 0, 0, 0],
        random: () => 0.5,
        sleep: async () => {}
      },
      onRetryScheduled: (schedule) => {
        retries.push({ ...schedule });
      },
      onEvent: (event) => {
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "error"
        ) {
          failures.push(event.message);
        }
      }
    });

    expect(calls).toBe(6);
    expect(retries).toHaveLength(5);
    expect(retries.at(-1)).toMatchObject({ failedAttempt: 5, nextAttempt: 6 });
    expect(failures).toHaveLength(1);
    expect(agent.state.messages).toHaveLength(3);
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "error"
    });
  });
});
