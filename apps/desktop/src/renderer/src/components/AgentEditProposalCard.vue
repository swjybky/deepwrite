<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import type { AgentEditProposal, ChatMessage } from "../types/conversation";
import { longImpactSummary } from "../utils/longImpactSummary";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import AppIcon from "./AppIcon.vue";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";
import AgentEditProposalEditor from "./AgentEditProposalEditor.vue";
import ApprovalDiscardButton from "./ApprovalDiscardButton.vue";
import { proposalEditBaseText } from "../utils/agentProposalEdit";
import {
  isStaleProposal,
  longExpectedImpact as proposalExpectedImpact,
  proposalAcceptLabel,
  proposalDiscardState,
  proposalReviewDisabled,
  proposalStatusLabel,
  proposalStatusMessage,
  proposalVisualStatus,
  showDiscardButton,
  showProposalReviewActions
} from "./agentEditProposalPresentation";
import { buildLongProposalChangePresentation } from "../utils/longProposalChangePresentation";
import LongProposalChangeDetails from "./LongProposalChangeDetails.vue";

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
    /** `row`: body of a file-change summary row, whose header shows the title. */
    variant?: "card" | "row";
    peerProposals?: readonly AgentEditProposal[];
  }>(),
  {
    allowLiveEditReview: false,
    discardable: false,
    variant: "card",
    peerProposals: () => []
  }
);

const emit = defineEmits<{
  review: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
      /** Accept the user's rewrite instead of the agent's text. */
      editedText?: string;
    }
  ];
  locate: [payload: { runId: string; proposalId: string }];
  discard: [payload: { runId: string; proposalId: string }];
}>();

const isStale = computed(() => isStaleProposal(props.proposal));
const proposalBookId = computed(
  () =>
    props.proposal.longPlotDesignTarget?.bookId ??
    props.proposal.longWorldbuildingTarget?.bookId ??
    props.proposal.longCharacterTarget?.bookId ??
    props.proposal.longDraftTarget?.bookId
);
const matchedWorkspaceIndex = computed(() =>
  proposalBookId.value &&
  longWorkspace.workspaceIndex?.bookId === proposalBookId.value
    ? longWorkspace.workspaceIndex
    : undefined
);
const longExpectedImpact = computed(() =>
  proposalExpectedImpact(props.proposal)
);
const longExpectedImpactSummary = computed(() =>
  longExpectedImpact.value
    ? longImpactSummary(longExpectedImpact.value, matchedWorkspaceIndex.value)
    : ""
);
const changePresentation = computed(() =>
  buildLongProposalChangePresentation(
    props.proposal,
    matchedWorkspaceIndex.value,
    props.peerProposals
  )
);
const canLocate = computed(
  () => props.proposal.status === "accepted" && !props.remoteDevice
);
const showFooter = computed(() => {
  const discardStatus = proposalDiscardState(props.proposal)?.status;
  return (
    props.variant !== "row" ||
    props.proposal.status !== "accepted" ||
    discardStatus === "conflict" ||
    discardStatus === "error"
  );
});

function review(decision: "accept" | "reject", editedText?: string): void {
  if (proposalReviewDisabled(props, decision)) return;
  emit("review", {
    runId: props.proposal.runId,
    proposalId: props.proposal.id,
    decision,
    ...(editedText === undefined ? {} : { editedText })
  });
}

// Edit mode: the user rewrites the agent's text on the card, then saves it.
const editing = ref(false);
const editedText = ref("");
const canEdit = computed(
  () =>
    !props.remoteDevice &&
    !isStale.value &&
    !proposalReviewDisabled(props, "accept") &&
    proposalEditBaseText(props.proposal) !== undefined
);
watch(canEdit, (value) => {
  if (!value) editing.value = false;
});

function startEditing(): void {
  editedText.value = props.proposal.proposedText ?? "";
  editing.value = true;
}

function saveEdited(): void {
  const text = editedText.value;
  editing.value = false;
  review("accept", text === props.proposal.proposedText ? undefined : text);
}

function locate(): void {
  emit("locate", {
    runId: props.proposal.runId,
    proposalId: props.proposal.id
  });
}

function discard(): void {
  emit("discard", {
    runId: props.proposal.runId,
    proposalId: props.proposal.id
  });
}
</script>

<template>
  <article
    class="edit-proposal-card"
    :class="[`is-${proposalVisualStatus(proposal)}`, `is-${variant}-variant`]"
    :aria-busy="
      proposal.status === 'accepting' ||
      proposalDiscardState(proposal)?.status === 'discarding'
    "
  >
    <header v-if="variant === 'card'" class="edit-proposal-header">
      <span class="edit-proposal-icon" aria-hidden="true">
        <AppIcon name="file" :size="17" />
      </span>
      <div class="edit-proposal-heading">
        <div class="edit-proposal-title-row">
          <strong>{{ proposal.title }}</strong>
          <span
            class="edit-proposal-status"
            :class="`is-${proposalVisualStatus(proposal)}`"
          >
            {{ proposalStatusLabel(props) }}
          </span>
          <button
            v-if="proposal.status === 'accepted' && !remoteDevice"
            class="approval-target-button"
            type="button"
            :title="t('goToTargetFile')"
            :aria-label="t('goToTargetFile')"
            @click.stop="locate"
          >
            {{ t("goToTargetFile") }}
          </button>
          <ApprovalDiscardButton
            v-if="showDiscardButton(props)"
            :discarding="
              proposalDiscardState(proposal)?.status === 'discarding'
            "
            @discard="discard"
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
        v-if="
          changePresentation.hasContentDiff ||
          proposal.additions + proposal.deletions > 0
        "
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
    <div
      v-else-if="proposal.summary || canLocate || showDiscardButton(props)"
      class="edit-proposal-row-toolbar"
    >
      <p v-if="proposal.summary" class="edit-proposal-row-summary">
        {{ proposal.summary }}
      </p>
      <div
        v-if="canLocate || showDiscardButton(props)"
        class="edit-proposal-actions"
      >
        <button
          v-if="canLocate"
          class="approval-target-button"
          type="button"
          @click.stop="locate"
        >
          {{ t("goToTargetFile") }}
        </button>
        <ApprovalDiscardButton
          v-if="showDiscardButton(props)"
          :discarding="proposalDiscardState(proposal)?.status === 'discarding'"
          @discard="discard"
        />
      </div>
    </div>

    <div
      v-if="changePresentation.rows.length > 0"
      class="long-change-details-wrap"
    >
      <LongProposalChangeDetails :rows="changePresentation.rows" />
    </div>

    <AgentEditProposalEditor
      v-if="editing"
      v-model="editedText"
      :label="t('editProposalText', { title: proposal.title })"
    />
    <div
      v-else-if="changePresentation.hasContentDiff"
      class="long-change-diff-block"
    >
      <strong
        v-if="changePresentation.contentLabel"
        class="long-change-diff-heading"
        >{{ changePresentation.contentLabel }}</strong
      >
      <AgentEditProposalDiff :proposal="proposal" :inline="variant === 'row'" />
    </div>

    <section
      v-if="
        longExpectedImpact &&
        !changePresentation.rows.length &&
        !changePresentation.hasContentDiff
      "
      class="long-proposal-impact"
      :aria-label="t('exactImpactOfThisNovelChange')"
    >
      <strong>{{ t("structuralAndLinkChanges") }}</strong>
      <p>{{ longExpectedImpactSummary }}</p>
    </section>

    <footer v-if="showFooter" class="edit-proposal-footer">
      <span class="edit-proposal-message">{{
        editing ? t("editHint") : proposalStatusMessage(props)
      }}</span>
      <div v-if="editing" class="edit-proposal-actions">
        <button
          class="edit-review-button"
          type="button"
          @click="editing = false"
        >
          {{ t("cancelEdit") }}
        </button>
        <button
          class="edit-review-button is-accept"
          type="button"
          :disabled="!canEdit"
          @click="saveEdited"
        >
          {{ t("saveEdited") }}
        </button>
      </div>
      <div
        v-else-if="showProposalReviewActions(props)"
        class="edit-proposal-actions"
      >
        <button
          class="edit-review-button is-reject"
          type="button"
          :disabled="proposalReviewDisabled(props, 'reject')"
          @click="review('reject')"
        >
          {{ isStale ? t("keepMine") : t("reject") }}
        </button>
        <button
          v-if="canEdit"
          class="edit-review-button"
          type="button"
          @click="startEditing"
        >
          {{ t("edit") }}
        </button>
        <button
          v-if="proposal.status !== 'conflict'"
          class="edit-review-button is-accept"
          type="button"
          :disabled="proposalReviewDisabled(props, 'accept')"
          @click="review('accept')"
        >
          {{ proposalAcceptLabel(proposal) }}
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
.long-change-details-wrap {
  min-width: 0;
}

.edit-proposal-card.is-card-variant .long-change-details-wrap {
  margin: 10px 14px 0;
}

.edit-proposal-card.is-row-variant .long-change-details-wrap {
  margin-top: 8px;
}

.long-change-diff-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  margin-top: 8px;
}

.long-change-diff-heading {
  font-size: 0.785714rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.edit-proposal-card.is-card-variant .long-change-diff-heading {
  padding: 0 14px;
}
</style>
