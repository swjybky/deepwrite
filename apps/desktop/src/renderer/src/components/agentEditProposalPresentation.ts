import { createScopedTranslator } from "../i18n";
import type { AgentEditProposal, ChatMessage } from "../types/conversation";
import {
  approvalDiscardStatusLabel,
  approvalDiscardStatusMessage,
  approvalDiscardVisualStatus,
  shouldShowApprovalDiscardButton
} from "./approvalDiscardPresentation";

const t = createScopedTranslator("components.agentEditProposalCard");

/** Everything an edit proposal's status, wording and actions depend on. */
export interface AgentEditProposalView {
  proposal: AgentEditProposal;
  messageStatus: ChatMessage["status"];
  allowLiveEditReview: boolean;
  discardable: boolean;
  /** Received through device sync: reviewed on that device, read-only here. */
  remoteDevice?: string | undefined;
}

const proposalStatusLabels: Record<AgentEditProposal["status"], string> = {
  get pending() {
    return t("awaitingReview");
  },
  get accepting() {
    return t("applying");
  },
  get accepted() {
    return t("accepted");
  },
  get rejected() {
    return t("rejected");
  },
  get conflict() {
    return t("changeConflict");
  },
  get error() {
    return t("failedToApply");
  }
};

const proposalStatusMessages: Record<AgentEditProposal["status"], string> = {
  get pending() {
    return t("acceptToApplyTheChangesToTheCurrentManuscript");
  },
  get accepting() {
    return t("applyingAndSavingChanges");
  },
  get accepted() {
    return t("changesAppliedAndSavedLocally");
  },
  get rejected() {
    return t("theCurrentManuscriptWasKeptTheseChangesWereNot");
  },
  get conflict() {
    return t("theChangesCouldNotBeAppliedCurrentContentWas");
  },
  get error() {
    return t("theChangesCouldNotBeAppliedCheckTheRun");
  }
};

/** The target changed after the agent read it; the user must choose. */
export function isStaleProposal(proposal: AgentEditProposal): boolean {
  return proposal.staleBase !== undefined && proposal.status === "pending";
}

export function isLongProposal(proposal: AgentEditProposal): boolean {
  return Boolean(
    proposal.longWorldbuildingTarget ||
    proposal.longCharacterTarget ||
    proposal.longPlotDesignTarget ||
    proposal.longDraftTarget
  );
}

export function proposalDiscardState(
  proposal: AgentEditProposal
): AgentEditProposal["discardState"] | undefined {
  return isLongProposal(proposal) &&
    !proposal.discardSnapshot?.longRestorePointId
    ? undefined
    : proposal.discardState;
}

export function proposalStatusLabel(view: AgentEditProposalView): string {
  const { proposal } = view;
  if (view.remoteDevice && proposal.status === "pending")
    return t("awaitingReviewOnDevice", { device: view.remoteDevice });
  const discardLabel = approvalDiscardStatusLabel(
    proposalDiscardState(proposal)
  );
  if (discardLabel) return discardLabel;
  if (isStaleProposal(proposal)) return t("youEditedThis");
  if (
    proposal.status === "pending" &&
    proposal.approvalMode === "auto-approve"
  ) {
    return t("awaitingAutosave");
  }
  if (isLongProposal(proposal)) {
    if (proposal.status === "accepting") return t("saving");
    if (proposal.status === "conflict") return t("contentChanged");
    if (proposal.status === "error") return t("saveFailed");
  }
  return proposalStatusLabels[proposal.status];
}

export function proposalVisualStatus(
  proposal: AgentEditProposal
): AgentEditProposal["status"] {
  return (
    approvalDiscardVisualStatus(proposalDiscardState(proposal)) ??
    (isStaleProposal(proposal) ? "conflict" : proposal.status)
  );
}

export function showDiscardButton(view: AgentEditProposalView): boolean {
  if (view.remoteDevice) return false;
  return shouldShowApprovalDiscardButton(
    view.discardable,
    view.proposal.status === "accepted",
    proposalDiscardState(view.proposal)
  );
}

export function longExpectedImpact(proposal: AgentEditProposal) {
  return (
    proposal.longWorldbuildingTarget?.expectedImpact ??
    proposal.longCharacterTarget?.expectedImpact ??
    proposal.longPlotDesignTarget?.expectedImpact ??
    proposal.longDraftTarget?.expectedImpact
  );
}

export function proposalAcceptLabel(proposal: AgentEditProposal): string {
  if (proposal.status === "accepting") return t("savingLabel");
  if (isStaleProposal(proposal)) return t("overwriteWithAgentVersion");
  if (isLongProposal(proposal)) {
    if (!longExpectedImpact(proposal)) return t("reviewImpact");
    return proposal.status === "error"
      ? t("confirmAgain")
      : t("confirmAndSave");
  }
  return proposal.status === "error"
    ? t("retryAcceptingAndSaving")
    : t("acceptAndSave");
}

function canReviewProposalWhileStreaming(view: AgentEditProposalView): boolean {
  return view.allowLiveEditReview;
}

export function showProposalReviewActions(
  view: AgentEditProposalView
): boolean {
  const { proposal } = view;
  if (view.remoteDevice) return false;
  if (
    !isStaleProposal(proposal) &&
    proposal.approvalMode === "auto-approve" &&
    canReviewProposalWhileStreaming(view) &&
    (proposal.status === "pending" || proposal.status === "accepting")
  ) {
    return false;
  }
  return (
    proposal.status === "pending" ||
    proposal.status === "accepting" ||
    proposal.status === "error" ||
    proposal.status === "conflict"
  );
}

function isProposalReviewable(
  proposal: AgentEditProposal,
  decision: "accept" | "reject"
): boolean {
  return (
    proposal.status === "pending" ||
    proposal.status === "error" ||
    (decision === "reject" && proposal.status === "conflict")
  );
}

export function proposalReviewDisabled(
  view: AgentEditProposalView,
  decision: "accept" | "reject"
): boolean {
  if (!isProposalReviewable(view.proposal, decision)) return true;
  return (
    view.messageStatus === "streaming" && !canReviewProposalWhileStreaming(view)
  );
}

function pendingTargetMessage(proposal: AgentEditProposal): string | undefined {
  if (proposal.libraryStructureTarget)
    return t("acceptToApplyLibraryOrganization");
  if (proposal.libraryTarget) {
    return proposal.libraryTarget.operation === "create"
      ? t("acceptToCreateTheLibraryEntryAndSaveIt")
      : t("acceptToUpdateTheLibraryEntryAndSaveIt");
  }
  if (proposal.draftSectionCreationTarget) {
    return t("acceptToCreateBlankManuscriptAndCharacterStateFiles");
  }
  if (proposal.draftSectionRenameTarget) {
    return t("acceptToRenameTheChapterAndSaveLocallyIts");
  }
  if (proposal.draftSectionDeletionTarget) {
    return t("acceptToPermanentlyDeleteThisChapterItsManuscriptAnd");
  }
  if (proposal.longWorldbuildingTarget) {
    return proposal.longWorldbuildingTarget.file.operation === "create"
      ? t("acceptToCreateABlankWorldbuildingFileAndSave")
      : t("acceptToWriteTheWorldbuildingFileAndSaveIt");
  }
  if (proposal.longCharacterTarget) {
    return proposal.longCharacterTarget.files.every(
      ({ operation }) => operation === "create"
    )
      ? t("acceptToCreateTheCharacterAndBothProfilesAnd")
      : t("acceptToWriteTheCharacterProfileAndSaveIt");
  }
  if (proposal.longPlotDesignTarget) {
    return t("acceptToValidateStructuralImpactAndSaveThePlot");
  }
  if (proposal.longDraftTarget) {
    return t("acceptToSaveTheCurrentChapterManuscriptToIts");
  }
  return undefined;
}

function streamingStatusMessage(
  view: AgentEditProposalView
): string | undefined {
  const { proposal } = view;
  if (view.messageStatus !== "streaming") return undefined;
  const live = canReviewProposalWhileStreaming(view);
  const autoApprove = proposal.approvalMode === "auto-approve";
  if (proposal.status === "pending" && autoApprove && live) {
    return t("thisItemIsReadyAndIsEnteringTheAutosave");
  }
  if (proposal.status === "pending" && live) {
    return t("thisItemIsReadyForReviewTheAgentIs");
  }
  if (proposal.status === "error" && live) {
    return (
      proposal.statusMessage ?? t("autosaveFailedYouCanRetryOrRejectNowThe")
    );
  }
  if (proposal.status === "pending" && autoApprove) {
    return t("thisItemIsReadyAndHasBeenAddedTo");
  }
  if (proposal.status === "pending" || proposal.status === "error") {
    return t("availableForReviewWhenGenerationFinishes");
  }
  return undefined;
}

export function proposalStatusMessage(view: AgentEditProposalView): string {
  const { proposal } = view;
  if (view.remoteDevice)
    return t(
      proposal.status === "pending" ? "reviewOnlyOnDevice" : "handledOnDevice",
      { device: view.remoteDevice }
    );
  const discardMessage = approvalDiscardStatusMessage(
    proposalDiscardState(proposal)
  );
  if (discardMessage) return discardMessage;
  if (isStaleProposal(proposal)) {
    return isLongProposal(proposal)
      ? t("staleLongMessage")
      : t("staleTextMessage");
  }
  if (!proposal.statusMessage && isLongProposal(proposal)) {
    if (proposal.status === "accepting") {
      return t("savingThisNovelChange");
    }
    if (proposal.status === "conflict") {
      return t("theTargetContentOrItsLinksHaveChangedThis");
    }
    if (proposal.status === "error") {
      return t("thisNovelChangeCouldNotBeSavedCheckThe");
    }
  }
  const streaming = streamingStatusMessage(view);
  if (streaming) return streaming;
  const target =
    !proposal.statusMessage && proposal.status === "pending"
      ? pendingTargetMessage(proposal)
      : undefined;
  return (
    target ??
    (proposal.statusMessage?.trim() || proposalStatusMessages[proposal.status])
  );
}
