import type {
  AgentMessage,
  AgentTool,
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  FauxResponseStep,
  Model,
  UserMessage
} from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeRef,
  ContextCompactionRequest,
  ContextCompactionRunSettings,
  ConversationCheckpoint,
  SessionConversationHistoryMessage,
  ThinkingLevel,
  UserPromptAttachment
} from "@deepwrite/contracts";
import type { PortableToolSchemaProfile } from "../portable-tool-schema";
import type { ContextPolicy } from "./context";
import type {
  AgentRunEventSource,
  AgentRuntimeEvent,
  AgentUserInputRequester
} from "../runtime-types";

/** Run identity and model settings shared by every agent domain. */
export interface AgentRunTarget {
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  runtimeConfig?: AgentProviderRuntimeConfig;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  webSearchEnabled?: boolean;
  attachments?: UserPromptAttachment[];
  conversationHistory?: SessionConversationHistoryMessage[];
  conversationHistoryMode?: "replace";
  /** Summary of turns older than `conversationHistory`. */
  conversationCheckpoint?: ConversationCheckpoint;
  /** User-requested compaction before this reply. */
  contextCompaction?: ContextCompactionRequest;
  /** Main-resolved compaction settings; absent means compaction is off. */
  contextCompactionSettings?: ContextCompactionRunSettings;
  /** Dedicated summary model, when configured. */
  compactionRuntimeConfig?: AgentProviderRuntimeConfig;
}

/** Model-dependent values available while a domain assembles its run. */
export interface AgentRunBuildContext {
  model: Model<Api>;
  thinkingLevel: PiThinkingLevel;
  runtime: AgentRuntimeRef;
  spawnStreamFn: StreamFn;
  parentSignal: AbortSignal;
  requestUserInput: AgentUserInputRequester;
  getParentMessages(): readonly AgentMessage[];
  /**
   * Registers a callback for when a summary removed earlier tool output from
   * the context, so tools can forget which documents were fully read.
   */
  onContextCompacted(listener: () => void): void;
}

export interface AgentRunAssembly {
  systemPrompt: string;
  tools: AgentTool[];
}

/**
 * Domain-specific assembly consumed by the shared run kernel. The kernel owns
 * model access, retries, timeouts, tool streaming and event emission; a plan
 * only decides what the agent is told and which tools it may call.
 */
export interface AgentRunPlan {
  target: AgentRunTarget;
  /** Coordinates and annotations applied to every emitted runtime event. */
  eventSource: AgentRunEventSource;
  /** Reuses the cached conversation agent under this key; omit for one-shot runs. */
  agentKey?: string;
  portableToolSchemaProfile: PortableToolSchemaProfile;
  fauxResponses(thinkingLevel: PiThinkingLevel): FauxResponseStep[];
  assertModelBudget?(model: Model<Api>): void;
  /**
   * Opts the run into conversation compaction. Plans without a policy are
   * never pruned, summarized or recovered from context overflow.
   */
  contextPolicy?: ContextPolicy;
  build(context: AgentRunBuildContext): AgentRunAssembly;
  /** `firstTurn` is true when the agent has no prior transcript. */
  userMessageContent(firstTurn: boolean): UserMessage["content"];
  /** The user's own words without workspace context, for later pruning. */
  rawUserMessageContent?(): UserMessage["content"];
  /** Requires a successful unified output event; missing submissions get nudged. */
  requiredOutputTool?: string;
  /**
   * Events derived from the final message, emitted before it. A derived
   * `agent.error` replaces the completion.
   */
  completionEvents?(
    completed: Extract<AgentRuntimeEvent, { type: "agent.completed" }>
  ): AgentRuntimeEvent[];
}
