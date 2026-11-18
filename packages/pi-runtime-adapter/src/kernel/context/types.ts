import type {
  JsonObject,
  ToolCall,
  ToolResultMessage
} from "@earendil-works/pi-ai";
import type {
  AgentContextCompactionReason,
  ContextCheckpointRefs,
  ContextCompactionRequest,
  ContextCompactionRunSettings,
  ConversationCheckpoint
} from "@deepwrite/contracts";

export type ContextRefs = ContextCheckpointRefs;
export type ContextRefKind = keyof ContextRefs;

/**
 * Tells the compactor how one tool's old calls and results can shrink. The
 * kernel knows no tool; every domain registers compactors for its own tools.
 */
export interface ToolCompactor {
  /** Placeholder text for an old result; undefined keeps the result. */
  result?(
    result: ToolResultMessage,
    call: ToolCall | undefined
  ): string | undefined;
  /** Replacement arguments for an old call, e.g. prose bodies replaced by stubs. */
  args?(args: JsonObject): JsonObject | undefined;
  /** Business references recorded without asking the summary model. */
  refs?(
    call: ToolCall,
    result: ToolResultMessage | undefined
  ): Partial<Record<ContextRefKind, string[]>>;
}

/** What the summary must keep for one kind of work. */
export type ContextTaskKind =
  | "short-plot"
  | "short-character"
  | "short-draft"
  | "script"
  | "long"
  | "academic"
  | "mystery"
  | "library-skill"
  | "library-material"
  | "subagent-authoring"
  | "chat"
  | "roleplay"
  | "book-decomposition"
  | "book-decomposition-unit"
  | "general";

/**
 * A plan's opt-in to conversation compaction. Plans without a policy run
 * exactly as before: no pruning, no summaries, no overflow recovery.
 */
export interface ContextPolicy {
  settings: ContextCompactionRunSettings;
  task: ContextTaskKind;
  toolCompactors: Readonly<Record<string, ToolCompactor>>;
  /** Checkpoint persisted with the conversation, used when rebuilding it. */
  checkpoint?: ConversationCheckpoint;
  /** User-requested compaction before this reply. */
  manual?: ContextCompactionRequest;
  /** Evidence-reading children use only turn and overflow recovery. */
  thresholdCompaction?: boolean;
  /**
   * Summarize a split turn by continuing the run's own request, so the
   * provider can serve the shared prefix from its cache. Falls back to the
   * serialized summary when that request fails or calls a tool.
   */
  inPlaceSummary?: boolean;
  /**
   * Verbatim source content re-attached after a summary, e.g. the bodies of
   * skills loaded earlier. Returns undefined when nothing applies.
   */
  rehydrate?(
    refs: ContextRefs,
    budgetTokens: number
  ): string | undefined | Promise<string | undefined>;
}

export interface ContextCompactionOutcome {
  reason: AgentContextCompactionReason;
  level: "prune" | "summary";
  tokensBefore: number;
  tokensAfter: number;
  checkpoint?: ConversationCheckpoint;
}

export function emptyContextRefs(): ContextRefs {
  return { read: [], proposed: [], skills: [], materials: [] };
}
