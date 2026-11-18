import { conversationVersionOrigin } from "./version-origin";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import type { DeepWriteApi, SystemEventEnvelope } from "@deepwrite/contracts";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type { AgentConversationController } from "../useAgentConversation";
import {
  persistPlotStructure,
  type PlotStructurePersistencePort
} from "./plot-structure-persistence";

const t = createScopedTranslator("workspace");

type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;

interface PlotStructureLaneNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

interface PlotStructureLaneInput extends PlotStructurePersistencePort {
  api(): DeepWriteApi | undefined;
  isCatalogConflict(error: unknown): boolean;
  isWorkspaceAccepting(workspaceId: string): boolean;
  setWorkspaceAccepting(workspaceId: string, accepting: boolean): void;
  notifications: PlotStructureLaneNotifications;
  queueAgentEdit(
    conversation: AgentConversationController,
    sessionId: string,
    runId: string,
    proposalId: string,
    automatic: boolean,
    scheduleImmediately: boolean
  ): void;
}

export function createPlotStructureProposalLane(input: PlotStructureLaneInput) {
  function stage(
    event: WorkspaceEditorMutationEvent,
    conversation: AgentConversationController,
    approvalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const target = event.payload.mutationTarget;
    if (target?.kind !== "plot-structure") return false;
    const book = input.catalogBook(event.payload.workspaceId);
    if (!book || book.bookType === "academic") {
      const message = t(
        "plotStructureLane.theTargetProjectIsNoLongerAvailableThePlot"
      );
      conversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      input.notifications.warning(message);
      return true;
    }
    const mutation = target.mutation;
    const currentStage =
      mutation.type === "update"
        ? book.plotStages.find((stage) => stage.id === mutation.stageId)
        : undefined;
    if (mutation.type === "update" && !currentStage) {
      const message = t(
        "plotStructureLane.theTargetPlotStructureNoLongerExistsTheseChanges"
      );
      conversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      input.notifications.warning(message);
      return true;
    }
    const documentId = `plot-structure:${event.payload.toolCallId}`;
    const proposalId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      documentId
    );
    if (conversation.getEditProposal(event.payload.runId, proposalId)) {
      return true;
    }
    const beforeText =
      mutation.type === "update"
        ? `${currentStage!.title}\n${currentStage!.description}`
        : "";
    const proposedText =
      mutation.type === "create"
        ? `${mutation.title}\n${mutation.description}${mutation.content ? `\n\n${mutation.content}` : ""}`
        : `${mutation.title}\n${mutation.description}`;
    const diff = buildAgentTextDiff(beforeText, proposedText);
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId: proposalId,
      generation: 1,
      approvalMode,
      sourceBaseRevision: event.payload.baseRevision,
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId,
      title:
        mutation.type === "create"
          ? t("plotStructureLane.createPlotStructure", {
              title: mutation.title
            })
          : t("plotStructureLane.renamePlotStructure", {
              value: currentStage!.title,
              title: mutation.title
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
      ...(mutation.type === "update"
        ? {
            discardSnapshot: {
              beforeText,
              beforeTitle: currentStage!.title,
              beforeDescription: currentStage!.description
            }
          }
        : {}),
      plotStructureTarget: { mutation }
    };
    conversation.upsertEditProposal(event.payload.runId, proposal);
    if (approvalMode === "auto-approve") {
      input.queueAgentEdit(
        conversation,
        event.payload.sessionId,
        event.payload.runId,
        proposalId,
        true,
        true
      );
    }
    return true;
  }

  async function accept(
    conversation: AgentConversationController,
    request: { runId: string; proposalId: string },
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
    const target = proposal.plotStructureTarget;
    const book = input.catalogBook(proposal.workspaceId);
    const api = input.api();
    if (!target || !book || !api) {
      const message = t(
        "plotStructureLane.thePlotStructureTargetIsUnavailableTheseChangesCannot"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      input.notifications.warning(message);
      return;
    }
    if (input.isWorkspaceAccepting(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "plotStructureLane.theProjectIsSavingOtherContentAutomaticPlotStructure"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      input.notifications.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t("plotStructureLane.automaticallyApprovingAndSavingThePlotStructure")
        : t("plotStructureLane.savingThePlotStructure")
    });
    input.setWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const mutation = target.mutation;
      const projectRevision = await persistPlotStructure({
        ...input,
        api,
        book,
        proposal,
        versionOrigin: conversationVersionOrigin(
          conversation,
          proposal.runId,
          proposal.summary
        )
      });
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: projectRevision
              }
            }),
        statusMessage:
          mutation.type === "create"
            ? automatic
              ? t(
                  "plotStructureLane.automaticallyApprovedAndCreatedPlotStructureIncludingItsContent",
                  { title: mutation.title }
                )
              : t("plotStructureLane.createdPlotStructureIncludingItsContent", {
                  title: mutation.title
                })
            : automatic
              ? t(
                  "plotStructureLane.automaticallyApprovedAndUpdatedPlotStructure",
                  { title: mutation.title }
                )
              : t("plotStructureLane.updatedPlotStructure", {
                  title: mutation.title
                })
      });
      if (!automatic) {
        input.notifications.success(
          mutation.type === "create"
            ? t("plotStructureLane.createdPlotStructure", {
                title: mutation.title
              })
            : t("plotStructureLane.updatedPlotStructure2", {
                title: mutation.title
              })
        );
      }
    } catch (error: unknown) {
      await input.loadCatalogSnapshot().catch(() => undefined);
      const message = formatError(
        error,
        t("plotStructureLane.couldNotSaveThePlotStructure")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: input.isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      input.notifications.error(message);
    } finally {
      input.setWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return { stage, accept };
}
