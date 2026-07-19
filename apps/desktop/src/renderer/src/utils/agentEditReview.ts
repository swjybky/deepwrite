import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../types/conversation";

export type AgentEditAcceptance =
  | "ready"
  | "already-applied"
  | "conflict"
  | "missing-proposed-text";

export function agentEditProposalId(
  runId: string,
  workspaceId: string,
  stageId: AgentEditProposal["stageId"]
): string {
  return `${runId}:${workspaceId}:${stageId}`;
}

export function expectedMutationBaseRevision(
  existingProposal: AgentEditProposal | undefined,
  currentText: string
): string {
  return (
    existingProposal?.proposedRevision ??
    createShortWorkspaceContentRevision(currentText)
  );
}

export function classifyAgentEditAcceptance(
  proposal: AgentEditProposal,
  currentText: string
): AgentEditAcceptance {
  if (typeof proposal.proposedText !== "string") {
    return "missing-proposed-text";
  }

  const currentRevision = createShortWorkspaceContentRevision(currentText);
  if (currentRevision === proposal.proposedRevision) {
    return "already-applied";
  }
  if (currentRevision === proposal.baseRevision) {
    return "ready";
  }
  return "conflict";
}
