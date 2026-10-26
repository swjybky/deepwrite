import type { LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import { t } from "../../i18n";
import { getErrorCode, getErrorPayload } from "../../i18n/errors";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";

/** Core found a different text than the one the agent edited. */
export function isLongDocumentChanged(error: unknown): boolean {
  return getErrorCode(error) === "long.operation.document_changed";
}

/**
 * Holds a long file proposal for the user's choice and remembers the disk
 * hash Core reported, so a later overwrite replaces exactly that version.
 */
export function staleLongProposalPatch(
  proposal: Pick<AgentEditProposal, "staleBase">,
  error: unknown,
  detectedAt = new Date().toISOString()
): Partial<AgentEditProposal> {
  const details = getErrorPayload(error)?.details;
  const reported =
    typeof details?.fileId === "string" &&
    typeof details.actualSha256 === "string"
      ? { [details.fileId]: details.actualSha256 }
      : {};
  return {
    status: "pending",
    approvalMode: "request-approval",
    staleBase: {
      detectedAt: proposal.staleBase?.detectedAt ?? detectedAt,
      currentSha256ByFileId: {
        ...proposal.staleBase?.currentSha256ByFileId,
        ...reported
      }
    }
  };
}

/** True when this failure reports a file version the user has not seen. */
export function longStaleBaseChanged(
  proposal: Pick<AgentEditProposal, "staleBase">,
  error: unknown
): boolean {
  const details = getErrorPayload(error)?.details;
  return (
    typeof details?.fileId !== "string" ||
    proposal.staleBase?.currentSha256ByFileId?.[details.fileId] !==
      details.actualSha256
  );
}

/** Overwrite: expect the versions the user confirmed instead of the agent's. */
export function withConfirmedDocumentHashes(
  batch: LongWorkspaceOperationBatch,
  proposal: Pick<AgentEditProposal, "staleBase">
): LongWorkspaceOperationBatch {
  const confirmed = proposal.staleBase?.currentSha256ByFileId;
  if (!confirmed) return batch;
  return {
    ...batch,
    documentWrites: batch.documentWrites.map((write) => {
      const expectedSha256 = confirmed[write.fileId];
      return write.mode === "create" || expectedSha256 === undefined
        ? write
        : { ...write, expectedSha256 };
    })
  };
}

interface HoldStaleLongProposalInput {
  conversation: AgentConversationController;
  runId: string;
  proposal: AgentEditProposal;
  error: unknown;
  removeQueued(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): void;
  warn(message: string): void;
}

/**
 * Takes the proposal out of the save queue and waits for the user to keep
 * the current file (reject) or overwrite the version Core reported (accept).
 */
export function holdStaleLongProposal(input: HoldStaleLongProposalInput): void {
  const { conversation, runId, proposal, error } = input;
  input.removeQueued(conversation, runId, proposal.id);
  const changed = longStaleBaseChanged(proposal, error);
  conversation.updateEditProposal(
    runId,
    proposal.id,
    staleLongProposalPatch(proposal, error)
  );
  if (changed) {
    input.warn(
      t("workspace.proposalCoordinator.userEditedAgentTarget", {
        title: proposal.title
      })
    );
  }
}
