import type {
  AgentRuntimeRef,
  AgentUsage,
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
  runId: string;
  workspaceId: string;
  stageId: ShortWorkspaceStageId;
  documentId: string;
  title: string;
  summary: string;
  status:
    | "pending"
    | "accepting"
    | "accepted"
    | "rejected"
    | "conflict"
    | "error";
  baseRevision: string;
  proposedRevision: string;
  proposedText?: string | undefined;
  toolCallIds: string[];
  additions: number;
  deletions: number;
  hunks: AgentTextDiffHunk[];
  truncated?: boolean;
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
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
  editProposals?: AgentEditProposal[];
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

export interface ComposerReferenceOption {
  id: string;
  label: string;
  detail: string;
}

export interface EditorTextReference {
  id: string;
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
