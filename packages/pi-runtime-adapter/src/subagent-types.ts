import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AgentTool,
  AgentMessage,
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AgentRuntimeRef,
  AgentUsage,
  AgentUsageObservationStatus,
  AgentProviderRuntimeConfig,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import type {
  AgentTurnAttempt,
  AgentTurnRetrySchedule,
  AgentTurnRetryPolicyOptions
} from "./agent-turn-retry";

export type RuntimeSubagentDefinition = Omit<
  ShortAgentSubagentDefinition,
  "id"
> & {
  id: string;
  contextMode?: "isolated" | "parent-snapshot";
  toolSource?: "writing" | "library-management";
};
export interface AgentToolExecutionHooks {
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal
  ) => Promise<AfterToolCallResult | undefined>;
}

export type SubagentProjectedActivity =
  | ({ type: "turn_started" } & AgentTurnAttempt)
  | ({ type: "retry_scheduled" } & AgentTurnRetrySchedule)
  | { type: "thinking_delta"; delta: string }
  | { type: "message_delta"; delta: string }
  | {
      type: "tool_requested";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_completed";
      toolCallId: string;
      toolName: string;
      resultSummary: string;
      isError: boolean;
    };

export interface SubagentProgressBase {
  parentToolCallId: string;
  subagentRunId: string;
  subagentId: string;
  name: string;
  /**
   * The child can use a custom model different from its parent. Older progress
   * payloads do not contain this field, so projection retains a parent-runtime
   * fallback for backward compatibility.
   */
  runtime?: AgentRuntimeRef;
}

export type SubagentToolProgress =
  | (SubagentProgressBase & {
      type: "started";
      task: string;
    })
  | (SubagentProgressBase & {
      type: "activity";
      activity: SubagentProjectedActivity;
    })
  | (SubagentProgressBase & {
      type: "completed";
      status: "completed" | "error" | "aborted";
      summary: string;
      errorMessage?: string;
      usage?: AgentUsage;
    })
  | (SubagentProgressBase & {
      type: "usage_observed";
      observationId: string;
      observedAt: string;
      messageId: string;
      turnId: string;
      attempt: number;
      status: AgentUsageObservationStatus;
      hadToolCall: boolean;
      usage: AgentUsage;
      runtime: AgentRuntimeRef;
    })
  | (SubagentProgressBase & {
      type: "child_tool_details";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    });

export type SubagentToolDetails =
  | { kind: "subagent-progress"; progress: SubagentToolProgress }
  | { kind: "subagent-result" };

export function isSubagentToolProgressDetails(
  value: unknown
): value is Extract<SubagentToolDetails, { kind: "subagent-progress" }> {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "subagent-progress" &&
    "progress" in value
  );
}

export interface BuildSpawnSubagentToolInput {
  parentSessionId: string;
  /** Parent run lifetime, independent of the SDK's individual tool invocation. */
  parentSignal?: AbortSignal;
  /** Runtime attribution inherited by children using `modelMode: inherit`. */
  parentRuntime?: AgentRuntimeRef;
  model: Model<Api>;
  thinkingLevel: PiThinkingLevel;
  streamFn: StreamFn;
  definitions: readonly RuntimeSubagentDefinition[];
  getParentMessages?: () => readonly AgentMessage[];
  /** Runtime-owned requirements appended after the editable child role prompt. */
  systemPromptRequirements?: string;
  /**
   * Resolved provider configs keyed by model config id, for subagents with
   * `modelMode: "custom"`.
   */
  subagentRuntimeConfigs?: Readonly<Record<string, AgentProviderRuntimeConfig>>;
  /**
   * Builds a child model + stream from a custom runtime config. Required when
   * any enabled definition uses `modelMode: "custom"`.
   */
  buildCustomModelRuntime?: (
    config: AgentProviderRuntimeConfig,
    options?: {
      thinkingLevel?: ShortAgentSubagentDefinition["thinkingLevel"];
      temperature?: ShortAgentSubagentDefinition["temperature"];
    }
  ) => {
    model: Model<Api>;
    streamFn: StreamFn;
    thinkingLevel: PiThinkingLevel;
  };
  buildChildTools: () => AgentTool[];
  prepareChild?: (
    definition: RuntimeSubagentDefinition,
    libraryId: string | undefined,
    signal?: AbortSignal
  ) => Promise<{ tools: AgentTool[]; systemPrompt: string }>;
  toolExecutionHooks?: AgentToolExecutionHooks;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  timeoutMs?: number;
  depth?: number;
  createRunId?: () => string;
}
