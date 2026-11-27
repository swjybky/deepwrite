import type {
  AgentEvaluationHistoryMessage,
  AgentEvaluationSnapshot,
  AgentEvaluationToolConfiguration
} from "@deepwrite/contracts";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  isAssistantMessage,
  readAssistantText,
  readAssistantThinking,
  serializedToolArguments,
  summarizeToolResult
} from "./event-mapping";
import {
  applyProviderToolSchemaCompatibility,
  type PortableToolSchemaProfile
} from "./portable-tool-schema";
import { enforceProviderToolSchemaCompatibility } from "./provider-tool-schema-compat";
import { jsonClone } from "@deepwrite/shared";

function evaluationContextText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (part): part is Extract<(typeof content)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n");
}

const EVALUATION_HISTORY_TEXT_LIMIT = 4_000;
const EVALUATION_HISTORY_MAX_MESSAGES = 40;

function compactEvaluationText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= EVALUATION_HISTORY_TEXT_LIMIT) return trimmed;
  return `${trimmed.slice(0, EVALUATION_HISTORY_TEXT_LIMIT)}…`;
}

function isUserAgentMessage(message: AgentMessage): message is UserMessage {
  return (
    typeof message === "object" && message !== null && message.role === "user"
  );
}

function isToolResultAgentMessage(
  message: AgentMessage
): message is ToolResultMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    message.role === "toolResult"
  );
}

function evaluationHistoryToolFields(
  toolName: string | undefined,
  toolCallId: string | undefined
): Pick<AgentEvaluationHistoryMessage, "toolName" | "toolCallId"> {
  const name = toolName?.trim();
  const id = toolCallId?.trim();
  return {
    ...(name ? { toolName: name } : {}),
    ...(id ? { toolCallId: id } : {})
  };
}

function evaluationHistoryFromToolResult(
  message: ToolResultMessage
): AgentEvaluationHistoryMessage {
  const text = message.content
    .filter(
      (
        part
      ): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n");
  return {
    role: "tool",
    text: compactEvaluationText(
      text || summarizeToolResult(message.details ?? message)
    ),
    ...evaluationHistoryToolFields(message.toolName, message.toolCallId),
    ...(message.isError ? { isError: true } : {})
  };
}

/** @internal Exported for evaluation-capture regression tests. */
export function evaluationConversationHistory(
  messages: readonly AgentMessage[]
): AgentEvaluationHistoryMessage[] {
  const entries: AgentEvaluationHistoryMessage[] = [];
  for (const message of messages) {
    if (isUserAgentMessage(message)) {
      const text = compactEvaluationText(
        evaluationContextText(message.content)
      );
      if (text) entries.push({ role: "user", text });
      continue;
    }
    if (isAssistantMessage(message)) {
      const text = compactEvaluationText(
        [readAssistantThinking(message), readAssistantText(message)]
          .filter(Boolean)
          .join("\n\n")
      );
      if (text) entries.push({ role: "assistant", text });
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        entries.push({
          role: "assistant",
          text: compactEvaluationText(
            serializedToolArguments(part.arguments) ?? ""
          ),
          ...evaluationHistoryToolFields(part.name, part.id)
        });
      }
      continue;
    }
    if (isToolResultAgentMessage(message)) {
      entries.push(evaluationHistoryFromToolResult(message));
    }
  }
  return entries.length <= EVALUATION_HISTORY_MAX_MESSAGES
    ? entries
    : entries.slice(-EVALUATION_HISTORY_MAX_MESSAGES);
}

type EvaluationToolSource = Pick<
  AgentTool,
  "name" | "description" | "parameters"
> &
  Partial<Pick<AgentTool, "label" | "executionMode">>;

function evaluationToolConfiguration(
  tool: EvaluationToolSource
): AgentEvaluationToolConfiguration {
  // TypeBox schemas contain symbol metadata used by local validation. A JSON
  // clone records the exact provider-facing schema without executable hooks.
  const inputSchema = jsonClone(tool.parameters);
  return {
    name: tool.name,
    ...(tool.label ? { label: tool.label } : {}),
    description: tool.description,
    inputSchema,
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {})
  };
}

/** @internal Exported for evaluation-capture regression tests. */
export function buildAgentEvaluationSnapshot(
  systemPrompt: string,
  runtimeUserContent: UserMessage["content"],
  initialSessionContext: boolean,
  tools: readonly EvaluationToolSource[],
  capturedAt = new Date().toISOString(),
  conversationHistory: readonly AgentEvaluationHistoryMessage[] = []
): AgentEvaluationSnapshot {
  return {
    schemaVersion: 1,
    capturedAt,
    systemPrompt,
    runtimeContext: {
      kind: initialSessionContext ? "initial-session-context" : "turn-context",
      text: evaluationContextText(runtimeUserContent)
    },
    tools: tools.map(evaluationToolConfiguration),
    ...(conversationHistory.length > 0
      ? { conversationHistory: [...conversationHistory] }
      : {})
  };
}

/** Describes the tools exactly as the provider will receive them. */
export function providerVisibleEvaluationTools(
  systemPrompt: string,
  tools: AgentTool[],
  provider: string,
  toolSchemaProfile: Parameters<typeof applyProviderToolSchemaCompatibility>[2],
  portableToolSchemaProfile: PortableToolSchemaProfile
): EvaluationToolSource[] {
  const providerVisibleTools =
    applyProviderToolSchemaCompatibility(
      enforceProviderToolSchemaCompatibility({
        systemPrompt,
        messages: [],
        tools
      }),
      provider,
      toolSchemaProfile,
      portableToolSchemaProfile
    ).tools ?? tools;
  return providerVisibleTools.map((providerTool) => {
    const executableTool = tools.find(
      (candidate) => candidate.name === providerTool.name
    );
    return {
      name: providerTool.name,
      description: providerTool.description,
      parameters: providerTool.parameters,
      ...(executableTool?.label ? { label: executableTool.label } : {}),
      ...(executableTool?.executionMode
        ? { executionMode: executableTool.executionMode }
        : {})
    };
  });
}
