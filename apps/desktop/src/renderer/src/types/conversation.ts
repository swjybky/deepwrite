import type { LibraryManagementScope } from "@deepwrite/contracts";
import type {
  AgentEvaluationSnapshot,
  AgentRuntimeRef,
  AgentUsage,
  CharacterStructureMutation,
  LongCharacterFileChange,
  LongChapterBodyChange,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch,
  LongWorldbuildingFileChange,
  ShortWorkspaceStageId
} from "@deepwrite/contracts";

export type AgentApprovalMode = "request-approval" | "auto-approve";

export interface AgentTextDiffLine {
  type: "context" | "addition" | "deletion";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface AgentTextDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: AgentTextDiffLine[];
}

export interface AgentEditProposal {
  id: string;
  /**
   * Stable logical target key. A new immutable proposal generation is created
   * when the agent writes the same file while an earlier generation is being
   * applied or has already been decided.
   */
  laneId?: string;
  /** Monotonic generation within `laneId` (legacy proposals default to 1). */
  generation?: number;
  /** Frozen run policy, retained so pending proposals can recover safely. */
  approvalMode?: AgentApprovalMode;
  /** Previous immutable generation that must land before this proposal. */
  predecessorProposalId?: string;
  /** Revision of the agent overlay from which this mutation was produced. */
  sourceBaseRevision?: string;
  /** Unique token assigned when this exact generation enters the commit queue. */
  decisionToken?: string;
  runId: string;
  workspaceId: string;
  stageId:
    | ShortWorkspaceStageId
    | "library"
    | "long-worldbuilding"
    | "long-character"
    | "long-plot-design"
    | "long-draft";
  documentId: string;
  title: string;
  summary: string;
  status:
    "pending" | "accepting" | "accepted" | "rejected" | "conflict" | "error";
  /** Short-form/editor checksum. Long-form proposals do not use revisions. */
  baseRevision?: string;
  /** Short-form/editor checksum. Long-form proposals use generation + predecessor. */
  proposedRevision?: string;
  proposedText?: string | undefined;
  toolCallIds: string[];
  additions: number;
  deletions: number;
  hunks: AgentTextDiffHunk[];
  truncated?: boolean;
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
  /** Immutable state needed to safely restore an accepted edit. */
  discardSnapshot?: {
    beforeText?: string;
    beforeTitle?: string;
    beforeDescription?: string;
    appliedProjectRevision?: number;
  };
  /** Presentation and retry state for restoring an accepted edit. */
  discardState?: {
    status: "discarding" | "discarded" | "conflict" | "error";
    message: string;
    updatedAt: string;
  };
  libraryTarget?: {
    managementScope?: LibraryManagementScope;
    libraryTitle?: string;
    operation: "create" | "edit" | "edit-overview";
    domain: "material" | "skill";
    libraryId: string;
    stageId?: string;
    baseProjectRevision?: number;
    entryId?: string;
  };
  longWorldbuildingTarget?: {
    bookId: string;
    batch: LongWorkspaceOperationBatch;
    file: LongWorldbuildingFileChange;
    expectedImpact?: LongWorkspaceImpactConfirmation;
  };
  longCharacterTarget?: {
    bookId: string;
    batch: LongWorkspaceOperationBatch;
    files: LongCharacterFileChange[];
    expectedImpact?: LongWorkspaceImpactConfirmation;
  };
  longPlotDesignTarget?: {
    bookId: string;
    batch: LongWorkspaceOperationBatch;
    expectedImpact?: LongWorkspaceImpactConfirmation;
  };
  longDraftTarget?: {
    bookId: string;
    batch: LongWorkspaceOperationBatch;
    file: LongChapterBodyChange;
    expectedImpact?: LongWorkspaceImpactConfirmation;
  };
  draftSectionCreationTarget?: {
    sections: Array<{
      title: string;
      wordCountRequirement: string;
      provisionalSectionId: string;
      bodyContent?: string;
      characterStateContent?: string;
      /** Persisted after atomic creation so recovery can rebuild the mapping. */
      realSectionId?: string;
    }>;
    afterSectionId?: string;
    /** Project revision captured when this idempotent creation was proposed. */
    baseProjectRevision?: number;
    /** Directory revision observed after this creation was durably confirmed. */
    acceptedDirectoryRevision?: string;
  };
  draftSectionRenameTarget?: {
    sectionId: string;
    previousTitle: string;
    title: string;
    /** Project revision captured when this rename was proposed. */
    baseProjectRevision?: number;
  };
  draftSectionDeletionTarget?: {
    sectionId: string;
    title: string;
    /** Project revision captured when this deletion was proposed. */
    baseProjectRevision?: number;
  };
  characterStructureTarget?: {
    mutation: CharacterStructureMutation;
    initialContent?: string;
    baseProjectRevision?: number;
  };
  plotStructureTarget?: {
    mutation:
      | {
          type: "create";
          title: string;
          description: string;
          provisionalStageId: string;
          content: string;
        }
      | {
          type: "update";
          stageId: ShortWorkspaceStageId;
          previousTitle: string;
          title: string;
          description: string;
        };
    baseProjectRevision?: number;
  };
  /** True when this file mutation targets a same-run provisional section. */
  provisionalExpertSection?: boolean;
  /** Stable item id for a same-run character create-then-write proposal. */
  provisionalCharacterItemId?: string;
}

export interface ChatToolActivity {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary?: string;
}

export interface ChatMessageAttachment {
  id: string;
  name: string;
  kind: "text" | "image";
  mediaType: string;
  size: number;
  truncated?: boolean;
}

export interface AgentToolTrace {
  id: string;
  streamId?: string;
  name: string;
  args: unknown;
  argumentsText?: string;
  argumentsComplete?: boolean;
  status: "preparing" | "running" | "completed" | "error";
  requestedAt: string;
  completedAt?: string;
  resultSummary?: string;
  isError?: boolean;
}

export type AgentSubagentRunStatus =
  "running" | "completed" | "error" | "stopped";

export interface AgentRetryMetadata {
  state: "scheduled" | "trying";
  turnId: string;
  attempt: number;
  maxAttempts: number;
  retryAt?: string;
  delayMs?: number;
  reason?: string;
}

export type AgentSubagentProcessingStep =
  | {
      id: string;
      type: "thinking";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "response";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "tool";
      toolCallId: string;
      createdAt: string;
    };

/**
 * Renderer-owned projection of one isolated child-agent session.
 *
 * The child output intentionally lives outside `ChatMessage.content`: the parent
 * model receives only the tool's final hand-off, while people can still inspect
 * the child run from the conversation card and from restored display history.
 */
export interface AgentSubagentRun {
  parentToolCallId: string;
  subagentRunId: string;
  subagentId: string;
  name: string;
  task: string;
  status: AgentSubagentRunStatus;
  runtime: AgentRuntimeRef;
  thinking?: string;
  output?: string;
  toolCalls: AgentToolTrace[];
  processingSteps: AgentSubagentProcessingStep[];
  startedAt: string;
  completedAt?: string;
  summary?: string;
  errorMessage?: string;
  usage?: AgentUsage;
  retry?: AgentRetryMetadata;
}

export type AgentProcessingStep =
  | {
      id: string;
      type: "thinking";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "response";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "tool";
      toolCallId: string;
      createdAt: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: ChatMessageAttachment[];
  runId?: string;
  thinking?: string;
  toolCalls?: AgentToolTrace[];
  processingSteps?: AgentProcessingStep[];
  processingStartedAt?: string;
  processingCompletedAt?: string;
  activityOnly?: boolean;
  status?: "streaming" | "completed" | "stopped" | "error";
  errorMessage?: string;
  runtime?: AgentRuntimeRef;
  usage?: AgentUsage;
  tools?: ChatToolActivity[];
  subagentRuns?: AgentSubagentRun[];
  editProposals?: AgentEditProposal[];
  retry?: AgentRetryMetadata;
  /** Present only for runs captured in the opt-in evaluation mode. */
  evaluationSnapshot?: AgentEvaluationSnapshot;
}

export interface ConversationHistoryItem {
  sessionId: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  turnCount: number;
  current: boolean;
}

export interface ConversationMessageRewriteRequest {
  messageId: string;
  content: string;
}

export interface ComposerReferenceOption {
  id: string;
  label: string;
  detail: string;
}

export interface EditorTextReference {
  id: string;
  source?: "editor" | "conversation";
  conversationMessageId?: string;
  resourceId: string;
  documentId: string;
  documentTitle: string;
  documentPath: string[];
  text: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  label: string;
}

export interface EditorTextReferenceNavigation {
  requestId: number;
  reference: EditorTextReference;
}
