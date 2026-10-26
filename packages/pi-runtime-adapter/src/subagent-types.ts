import type { ContextPolicy } from "./kernel/context";
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
import type { Api, Model, FauxResponseStep } from "@earendil-works/pi-ai";
import type {
  AgentRuntimeRef,
  AgentUsage,
  AgentUsageObservationStatus,
  AgentProviderRuntimeConfig,
  ShortAgentSubagentDefinition,
  SubagentAgentMode,
  SubagentDrawRef,
  SubagentDrawUpdatedPayload
} from "@deepwrite/contracts";
import type { AgentUserInputRequester } from "./runtime-types";
import type {
  AgentTurnAttempt,
  AgentTurnRetrySchedule,
  AgentTurnRetryPolicyOptions
} from "./agent-turn-retry";

export type RuntimeSubagentDefinition = Omit<
  ShortAgentSubagentDefinition,
  "id" | "agentMode"
> & {
  id: string;
  /** Absent means `standard`; library managers are always `standard`. */
  agentMode?: SubagentAgentMode;
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

/** How many draws one task runs, and in auto-count mode what each is for. */
export interface SubagentDrawPlan {
  count: number;
  /** One parent-written requirement per draw; absent in fixed mode. */
  variants?: string[];
}

/** One validated entry of a `spawn_subagent` task list. */
export interface SubagentTaskRequest {
  index: number;
  key: string;
  definition: RuntimeSubagentDefinition;
  task: string;
  libraryId?: string;
  dependsOn: string[];
  /** Library managers own their tools and never run beside another task. */
  exclusive?: boolean;
  /** Present when the task runs as a draw; otherwise one ordinary run. */
  draw?: SubagentDrawPlan;
}

export type SubagentTaskStatus = "completed" | "error" | "aborted" | "skipped";

export interface SubagentTaskOutcome {
  status: SubagentTaskStatus;
  summary: string;
}

export interface SubagentBatchTaskRef {
  index: number;
  key: string;
  dependsOn: string[];
}

/** A task of a multi-task call as the scheduler will run it. */
export interface SubagentPlannedTaskRef extends SubagentBatchTaskRef {
  subagentId: string;
  name: string;
  task: string;
  runtime: AgentRuntimeRef;
  drawCount?: number;
}

export interface SubagentProgressBase {
  parentToolCallId: string;
  subagentRunId: string;
  subagentId: string;
  name: string;
  batchTask?: SubagentBatchTaskRef;
  /**
   * The child can use a custom model different from its parent. Older progress
   * payloads do not contain this field, so projection retains a parent-runtime
   * fallback for backward compatibility.
   */
  runtime?: AgentRuntimeRef;
  /** Set on the candidates and the evaluator of a draw-mode task. */
  draw?: SubagentDrawRef;
}

export type SubagentToolProgress =
  | {
      /** Emitted once, before the first child of a multi-task call starts. */
      type: "planned";
      parentToolCallId: string;
      tasks: SubagentPlannedTaskRef[];
    }
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
      status: SubagentTaskStatus;
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
  | ({ type: "draw_updated" } & Omit<
      SubagentDrawUpdatedPayload,
      "sessionId" | "runId"
    >)
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
  /** Runtime-owned requirements; factories resolve the live view at child startup. */
  systemPromptRequirements?: string | (() => string);
  /** Read-only variant, also resolved at child startup, without any write rules. */
  pureReadSystemPromptRequirements?: string | (() => string);
  /** Material directory for ordinary team members, never library managers. */
  materialContext?: string;
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
  buildChildTools: (
    onContextCompacted?: (listener: () => void) => void
  ) => AgentTool[];
  /** Whether the main agent has search; members in `inherit` mode follow it. */
  mainWebSearch?: boolean;
  prepareChild?: (
    definition: RuntimeSubagentDefinition,
    libraryId: string | undefined,
    signal?: AbortSignal,
    request?: SubagentTaskRequest
  ) => Promise<{
    tools: AgentTool[];
    systemPrompt: string;
    /**
     * Replaces the parent's task text as the child's request, e.g. with
     * system-assembled evidence ahead of it. Progress events keep the
     * parent's text.
     */
    task?: string;
    contextPolicy?: ContextPolicy;
    fauxResponses?: FauxResponseStep[];
  }>;
  toolExecutionHooks?: AgentToolExecutionHooks;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  /**
   * Compaction for child runs: only between turns of a long run and after a
   * context overflow, never by threshold, since the child's reply is short.
   */
  contextPolicy?: ContextPolicy;
  timeoutMs?: number;
  depth?: number;
  createRunId?: () => string;
  /**
   * Team-wide parallel mode: independent tasks run concurrently, and their
   * writes to the work are serialized by a shared lock.
   */
  parallel?: boolean;
  /** Extras tasks use dedicated, authorized submissions and never touch the work's write tools. */
  workspaceAccess?: "workspace" | "none";
  /** Asks the user to pick a draw candidate; queued per parent run. */
  requestUserInput?: AgentUserInputRequester;
}
