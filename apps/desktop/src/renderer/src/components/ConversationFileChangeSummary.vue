<script setup lang="ts">
import { computed, useId } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { createScopedTranslator, t as translate } from "../i18n";
import { useConversationDisclosure } from "../composables/conversationDisclosureState";
import type { ChatMessage } from "../types/conversation";
import type { ApprovalCardItem } from "./conversationToolPresentation";
import {
  fileChangeSummary,
  visibleFileChangeRows
} from "./conversationFileChanges";
import AppIcon from "./AppIcon.vue";
import ConversationFileChangeRow from "./ConversationFileChangeRow.vue";

const t = createScopedTranslator("components.conversationFileChanges");

const props = defineProps<{
  approvals: readonly ApprovalCardItem[];
  messageStatus: ChatMessage["status"];
  allowLiveEditReview: boolean;
  longWorkspaceIndex: LongWorkspaceIndexSnapshot | null;
}>();

const emit = defineEmits<{
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  discardEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

const listId = useId();
// Disclosure keys are already scoped to this message by its row.
const collapsed = useConversationDisclosure(() => "file-changes-collapsed");
const showAll = useConversationDisclosure(() => "file-changes-all");

const summary = computed(() => fileChangeSummary(props.approvals));
const peerProposals = computed(() =>
  props.approvals.flatMap((approval) =>
    approval.type === "edit-proposal" ? [approval.proposal] : []
  )
);
const rows = computed(() =>
  visibleFileChangeRows(summary.value, showAll.value)
);
const hiddenCount = computed(
  () => summary.value.rows.length - rows.value.length
);

const heading = computed(() =>
  summary.value.structureOnly
    ? t("changes", { count: summary.value.rows.length })
    : t("files", { count: summary.value.fileCount })
);

const hasLineStats = computed(
  () => summary.value.additions + summary.value.deletions > 0
);

const overall = computed<{ label: string; tone: string }>(() => {
  const { counts, danger, rows: allRows } = summary.value;
  if (counts.action) {
    return {
      label: t("pending", { count: counts.action }),
      tone: danger ? "is-danger" : "is-action"
    };
  }
  if (counts.progress) {
    return {
      label: translate("components.agentEditProposalCard.saving"),
      tone: "is-action"
    };
  }
  if (counts.remote) {
    const remote = allRows
      .flatMap(({ writes }) => writes)
      .find((write) => write.type === "edit-proposal" && write.remoteDevice);
    const device =
      remote?.type === "edit-proposal" ? (remote.remoteDevice ?? "") : "";
    return {
      label: translate(
        "components.agentEditProposalCard.awaitingReviewOnDevice",
        { device }
      ),
      tone: ""
    };
  }
  const dropped = counts.rejected + counts.discarded;
  if (!dropped) return { label: t("allSaved"), tone: "is-done" };
  return {
    label: t("settled", { saved: counts.accepted, dropped }),
    tone: counts.accepted ? "is-done" : ""
  };
});
</script>

<template>
  <section
    class="file-change-summary"
    :class="{ 'is-open': !collapsed }"
    :aria-label="
      translate('components.conversationMessageItem.approvalCardsForThisTurn')
    "
  >
    <button
      class="file-change-summary-header"
      type="button"
      :aria-expanded="!collapsed"
      :aria-controls="listId"
      @click="collapsed = !collapsed"
    >
      <AppIcon name="chevron" :size="14" />
      <span class="file-change-summary-title">{{ heading }}</span>
      <span
        v-if="hasLineStats"
        class="file-change-stats"
        :aria-label="
          translate(
            'components.agentEditProposalCard.valueLinesAddedValueLinesRemoved',
            { arg0: summary.additions, arg1: summary.deletions }
          )
        "
      >
        <span class="is-addition">+{{ summary.additions }}</span>
        <span class="is-deletion">−{{ summary.deletions }}</span>
      </span>
      <span class="file-change-overall" :class="overall.tone">{{
        overall.label
      }}</span>
    </button>
    <div v-if="!collapsed" :id="listId" class="file-change-list">
      <ConversationFileChangeRow
        v-for="row in rows"
        :key="row.key"
        :row="row"
        :message-status="messageStatus"
        :allow-live-edit-review="allowLiveEditReview"
        :long-workspace-index="longWorkspaceIndex"
        :peer-proposals="peerProposals"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @discard-edit-proposal="emit('discardEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
      />
      <button
        v-if="hiddenCount > 0"
        class="file-change-more"
        type="button"
        @click="showAll = true"
      >
        <AppIcon name="chevron" :size="13" />
        <span>{{ t("more", { count: hiddenCount }) }}</span>
      </button>
    </div>
  </section>
</template>
