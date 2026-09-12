import type {
  AgentApprovalMode,
  AgentEditProposal,
  ChatMessage
} from "../../types/conversation";
export interface ApprovalsOperations {
  acceptsRunEvent(eventSessionId: string, runId: string): boolean;
  rememberRunApprovalMode(runId: string, mode: AgentApprovalMode): void;
  approvalModeForRun(
    eventSessionId: string,
    runId: string
  ): AgentApprovalMode | undefined;
  markToolConflict(runId: string, toolCallId: string, summary: string): void;
  messageForEditProposal(runId: string): ChatMessage | undefined;
  ensureEditProposalMessage(runId: string, createdAt: string): ChatMessage;
  getEditProposal(
    runId: string,
    proposalId: string
  ): AgentEditProposal | undefined;
  listEditProposals(runId: string): AgentEditProposal[];
  upsertEditProposal(
    runId: string,
    proposal: AgentEditProposal
  ): AgentEditProposal;
  updateEditProposal(
    runId: string,
    proposalId: string,
    patch: Partial<AgentEditProposal>
  ): AgentEditProposal | undefined;
}
