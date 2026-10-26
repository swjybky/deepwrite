<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { AgentEditProposal, ChatMessage } from "../types/conversation";
import { longImpactSummary } from "../utils/longImpactSummary";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import AppIcon from "./AppIcon.vue";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";
import ApprovalDiscardButton from "./ApprovalDiscardButton.vue";
import {
  approvalDiscardStatusLabel,
  approvalDiscardStatusMessage,
  approvalDiscardVisualStatus,
  shouldShowApprovalDiscardButton
} from "./approvalDiscardPresentation";

const t = createScopedTranslator("components.agentEditProposalCard");
const longWorkspace = useLongWorkspaceStore();

const props = withDefaults(
  defineProps<{
    proposal: AgentEditProposal;
    messageStatus: ChatMessage["status"];
    allowLiveEditReview?: boolean;
    discardable?: boolean;
    /** Received through device sync: reviewed on that device, read-only here. */
    remoteDevice?: string | undefined;
  }>(),
  {
    allowLiveEditReview: false,
    discardable: false
  }
);

const emit = defineEmits<{
  review: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locate: [payload: { runId: string; proposalId: string }];
  discard: [payload: { runId: string; proposalId: string }];
}>();

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
const isStale = computed(
  () =>
    props.proposal.staleBase !== undefined &&
    props.proposal.status === "pending"
);

function proposalStatusLabel(): string {
  if (props.remoteDevice && props.proposal.status === "pending")
    return t("awaitingReviewOnDevice", { device: props.remoteDevice });
  const discardLabel = approvalDiscardStatusLabel(proposalDiscardState());
  if (discardLabel) return discardLabel;
  if (isStale.value) return t("youEditedThis");
  if (
    props.proposal.status === "pending" &&
    props.proposal.approvalMode === "auto-approve"
  ) {
    return t("awaitingAutosave");
  }
  if (isLongProposal()) {
    if (props.proposal.status === "accepting") return t("saving");
    if (props.proposal.status === "conflict") return t("contentChanged");
    if (props.proposal.status === "error") return t("saveFailed");
  }
  return proposalStatusLabels[props.proposal.status];
}

function proposalVisualStatus(): AgentEditProposal["status"] {
  return (
    approvalDiscardVisualStatus(proposalDiscardState()) ??
    (isStale.value ? "conflict" : props.proposal.status)
  );
}

function showDiscardButton(): boolean {
  if (props.remoteDevice) return false;
  return shouldShowApprovalDiscardButton(
    props.discardable,
    props.proposal.status === "accepted",
    proposalDiscardState()
  );
}

function proposalAcceptLabel(): string {
  if (props.proposal.status === "accepting") return t("savingLabel");
  if (isStale.value) return t("overwriteWithAgentVersion");
  if (isLongProposal()) {
    if (!longExpectedImpact.value) return t("reviewImpact");
    return props.proposal.status === "error"
      ? t("confirmAgain")
      : t("confirmAndSave");
  }
  return props.proposal.status === "error"
    ? t("retryAcceptingAndSaving")
    : t("acceptAndSave");
}

function isLongProposal(): boolean {
  return Boolean(
    props.proposal.longWorldbuildingTarget ||
    props.proposal.longCharacterTarget ||
    props.proposal.longPlotDesignTarget ||
    props.proposal.longDraftTarget
  );
}

function proposalDiscardState(): AgentEditProposal["discardState"] | undefined {
  return isLongProposal() ? undefined : props.proposal.discardState;
}

const longExpectedImpact = computed(
  () =>
    props.proposal.longWorldbuildingTarget?.expectedImpact ??
    props.proposal.longCharacterTarget?.expectedImpact ??
    props.proposal.longPlotDesignTarget?.expectedImpact ??
    props.proposal.longDraftTarget?.expectedImpact
);
const longExpectedImpactSummary = computed(() =>
  longExpectedImpact.value
    ? longImpactSummary(
        longExpectedImpact.value,
        longWorkspace.workspaceIndex?.bookId === props.proposal.workspaceId
          ? longWorkspace.workspaceIndex
          : undefined
      )
    : ""
);

function canReviewProposalWhileStreaming(): boolean {
  return props.allowLiveEditReview;
}

function showProposalReviewActions(): boolean {
  if (props.remoteDevice) return false;
  if (
    !isStale.value &&
    props.proposal.approvalMode === "auto-approve" &&
    canReviewProposalWhileStreaming() &&
    (props.proposal.status === "pending" ||
      props.proposal.status === "accepting")
  ) {
    return false;
  }
  return (
    props.proposal.status === "pending" ||
    props.proposal.status === "accepting" ||
    props.proposal.status === "error" ||
    props.proposal.status === "conflict"
  );
}

function isProposalReviewable(decision: "accept" | "reject"): boolean {
  return (
    props.proposal.status === "pending" ||
    props.proposal.status === "error" ||
    (decision === "reject" && props.proposal.status === "conflict")
  );
}

function proposalReviewDisabled(decision: "accept" | "reject"): boolean {
  if (!isProposalReviewable(decision)) return true;
  return (
    props.messageStatus === "streaming" && !canReviewProposalWhileStreaming()
  );
}

function proposalStatusMessage(): string {
  const proposal = props.proposal;
  if (props.remoteDevice)
    return t(
      proposal.status === "pending" ? "reviewOnlyOnDevice" : "handledOnDevice",
      { device: props.remoteDevice }
    );
  const discardMessage = approvalDiscardStatusMessage(proposalDiscardState());
  if (discardMessage) return discardMessage;
  if (isStale.value) {
    return isLongProposal() ? t("staleLongMessage") : t("staleTextMessage");
  }
  if (!proposal.statusMessage && isLongProposal()) {
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
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    proposal.approvalMode === "auto-approve" &&
    canReviewProposalWhileStreaming()
  ) {
    return t("thisItemIsReadyAndIsEnteringTheAutosave");
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    canReviewProposalWhileStreaming()
  ) {
    return t("thisItemIsReadyForReviewTheAgentIs");
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "error" &&
    canReviewProposalWhileStreaming()
  ) {
    return (
      proposal.statusMessage ?? t("autosaveFailedYouCanRetryOrRejectNowThe")
    );
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    proposal.approvalMode === "auto-approve"
  ) {
    return t("thisItemIsReadyAndHasBeenAddedTo");
  }
  if (
    props.messageStatus === "streaming" &&
    (proposal.status === "pending" || proposal.status === "error")
  ) {
    return t("availableForReviewWhenGenerationFinishes");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.libraryTarget
  ) {
    return proposal.libraryTarget.operation === "create"
      ? t("acceptToCreateTheLibraryEntryAndSaveIt")
      : t("acceptToUpdateTheLibraryEntryAndSaveIt");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionCreationTarget
  ) {
    return t("acceptToCreateBlankManuscriptAndCharacterStateFiles");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionRenameTarget
  ) {
    return t("acceptToRenameTheChapterAndSaveLocallyIts");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionDeletionTarget
  ) {
    return t("acceptToPermanentlyDeleteThisChapterItsManuscriptAnd");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longWorldbuildingTarget
  ) {
    return proposal.longWorldbuildingTarget.file.operation === "create"
      ? t("acceptToCreateABlankWorldbuildingFileAndSave")
      : t("acceptToWriteTheWorldbuildingFileAndSaveIt");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longCharacterTarget
  ) {
    return proposal.longCharacterTarget.files.every(
      ({ operation }) => operation === "create"
    )
      ? t("acceptToCreateTheCharacterAndBothProfilesAnd")
      : t("acceptToWriteTheCharacterProfileAndSaveIt");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longPlotDesignTarget
  ) {
    return t("acceptToValidateStructuralImpactAndSaveThePlot");
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longDraftTarget
  ) {
    return t("acceptToSaveTheCurrentChapterManuscriptToIts");
  }
  return (
    proposal.statusMessage?.trim() || proposalStatusMessages[proposal.status]
  );
}

function review(decision: "accept" | "reject"): void {
  if (proposalReviewDisabled(decision)) return;
  emit("review", {
    runId: props.proposal.runId,
    proposalId: props.proposal.id,
    decision
  });
}
</script>

<template>
  <article
    class="edit-proposal-card"
    :class="`is-${proposalVisualStatus()}`"
    :aria-busy="
      proposal.status === 'accepting' ||
      proposalDiscardState()?.status === 'discarding'
    "
  >
    <header class="edit-proposal-header">
      <span class="edit-proposal-icon" aria-hidden="true">
        <AppIcon name="file" :size="17" />
      </span>
      <div class="edit-proposal-heading">
        <div class="edit-proposal-title-row">
          <strong>{{ proposal.title }}</strong>
          <span
            class="edit-proposal-status"
            :class="`is-${proposalVisualStatus()}`"
          >
            {{ proposalStatusLabel() }}
          </span>
          <button
            v-if="proposal.status === 'accepted' && !remoteDevice"
            class="approval-target-button"
            type="button"
            :title="t('goToTargetFile')"
            :aria-label="t('goToTargetFile')"
            @click.stop="
              emit('locate', {
                runId: proposal.runId,
                proposalId: proposal.id
              })
            "
          >
            {{ t("goToTargetFile") }}
          </button>
          <ApprovalDiscardButton
            v-if="showDiscardButton()"
            :discarding="proposalDiscardState()?.status === 'discarding'"
            @discard="
              emit('discard', {
                runId: proposal.runId,
                proposalId: proposal.id
              })
            "
          />
        </div>
        <p v-if="proposal.libraryTarget">
          {{
            t("targetMessage", {
              arg0:
                (proposal.libraryTarget.domain === "skill"
                  ? t("skillLibrary")
                  : t("materialLibrary")) ?? "",
              arg1:
                proposal.libraryTarget.libraryTitle ??
                proposal.libraryTarget.libraryId ??
                ""
            })
          }}
        </p>
        <p>{{ proposal.summary }}</p>
      </div>
      <div
        class="edit-proposal-stats"
        :aria-label="
          t('valueLinesAddedValueLinesRemoved', {
            arg0: proposal.additions,
            arg1: proposal.deletions
          })
        "
      >
        <span class="is-addition">+{{ proposal.additions }}</span>
        <span class="is-deletion">−{{ proposal.deletions }}</span>
      </div>
    </header>

    <AgentEditProposalDiff :proposal="proposal" />

    <section
      v-if="longExpectedImpact"
      class="long-proposal-impact"
      :aria-label="t('exactImpactOfThisNovelChange')"
    >
      <strong>{{ t("structuralAndLinkChanges") }}</strong>
      <p>{{ longExpectedImpactSummary }}</p>
    </section>

    <footer class="edit-proposal-footer">
      <span class="edit-proposal-message">{{ proposalStatusMessage() }}</span>
      <div v-if="showProposalReviewActions()" class="edit-proposal-actions">
        <button
          class="edit-review-button is-reject"
          type="button"
          :disabled="proposalReviewDisabled('reject')"
          @click="review('reject')"
        >
          {{ isStale ? t("keepMine") : t("reject") }}
        </button>
        <button
          v-if="proposal.status !== 'conflict'"
          class="edit-review-button is-accept"
          type="button"
          :disabled="proposalReviewDisabled('accept')"
          @click="review('accept')"
        >
          {{ proposalAcceptLabel() }}
        </button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.long-proposal-impact {
  display: grid;
  gap: 6px;
  margin: 10px 14px 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.long-proposal-impact strong {
  color: var(--text-primary);
}

.long-proposal-impact p {
  margin: 0;
}
</style>
