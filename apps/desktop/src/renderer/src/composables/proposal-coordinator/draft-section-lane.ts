import { conversationVersionOrigin } from "./version-origin";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import { captureWorkspaceDocumentBaselines } from "../../utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "../../utils/draftFileTitles";
import type { AgentConversationController } from "../useAgentConversation";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import {
  createdDraftSectionsAreVisible,
  saveCreatedDraftSectionContents
} from "./creation-content";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

const t = createScopedTranslator("workspace");

export function createDraftSectionLane(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogProjection,
    catalogBook,
    loadCatalogSnapshot,
    applyAcceptedAgentDocumentLocally,
    isCatalogConflict,
    refreshBookAfterSuccessfulDocumentSave,
    documents,
    editorDrafts,
    liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingAgentEditWorkspaceIds,
    setAgentEditWorkspaceAccepting,
    removeConversation,
    legacyDraftSectionConversationKeys,
    selectedResourceId,
    activeCreationResourceId
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);
  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (
    ...args
  ) => ctx.removeQueuedAgentEdit(...args);
  const rememberProvisionalExpertSectionMapping: ProposalLaneContext["rememberProvisionalExpertSectionMapping"] =
    (...args) => ctx.rememberProvisionalExpertSectionMapping(...args);
  const resolveProvisionalExpertSectionId: ProposalLaneContext["resolveProvisionalExpertSectionId"] =
    (...args) => ctx.resolveProvisionalExpertSectionId(...args);
  const remapProvisionalExpertSectionFileProposals: ProposalLaneContext["remapProvisionalExpertSectionFileProposals"] =
    (...args) => ctx.remapProvisionalExpertSectionFileProposals(...args);
  const pauseDependentProvisionalFileProposals: ProposalLaneContext["pauseDependentProvisionalFileProposals"] =
    (...args) => ctx.pauseDependentProvisionalFileProposals(...args);
  const conflictDependentProvisionalFileProposals: ProposalLaneContext["conflictDependentProvisionalFileProposals"] =
    (...args) => ctx.conflictDependentProvisionalFileProposals(...args);

  function draftSectionCreationOperationId(
    proposal: AgentEditProposal
  ): string {
    return [
      "agent-draft-sections",
      proposal.runId.slice(-120),
      proposal.id.slice(-240)
    ].join(":");
  }

  async function acceptDraftSectionCreationProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionCreationTarget;
    if (!target || target.sections.length === 0) {
      const message = t(
        "proposalCoordinator.thePendingChapterCreationIsMissingRequiredParametersGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = t(
        "proposalCoordinator.theManuscriptDirectoryIsUnavailableChaptersCannotBeCreated"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (directory.sections.length + target.sections.length > 100) {
      const message = t(
        "draftSectionLane.creatingThisChapterWouldExceedTheLimitOfManuscript"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const existingTitles = new Set(
      directory.sections.map((section) => section.title)
    );
    const duplicateTitle = target.sections.find((section) =>
      existingTitles.has(section.title)
    )?.title;
    if (duplicateTitle) {
      const message = t(
        "draftSectionLane.aChapterNamedAlreadyExistsInTheManuscriptDirectory",
        { duplicateTitle: duplicateTitle }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const resolvedAfterSectionId = target.afterSectionId
      ? resolveProvisionalExpertSectionId(
          request.runId,
          proposal.workspaceId,
          target.afterSectionId
        )
      : undefined;
    if (
      resolvedAfterSectionId &&
      !directory.sections.some(
        (section) => section.id === resolvedAfterSectionId
      )
    ) {
      const message = t(
        "draftSectionLane.theRequestedChapterInsertionPositionNoLongerExistsNo"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t(
            "proposalCoordinator.automaticallyApprovingAndCreatingBlankChapterFiles"
          )
        : t("draftSectionLane.creatingAnEmptyChapterFile")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let lastCreatedSectionId: string | undefined;
    const createdMapping = new Map<string, string>();
    try {
      const created = await currentApi.catalog.createDraftSections({
        operationId: draftSectionCreationOperationId(proposal),
        bookId: proposal.workspaceId,
        ...(resolvedAfterSectionId
          ? { afterSectionId: resolvedAfterSectionId }
          : {}),
        force: true,
        sections: target.sections.map((section) => ({
          clientSectionId: section.provisionalSectionId,
          title: section.title,
          ...(section.wordCountRequirement
            ? { wordCountRequirement: section.wordCountRequirement }
            : {})
        }))
      });
      const createdCount = created.sections.length;
      for (const result of created.sections) {
        lastCreatedSectionId = result.section.id;
        createdMapping.set(result.clientSectionId, result.section.id);
        rememberProvisionalExpertSectionMapping(
          request.runId,
          proposal.workspaceId,
          result.clientSectionId,
          result.section.id
        );
      }
      await saveCreatedDraftSectionContents(currentApi.catalog, {
        versionOrigin: conversationVersionOrigin(
          conversation,
          proposal.runId,
          proposal.summary
        ),
        bookId: proposal.workspaceId,
        requested: target.sections,
        created: created.sections
      });
      await loadCatalogSnapshot();
      const refreshedDirectory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === proposal.workspaceId
      );
      if (
        !createdDraftSectionsAreVisible(refreshedDirectory, created.sections)
      ) {
        throw new Error(
          t("proposalCoordinator.chaptersCreatedButTheNewChaptersCouldNotBe")
        );
      }
      remapProvisionalExpertSectionFileProposals(
        conversation,
        request.runId,
        proposal.workspaceId,
        createdMapping
      );
      if (refreshedDirectory && !automatic) {
        selectedResourceId.value = refreshedDirectory.id;
        activeCreationResourceId.value = refreshedDirectory.id;
        if (lastCreatedSectionId) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [refreshedDirectory.id]: lastCreatedSectionId
          };
          selectedDraftFileKinds.value = {
            ...selectedDraftFileKinds.value,
            [refreshedDirectory.id]: "body"
          };
        }
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        draftSectionCreationTarget: {
          ...target,
          sections: target.sections.map((section) => ({
            ...section,
            ...(createdMapping.get(section.provisionalSectionId)
              ? {
                  realSectionId: createdMapping.get(
                    section.provisionalSectionId
                  )!
                }
              : {})
          }))
        },
        statusMessage: automatic
          ? t(
              "proposalCoordinator.automaticallyApprovedAndCreatedChaptersIncludingTheirSubmittedProse",
              { createdCount: createdCount }
            )
          : t(
              "proposalCoordinator.createdChaptersAndSavedTheirSubmittedProseAndCharacter",
              { createdCount: createdCount }
            )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.createdBlankChapterFiles", {
            createdCount: createdCount
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToCreateBlankChapters")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          t(
            "proposalCoordinator.theAssociatedBlankChapterCouldNotBeCreatedRelated"
          )
        );
      } else {
        pauseDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          t("proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs")
        );
      }
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptDraftSectionRenameProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionRenameTarget;
    if (!target) {
      const message = t(
        "proposalCoordinator.thePendingChapterRenameIsMissingRequiredParametersGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    const bodyDocument = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === proposal.workspaceId &&
        document.stageId === "draft" &&
        document.expertSectionId === target.sectionId &&
        document.draftFileKind === "body" &&
        document.catalogDocumentId
    );
    if (!directory || !book || !bodyDocument?.catalogDocumentId) {
      const message = t(
        "proposalCoordinator.theTargetChapterIsUnavailableAndCannotBeRenamed"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      const message = t(
        "proposalCoordinator.theTargetChapterNoLongerExistsAndCannotBe"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic2"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t("proposalCoordinator.automaticallyApprovingAndRenamingTheChapter")
        : t("proposalCoordinator.renamingTheChapter")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      // Core reads the current file while applying the title change. The
      // renderer projection may be stale and must never be written back.
      const saved = await currentApi.catalog.saveDocument({
        bookId: proposal.workspaceId,
        documentId: bodyDocument.catalogDocumentId,
        title: target.title,
        content: "",
        preserveCurrentContent: true,
        force: true
      });
      applyAcceptedAgentDocumentLocally(
        {
          id: bodyDocument.id,
          title: saved.title,
          content: saved.content
        },
        saved.projectRevision,
        undefined
      );
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        proposal.workspaceId
      );
      await refreshBookAfterSuccessfulDocumentSave(
        proposal.workspaceId,
        expectedDocuments,
        saved.projectRevision
      );
      const draft = editorDrafts.value[bodyDocument.id];
      if (draft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [bodyDocument.id]: {
            ...draft,
            title: saved.title
          }
        };
      }
      const characterStateDocument = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === proposal.workspaceId &&
          document.stageId === "draft" &&
          document.expertSectionId === target.sectionId &&
          document.draftFileKind === "character-state"
      );
      const characterDraft = characterStateDocument
        ? editorDrafts.value[characterStateDocument.id]
        : undefined;
      if (characterStateDocument && characterDraft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [characterStateDocument.id]: {
            ...characterDraft,
            title: draftCharacterStateTitle(saved.title)
          }
        };
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? t("proposalCoordinator.automaticallyApprovedAndRenamedChapterTo", {
              previousTitle: target.previousTitle,
              title: target.title
            })
          : t("proposalCoordinator.renamedChapterToAndSavedItLocally", {
              previousTitle: target.previousTitle,
              title: target.title
            })
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.chapterRenamedTo", {
            title: target.title
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToRenameChapter")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function conflictDependentDeletedSectionProposals(
    conversation: AgentConversationController,
    runId: string,
    sectionId: string,
    message: string,
    exceptProposalId?: string
  ): void {
    const bodyId = catalogDraftBodyDocumentId(sectionId);
    const stateId = catalogDraftCharacterStateDocumentId(sectionId);
    for (const candidate of conversation.listEditProposals(runId)) {
      if (exceptProposalId && candidate.id === exceptProposalId) continue;
      if (
        candidate.status !== "pending" &&
        candidate.status !== "error" &&
        candidate.status !== "accepting"
      ) {
        continue;
      }
      const targetsDeletedSection =
        candidate.documentId === bodyId ||
        candidate.documentId === stateId ||
        candidate.draftSectionRenameTarget?.sectionId === sectionId ||
        (candidate.draftSectionDeletionTarget?.sectionId === sectionId &&
          candidate.id !== exceptProposalId);
      if (!targetsDeletedSection) continue;
      removeQueuedAgentEdit(conversation, runId, candidate.id);
      conversation.updateEditProposal(runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptDraftSectionDeletionProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const draftUnit =
      catalogBook(proposal.workspaceId)?.bookType === "script"
        ? t("workspaceResourceCoordinator.episode")
        : t("proposalCoordinator.chapter");
    const target = proposal.draftSectionDeletionTarget;
    if (!target) {
      const message = t(
        "proposalCoordinator.thePendingDeletionIsMissingRequiredParametersGenerateIt",
        { draftUnit: draftUnit }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = t(
        "proposalCoordinator.theManuscriptDirectoryIsUnavailableTheCannotBeDeleted",
        { draftUnit: draftUnit }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: t(
          "proposalCoordinator.noLongerExistsNoFurtherDeletionIsNeeded",
          { draftUnit: draftUnit, title: target.title }
        )
      });
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        t(
          "proposalCoordinator.theTargetWasDeletedRelatedProseChangesCannotBe",
          { draftUnit: draftUnit }
        ),
        request.proposalId
      );
      return;
    }
    if (directory.sections.length <= 1) {
      const message = t(
        "proposalCoordinator.atLeastOneMustRemainInTheManuscriptNothing",
        { draftUnit: draftUnit }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic3"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t("proposalCoordinator.automaticallyApprovingAndDeleting", {
            draftUnit: draftUnit
          })
        : t("proposalCoordinator.deleting", { draftUnit: draftUnit })
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const removedIndex = directory.sections.findIndex(
        (candidate) => candidate.id === target.sectionId
      );
      const fallbackSections = directory.sections.filter(
        (candidate) => candidate.id !== target.sectionId
      );
      const fallbackSection =
        fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
      const deleted = await currentApi.catalog.deleteDraftSection({
        bookId: proposal.workspaceId,
        sectionId: target.sectionId,
        force: true
      });
      if (!deleted.deleted) {
        throw new Error(
          t("proposalCoordinator.noLongerExists", {
            draftUnit: draftUnit,
            title: target.title
          })
        );
      }
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[section.bodyDocumentId];
      delete nextDrafts[section.characterStateDocumentId];
      editorDrafts.value = nextDrafts;
      for (const conversationKey of legacyDraftSectionConversationKeys(
        proposal.workspaceId,
        target.sectionId
      )) {
        removeConversation(conversationKey);
      }
      await loadCatalogSnapshot();
      if (!automatic) {
        selectedResourceId.value = directory.id;
        activeCreationResourceId.value = directory.id;
        if (fallbackSection) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [directory.id]: fallbackSection.id
          };
        }
        selectedDraftFileKinds.value = {
          ...selectedDraftFileKinds.value,
          [directory.id]: "body"
        };
      }
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        t(
          "proposalCoordinator.theTargetWasDeletedRelatedProseChangesCannotBe",
          { draftUnit: draftUnit }
        ),
        request.proposalId
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? t(
              "proposalCoordinator.automaticallyApprovedAndDeletedAndItsManuscriptAndCharacter",
              { draftUnit: draftUnit, title: target.title }
            )
          : t(
              "proposalCoordinator.deletedAndItsManuscriptAndCharacterStateFiles",
              { draftUnit: draftUnit, title: target.title }
            )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.deletedAndItsCharacterStateFile", {
            draftUnit: draftUnit,
            title: target.title
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToDelete", {
          draftUnit: draftUnit
        })
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function stageDraftSectionDirectoryProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const mutationTarget = event.payload.mutationTarget;
    if (mutationTarget?.kind === "expert-draft-section-creation") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      if (!directory || !book) {
        const message = t(
          "proposalCoordinator.theManuscriptDirectoryIsUnavailableChapterCreationWasNot"
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }

      const documentId = `draft-section-creation:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff("", proposedText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: t("proposalCoordinator.createBlankChapters", {
          length: mutationTarget.sections.length
        }),
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionCreationTarget: {
          sections: mutationTarget.sections.map((section) => ({
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            provisionalSectionId: section.provisionalSectionId,
            ...(section.bodyContent === undefined
              ? {}
              : { bodyContent: section.bodyContent }),
            ...(section.characterStateContent === undefined
              ? {}
              : { characterStateContent: section.characterStateContent })
          })),
          ...(mutationTarget.afterSectionId
            ? { afterSectionId: mutationTarget.afterSectionId }
            : {})
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }

    if (mutationTarget?.kind === "expert-draft-section-rename") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      if (!directory || !book || !section) {
        const message = t(
          "proposalCoordinator.theTargetChapterIsUnavailableRenamingWasNotSubmitted"
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      const documentId = `draft-section-rename:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(
        mutationTarget.previousTitle,
        mutationTarget.title
      );
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: t("proposalCoordinator.renameChapter", {
          previousTitle: mutationTarget.previousTitle,
          title: mutationTarget.title
        }),
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionRenameTarget: {
          sectionId: mutationTarget.sectionId,
          previousTitle: mutationTarget.previousTitle,
          title: mutationTarget.title
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }

    if (mutationTarget?.kind === "expert-draft-section-deletion") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      const draftUnit =
        directory?.workspaceType === "script" || book?.bookType === "script"
          ? t("workspaceResourceCoordinator.episode")
          : t("proposalCoordinator.chapter");
      if (!directory || !book || !section) {
        const message = t(
          "proposalCoordinator.theTargetIsUnavailableDeletingTheWasNotSubmitted",
          { draftUnit: draftUnit, draftUnit2: draftUnit }
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      const documentId = `draft-section-deletion:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(mutationTarget.title, "");
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: t("proposalCoordinator.delete", {
          draftUnit: draftUnit,
          title: mutationTarget.title
        }),
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionDeletionTarget: {
          sectionId: mutationTarget.sectionId,
          title: mutationTarget.title
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }
    return false;
  }

  return {
    draftSectionCreationOperationId,
    acceptDraftSectionCreationProposal,
    acceptDraftSectionRenameProposal,
    conflictDependentDeletedSectionProposals,
    acceptDraftSectionDeletionProposal,
    stageDraftSectionDirectoryProposal
  };
}
