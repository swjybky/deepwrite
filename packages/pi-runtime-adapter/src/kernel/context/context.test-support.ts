import {
  Agent,
  type AgentMessage,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type UserMessage
} from "@earendil-works/pi-ai";
import type { AgentRuntimeEvent } from "../../runtime-types";
import { RunContextManager } from "./manager";
import type { ContextPolicy } from "./types";

export const model: Model<"openai-completions"> = {
  id: "context-test",
  name: "Context test",
  provider: "example",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 2_000
};
export const runtime = {
  mode: "provider" as const,
  provider: model.provider,
  model: model.id
};
export const policy: ContextPolicy = {
  settings: { enabled: true, budgetTokens: 16_000 },
  task: "short-draft",
  toolCompactors: {}
};
export const user = (content: string, timestamp = 1): UserMessage => ({
  role: "user",
  content,
  timestamp
});
export function assistant(
  content = "答复",
  stopReason: AssistantMessage["stopReason"] = "stop"
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: 2,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason
  };
}
export function response(
  message = assistant("约束：不要使用梦境结局。进度：第三节待续写。")
) {
  const stream = createAssistantMessageEventStream();
  if (message.stopReason === "error" || message.stopReason === "aborted")
    stream.push({ type: "error", reason: message.stopReason, error: message });
  else if (message.stopReason !== "pending")
    stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}
export function manager(
  messages: AgentMessage[],
  overrides: {
    policy?: ContextPolicy;
    streamFn?: StreamFn;
    signal?: AbortSignal;
    model?: typeof model;
    notifyCompacted?: (ids?: readonly string[]) => void;
  } = {}
) {
  const events: AgentRuntimeEvent[] = [];
  const streamFn = overrides.streamFn ?? (() => response());
  const agent = new Agent({
    initialState: {
      model: overrides.model ?? model,
      messages,
      systemPrompt: "写作",
      thinkingLevel: "off"
    },
    streamFn
  });
  let invalidated = 0;
  const guard = new RunContextManager({
    agent,
    policy: overrides.policy ?? policy,
    model: overrides.model ?? model,
    summaryModel: {
      model: overrides.model ?? model,
      streamFn,
      thinkingLevel: "off",
      runtime,
      local: false
    },
    runId: "run-new",
    sessionId: "session",
    messageId: "answer",
    runtime,
    fixedTokens: 100,
    signal: overrides.signal ?? new AbortController().signal,
    emit: (event) => events.push(event),
    setBusy: () => {},
    notifyCompacted: (ids) => {
      invalidated += 1;
      overrides.notifyCompacted?.(ids);
    }
  });
  return { agent, guard, events, invalidated: () => invalidated };
}
