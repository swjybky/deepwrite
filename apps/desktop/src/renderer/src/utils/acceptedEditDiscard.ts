import type { AgentEditProposal } from "../types/conversation";

export class AcceptedEditDiscardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptedEditDiscardConflictError";
  }
}

export function textEditDiscardSnapshot(
  existing: Pick<AgentEditProposal, "discardSnapshot"> | undefined,
  coalescesExisting: boolean,
  beforeText: string,
  beforeTitle: string
): NonNullable<AgentEditProposal["discardSnapshot"]> {
  return coalescesExisting && existing?.discardSnapshot
    ? existing.discardSnapshot
    : { beforeText, beforeTitle };
}

function isAgentCreationProposal(proposal: AgentEditProposal): boolean {
  return Boolean(
    Boolean(proposal.libraryStructureTarget) ||
    proposal.libraryTarget?.operation === "create" ||
    proposal.draftSectionCreationTarget ||
    proposal.characterStructureTarget?.mutation.type === "createItem" ||
    proposal.plotStructureTarget?.mutation.type === "create" ||
    proposal.provisionalExpertSection ||
    proposal.provisionalCharacterItemId
  );
}

export function agentProposalSupportsDiscard(
  proposal: AgentEditProposal
): boolean {
  if (
    proposal.longWorldbuildingTarget ||
    proposal.longCharacterTarget ||
    proposal.longPlotDesignTarget ||
    proposal.longDraftTarget
  ) {
    return (
      proposal.status === "accepted" &&
      proposal.discardState?.status !== "discarded" &&
      Boolean(proposal.discardSnapshot?.longRestorePointId)
    );
  }
  if (
    proposal.status !== "accepted" ||
    proposal.discardState?.status === "discarded" ||
    isAgentCreationProposal(proposal)
  ) {
    return false;
  }
  if (proposal.characterStructureTarget) {
    return proposal.characterStructureTarget.mutation.type === "updateItem"
      ? proposal.discardSnapshot?.beforeTitle !== undefined
      : proposal.characterStructureTarget.mutation.type === "moveItem" &&
          proposal.discardSnapshot?.appliedProjectRevision !== undefined;
  }
  if (proposal.plotStructureTarget) {
    return (
      proposal.plotStructureTarget.mutation.type === "update" &&
      proposal.discardSnapshot?.beforeTitle !== undefined &&
      proposal.discardSnapshot.beforeDescription !== undefined
    );
  }
  if (proposal.draftSectionRenameTarget) return true;
  return Boolean(
    proposal.discardSnapshot?.beforeText !== undefined &&
    (proposal.proposedRevision !== proposal.baseRevision ||
      proposal.title !== proposal.discardSnapshot.beforeTitle)
  );
}

export function discardStatePatch(
  status: NonNullable<AgentEditProposal["discardState"]>["status"],
  message: string
): NonNullable<AgentEditProposal["discardState"]> {
  return { status, message, updatedAt: new Date().toISOString() };
}
