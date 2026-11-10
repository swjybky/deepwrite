import { getErrorCode } from "../../i18n/errors";
import { t } from "../../i18n";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { LongWorkspaceRendererApi } from "../../types/longWorkspace";
import type { AgentConversationController } from "../useAgentConversation";

interface ManualReviewInput {
  conversation: AgentConversationController;
  runId: string;
  proposalId: string;
  patch: Partial<AgentEditProposal>;
  statusMessage: string;
  notificationMessage: string;
  removeQueued(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): void;
  notify(message: string): void;
}

interface HoldForManualReviewInput extends ManualReviewInput {
  automatic: boolean;
  hadExpectedImpact: boolean;
}

export function moveLongProposalToManualReview(input: ManualReviewInput): void {
  input.removeQueued(input.conversation, input.runId, input.proposalId);
  input.conversation.updateEditProposal(input.runId, input.proposalId, {
    ...input.patch,
    status: "pending",
    approvalMode: "request-approval",
    statusMessage: input.statusMessage
  });
  input.notify(input.notificationMessage);
}

/**
 * A manual proposal shows its impact once before the user confirms it. An
 * automatic proposal is saved directly, deletions included: the user already
 * chose automatic saving, and destructive batches keep a restore point so the
 * card can undo them. Holding them here would stall every later edit queued
 * behind them in the same lane.
 */
export function holdLongProposalForManualReview(
  input: HoldForManualReviewInput
): boolean {
  if (input.hadExpectedImpact || input.automatic) return false;
  moveLongProposalToManualReview(input);
  return true;
}

export function isLongImpactMismatch(error: unknown): boolean {
  return getErrorCode(error) === "long.operation.impact_mismatch";
}

export async function previewLongProposalImpact(
  api: Pick<LongWorkspaceRendererApi, "previewOperations">,
  bookId: string,
  batch: LongWorkspaceOperationBatch,
  label: string
): Promise<LongWorkspaceImpactConfirmation> {
  const preview = await api.previewOperations({ bookId, batch });
  if (preview.bookId !== bookId) {
    throw new Error(
      t(
        "workspace.longImpactApproval.theImpactPreviewForDoesNotMatchTheCurrent",
        { label: label }
      )
    );
  }
  return preview.preview.confirmation;
}
