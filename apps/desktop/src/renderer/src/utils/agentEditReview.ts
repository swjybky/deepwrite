import {
  createShortWorkspaceContentRevision,
  type WorkspaceEditorMutationPayload
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../types/conversation";

export type AgentEditAcceptance =
  | "ready"
  | "already-applied"
  | "conflict"
  | "missing-proposed-text";

export function agentEditProposalId(
  runId: string,
  workspaceId: string,
  stageId: AgentEditProposal["stageId"],
  documentId: string
): string {
  return `${runId}:${workspaceId}:${stageId}:${encodeURIComponent(documentId)}`;
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
  if (mutation.stageId !== "draft") {
    return { error: "正文文件修改只能应用到正文目录。" };
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
