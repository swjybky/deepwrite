import {
  createShortWorkspaceContentRevision,
  findExpertDraftSection,
  parseExpertDraftMarkdown,
  serializeExpertDraftMarkdown,
  updateExpertDraftSection,
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
  stageId: AgentEditProposal["stageId"]
): string {
  return `${runId}:${workspaceId}:${stageId}`;
}

export function expectedMutationBaseRevision(
  existingProposal: AgentEditProposal | undefined,
  currentText: string,
  targetedSectionMutation = false
): string {
  if (targetedSectionMutation) {
    return (
      existingProposal?.baseRevision ??
      createShortWorkspaceContentRevision(currentText)
    );
  }
  return (
    existingProposal?.proposedRevision ??
    createShortWorkspaceContentRevision(currentText)
  );
}

export function resolveAgentEditorMutationText(
  baseText: string,
  mutation: Pick<
    WorkspaceEditorMutationPayload,
    "stageId" | "text" | "mutationTarget"
  >
): { text: string } | { error: string } {
  const target = mutation.mutationTarget;
  if (!target) return { text: mutation.text };
  if (mutation.stageId !== "draft") {
    return { error: "分节修改只能应用到正文阶段。" };
  }

  const draft = parseExpertDraftMarkdown(baseText);
  const section = findExpertDraftSection(draft, target.sectionId);
  if (!section) {
    return { error: `正文小节 ${target.sectionId} 已不存在，本次修改未应用。` };
  }
  const nextDraft = updateExpertDraftSection(draft, target.sectionId, {
    [target.field]: mutation.text
  });
  return { text: serializeExpertDraftMarkdown(nextDraft) };
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
