import {
  createShortWorkspaceContentRevision,
  type WorkspaceEditorMutationPayload
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../types/conversation";

export type AgentEditAcceptance =
  "ready" | "already-applied" | "conflict" | "missing-proposed-text";

export function agentEditProposalId(
  runId: string,
  workspaceId: string,
  stageId: AgentEditProposal["stageId"],
  documentId: string
): string {
  return `${runId}:${workspaceId}:${stageId}:${encodeURIComponent(documentId)}`;
}

export function agentEditProposalGenerationId(
  laneId: string,
  generation: number
): string {
  return generation <= 1 ? laneId : `${laneId}:generation:${generation}`;
}

export function agentEditProposalLaneId(proposal: AgentEditProposal): string {
  return proposal.laneId ?? proposal.id;
}

export function latestAgentEditProposalInLane(
  proposals: readonly AgentEditProposal[],
  laneId: string
): AgentEditProposal | undefined {
  return proposals
    .filter((proposal) => agentEditProposalLaneId(proposal) === laneId)
    .sort(
      (left, right) =>
        (right.generation ?? 1) - (left.generation ?? 1) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0];
}

export interface AgentEditProposalGeneration {
  id: string;
  laneId: string;
  generation: number;
  coalescesExisting: boolean;
  predecessorProposalId?: string;
}

export function resolveAgentEditProposalGeneration(
  laneId: string,
  existing: AgentEditProposal | undefined
): AgentEditProposalGeneration {
  const existingGeneration = existing?.generation ?? 1;
  if (
    existing &&
    (existing.status === "pending" || existing.status === "error")
  ) {
    return {
      id: existing.id,
      laneId,
      generation: existingGeneration,
      coalescesExisting: true,
      ...(existing.predecessorProposalId
        ? { predecessorProposalId: existing.predecessorProposalId }
        : {})
    };
  }
  const generation = existing ? existingGeneration + 1 : 1;
  return {
    id: agentEditProposalGenerationId(laneId, generation),
    laneId,
    generation,
    coalescesExisting: false,
    ...(existing ? { predecessorProposalId: existing.id } : {})
  };
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

export function resolveAgentEditorMutationText(
  _baseText: string,
  mutation: Pick<
    WorkspaceEditorMutationPayload,
    "stageId" | "text" | "mutationTarget"
  >
): { text: string } | { error: string } {
  const target = mutation.mutationTarget;
  if (!target) return { text: mutation.text };
  if (target.kind.startsWith("expert-draft") && mutation.stageId !== "draft") {
    return { error: "正文文件修改只能应用到正文目录。" };
  }
  if (
    target.kind.startsWith("character-") &&
    mutation.stageId !== "character_design"
  ) {
    return { error: "人物文件修改只能应用到人物设计阶段。" };
  }
  return { text: mutation.text };
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
