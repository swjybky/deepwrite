import type {
  AgentMessage,
  AgentTool,
  AgentToolResult
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  Model,
  AssistantMessage,
  Usage
} from "@earendil-works/pi-ai";
import type {
  AgentUsage,
  AgentRuntimeRef,
  AgentProviderRuntimeConfig,
  AgentUsageObservationStatus
} from "@deepwrite/contracts";
import type { RuntimeSubagentDefinition } from "./subagent-types";
export const SUBAGENT_SUMMARY_MAX_LENGTH = 20_000;
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

export function namespaceChildToolCallId(
  subagentRunId: string,
  toolCallId: string
): string {
  return `${subagentRunId}:${toolCallId}`;
}

export function readAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

export function normalizeUsage(
  usage: Usage | undefined
): AgentUsage | undefined {
  if (!usage) return undefined;
  const values = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return undefined;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens
  };
}

export function runtimeFromConfig(
  config: AgentProviderRuntimeConfig
): AgentRuntimeRef {
  return {
    provider: config.provider,
    model: config.modelId,
    mode: "provider",
    configId: config.id
  };
}

export function runtimeFromModel(model: Model<Api>): AgentRuntimeRef {
  return {
    provider: model.provider,
    model: model.id,
    mode: "provider"
  };
}

export function usageObservationStatus(
  message: AssistantMessage
): AgentUsageObservationStatus {
  if (message.stopReason === "aborted") return "aborted";
  if (message.stopReason === "error" || message.errorMessage) return "error";
  return "completed";
}

export function summarizeToolResult(result: unknown): string {
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (item): item is { type: "text"; text: string } =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string"
        )
        .map((item) => item.text)
        .join("\n");
      if (text) return text.slice(0, 4_000);
    }
  }
  if (result === undefined || result === null) return "工具执行完成。";
  try {
    return (JSON.stringify(result) || "工具执行完成。").slice(0, 4_000);
  } catch {
    return "工具已执行完成。";
  }
}

export function isAssistantMessage(
  message: AgentMessage
): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    message.role === "assistant"
  );
}

/**
 * Child agents keep their own role prompt (no parent prompt inheritance). The
 * appended block states only runtime facts the child cannot observe on its own
 * — fresh context, no recursion, the live tool list, and how its final reply is
 * consumed. Whether the child should write through tools or hand information
 * back to the parent is left entirely to `definition.systemPrompt`.
 */
export function buildSubagentSystemPrompt(
  definition: RuntimeSubagentDefinition,
  childTools: readonly AgentTool[],
  systemPromptRequirements?: string
): string {
  const toolLines = childTools.map((tool) => {
    const label =
      "label" in tool && typeof tool.label === "string" && tool.label.trim()
        ? tool.label.trim()
        : tool.name;
    return `- ${tool.name}（${label}）`;
  });
  return [
    definition.systemPrompt.trim(),
    ...(systemPromptRequirements?.trim()
      ? ["", "【本轮不可编辑的写作约束】", systemPromptRequirements.trim()]
      : []),
    "",
    `【当前子智能体：${definition.name} / ${definition.id}】`,
    "【本轮运行事实】",
    definition.contextMode === "parent-snapshot"
      ? "你继承了主智能体调用时的对话快照。历史工具结果仅供理解任务，不代表你拥有那些工具或已经读取过待编辑条目；必须使用自己的工具重新读取。"
      : "你由当前主智能体为一个明确子任务临时创建。本次运行使用全新上下文，不继承主对话历史。",
    "你不能创建或调用其它子智能体。",
    ...(toolLines.length > 0
      ? [
          "本轮可用工具：",
          ...toolLines,
          "没有出现在上面清单里的能力本轮不可用，不得声称已经执行。"
        ]
      : ["本轮没有可用工具，只能返回文字结论。"]),
    `你的最终回复会原样返回给主智能体，并计入主智能体的上下文（超过 ${SUBAGENT_SUMMARY_MAX_LENGTH} 字会被截断）。只写主智能体真正需要的信息，不要整段粘贴文件原文。`
  ].join("\n");
}
