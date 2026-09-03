import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  parseCatalogDraftDocumentId
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalLaneContext } from "./types";

export function createProvisionalSectionHelpers(ctx: ProposalLaneContext) {
  const { liveWorkspaceDocuments } = ctx;

  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (
    ...args
  ) => ctx.removeQueuedAgentEdit(...args);
  const acceptedProvisionalExpertSectionIds = new Map<
    string,
    Map<string, string>
  >();
  ctx.acceptedProvisionalExpertSectionIds = acceptedProvisionalExpertSectionIds;

  function provisionalExpertSectionMapKey(
    runId: string,
    workspaceId: string
  ): string {
    return `${runId}\u0000${workspaceId}`;
  }

  function rememberProvisionalExpertSectionMapping(
    runId: string,
    workspaceId: string,
    provisionalSectionId: string,
    realSectionId: string
  ): void {
    const key = provisionalExpertSectionMapKey(runId, workspaceId);
    const map =
      acceptedProvisionalExpertSectionIds.get(key) ?? new Map<string, string>();
    map.set(provisionalSectionId, realSectionId);
    acceptedProvisionalExpertSectionIds.set(key, map);
    while (acceptedProvisionalExpertSectionIds.size > 2_000) {
      const oldest = acceptedProvisionalExpertSectionIds.keys().next().value as
        string | undefined;
      if (!oldest) break;
      acceptedProvisionalExpertSectionIds.delete(oldest);
    }
  }

  function resolveProvisionalExpertSectionId(
    runId: string,
    workspaceId: string,
    sectionId: string
  ): string {
    if (!isProvisionalExpertDraftSectionId(sectionId)) return sectionId;
    return (
      acceptedProvisionalExpertSectionIds
        .get(provisionalExpertSectionMapKey(runId, workspaceId))
        ?.get(sectionId) ?? sectionId
    );
  }

  function findPendingDraftSectionCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionId: string
  ): AgentEditProposal | undefined {
    return conversation
      .listEditProposals(runId)
      .find((proposal) =>
        Boolean(
          proposal.draftSectionCreationTarget?.sections.some(
            (section) => section.provisionalSectionId === provisionalSectionId
          ) &&
          (proposal.status === "pending" ||
            proposal.status === "accepting" ||
            proposal.status === "error")
        )
      );
  }

  function remapProvisionalExpertSectionFileProposals(
    conversation: AgentConversationController,
    runId: string,
    workspaceId: string,
    mapping: ReadonlyMap<string, string>
  ): void {
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      if (
        proposal.status !== "pending" &&
        proposal.status !== "accepting" &&
        proposal.status !== "error"
      ) {
        continue;
      }
      for (const [provisionalSectionId, realSectionId] of mapping) {
        const provisionalBodyId =
          catalogDraftBodyDocumentId(provisionalSectionId);
        const provisionalStateId =
          catalogDraftCharacterStateDocumentId(provisionalSectionId);
        const fileKind =
          proposal.documentId === provisionalBodyId
            ? ("body" as const)
            : proposal.documentId === provisionalStateId
              ? ("character-state" as const)
              : undefined;
        if (!fileKind) continue;
        const realDocument = liveWorkspaceDocuments.value.find(
          (document) =>
            document.workspaceId === workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === realSectionId &&
            document.draftFileKind === fileKind
        );
        if (!realDocument) continue;
        conversation.updateEditProposal(runId, proposal.id, {
          documentId: realDocument.id,
          title: realDocument.title,
          provisionalExpertSection: false,
          baseRevision: proposal.predecessorProposalId
            ? (proposal.baseRevision ??
              createShortWorkspaceContentRevision(realDocument.content))
            : createShortWorkspaceContentRevision(realDocument.content),
          statusMessage:
            proposal.statusMessage ??
            "已关联到新创建的章节文件，接受后将写入正文。"
        });
        break;
      }
    }
  }

  function restoreAcceptedDraftSectionCreationMappings(
    conversation: AgentConversationController
  ): void {
    for (const message of conversation.messages.value) {
      for (const proposal of message.editProposals ?? []) {
        if (
          proposal.status !== "accepted" ||
          !proposal.draftSectionCreationTarget
        ) {
          continue;
        }
        const mapping = new Map<string, string>();
        for (const section of proposal.draftSectionCreationTarget.sections) {
          if (!section.realSectionId) continue;
          mapping.set(section.provisionalSectionId, section.realSectionId);
          rememberProvisionalExpertSectionMapping(
            proposal.runId,
            proposal.workspaceId,
            section.provisionalSectionId,
            section.realSectionId
          );
        }
        if (mapping.size === 0) continue;
        remapProvisionalExpertSectionFileProposals(
          conversation,
          proposal.runId,
          proposal.workspaceId,
          mapping
        );
      }
    }
  }

  function pauseDependentProvisionalFileProposals(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void {
    const provisionalSet = new Set(provisionalSectionIds);
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      const parsed = parseCatalogDraftDocumentId(proposal.documentId);
      if (
        !parsed ||
        !provisionalSet.has(parsed.sectionId) ||
        (proposal.status !== "pending" &&
          proposal.status !== "accepting" &&
          proposal.status !== "error")
      ) {
        continue;
      }
      conversation.updateEditProposal(runId, proposal.id, {
        status: "pending",
        statusMessage: message
      });
    }
  }

  function conflictDependentProvisionalFileProposals(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void {
    const provisionalSet = new Set(provisionalSectionIds);
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      if (
        proposal.status !== "pending" &&
        proposal.status !== "accepting" &&
        proposal.status !== "error"
      ) {
        continue;
      }
      const matches = [...provisionalSet].some((sectionId) => {
        const bodyId = catalogDraftBodyDocumentId(sectionId);
        const stateId = catalogDraftCharacterStateDocumentId(sectionId);
        return (
          proposal.documentId === bodyId || proposal.documentId === stateId
        );
      });
      if (!matches) continue;
      removeQueuedAgentEdit(conversation, runId, proposal.id);
      conversation.updateEditProposal(runId, proposal.id, {
        status: "conflict",
        statusMessage: message,
        proposedText: undefined
      });
    }
  }

  return {
    rememberProvisionalExpertSectionMapping,
    resolveProvisionalExpertSectionId,
    findPendingDraftSectionCreationForProvisional,
    remapProvisionalExpertSectionFileProposals,
    restoreAcceptedDraftSectionCreationMappings,
    pauseDependentProvisionalFileProposals,
    conflictDependentProvisionalFileProposals
  };
}
