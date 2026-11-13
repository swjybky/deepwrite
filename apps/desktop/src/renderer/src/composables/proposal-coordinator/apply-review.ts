import { conversationVersionOrigin } from "./version-origin";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import {
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  parseCatalogDraftDocumentId
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import {
  agentEditProposalId,
  classifyAgentEditAcceptance,
  resolveAgentEditProposalGeneration,
  resolveAgentEditorMutationText
} from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { captureWorkspaceDocumentBaselines } from "../../utils/catalogSaveReconciliation";
import { textEditDiscardSnapshot } from "../../utils/acceptedEditDiscard";
import { resolveProvisionalWriteStagingMode } from "../../utils/provisionalExpertSectionStaging";
import type { AgentConversationController } from "../useAgentConversation";
import { reconcileCreationDependencyAfterAttempt } from "./creation-dependency";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

const t = createScopedTranslator("workspace");

export function createApplyReview(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogSnapshot,
    findCatalogLibrary,
    loadCatalogSnapshot,
    applyAcceptedAgentDocumentLocally,
    applySavedLibraryEntry,
    applyUpdatedCatalogLibrary,
    isCatalogConflict,
    refreshBookAfterSuccessfulDocumentSave,
    documents,
    editorDrafts,
    liveWorkspaceDocuments,
    acceptingAgentEditWorkspaceIds,
    savingDocumentIds,
    rememberWorkspaceMutationEvent,
    setAgentEditDocumentAccepting,
    setAgentEditWorkspaceAccepting,
    activeConversation,
    activeLongConversation,
    allConversations
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);
  const canReviewAgentEditDuringRun: ProposalLaneContext["canReviewAgentEditDuringRun"] =
    (...args) => ctx.canReviewAgentEditDuringRun(...args);
  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (
    ...args
  ) => ctx.removeQueuedAgentEdit(...args);
  const blockLaterAgentEditGenerations: ProposalLaneContext["blockLaterAgentEditGenerations"] =
    (...args) => ctx.blockLaterAgentEditGenerations(...args);
  const latestProposalForLane: ProposalLaneContext["latestProposalForLane"] = (
    ...args
  ) => ctx.latestProposalForLane(...args);
  const blockedAgentEditLaneMessage: ProposalLaneContext["blockedAgentEditLaneMessage"] =
    (...args) => ctx.blockedAgentEditLaneMessage(...args);
  const resolveProvisionalExpertSectionId: ProposalLaneContext["resolveProvisionalExpertSectionId"] =
    (...args) => ctx.resolveProvisionalExpertSectionId(...args);
  const findPendingDraftSectionCreationForProvisional: ProposalLaneContext["findPendingDraftSectionCreationForProvisional"] =
    (...args) => ctx.findPendingDraftSectionCreationForProvisional(...args);
  const remapProvisionalExpertSectionFileProposals: ProposalLaneContext["remapProvisionalExpertSectionFileProposals"] =
    (...args) => ctx.remapProvisionalExpertSectionFileProposals(...args);
  const restoreAcceptedDraftSectionCreationMappings: ProposalLaneContext["restoreAcceptedDraftSectionCreationMappings"] =
    (...args) => ctx.restoreAcceptedDraftSectionCreationMappings(...args);
  const conflictDependentProvisionalFileProposals: ProposalLaneContext["conflictDependentProvisionalFileProposals"] =
    (...args) => ctx.conflictDependentProvisionalFileProposals(...args);
  const acceptLibraryCreationProposal: ProposalLaneContext["acceptLibraryCreationProposal"] =
    (...args) => ctx.acceptLibraryCreationProposal(...args);
  const currentLibraryProjectRevisionMatches: ProposalLaneContext["currentLibraryProjectRevisionMatches"] =
    (...args) => ctx.currentLibraryProjectRevisionMatches(...args);
  const rememberAcceptedLibraryMutation: ProposalLaneContext["rememberAcceptedLibraryMutation"] =
    (...args) => ctx.rememberAcceptedLibraryMutation(...args);
  const acceptDraftSectionCreationProposal: ProposalLaneContext["acceptDraftSectionCreationProposal"] =
    (...args) => ctx.acceptDraftSectionCreationProposal(...args);
  const acceptDraftSectionRenameProposal: ProposalLaneContext["acceptDraftSectionRenameProposal"] =
    (...args) => ctx.acceptDraftSectionRenameProposal(...args);
  const acceptDraftSectionDeletionProposal: ProposalLaneContext["acceptDraftSectionDeletionProposal"] =
    (...args) => ctx.acceptDraftSectionDeletionProposal(...args);
  const stageDraftSectionDirectoryProposal: ProposalLaneContext["stageDraftSectionDirectoryProposal"] =
    (...args) => ctx.stageDraftSectionDirectoryProposal(...args);
  const acceptCharacterStructureProposal: ProposalLaneContext["acceptCharacterStructureProposal"] =
    (...args) => ctx.acceptCharacterStructureProposal(...args);
  const stageCharacterStructureProposal: ProposalLaneContext["stageCharacterStructureProposal"] =
    (...args) => ctx.stageCharacterStructureProposal(...args);
  const findPendingCharacterCreationForProvisional: ProposalLaneContext["findPendingCharacterCreationForProvisional"] =
    (...args) => ctx.findPendingCharacterCreationForProvisional(...args);
  const acceptLongWorldbuildingFileProposal: ProposalLaneContext["acceptLongWorldbuildingFileProposal"] =
    (...args) => ctx.acceptLongWorldbuildingFileProposal(...args);
  const conflictDependentLongWorldbuildingProposals: ProposalLaneContext["conflictDependentLongWorldbuildingProposals"] =
    (...args) => ctx.conflictDependentLongWorldbuildingProposals(...args);
  const acceptLongCharacterFileProposal: ProposalLaneContext["acceptLongCharacterFileProposal"] =
    (...args) => ctx.acceptLongCharacterFileProposal(...args);
  const conflictDependentLongCharacterProposals: ProposalLaneContext["conflictDependentLongCharacterProposals"] =
    (...args) => ctx.conflictDependentLongCharacterProposals(...args);
  const acceptLongPlotDesignProposal: ProposalLaneContext["acceptLongPlotDesignProposal"] =
    (...args) => ctx.acceptLongPlotDesignProposal(...args);
  const acceptLongDraftProposal: ProposalLaneContext["acceptLongDraftProposal"] =
    (...args) => ctx.acceptLongDraftProposal(...args);

  function resumeRecoveredAutomaticAgentEdits(
    conversationsToScan: readonly AgentConversationController[] = allConversations()
  ): void {
    if (!catalogSnapshot.value) return;
    for (const conversation of conversationsToScan) {
      restoreAcceptedDraftSectionCreationMappings(conversation);
    }
    for (const conversation of conversationsToScan) {
      for (const message of conversation.messages.value) {
        for (const proposal of message.editProposals ?? []) {
          if (
            proposal.approvalMode !== "auto-approve" ||
            proposal.status !== "pending" ||
            !canReviewAgentEditDuringRun(proposal)
          ) {
            continue;
          }
          queueAgentEdit(
            conversation,
            conversation.sessionId.value,
            proposal.runId,
            proposal.id,
            true,
            true
          );
        }
      }
    }
  }

  function stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    if (!sourceConversation) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";

    const mutationTarget = event.payload.mutationTarget;
    if (
      stageCharacterStructureProposal(
        event,
        sourceConversation,
        runApprovalMode
      )
    ) {
      return;
    }
    if (
      stageDraftSectionDirectoryProposal(
        event,
        sourceConversation,
        runApprovalMode
      )
    ) {
      return;
    }

    const expectedDraftFileKind =
      mutationTarget?.kind === "expert-draft-file" &&
      mutationTarget.fileKind === "characterState"
        ? "character-state"
        : mutationTarget?.kind === "expert-draft-file"
          ? mutationTarget.fileKind
          : undefined;
    const target = liveWorkspaceDocuments.value.find((document) =>
      mutationTarget?.kind === "character-file"
        ? document.catalogDocumentId === mutationTarget.documentId &&
          document.workspaceId === event.payload.workspaceId &&
          document.stageId === "character_design"
        : mutationTarget?.kind === "expert-draft-file"
          ? document.id === mutationTarget.documentId &&
            document.workspaceId === event.payload.workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === mutationTarget.sectionId &&
            document.draftFileKind === expectedDraftFileKind
          : document.workspaceId === event.payload.workspaceId &&
            document.stageId === event.payload.stageId &&
            document.draftFileKind === undefined
    );
    if (
      (!target || target.readOnly) &&
      mutationTarget?.kind === "expert-draft-file" &&
      isProvisionalExpertDraftSectionId(mutationTarget.sectionId)
    ) {
      const creation = findPendingDraftSectionCreationForProvisional(
        sourceConversation,
        event.payload.runId,
        mutationTarget.sectionId
      );
      const realSectionId = resolveProvisionalExpertSectionId(
        event.payload.runId,
        event.payload.workspaceId,
        mutationTarget.sectionId
      );
      const stagingMode = resolveProvisionalWriteStagingMode({
        hasPendingCreation: Boolean(creation),
        provisionalSectionId: mutationTarget.sectionId,
        resolvedSectionId: realSectionId
      });

      // Mid-run accept already landed the chapter: keep staging on the same
      // provisional-keyed proposal id, but validate/write against the real file.
      if (stagingMode === "mapped-real") {
        const realTarget = liveWorkspaceDocuments.value.find(
          (document) =>
            document.workspaceId === event.payload.workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === realSectionId &&
            document.draftFileKind === expectedDraftFileKind
        );
        if (!realTarget || realTarget.readOnly) {
          const message = t(
            "proposalCoordinator.theTargetChapterHasNotBeenCreatedOrIs"
          );
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            message
          );
          uiMessage.warning(message);
          return;
        }

        const laneId = agentEditProposalId(
          event.payload.runId,
          event.payload.workspaceId,
          event.payload.stageId,
          mutationTarget.documentId
        );
        const existing = latestProposalForLane(
          sourceConversation,
          event.payload.runId,
          laneId
        );
        if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
          return;
        }
        const blockedMessage = blockedAgentEditLaneMessage(existing);
        if (blockedMessage) {
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            blockedMessage
          );
          return;
        }
        const baseText = existing?.proposedText ?? realTarget.content;
        const resolvedMutation = resolveAgentEditorMutationText(
          baseText,
          event.payload
        );
        if ("error" in resolvedMutation) {
          if (existing) {
            sourceConversation.updateEditProposal(
              event.payload.runId,
              existing.id,
              {
                status: "conflict",
                statusMessage: resolvedMutation.error,
                updatedAt: event.timestamp
              }
            );
          }
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            resolvedMutation.error
          );
          uiMessage.warning(resolvedMutation.error);
          return;
        }
        const proposedText = resolvedMutation.text;
        const proposedRevision =
          createShortWorkspaceContentRevision(proposedText);
        const diff = buildAgentTextDiff(baseText, proposedText);
        const identity = resolveAgentEditProposalGeneration(laneId, existing);
        const applyBaseRevision = identity.coalescesExisting
          ? (existing!.baseRevision ?? event.payload.baseRevision)
          : (existing?.proposedRevision ?? event.payload.baseRevision);
        const noChanges =
          proposedText === realTarget.content &&
          (!existing ||
            existing.status === "accepted" ||
            identity.coalescesExisting);
        const proposal: AgentEditProposal = {
          id: identity.id,
          laneId,
          generation: identity.generation,
          approvalMode: runApprovalMode,
          sourceBaseRevision: event.payload.baseRevision,
          ...(identity.predecessorProposalId
            ? { predecessorProposalId: identity.predecessorProposalId }
            : {}),
          runId: event.payload.runId,
          workspaceId: event.payload.workspaceId,
          stageId: event.payload.stageId,
          documentId: realTarget.id,
          title: realTarget.title,
          summary: event.payload.summary,
          status: noChanges ? "accepted" : "pending",
          baseRevision: applyBaseRevision,
          proposedRevision,
          ...(noChanges ? {} : { proposedText }),
          toolCallIds: [
            ...new Set([
              ...(identity.coalescesExisting
                ? (existing?.toolCallIds ?? [])
                : []),
              event.payload.toolCallId
            ])
          ],
          additions: diff.additions,
          deletions: diff.deletions,
          hunks: diff.hunks,
          ...(diff.truncated ? { truncated: true } : {}),
          ...(noChanges
            ? {
                statusMessage: t(
                  "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
                )
              }
            : {}),
          createdAt:
            identity.coalescesExisting && existing
              ? existing.createdAt
              : event.timestamp,
          updatedAt: event.timestamp,
          discardSnapshot: textEditDiscardSnapshot(
            existing,
            identity.coalescesExisting,
            baseText,
            realTarget.title
          ),
          provisionalExpertSection: false
        };
        sourceConversation.upsertEditProposal(event.payload.runId, proposal);
        if (!noChanges && runApprovalMode === "auto-approve") {
          queueAgentEdit(
            sourceConversation,
            event.payload.sessionId,
            event.payload.runId,
            proposal.id,
            true,
            true
          );
        }
        return;
      }

      if (stagingMode === "unavailable" || !creation) {
        const message = t(
          "proposalCoordinator.theTargetChapterHasNotBeenCreatedOrIs"
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const laneId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        event.payload.stageId,
        mutationTarget.documentId
      );
      const existing = latestProposalForLane(
        sourceConversation,
        event.payload.runId,
        laneId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
        return;
      }
      const blockedMessage = blockedAgentEditLaneMessage(existing);
      if (blockedMessage) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          blockedMessage
        );
        return;
      }
      const creationSection =
        creation.draftSectionCreationTarget?.sections.find(
          (section) => section.provisionalSectionId === mutationTarget.sectionId
        );
      const creationText =
        mutationTarget.fileKind === "characterState"
          ? (creationSection?.characterStateContent ?? "")
          : (creationSection?.bodyContent ?? "");
      const baseText = existing?.proposedText ?? creationText;
      const resolvedMutation = resolveAgentEditorMutationText(
        baseText,
        event.payload
      );
      if ("error" in resolvedMutation) {
        if (existing) {
          sourceConversation.updateEditProposal(
            event.payload.runId,
            existing.id,
            {
              status: "conflict",
              statusMessage: resolvedMutation.error,
              updatedAt: event.timestamp
            }
          );
        }
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          resolvedMutation.error
        );
        uiMessage.warning(resolvedMutation.error);
        return;
      }
      const proposedText = resolvedMutation.text;
      const proposedRevision =
        createShortWorkspaceContentRevision(proposedText);
      const diff = buildAgentTextDiff(baseText, proposedText);
      const identity = resolveAgentEditProposalGeneration(laneId, existing);
      const applyBaseRevision = identity.coalescesExisting
        ? (existing!.baseRevision ?? event.payload.baseRevision)
        : (existing?.proposedRevision ?? event.payload.baseRevision);
      const noChanges =
        proposedText === creationText &&
        (!existing ||
          existing.status === "accepted" ||
          identity.coalescesExisting);
      const sectionTitle =
        creationSection?.title ?? t("proposalCoordinator.newChapter");
      const title =
        mutationTarget.fileKind === "characterState"
          ? t("proposalCoordinator.characterState", {
              sectionTitle: sectionTitle
            })
          : sectionTitle;
      const proposal: AgentEditProposal = {
        id: identity.id,
        laneId,
        generation: identity.generation,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        ...(identity.predecessorProposalId
          ? { predecessorProposalId: identity.predecessorProposalId }
          : {}),
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        documentId: mutationTarget.documentId,
        title,
        summary: event.payload.summary,
        status: noChanges ? "accepted" : "pending",
        baseRevision: applyBaseRevision,
        proposedRevision,
        ...(noChanges ? {} : { proposedText }),
        toolCallIds: [
          ...new Set([
            ...(identity.coalescesExisting
              ? (existing?.toolCallIds ?? [])
              : []),
            event.payload.toolCallId
          ])
        ],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        ...(noChanges
          ? {
              statusMessage: t(
                "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
              )
            }
          : {}),
        createdAt:
          identity.coalescesExisting && existing
            ? existing.createdAt
            : event.timestamp,
        updatedAt: event.timestamp,
        provisionalExpertSection: true
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (!noChanges && runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposal.id,
          true,
          true
        );
      }
      return;
    }

    if (
      (!target || target.readOnly) &&
      mutationTarget?.kind === "character-file" &&
      mutationTarget.itemId
    ) {
      const creation = findPendingCharacterCreationForProvisional(
        sourceConversation,
        event.payload.runId,
        mutationTarget.itemId
      );
      const creationMutation = creation?.characterStructureTarget?.mutation;
      if (!creation || creationMutation?.type !== "createItem") {
        const message = t(
          "proposalCoordinator.theTargetCharacterEntryHasNotBeenCreatedOr"
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const futureDocumentId = [
        "catalog",
        "book-document",
        encodeURIComponent(event.payload.workspaceId),
        encodeURIComponent(mutationTarget.itemId)
      ].join(":");
      const laneId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        event.payload.stageId,
        futureDocumentId
      );
      const existing = latestProposalForLane(
        sourceConversation,
        event.payload.runId,
        laneId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
      const blockedMessage = blockedAgentEditLaneMessage(existing);
      if (blockedMessage) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          blockedMessage
        );
        return;
      }
      const creationText =
        creation.characterStructureTarget?.initialContent ?? "";
      const baseText = existing?.proposedText ?? creationText;
      const resolvedMutation = resolveAgentEditorMutationText(
        baseText,
        event.payload
      );
      if ("error" in resolvedMutation) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          resolvedMutation.error
        );
        uiMessage.warning(resolvedMutation.error);
        return;
      }
      const proposedText = resolvedMutation.text;
      const proposedRevision =
        createShortWorkspaceContentRevision(proposedText);
      const diff = buildAgentTextDiff(baseText, proposedText);
      const identity = resolveAgentEditProposalGeneration(laneId, existing);
      const proposal: AgentEditProposal = {
        id: identity.id,
        laneId,
        generation: identity.generation,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        ...(identity.predecessorProposalId
          ? { predecessorProposalId: identity.predecessorProposalId }
          : {}),
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        documentId: futureDocumentId,
        title: creationMutation.title,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: identity.coalescesExisting
          ? (existing!.baseRevision ?? event.payload.baseRevision)
          : (existing?.proposedRevision ?? event.payload.baseRevision),
        proposedRevision,
        proposedText,
        toolCallIds: [
          ...new Set([
            ...(identity.coalescesExisting
              ? (existing?.toolCallIds ?? [])
              : []),
            event.payload.toolCallId
          ])
        ],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt:
          identity.coalescesExisting && existing
            ? existing.createdAt
            : event.timestamp,
        updatedAt: event.timestamp,
        provisionalCharacterItemId: mutationTarget.itemId
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposal.id,
          true,
          true
        );
      }
      return;
    }

    if (!target || target.readOnly) {
      const message = t(
        "proposalCoordinator.theTargetManuscriptIsNotWritableThisAgentChange"
      );
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const laneId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      target.id
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
      return;
    }
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const baseText = existing?.proposedText ?? target.content;
    const resolvedMutation = resolveAgentEditorMutationText(
      baseText,
      event.payload
    );
    if ("error" in resolvedMutation) {
      if (
        existing &&
        (existing.status === "pending" || existing.status === "error")
      ) {
        sourceConversation.updateEditProposal(
          event.payload.runId,
          existing.id,
          {
            status: "conflict",
            statusMessage: resolvedMutation.error,
            updatedAt: event.timestamp
          }
        );
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        resolvedMutation.error
      );
      uiMessage.warning(resolvedMutation.error);
      return;
    }
    const proposedText = resolvedMutation.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);

    const diff = buildAgentTextDiff(baseText, proposedText);
    const identity = resolveAgentEditProposalGeneration(laneId, existing);
    const applyBaseRevision = identity.coalescesExisting
      ? (existing!.baseRevision ?? event.payload.baseRevision)
      : (existing?.proposedRevision ?? event.payload.baseRevision);
    const noChanges =
      proposedText === target.content &&
      (!existing ||
        existing.status === "accepted" ||
        identity.coalescesExisting);
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: event.payload.baseRevision,
      ...(identity.predecessorProposalId
        ? { predecessorProposalId: identity.predecessorProposalId }
        : {}),
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId: target.id,
      title: target.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: applyBaseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText }),
      toolCallIds: [
        ...new Set([
          ...(identity.coalescesExisting ? (existing?.toolCallIds ?? []) : []),
          event.payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? {
            statusMessage: t(
              "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
            )
          }
        : {}),
      createdAt:
        identity.coalescesExisting && existing
          ? existing.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      discardSnapshot: textEditDiscardSnapshot(
        existing,
        identity.coalescesExisting,
        baseText,
        target.title
      )
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  async function applyAgentEdit(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    automatic = false,
    reservation?: {
      decisionToken: string;
      expectedProposedRevision: string;
    }
  ): Promise<void> {
    let proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (!proposal) {
      uiMessage.error(
        t("proposalCoordinator.thePendingAgentChangeNoLongerExistsGenerateIt")
      );
      return;
    }
    const reserved = Boolean(
      reservation &&
      proposal.status === "accepting" &&
      proposal.decisionToken === reservation.decisionToken &&
      (proposal.proposedRevision ?? proposal.id) ===
        reservation.expectedProposedRevision
    );
    if (reservation && !reserved) {
      return;
    }
    if (conversation.isBusy.value && !canReviewAgentEditDuringRun(proposal)) {
      uiMessage.info(
        t("proposalCoordinator.waitForTheCurrentAgentTurnToFinishBefore")
      );
      return;
    }

    if (request.decision === "reject") {
      if (proposal.status === "accepting" || proposal.status === "accepted")
        return;
      removeQueuedAgentEdit(conversation, request.runId, request.proposalId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "rejected",
        proposedText: undefined,
        statusMessage: proposal.longPlotDesignTarget
          ? t("proposalCoordinator.rejectedPlotDesignIsUnchanged")
          : proposal.longDraftTarget
            ? t("proposalCoordinator.rejectedChapterProseIsUnchanged")
            : t("proposalCoordinator.rejectedTheOriginalTextIsUnchanged")
      });
      if (proposal.draftSectionCreationTarget) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          proposal.draftSectionCreationTarget.sections.map(
            (section) => section.provisionalSectionId
          ),
          t(
            "proposalCoordinator.creationOfTheEmptyChapterWasRejectedItsManuscript"
          )
        );
      }
      if (proposal.longWorldbuildingTarget?.file.operation === "create") {
        conflictDependentLongWorldbuildingProposals(
          conversation,
          proposal,
          t(
            "proposalCoordinator.creationOfTheEmptyWorldbuildingFileWasRejectedIts"
          )
        );
      }
      if (
        proposal.longCharacterTarget?.files.every(
          ({ operation }) => operation === "create"
        )
      ) {
        conflictDependentLongCharacterProposals(
          conversation,
          proposal,
          t(
            "proposalCoordinator.characterCreationWasRejectedTheAssociatedCharacterProfileCannot"
          )
        );
      }
      blockLaterAgentEditGenerations(conversation, proposal);
      uiMessage.info(
        proposal.longPlotDesignTarget
          ? t(
              "proposalCoordinator.plotDesignChangesRejectedTheCurrentStructureIsUnchanged"
            )
          : proposal.longDraftTarget
            ? t(
                "proposalCoordinator.chapterChangesRejectedTheManuscriptIsUnchanged"
              )
            : t(
                "proposalCoordinator.agentEditsRejectedTheOriginalTextIsUnchanged"
              )
      );
      return;
    }

    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }

    if (proposal.predecessorProposalId) {
      const predecessor = conversation.getEditProposal(
        request.runId,
        proposal.predecessorProposalId
      );
      if (
        !predecessor ||
        predecessor.status === "rejected" ||
        predecessor.status === "conflict"
      ) {
        const message = t(
          "proposalCoordinator.anEarlierAgentEditCouldNotBeSavedThis"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          proposedText: undefined,
          statusMessage: message
        });
        return;
      }
      if (predecessor.status !== "accepted") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage:
            predecessor.status === "accepting"
              ? t("proposalCoordinator.waitingForEarlierEditsToFinishSaving")
              : predecessor.status === "error"
                ? t("proposalCoordinator.predecessorSaveFailed", {
                    title: predecessor.title,
                    detail: predecessor.statusMessage ?? ""
                  })
                : t("proposalCoordinator.reviewPredecessorFirst", {
                    title: predecessor.title
                  })
        });
        return;
      }
    }

    if (proposal.libraryTarget?.operation === "create") {
      await acceptLibraryCreationProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longWorldbuildingTarget) {
      await acceptLongWorldbuildingFileProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longCharacterTarget) {
      await acceptLongCharacterFileProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longPlotDesignTarget) {
      await acceptLongPlotDesignProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longDraftTarget) {
      await acceptLongDraftProposal(conversation, request, proposal, automatic);
      return;
    }

    if (proposal.characterStructureTarget) {
      await acceptCharacterStructureProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionCreationTarget) {
      await acceptDraftSectionCreationProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionRenameTarget) {
      await acceptDraftSectionRenameProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionDeletionTarget) {
      await acceptDraftSectionDeletionProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.provisionalExpertSection) {
      const parsedDocumentId = parseCatalogDraftDocumentId(proposal.documentId);
      if (!parsedDocumentId) {
        const message = t(
          "proposalCoordinator.theTemporaryChapterAwaitingReviewHasAnInvalidFile"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "error",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
      const provisionalSectionId = parsedDocumentId.sectionId;
      const creation = findPendingDraftSectionCreationForProvisional(
        conversation,
        request.runId,
        provisionalSectionId
      );
      if (creation?.status === "error" || creation?.status === "accepting") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage:
            creation.status === "error"
              ? t(
                  "proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs"
                )
              : t(
                  "proposalCoordinator.waitingForTheAssociatedChapterToBeCreated"
                )
        });
        return;
      }
      if (creation) {
        await acceptDraftSectionCreationProposal(
          conversation,
          {
            runId: request.runId,
            proposalId: creation.id,
            decision: "accept"
          },
          creation,
          automatic
        );
        if (
          reconcileCreationDependencyAfterAttempt({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            creationProposalId: creation.id,
            waitingMessage: t(
              "proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs"
            ),
            blockedMessage: t(
              "proposalCoordinator.theAssociatedBlankChapterCouldNotBeCreatedRelated"
            )
          })
        ) {
          return;
        }
      } else {
        const realSectionId = resolveProvisionalExpertSectionId(
          request.runId,
          proposal.workspaceId,
          provisionalSectionId
        );
        if (realSectionId !== provisionalSectionId) {
          remapProvisionalExpertSectionFileProposals(
            conversation,
            request.runId,
            proposal.workspaceId,
            new Map([[provisionalSectionId, realSectionId]])
          );
        } else {
          const inFlight = conversation
            .listEditProposals(request.runId)
            .find(
              (candidate) =>
                candidate.draftSectionCreationTarget?.sections.some(
                  (section) =>
                    section.provisionalSectionId === provisionalSectionId
                ) && candidate.status === "accepting"
            );
          if (inFlight) {
            conversation.updateEditProposal(request.runId, request.proposalId, {
              status: "pending",
              statusMessage: t(
                "proposalCoordinator.waitingForTheAssociatedChapterToBeCreated"
              )
            });
            uiMessage.info(
              t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait")
            );
            return;
          }
        }
      }
      const remapped = conversation.getEditProposal(
        request.runId,
        request.proposalId
      );
      if (!remapped) {
        uiMessage.error(
          t("proposalCoordinator.thePendingAgentChangeNoLongerExistsGenerateIt")
        );
        return;
      }
      proposal = remapped;
      if (proposal.provisionalExpertSection) {
        const message = t(
          "proposalCoordinator.theEmptyTargetChapterHasNotBeenSavedYet"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    if (proposal.provisionalCharacterItemId) {
      const creation = findPendingCharacterCreationForProvisional(
        conversation,
        request.runId,
        proposal.provisionalCharacterItemId
      );
      if (creation?.status === "error" || creation?.status === "accepting") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage:
            creation.status === "error"
              ? t(
                  "proposalCoordinator.characterCreationHasNotBeenConfirmedTheContentHas"
                )
              : t(
                  "proposalCoordinator.waitingForTheAssociatedCharacterEntryToBeCreated"
                )
        });
        return;
      }
      if (creation) {
        await acceptCharacterStructureProposal(
          conversation,
          {
            runId: request.runId,
            proposalId: creation.id,
            decision: "accept"
          },
          creation,
          automatic
        );
        if (
          reconcileCreationDependencyAfterAttempt({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            creationProposalId: creation.id,
            waitingMessage: t(
              "proposalCoordinator.characterCreationHasNotBeenConfirmedTheContentHas"
            ),
            blockedMessage: t(
              "proposalCoordinator.theAssociatedCharacterEntryCouldNotBeCreatedIts"
            )
          })
        ) {
          return;
        }
      }
      const createdTarget = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === proposal.workspaceId &&
          document.catalogDocumentId === proposal.provisionalCharacterItemId
      );
      if (!createdTarget) {
        const message = t(
          "proposalCoordinator.theTargetCharacterEntryHasNotBeenSavedYet"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    const target = liveWorkspaceDocuments.value.find(
      (document) => document.id === proposal.documentId
    );
    const persistedDocument = documents.value.find(
      (document) => document.id === proposal.documentId
    );
    if (!target || !persistedDocument || target.readOnly) {
      const message = t(
        "proposalCoordinator.theTargetManuscriptIsNoLongerAvailableThisAgent"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }

    if (proposal.libraryTarget) {
      const library = findCatalogLibrary(
        proposal.libraryTarget.domain,
        proposal.libraryTarget.libraryId
      );
      if (
        !library ||
        !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
      ) {
        const message = t(
          "proposalCoordinator.theLibraryDirectoryChangedDuringReviewTheAgentEdit"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    if (
      acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId) ||
      documents.value.some(
        (document) =>
          (document.workspaceId === proposal.workspaceId ||
            (proposal.libraryTarget !== undefined &&
              document.domain === proposal.libraryTarget.domain &&
              document.libraryId === proposal.libraryTarget.libraryId)) &&
          savingDocumentIds.value.has(document.id)
      )
    ) {
      const message = automatic
        ? t(
            "proposalCoordinator.theProjectIsSavingOtherContentAutomaticSavingIs"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    const currentDraft = editorDrafts.value[target.id];
    if (
      typeof proposal.proposedText === "string" &&
      persistedDocument.content === proposal.proposedText &&
      (!proposal.libraryTarget || persistedDocument.title === proposal.title)
    ) {
      const staleRecoveryDraft = Boolean(
        currentDraft &&
        currentDraft.title === persistedDocument.title &&
        (currentDraft.content === persistedDocument.content ||
          currentDraft.content === proposal.proposedText)
      );
      if (staleRecoveryDraft) {
        const nextDrafts = { ...editorDrafts.value };
        delete nextDrafts[target.id];
        editorDrafts.value = nextDrafts;
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          currentDraft && !staleRecoveryDraft
            ? t(
                "proposalCoordinator.theseEditsAreAlreadyInTheLocalMarkdownFile"
              )
            : t(
                "proposalCoordinator.theseEditsAreAlreadyInTheLocalMarkdownFile2"
              )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.theAgentEditsAreAlreadySavedInTheLocal")
        );
      }
      return;
    }

    if (typeof proposal.proposedText !== "string") {
      const message = t(
        "proposalCoordinator.thePendingChangesAreMissingTheCompleteRevisedText"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (
      proposal.libraryTarget &&
      classifyAgentEditAcceptance(proposal, target.content) === "conflict"
    ) {
      const message = t(
        "proposalCoordinator.theLibraryContentChangedDuringReviewTheAgentEdit"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }

    const proposedText = proposal.proposedText;
    const payload = {
      id: target.id,
      title: proposal.title,
      content: proposedText
    };
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t(
            "proposalCoordinator.automaticallyApprovingAndSavingToLocalMarkdown"
          )
        : t("proposalCoordinator.savingToLocalMarkdown")
    });
    setAgentEditDocumentAccepting(target.id, true);
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    const draftAtAccept = currentDraft;
    const currentApi = api();

    try {
      let persisted = false;
      let newerDraftPreserved = false;
      if (
        persistedDocument.workspaceId &&
        persistedDocument.catalogDocumentId
      ) {
        if (!currentApi) {
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const saved = await currentApi.catalog.saveDocument({
          bookId: persistedDocument.workspaceId,
          documentId: persistedDocument.catalogDocumentId,
          content: payload.content,
          versionOrigin: conversationVersionOrigin(
            conversation,
            proposal.runId,
            proposal.summary
          ),
          force: true
        });
        const normalizedPayload = {
          id: payload.id,
          title: saved.title,
          content: saved.content
        };
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          saved.projectRevision,
          draftAtAccept
        );
        const expectedDocuments = captureWorkspaceDocumentBaselines(
          documents.value,
          persistedDocument.workspaceId
        );
        await refreshBookAfterSuccessfulDocumentSave(
          persistedDocument.workspaceId,
          expectedDocuments,
          saved.projectRevision
        );
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else if (
        proposal.libraryTarget?.operation === "edit-overview" &&
        persistedDocument.catalogLibraryField === "overview" &&
        persistedDocument.libraryId &&
        (persistedDocument.domain === "material" ||
          persistedDocument.domain === "skill")
      ) {
        if (!currentApi) {
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const updated = await currentApi.catalog.updateLibrary({
          domain: persistedDocument.domain,
          libraryId: persistedDocument.libraryId,
          overview: payload.content,
          ...(persistedDocument.catalogProjectRevision === undefined
            ? {}
            : {
                baseProjectRevision:
                  findCatalogLibrary(
                    persistedDocument.domain,
                    persistedDocument.libraryId
                  )?.projectRevision ?? persistedDocument.catalogProjectRevision
              })
        });
        const normalizedPayload = {
          id: payload.id,
          title: persistedDocument.title,
          content: updated.overview
        };
        await applyUpdatedCatalogLibrary(persistedDocument.domain, updated);
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          updated.projectRevision,
          draftAtAccept
        );
        rememberAcceptedLibraryMutation(proposal);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else if (
        proposal.libraryTarget?.operation === "edit" &&
        persistedDocument.catalogEntryId &&
        persistedDocument.libraryId &&
        (persistedDocument.domain === "material" ||
          persistedDocument.domain === "skill")
      ) {
        if (!currentApi) {
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const library = findCatalogLibrary(
          persistedDocument.domain,
          persistedDocument.libraryId
        );
        if (!library) {
          throw new Error(t("short.theTargetLibraryNoLongerExists"));
        }
        const projectRevision = library.projectRevision;
        const saved = await currentApi.catalog.saveLibraryEntry({
          domain: persistedDocument.domain,
          libraryId: persistedDocument.libraryId,
          entryId: persistedDocument.catalogEntryId,
          title: payload.title,
          content: payload.content,
          baseRevision:
            currentDraft?.baseRevision ??
            createShortWorkspaceContentRevision(persistedDocument.content),
          ...(projectRevision === undefined
            ? {}
            : { baseProjectRevision: projectRevision })
        });
        const savedProjectRevision =
          projectRevision === undefined ? undefined : projectRevision + 1;
        const normalizedPayload = {
          id: payload.id,
          title: saved.title,
          content: saved.body
        };
        const synchronizedProjectRevision = await applySavedLibraryEntry(
          persistedDocument.domain,
          persistedDocument.libraryId,
          saved,
          savedProjectRevision
        );
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          synchronizedProjectRevision,
          draftAtAccept
        );
        rememberAcceptedLibraryMutation(proposal);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else {
        applyAcceptedAgentDocumentLocally(payload, undefined, draftAtAccept);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      }

      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: newerDraftPreserved
          ? t(
              "proposalCoordinator.savedTheReviewedAgentEditsNewerChangesMadeDuring",
              {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.successfully")
              }
            )
          : persisted
            ? t("proposalCoordinator.savedToTheLocalFile", {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.acceptedAnd")
              })
            : t(
                "proposalCoordinator.theCurrentWorkspaceThisPreviewHasNoCorrespondingLocal",
                {
                  value: automatic
                    ? t("proposalCoordinator.automaticallyApprovedAndWrittenTo")
                    : t("proposalCoordinator.acceptedInto")
                }
              )
      });
      if (!automatic) {
        uiMessage.success(
          persisted
            ? t("proposalCoordinator.agentEditsAcceptedAndSaved")
            : t("proposalCoordinator.agentEditsAccepted")
        );
      }
    } catch (error: unknown) {
      const conflict = isCatalogConflict(error);
      const message = conflict
        ? t(
            "proposalCoordinator.theLocalMarkdownFileWasUpdatedElsewhereTheAgent"
          )
        : formatError(
            error,
            t("proposalCoordinator.couldNotSaveTheAgentEditsTheOriginalText")
          );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        await loadCatalogSnapshot();
        uiMessage.warning(message);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditDocumentAccepting(target.id, false);
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function reviewAgentEdit(
    request: AgentEditReviewRequest
  ): Promise<void> {
    const conversation = activeConversation.value;
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      request.decision === "accept" &&
      proposal &&
      canReviewAgentEditDuringRun(proposal)
    ) {
      queueAgentEdit(
        conversation,
        conversation.sessionId.value,
        request.runId,
        request.proposalId,
        false,
        true
      );
      return;
    }
    await applyAgentEdit(conversation, request);
  }

  async function reviewLongAgentEdit(
    request: AgentEditReviewRequest
  ): Promise<void> {
    const conversation = activeLongConversation.value;
    if (!conversation) return;
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      request.decision === "accept" &&
      proposal &&
      canReviewAgentEditDuringRun(proposal)
    ) {
      queueAgentEdit(
        conversation,
        conversation.sessionId.value,
        request.runId,
        request.proposalId,
        false,
        true
      );
      return;
    }
    await applyAgentEdit(conversation, request);
  }

  return {
    resumeRecoveredAutomaticAgentEdits,
    stageAgentEditProposal,
    applyAgentEdit,
    reviewAgentEdit,
    reviewLongAgentEdit
  };
}
