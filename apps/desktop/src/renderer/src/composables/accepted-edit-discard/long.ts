import { getErrorCode } from "../../i18n/errors";
import type { AgentEditProposal } from "../../types/conversation";
import { replaceLongBookSummary } from "../../types/longWorkspace";
import type { ProposalCoordinatorContext } from "../proposal-coordinator/types";

function longProposalBookId(proposal: AgentEditProposal): string | undefined {
  return (
    proposal.longPlotDesignTarget?.bookId ??
    proposal.longWorldbuildingTarget?.bookId ??
    proposal.longCharacterTarget?.bookId ??
    proposal.longDraftTarget?.bookId
  );
}

export function isLongRestoreConflict(error: unknown): boolean {
  return getErrorCode(error) === "long.operation.restore_conflict";
}

/**
 * Undo an accepted long-form batch from the restore point Core kept for it.
 * Returns false when the proposal is not a long-form edit with one.
 */
export async function discardAcceptedLongEdit(
  context: Pick<ProposalCoordinatorContext, "api" | "longWorkspace">,
  proposal: AgentEditProposal
): Promise<boolean> {
  const restorePointId = proposal.discardSnapshot?.longRestorePointId;
  const bookId = longProposalBookId(proposal);
  if (!restorePointId || !bookId) return false;
  const api = context.api()?.long;
  if (!api) throw new Error("Long workspace service is unavailable.");
  const result = await api.restoreOperations({ bookId, restorePointId });
  context.longWorkspace.books.value = replaceLongBookSummary(
    context.longWorkspace.books.value,
    result.summary
  );
  await context.longWorkspace.refreshWorkspaceAfterProposal(bookId);
  return true;
}
