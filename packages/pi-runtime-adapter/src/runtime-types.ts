import type { LibraryAgentCommandExecutor } from "./library-agent-tools/domain-tools";
import type {
  TeamManagementRuntimeContext,
  AgentTeamPromptReview,
  LibraryManagementRuntimeContext,
  LibraryManagementScope
} from "@deepwrite/contracts";
import type { LibraryManagementCommandExecutor } from "./library-management-runtime";
import type { TeamManagementCommandExecutor } from "./team-management-runtime";
import type {
  AgentContextCompactionPayload,
  AgentEvaluationSnapshot,
  AgentProviderRuntimeConfig,
  AgentRuntimeRef,
  AgentUsage,
  AgentUsageObservationStatus,
  SubagentBatchTask,
  SubagentDrawRef,
  SubagentDrawUpdatedPayload,
  SubagentPlannedTask,
  AgentWriteApprovalMode,
  PromptLocale,
  ProposalSettlements,
  ContextCompactionRequest,
  ContextCompactionRunSettings,
  ConversationCheckpoint,
  AgentUserInputDraw,
  AgentUserInputQuestion,
  AgentUserInputSource,
  SessionUserInputResponsePayload,
  SteeringAttachmentSummary,
  LibraryAgentProfile,
  LongAgentProfile,
  ScriptWorkspaceAgentProfile,
  SessionConversationHistoryMessage,
  ShortAgentSubagentDefinition,
  ShortWorkspaceAgentProfile,
  SubagentActivity,
  ThinkingLevel as ConfiguredThinkingLevel,
  UserPromptAttachment,
  WebSearchRuntimeConfig,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { AgentTurnRetryPolicyOptions } from "./agent-turn-retry";
import type { LongCommandExecutor } from "./long-agent-tools";
import type { MaterialCommandExecutor } from "./material-query-runtime";
import type { ShortWorkspaceToolDetails } from "./short-agent-tools";
import type { AgentToolExecutionHooks } from "./subagent-runtime";

export interface AgentRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  conversationHistory?: SessionConversationHistoryMessage[];
  conversationHistoryMode?: "replace";
  conversationCheckpoint?: ConversationCheckpoint;
  contextCompaction?: ContextCompactionRequest;
  contextCompactionSettings?: ContextCompactionRunSettings;
  compactionRuntimeConfig?: AgentProviderRuntimeConfig;
  attachments?: UserPromptAttachment[];
  /** Main-resolved web search settings; present only when search is on and configured. */
  webSearch?: WebSearchRuntimeConfig;
  /** The user's switch for this run: whether the main agent itself may search. */
  webSearchEnabled?: boolean;
  writeApprovalMode?: AgentWriteApprovalMode;
  /** Main-resolved system prompt language; absent means Chinese. */
  promptLocale?: PromptLocale;
  /** Outcomes of earlier proposals, rendered into this turn's user message. */
  proposalSettlements?: ProposalSettlements;
  autoApproveCrossStageOperations?: boolean;
  thinkingLevel?: ConfiguredThinkingLevel;
  temperature?: number;
  runtimeConfig?: AgentProviderRuntimeConfig;
  agentProfile?: ShortWorkspaceAgentProfile;
  scriptAgentProfile?: ScriptWorkspaceAgentProfile;
  longAgentProfile?: LongAgentProfile;
  subagentDefinitions?: ShortAgentSubagentDefinition[];
  subagentRuntimeConfigs?: Readonly<Record<string, AgentProviderRuntimeConfig>>;
  /** The enabled team runs independent delegated tasks concurrently. */
  parallelSubagents?: boolean;
  libraryAgentProfile?: LibraryAgentProfile;
  libraryAgentCommandExecutor?: LibraryAgentCommandExecutor;
  libraryManagement?: LibraryManagementRuntimeContext;
  libraryManagementCommandExecutor?: LibraryManagementCommandExecutor;
  teamManagement?: TeamManagementRuntimeContext;
  teamManagementCommandExecutor?: TeamManagementCommandExecutor;
  workspaceContext?: WorkspaceRuntimeContext;
  /**
   * Narrow Agent Utility -> Core query bridge for the active long-form book.
   * Proposal tools never use this callback for mutation commands.
   */
  longCommandExecutor?: LongCommandExecutor;
  materialCommandExecutor?: MaterialCommandExecutor;
  signal?: AbortSignal;
}

/** Run coordinates, plus the context runtime-event mapping may annotate. */
export type AgentRunEventSource = Pick<
  AgentRunInput,
  "runId" | "sessionId" | "libraryManagement"
>;

export interface AgentUserInputRequest {
  toolCallId: string;
  source: AgentUserInputSource;
  questions: AgentUserInputQuestion[];
  /** Candidates of a `subagent_draw` request. */
  draw?: AgentUserInputDraw;
  promptReview?: AgentTeamPromptReview;
}

export type AgentUserInputRequester = (
  request: AgentUserInputRequest,
  signal?: AbortSignal
) => Promise<SessionUserInputResponsePayload>;

export type AgentRuntimeEvent =
  | {
      type: "agent.evaluation_snapshot";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        snapshot: AgentEvaluationSnapshot;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.turn_started";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        turnId: string;
        attempt: number;
        maxAttempts: number;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.retry_scheduled";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        turnId: string;
        failedAttempt: number;
        nextAttempt: number;
        maxAttempts: number;
        delayMs: number;
        retryAt: string;
        reason: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.context_compaction";
      runId: string;
      sessionId: string;
      payload: Omit<AgentContextCompactionPayload, "runId" | "sessionId">;
    }
  | {
      type: "agent.delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.thinking_delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.completed";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        content: string;
        thinking?: string;
        stopReason?: string;
        usage?: AgentUsage;
        runtime: AgentRuntimeRef;
      };
    }
  /**
   * Internal accounting signal emitted once for every provider-returned
   * assistant message. Unlike `agent.completed`, this also includes tool-call
   * turns and retryable error attempts.
   */
  | {
      type: "agent.usage_observed";
      runId: string;
      sessionId: string;
      payload: {
        observationId: string;
        observedAt: string;
        messageId: string;
        turnId: string;
        attempt: number;
        status: AgentUsageObservationStatus;
        hadToolCall: boolean;
        usage: AgentUsage;
        runtime: AgentRuntimeRef;
        parentToolCallId?: string;
        subagentRunId?: string;
        subagentId?: string;
      };
    }
  | {
      type: "agent.tool_stream";
      runId: string;
      sessionId: string;
      payload: {
        streamId: string;
        toolCallId?: string;
        toolName?: string;
        phase: "start" | "delta" | "end";
        argumentsDelta: string;
        /**
         * Provider-side cumulative argument text. This stays inside the runtime
         * adapter and is reduced to argumentsDelta before crossing IPC.
         */
        argumentsSnapshot?: string;
        args?: unknown;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.tool_requested";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        toolName: string;
        args: unknown;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.tool_completed";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        toolName: string;
        resultSummary: string;
        isError: boolean;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.user_input_requested";
      runId: string;
      sessionId: string;
      payload: {
        requestId: string;
        toolCallId: string;
        source: AgentUserInputSource;
        questions: AgentUserInputQuestion[];
        draw?: AgentUserInputDraw;
        promptReview?: AgentTeamPromptReview;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.steering_delivered";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        steerId: string;
        content: string;
        attachments?: SteeringAttachmentSummary[];
        deliveredAt: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "subagent.started";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        task: string;
        runtime: AgentRuntimeRef;
        batchTask?: SubagentBatchTask;
        draw?: SubagentDrawRef;
      };
    }
  | {
      type: "subagent.planned";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        tasks: SubagentPlannedTask[];
      };
    }
  | {
      type: "subagent.activity";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        activity: SubagentActivity;
        runtime: AgentRuntimeRef;
        draw?: SubagentDrawRef;
      };
    }
  | {
      type: "subagent.completed";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        status: "completed" | "error" | "aborted" | "skipped";
        summary: string;
        errorMessage?: string;
        usage?: AgentUsage;
        runtime: AgentRuntimeRef;
        batchTask?: SubagentBatchTask;
        draw?: SubagentDrawRef;
      };
    }
  | {
      type: "subagent.draw_updated";
      runId: string;
      sessionId: string;
      payload: Omit<SubagentDrawUpdatedPayload, "sessionId" | "runId">;
    }
  | {
      type: "workspace.editor_mutation";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        workspaceId: string;
        stageId: import("@deepwrite/contracts").ShortWorkspaceStageId;
        text: string;
        mutationTarget?:
          | {
              kind: "expert-draft-file";
              documentId: string;
              sectionId: string;
              fileKind: "body" | "characterState";
            }
          | {
              kind: "expert-draft-section-creation";
              sections: Array<{
                title: string;
                wordCountRequirement: string;
                provisionalSectionId: string;
                bodyContent?: string;
                characterStateContent?: string;
              }>;
              afterSectionId?: string;
            }
          | {
              kind: "expert-draft-section-rename";
              sectionId: string;
              previousTitle: string;
              title: string;
            }
          | {
              kind: "expert-draft-section-deletion";
              sectionId: string;
              title: string;
            }
          | {
              kind: "character-file";
              documentId: string;
              itemId?: string;
            }
          | {
              kind: "character-structure";
              initialContent?: string;
              mutation: Extract<
                ShortWorkspaceToolDetails,
                { kind: "workspace-character-structure-mutation" }
              >["mutation"];
            }
          | {
              kind: "plot-structure";
              mutation: Extract<
                ShortWorkspaceToolDetails,
                { kind: "workspace-plot-structure-mutation" }
              >["mutation"];
            };
        baseRevision: string;
        summary: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "workspace.stage_selection";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        workspaceId: string;
        stageId: import("@deepwrite/contracts").ShortWorkspaceStageId;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.mutation_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch;
        summary: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.worldbuilding_file_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch;
        summary: string;
        files: import("@deepwrite/contracts").LongWorldbuildingFileChange[];
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.character_file_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch;
        summary: string;
        files: import("@deepwrite/contracts").LongCharacterFileChange[];
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.continuity_file_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch;
        summary: string;
        files: import("@deepwrite/contracts").LongContinuityFileChange[];
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.chapter_write_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch;
        file: import("@deepwrite/contracts").LongChapterBodyChange;
        summary: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "long.ledger_commit_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        bookId: string;
        agentId: import("@deepwrite/contracts").LongAgentId;
        input: import("@deepwrite/contracts").LongCommitChapterInput;
        summary: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "library.structure_proposal";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        plan: import("@deepwrite/contracts").LibraryStructurePlan;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "library.editor_mutation";
      runId: string;
      sessionId: string;
      payload:
        | {
            toolCallId: string;
            operation: "create";
            domain: "material" | "skill";
            libraryId: string;
            managementScope?: LibraryManagementScope;
            creationId?: string;
            stageId: string;
            title: string;
            text: string;
            baseRevision: string;
            baseProjectRevision?: number;
            summary: string;
            runtime: AgentRuntimeRef;
          }
        | {
            toolCallId: string;
            operation: "edit";
            domain: "material" | "skill";
            libraryId: string;
            managementScope?: LibraryManagementScope;
            creationId?: string;
            entryId: string;
            documentId: string;
            stageId: string;
            title: string;
            text: string;
            baseRevision: string;
            baseProjectRevision?: number;
            summary: string;
            runtime: AgentRuntimeRef;
          }
        | {
            toolCallId: string;
            operation: "edit-overview";
            domain: "material" | "skill";
            libraryId: string;
            managementScope?: LibraryManagementScope;
            creationId?: string;
            documentId: string;
            title: string;
            text: string;
            baseRevision: string;
            baseProjectRevision?: number;
            summary: string;
            runtime: AgentRuntimeRef;
          };
    }
  | {
      type: "extras_agent.output_updated";
      runId: string;
      sessionId: string;
      payload: {
        agentId: import("@deepwrite/contracts").ExtrasAgentId;
        jobId: string;
        /** Absent when the output was parsed from the final message. */
        toolCallId?: string;
        output: import("@deepwrite/contracts").ExtrasAgentOutput;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "subagent_authoring.draft_updated";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        draft: import("@deepwrite/contracts").SubagentAuthoringDraft;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.error";
      runId: string;
      sessionId: string;
      payload: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        runtime?: AgentRuntimeRef;
      };
    };

export interface AgentRuntime {
  describe(): AgentRuntimeRef;
  start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}

export interface PiRuntimeAdapterOptions extends AgentToolExecutionHooks {
  idleTimeoutMs?: number;
  subagentTimeoutMs?: number;
  tokensPerSecond?: number;
  systemPrompt?: string;
  evaluationMode?: boolean;
  retryPolicy?: AgentTurnRetryPolicyOptions;
}
