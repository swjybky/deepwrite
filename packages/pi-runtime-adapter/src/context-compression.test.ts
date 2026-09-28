import { describe, expect, it } from "vitest";
import {
  Agent,
  type AgentMessage,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from "@earendil-works/pi-ai";
import {
  ContextCompressionController,
  type ContextCompactedInfo
} from "./context-compression";

const model: Model<"openai-completions"> = {
  id: "compaction-test-model",
  name: "Compaction Test Model",
  api: "openai-completions",
  provider: "custom",
  baseUrl: "http://127.0.0.1/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
  maxTokens: 2_000
};

function usage(input: number): AssistantMessage["usage"] {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
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
    stream.push({ type: "done", reason: message.stopReason, message });
  }
  return stream;
}

function assistantMessage(
  text: string,
  inputTokens: number,
  stopReason: "stop" | "length" | "toolUse" | "error" = "stop"
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(inputTokens),
    stopReason,
    timestamp: Date.now()
  };
}

/** ~2000 estimated tokens (heuristic is ceil(chars / 4)). */
const FILLER = "a".repeat(8_000);

/** Summarization requests open with the framework's summarizer system prompt. */
function isSummarizationRequest(systemPrompt: string | undefined): boolean {
  return (
    typeof systemPrompt === "string" &&
    systemPrompt.startsWith("You are a context summarization assistant.")
  );
}

function userMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

interface Harness {
  agent: Agent;
  controller: ContextCompressionController;
  summarizationRequests: AgentMessage[][];
  compacted: ContextCompactedInfo[];
}

function createHarness(
  messages: AgentMessage[],
  options: {
    contextWindow?: number;
    thresholdPercent?: number;
    summaryFails?: boolean;
    enabled?: boolean;
  } = {}
): Harness {
  const summarizationRequests: AgentMessage[][] = [];
  const compacted: ContextCompactedInfo[] = [];
  const effectiveModel: Model<"openai-completions"> = {
    ...model,
    contextWindow: options.contextWindow ?? model.contextWindow
  };

  const streamFn: StreamFn = async (_model, context) => {
    // The framework appends to the summarization system prompt, so match the
    // distinctive opening rather than requiring exact equality.
    if (isSummarizationRequest(context.systemPrompt)) {
      summarizationRequests.push(context.messages as AgentMessage[]);
      return responseStream(
        options.summaryFails
          ? assistantMessage("", 0, "error")
          : assistantMessage("SUMMARY-OF-OLDER-HISTORY", 0)
      );
    }
    return responseStream(assistantMessage("ok", 0));
  };

  const agent = new Agent({
    initialState: {
      model: effectiveModel,
      systemPrompt: "test",
      thinkingLevel: "off",
      messages
    },
    streamFn
  });

  const controller = new ContextCompressionController(agent);
  controller.configure({
    model: effectiveModel,
    streamFn,
    enabled: options.enabled ?? true,
    thresholdPercent: options.thresholdPercent ?? 80,
    thinkingLevel: "off",
    onCompacted: (info) => compacted.push(info)
  });

  return { agent, controller, summarizationRequests, compacted };
}

/** Six large messages: ~12k estimated tokens, far past the 16k window trigger. */
function longTranscript(): AgentMessage[] {
  return [
    userMessage(FILLER),
    assistantMessage(FILLER, 0),
    userMessage(FILLER),
    assistantMessage(FILLER, 0),
    userMessage(FILLER),
    assistantMessage(FILLER, 15_000)
  ];
}

describe("context compression controller", () => {
  it("leaves a transcript below the threshold untouched", async () => {
    const messages: AgentMessage[] = [
      userMessage("hello"),
      assistantMessage("hi", 500)
    ];
    const test = createHarness(messages);

    const result = await test.controller.transformContext(messages);

    expect(result).toBe(messages);
    expect(test.summarizationRequests).toHaveLength(0);
    expect(test.compacted).toHaveLength(0);
  });

  it("replaces the head with a summary and never mutates the input array", async () => {
    const messages = longTranscript();
    const lengthBefore = messages.length;
    const test = createHarness(messages);

    const result = await test.controller.transformContext(messages);

    expect(test.summarizationRequests).toHaveLength(1);
    expect(result).not.toBe(messages);
    expect(result.length).toBeLessThan(messages.length);
    expect(result[0]!.role).toBe("compactionSummary");

    // Original transcript is untouched: same length, no summary role.
    expect(messages).toHaveLength(lengthBefore);
    expect(messages.some((m) => m.role === "compactionSummary")).toBe(false);

    expect(test.compacted).toHaveLength(1);
    expect(test.compacted[0]).toMatchObject({ trigger: "threshold" });
    expect(test.compacted[0]!.tokensBefore).toBeGreaterThan(0);
    expect(test.compacted[0]!.summarizedMessages).toBeGreaterThan(0);
  });

  it("reuses the cached summary instead of summarizing twice", async () => {
    const messages = longTranscript();
    const test = createHarness(messages);

    const first = await test.controller.transformContext(messages);
    const second = await test.controller.transformContext(messages);

    expect(test.summarizationRequests).toHaveLength(1);
    expect(second[0]).toBe(first[0]);
    expect(second).toHaveLength(first.length);
  });

  it("does not re-compact until two new messages arrive (debounce)", async () => {
    const messages = longTranscript();
    const test = createHarness(messages);
    await test.controller.transformContext(messages);

    // A single appended message is not enough to re-trigger.
    messages.push(userMessage(FILLER));
    await test.controller.transformContext(messages);
    expect(test.summarizationRequests).toHaveLength(1);

    // Two appended messages clear the debounce, but the projection must still be
    // the cached one rather than a fresh summarization of the same head.
    messages.push(assistantMessage(FILLER, 15_000));
    const third = await test.controller.transformContext(messages);
    expect(third[0]!.role).toBe("compactionSummary");
  });

  it("falls back to the raw transcript when summarization fails", async () => {
    const messages = longTranscript();
    const test = createHarness(messages, { summaryFails: true });

    const result = await test.controller.transformContext(messages);

    expect(test.summarizationRequests).toHaveLength(1);
    expect(result).toBe(messages);
    expect(test.compacted).toHaveLength(0);
  });

  it("re-summarizes after the transcript is replaced", async () => {
    const messages = longTranscript();
    const test = createHarness(messages);
    await test.controller.transformContext(messages);
    expect(test.summarizationRequests).toHaveLength(1);

    // A brand new transcript invalidates the cached prefix identity.
    const replacement = longTranscript();
    const result = await test.controller.transformContext(replacement);

    expect(test.summarizationRequests).toHaveLength(2);
    expect(result[0]!.role).toBe("compactionSummary");
  });

  it("stays inert when disabled", async () => {
    const messages = longTranscript();
    const test = createHarness(messages, { enabled: false });

    const result = await test.controller.transformContext(messages);

    expect(result).toBe(messages);
    expect(test.summarizationRequests).toHaveLength(0);
  });

  it("honors a lower threshold", async () => {
    // Usage below the default trigger but above a 50% threshold.
    const messages: AgentMessage[] = [
      userMessage(FILLER),
      assistantMessage(FILLER, 0),
      userMessage(FILLER),
      assistantMessage(FILLER, 9_000)
    ];
    const off = createHarness(messages, { thresholdPercent: 95 });
    expect(await off.controller.transformContext(messages)).toBe(messages);

    const on = createHarness(messages, { thresholdPercent: 50 });
    const result = await on.controller.transformContext(messages);
    expect(result[0]!.role).toBe("compactionSummary");
  });

  it("keeps a tool result attached to the turn it belongs to", async () => {
    const messages: AgentMessage[] = [
      userMessage(FILLER),
      assistantMessage(FILLER, 0),
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: FILLER }],
        isError: false,
        timestamp: Date.now()
      } as unknown as AgentMessage,
      userMessage(FILLER),
      assistantMessage(FILLER, 15_000)
    ];
    const test = createHarness(messages);

    const result = await test.controller.transformContext(messages);

    expect(result[0]!.role).toBe("compactionSummary");
    // A projection must never open with an orphaned tool result.
    expect(result[1]!.role).not.toBe("toolResult");
  });

  it("reports overflow recovery only once per run", async () => {
    const messages = longTranscript();
    const test = createHarness(messages);
    const overflow: AssistantMessage = {
      ...assistantMessage("", 0, "error"),
      errorMessage: "prompt is too long: 30000 tokens > 16000 maximum"
    };

    expect(test.controller.canRecoverOverflow(overflow)).toBe(true);
    expect(await test.controller.recoverFromOverflow()).toBe(true);
    // Second overflow in the same run is terminal.
    expect(test.controller.canRecoverOverflow(overflow)).toBe(false);
    expect(await test.controller.recoverFromOverflow()).toBe(false);
  });

  it("ignores non-overflow errors", async () => {
    const messages = longTranscript();
    const test = createHarness(messages);
    const transient: AssistantMessage = {
      ...assistantMessage("", 0, "error"),
      errorMessage: "fetch failed: connection reset"
    };

    expect(test.controller.canRecoverOverflow(transient)).toBe(false);
  });
});
