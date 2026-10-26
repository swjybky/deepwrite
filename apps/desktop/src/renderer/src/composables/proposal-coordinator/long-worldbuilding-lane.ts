import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { nextTick, type Ref } from "vue";
import {
  LongWorkspaceOperationBatchSchema,
  type LongBookSummary,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../../types/longWorkspace";
import { findLongWorldbuildingFile } from "../../utils/longWorldbuildingFiles";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorNotifications } from "./types";
import {
  holdLongProposalForManualReview,
  isLongImpactMismatch,
  moveLongProposalToManualReview,
  previewLongProposalImpact
} from "./long-impact-approval";
import { refreshSavedLongProposal } from "./refresh-saved-long-proposal";
import {
  holdStaleLongProposal,
  isLongDocumentChanged,
  withConfirmedDocumentHashes
} from "./long-stale-base";
import { resolvedStaleBase } from "./stale-base";

const t = createScopedTranslator("workspace");

interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
}
interface WorldbuildingLaneOptions {
  acceptingAgentEditWorkspaceIds: Ref<Set<string>>;
  setAgentEditWorkspaceAccepting(workspaceId: string, accepting: boolean): void;
  activeLongBookId: Ref<string | null>;
  longBooks: Ref<readonly LongBookSummary[]>;
  saveActiveLongEditorChanges(): Promise<boolean>;
  refreshLongProposalWorkspace(bookId: string): Promise<boolean>;
  removeQueuedAgentEdit(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): void;
  uiMessage: ProposalCoordinatorNotifications;
}

export function createLongWorldbuildingProposalLane(
  options: WorldbuildingLaneOptions
) {
  const {
    acceptingAgentEditWorkspaceIds,
    setAgentEditWorkspaceAccepting,
    activeLongBookId,
    longBooks,
    saveActiveLongEditorChanges,
    refreshLongProposalWorkspace,
    removeQueuedAgentEdit,
    uiMessage
  } = options;
  async function acceptLongWorldbuildingFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longWorldbuildingTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = t(
        "longWorldbuildingLane.theLongFormWorldbuildingFileServiceIsCurrentlyUnavailable"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t("proposalCoordinator.otherContentInThisBookIsBeingSavedAutomatic2")
        : t("proposalCoordinator.otherEditsToThisBookAreBeingSavedWait");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage:
        target.file.operation === "create"
          ? automatic
            ? t(
                "longWorldbuildingLane.automaticallyApprovingAndCreatingTheWorldbuildingFile"
              )
            : t("longWorldbuildingLane.creatingTheWorldbuildingFile")
          : automatic
            ? t(
                "longWorldbuildingLane.automaticallyApprovingAndSavingTheWorldbuildingFile"
              )
            : t("longWorldbuildingLane.savingTheWorldbuildingFile")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error(
            t(
              "longWorldbuildingLane.theCurrentLongFormEditsAreUnsavedTheWorldbuilding"
            )
          );
        }
      }
      const latest = await api.getWorkspaceIndex({
        bookId: target.bookId
      });
      const currentFile = findLongWorldbuildingFile(
        latest.workspaceIndex.worldbuilding,
        target.file.fileId
      );
      if (target.file.operation === "create") {
        if (currentFile) {
          const message = t(
            "longWorldbuildingLane.thisFileAlreadyExistsInTheWorldbuildingDirectoryNo"
          );
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else if (!currentFile) {
        const message = t(
          "longWorldbuildingLane.theTargetWorldbuildingFileNoLongerExistsTheseChanges"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongProposalWorkspace(target.bookId);
        uiMessage.warning(message);
        return;
      }

      const batch = target.expectedImpact
        ? LongWorkspaceOperationBatchSchema.parse(target.batch)
        : LongWorkspaceOperationBatchSchema.parse({
            ...target.batch,
            operations: (() => {
              const nextOrderByCategory = new Map<string, number>();
              return target.batch.operations.map((operation) => {
                if (operation.type !== "worldbuildingItem.create") {
                  return operation;
                }
                const category = latest.workspaceIndex.worldbuilding.find(
                  ({ id }) => id === operation.categoryId
                );
                if (!category || category.format !== "list") {
                  throw new Error(
                    t(
                      "longWorldbuildingLane.theWorldbuildingFileSTargetCategoryNoLongerExists"
                    )
                  );
                }
                const nextOrder =
                  (nextOrderByCategory.get(category.id) ??
                    category.items.length) + 1;
                nextOrderByCategory.set(category.id, nextOrder);
                return {
                  ...operation,
                  item: { ...operation.item, order: nextOrder }
                };
              });
            })()
          });
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          t("longWorldbuildingLane.worldbuildingFile")
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longWorldbuildingTarget: { ...target, batch, expectedImpact }
          },
          statusMessage: t(
            "longWorldbuildingLane.theFileAndRelationshipImpactHaveBeenLoadedReview"
          ),
          notificationMessage: t(
            "longWorldbuildingLane.reviewTheWorldbuildingFileAndItsRelationshipImpactThen"
          ),
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...withConfirmedDocumentHashes(batch, proposal),
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...resolvedStaleBase(proposal, "overwrote"),
        statusMessage:
          target.file.operation === "create"
            ? automatic
              ? t(
                  "longWorldbuildingLane.automaticallyApprovedAndCreatedTheWorldbuildingFile"
                )
              : t(
                  "longWorldbuildingLane.createdTheWorldbuildingFileAndSavedItToLocal"
                )
            : t("proposalCoordinator.savedToLocalMarkdown", {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.acceptedAnd")
              })
      });
      void refreshSavedLongProposal({
        refresh: () => refreshLongProposalWorkspace(target.bookId),
        warn: uiMessage.warning
      });
      if (!automatic) {
        uiMessage.success(
          target.file.operation === "create"
            ? t("longWorldbuildingLane.worldbuildingFileCreated")
            : t("longWorldbuildingLane.worldbuildingFileAcceptedAndSaved")
        );
      }
    } catch (error: unknown) {
      if (!applied && isLongDocumentChanged(error)) {
        holdStaleLongProposal({
          conversation,
          runId: request.runId,
          proposal,
          error,
          removeQueued: removeQueuedAgentEdit,
          warn: uiMessage.warning
        });
        return;
      }
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            t("longWorldbuildingLane.worldbuildingFile")
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longWorldbuildingTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage: t(
              "proposalCoordinator.relatedImpactsChangedAndHaveBeenUpdatedBelowReview"
            ),
            notificationMessage: t(
              "longWorldbuildingLane.theWorldbuildingFileSRelationshipImpactHasChangedConfirm"
            ),
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message = formatError(
        currentError,
        t(
          "longWorldbuildingLane.couldNotSaveTheWorldbuildingFileTheOriginalFile"
        )
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? t(
              "longWorldbuildingLane.theWorldbuildingFileWasSavedButTheRefreshFailed",
              { message: message }
            )
          : message
      });
      if (applied) {
        uiMessage.warning(
          t(
            "longWorldbuildingLane.theWorldbuildingFileWasSavedButTheRefreshFailed",
            { message: message }
          )
        );
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return { accept: acceptLongWorldbuildingFileProposal };
}
