import { conversationVersionOrigin } from "./version-origin";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import {
  createShortWorkspaceContentRevision,
  type CharacterStructureMutation
} from "@deepwrite/contracts";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { saveCreatedCharacterContent } from "./creation-content";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

const t = createScopedTranslator("workspace.proposalCoordinator");

export function createCharacterStructureLane(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogBook,
    loadCatalogSnapshot,
    isCatalogConflict,
    liveWorkspaceDocuments,
    setAgentEditWorkspaceAccepting
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);

  function findPendingCharacterCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    itemId: string
  ): AgentEditProposal | undefined {
    return conversation.listEditProposals(runId).find((proposal) => {
      const mutation = proposal.characterStructureTarget?.mutation;
      return Boolean(
        mutation?.type === "createItem" &&
        mutation.itemId === itemId &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
      );
    });
  }

  async function acceptCharacterStructureProposal(
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
    )
      return;
    const target = proposal.characterStructureTarget;
    const book = catalogBook(proposal.workspaceId);
    const currentApi = api();
    if (!target || !book || !currentApi) {
      const message = t(
        "theTargetCharacterStructureIsUnavailableThisChangeCannot"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const createdItemId =
      target.mutation.type === "createItem"
        ? target.mutation.itemId
        : undefined;
    if (target.mutation.type === "createItem" && !createdItemId) {
      const message = t("characterCreationIsMissingAStableEntryIdOrdered");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t("automaticallySavingCharacterStructure")
        : t("savingCharacterStructure")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const updatedBook = await currentApi.catalog.mutateCharacterStructure({
        bookId: proposal.workspaceId,
        // The command schema still requires this legacy field. `force` makes
        // it metadata only, so a missing or stale project revision cannot
        // reject an agent write.
        baseProjectRevision: book.projectRevision ?? 0,
        force: true,
        mutation: target.mutation
      });
      if (
        target.mutation.type === "createItem" &&
        target.initialContent?.trim()
      ) {
        await saveCreatedCharacterContent(currentApi.catalog, {
          versionOrigin: conversationVersionOrigin(
            conversation,
            proposal.runId,
            proposal.summary
          ),
          bookId: proposal.workspaceId,
          itemId: createdItemId!,
          currentContent:
            updatedBook.documents.find(({ id }) => id === createdItemId)
              ?.content ?? "",
          content: target.initialContent
        });
      }
      await loadCatalogSnapshot();
      if (
        createdItemId &&
        !liveWorkspaceDocuments.value.some(
          (document) =>
            document.workspaceId === proposal.workspaceId &&
            document.catalogDocumentId === createdItemId
        )
      ) {
        throw new Error(t("characterEntryCreatedButItsFileCouldNotBe"));
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(updatedBook.projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: updatedBook.projectRevision
              }
            }),
        statusMessage: automatic
          ? t("characterStructureChangesAutomaticallyApprovedAndSaved")
          : t("characterStructureChangesSavedLocally")
      });
      if (!automatic) uiMessage.success(t("characterStructureChangesSaved"));
    } catch (error) {
      await loadCatalogSnapshot();
      const message = formatError(
        error,
        t("failedToSaveCharacterStructureChanges")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function stageCharacterStructureProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const mutationTarget = event.payload.mutationTarget;
    if (mutationTarget?.kind === "character-structure") {
      const book = catalogBook(event.payload.workspaceId);
      if (!book || book.characterStructure.format !== "list") {
        const message = t("theCurrentCharacterStructureIsNotListBasedThis");
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      const source = mutationTarget.mutation;
      const currentUpdatedItem =
        source.type === "updateItem"
          ? book.characterStructure.items.find(({ id }) => id === source.itemId)
          : undefined;
      const previousItemTitle =
        currentUpdatedItem?.title ??
        (source.type === "updateItem" ? source.previousTitle : undefined);
      const mutation: CharacterStructureMutation =
        source.type === "createItem"
          ? {
              type: "createItem",
              title: source.title,
              itemId: source.provisionalItemId
            }
          : source.type === "updateItem"
            ? { type: "updateItem", itemId: source.itemId, title: source.title }
            : source.type === "moveItem"
              ? {
                  type: "moveItem",
                  itemId: source.itemId,
                  direction: source.direction
                }
              : { type: "deleteItem", itemId: source.itemId };
      const documentId = `character-structure:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "character_design",
        documentId
      );
      if (sourceConversation.getEditProposal(event.payload.runId, proposalId)) {
        return true;
      }
      const beforeText =
        source.type === "deleteItem"
          ? source.deletedText
          : source.type === "updateItem"
            ? previousItemTitle!
            : "";
      const afterText =
        source.type === "deleteItem"
          ? ""
          : source.type === "updateItem"
            ? source.title
            : source.type === "createItem"
              ? source.title
              : event.payload.text;
      const diff = buildAgentTextDiff(beforeText, afterText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "character_design",
        documentId,
        title:
          source.type === "createItem"
            ? t("createCharacterEntry", {
                title: source.title
              })
            : source.type === "updateItem"
              ? t("renameCharacter", {
                  previousItemTitle: previousItemTitle ?? "",
                  title: source.title
                })
              : source.type === "moveItem"
                ? t("characterEntry", {
                    value:
                      source.direction === "up" ? t("moveUp") : t("moveDown"),
                    title: source.title
                  })
                : t("deleteCharacterEntry", {
                    title: source.title
                  }),
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(afterText),
        proposedText: afterText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        ...(source.type === "updateItem"
          ? {
              discardSnapshot: {
                beforeText: previousItemTitle!,
                beforeTitle: previousItemTitle!
              }
            }
          : {}),
        characterStructureTarget: {
          mutation,
          ...(mutationTarget.initialContent
            ? { initialContent: mutationTarget.initialContent }
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
    return false;
  }

  return {
    findPendingCharacterCreationForProvisional,
    acceptCharacterStructureProposal,
    stageCharacterStructureProposal
  };
}
