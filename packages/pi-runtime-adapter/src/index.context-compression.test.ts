import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from "@earendil-works/pi-ai";
import * as provider from "./provider-runtime";
import { PiAgentRuntimeAdapter } from "./adapter";
import type { AgentRuntimeEvent } from "./runtime-types";

const model: Model<"openai-completions"> = {
  id: "compaction-integration-model",
  name: "Compaction Integration Model",
  provider: "custom",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 16_000,
  maxTokens: 2_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};

const config: AgentProviderRuntimeConfig = {
  id: "test-config",
  label: "Test",
  provider: "custom",
  modelId: model.id,
  api: model.api,
  baseUrl: model.baseUrl,
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  temperatureOptions: [0, 0.5, 1],
  apiKey: "invalid-test-key"
};

/** ~2000 estimated tokens per message. */
const BULK = "a".repeat(8_000);

function assistant(text: string, inputTokens: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: inputTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: inputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function stream(message: AssistantMessage) {
  const eventStream = createAssistantMessageEventStream();
  eventStream.push({ type: "done", reason: "stop", message });
  return eventStream;
}

function isSummarization(systemPrompt: unknown): boolean {
  return (
    typeof systemPrompt === "string" &&
    systemPrompt.startsWith("You are a context summarization assistant.")
  );
}

interface Harness {
  runtime: PiAgentRuntimeAdapter;
  /** Message arrays the model actually received on each non-summarization call. */
  modelRequests: unknown[][];
  counts: { summarization: number };
}

function createHarness(inputTokens = 15_000): Harness {
  const modelRequests: unknown[][] = [];
  const counts = { summarization: 0 };

  const streamFn: StreamFn = async (_model, context) => {
    if (isSummarization(context.systemPrompt)) {
      counts.summarization += 1;
      return stream(assistant("SUMMARY-OF-EARLIER-TURNS", 0));
    }
    modelRequests.push(context.messages as unknown[]);
    return stream(assistant(BULK, inputTokens));
  };

  vi.spyOn(provider, "buildWorkspaceProviderRuntimes").mockReturnValue({
    model,
    streamFn,
    spawnStreamFn: streamFn
  });

  return {
    runtime: new PiAgentRuntimeAdapter({ tokensPerSecond: 0 }),
    modelRequests,
    counts
  };
}

async function runTurn(
  runtime: PiAgentRuntimeAdapter,
  index: number,
  options: {
    autoCompactContext?: boolean;
    autoCompactThresholdPercent?: number;
  } = {}
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.start({
    runId: `run_compaction_${index}`,
    sessionId: "session_compaction",
    prompt: BULK,
    thinkingLevel: "off",
    runtimeConfig: config,
    ...options
  })) {
    events.push(event);
  }
  return events;
}

function cachedAgent(runtime: PiAgentRuntimeAdapter):
  | {
      state: { messages: Array<{ role?: string }> };
    }
  | undefined {
  const cache = (
    runtime as unknown as {
      conversationAgents: Map<string, { state: { messages: unknown[] } }>;
    }
  ).conversationAgents;
  return [...cache.values()][0] as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pi runtime adapter automatic context compaction", () => {
  it("compacts the model request while leaving the transcript intact", async () => {
    const harness = createHarness();
    await runTurn(harness.runtime, 1);
    await runTurn(harness.runtime, 2);
    const events = await runTurn(harness.runtime, 3);

    expect(harness.counts.summarization).toBeGreaterThan(0);
    const compactionEvents = events.filter(
      (event) => event.type === "agent.context_compacted"
    );
    expect(compactionEvents).toHaveLength(1);
    expect(compactionEvents[0]!.payload).toMatchObject({
      trigger: "threshold"
    });

    // The request sent after compaction opens with the summary instead of the
    // full history, so it carries fewer messages than the transcript.
    const agent = cachedAgent(harness.runtime);
    const transcript = agent!.state.messages;
    const lastRequest = harness.modelRequests.at(-1)!;
    expect(lastRequest.length).toBeLessThan(transcript.length);

    // The transcript itself keeps every message and never gains a summary.
    expect(transcript.every((m) => m.role !== "compactionSummary")).toBe(true);
    expect(transcript.length).toBeGreaterThan(compactionEvents.length);
  });

  it("stays inert when the setting is disabled", async () => {
    const harness = createHarness();
    for (const index of [1, 2, 3]) {
      await runTurn(harness.runtime, index, { autoCompactContext: false });
    }

    expect(harness.counts.summarization).toBe(0);
  });

  it("does not compact below the configured threshold", async () => {
    // 12k usage plus one trailing ~2k prompt estimates to 14k: above the 80%
    // trigger (12.8k) but below the 95% one (14.98k).
    const harness = createHarness(12_000);
    for (const index of [1, 2, 3]) {
      await runTurn(harness.runtime, index, {
        autoCompactThresholdPercent: 95
      });
    }

    expect(harness.counts.summarization).toBe(0);
  });

  it("compacts the same transcript at the default threshold", async () => {
    const harness = createHarness(12_000);
    for (const index of [1, 2, 3]) {
      await runTurn(harness.runtime, index);
    }

    expect(harness.counts.summarization).toBeGreaterThan(0);
  });
});
