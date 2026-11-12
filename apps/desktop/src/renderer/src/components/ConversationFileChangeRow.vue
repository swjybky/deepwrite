<script setup lang="ts">
import { computed, useId, watch } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { createScopedTranslator, t as translate } from "../i18n";
import { useConversationDisclosure } from "../composables/conversationDisclosureState";
import type { ChatMessage } from "../types/conversation";
import type { FileChangeRow } from "./conversationFileChanges";
import type { ApprovalCardItem } from "./conversationToolPresentation";
import {
  proposalStatusLabel,
  proposalVisualStatus,
  showProposalReviewActions
} from "./agentEditProposalPresentation";
import {
  contentProposalVisualStatus,
  longProposalStatusLabel,
  proposalTitle
} from "./longProposalPresentation";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
import LongProposalReview from "./LongProposalReview.vue";

const t = createScopedTranslator("components.conversationFileChanges");

const props = defineProps<{
  row: FileChangeRow;
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

type EditWrite = Extract<ApprovalCardItem, { type: "edit-proposal" }>;

const bodyId = useId();
const open = useConversationDisclosure(() => `file-change:${props.row.key}`);
const latest = computed(() => props.row.writes.at(-1)!);
const earlierWrites = computed(() =>
  (props.row.writes.slice(0, -1) as EditWrite[]).reverse()
);

// Open whatever newly needs the user; never close a row on its own, so a
// decision settling in place does not shift the rows below it.
watch(
  () => props.row.status === "action",
  (needsAction) => {
    if (needsAction) open.value = true;
  },
  { immediate: true }
);

function editView(write: EditWrite) {
  return {
    proposal: write.proposal,
    messageStatus: props.messageStatus,
    allowLiveEditReview: props.allowLiveEditReview,
    discardable: write.canDiscard,
    remoteDevice: write.remoteDevice
  };
}

const title = computed(() =>
  latest.value.type === "edit-proposal"
    ? latest.value.proposal.title
    : proposalTitle(latest.value.item, props.longWorkspaceIndex)
);

const detail = computed(() => {
  const write = latest.value;
  if (write.type !== "edit-proposal") return "";
  if (write.remoteDevice) {
    return translate("components.conversationMessageItem.fromDevice", {
      device: write.remoteDevice
    });
  }
  const library = write.proposal.libraryTarget;
  if (!library) return "";
  const domain = translate(
    library.domain === "skill"
      ? "components.agentEditProposalCard.skillLibrary"
      : "components.agentEditProposalCard.materialLibrary"
  );
  const name = library.libraryTitle ?? "";
  return name ? `${domain} · ${name}` : domain;
});

const status = computed(() => {
  const write = latest.value;
  return write.type === "edit-proposal"
    ? {
        label: proposalStatusLabel(editView(write)),
        visual: proposalVisualStatus(write.proposal)
      }
    : {
        label: longProposalStatusLabel(write.item),
        visual: contentProposalVisualStatus(write.item)
      };
});

const canLocate = computed(() => {
  const write = latest.value;
  return write.type === "edit-proposal"
    ? write.proposal.status === "accepted" && !write.remoteDevice
    : write.item.status === "accepted";
});

function locate(): void {
  const write = latest.value;
  if (write.type === "edit-proposal") {
    emit("locateEditProposal", {
      runId: write.proposal.runId,
      proposalId: write.proposal.id
    });
  } else {
    emit("locateLongProposal", write.item.event.id);
  }
}
</script>

<template>
  <section
    class="file-change-row"
    :class="{ 'is-open': open }"
    :data-file-change-key="row.key"
  >
    <div class="file-change-row-header">
      <button
        class="file-change-row-toggle"
        type="button"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="open = !open"
      >
        <AppIcon class="file-change-chevron" name="chevron" :size="13" />
        <span class="file-change-row-icon" aria-hidden="true">
          <AppIcon :name="row.kind === 'text' ? 'file' : 'wand'" :size="15" />
        </span>
        <span class="file-change-row-name">
          <strong>{{ title }}</strong>
          <small v-if="detail">{{ detail }}</small>
          <span v-if="row.creates" class="file-change-tag">{{
            t("create")
          }}</span>
          <span v-if="row.deletes" class="file-change-tag is-delete">{{
            t("delete")
          }}</span>
          <span v-if="row.writes.length > 1" class="file-change-tag">{{
            t("writes", { count: row.writes.length })
          }}</span>
        </span>
        <span
          v-if="row.additions !== undefined"
          class="file-change-stats"
          :aria-label="
            translate(
              'components.agentEditProposalCard.valueLinesAddedValueLinesRemoved',
              { arg0: row.additions, arg1: row.deletions ?? 0 }
            )
          "
        >
          <span class="is-addition">+{{ row.additions }}</span>
          <span class="is-deletion">−{{ row.deletions ?? 0 }}</span>
        </span>
        <span class="edit-proposal-status" :class="`is-${status.visual}`">
          {{ status.label }}
        </span>
      </button>
      <button
        v-if="canLocate"
        class="file-change-locate"
        type="button"
        :title="translate('components.agentEditProposalCard.goToTargetFile')"
        :aria-label="
          translate('components.agentEditProposalCard.goToTargetFile')
        "
        @click="locate"
      >
        <AppIcon name="external" :size="14" />
      </button>
    </div>

    <div v-if="open" :id="bodyId" class="file-change-row-body">
      <AgentEditProposalCard
        v-if="latest.type === 'edit-proposal'"
        variant="row"
        :proposal="latest.proposal"
        :message-status="messageStatus"
        :allow-live-edit-review="allowLiveEditReview"
        :discardable="latest.canDiscard"
        :remote-device="latest.remoteDevice"
        @review="emit('reviewEdit', $event)"
        @locate="emit('locateEditProposal', $event)"
        @discard="emit('discardEditProposal', $event)"
      />
      <LongProposalReview
        v-else
        embedded
        conversation-card
        row-body
        :items="[latest.item]"
        :workspace-index="longWorkspaceIndex"
        @approve="emit('approveLongProposal', $event)"
        @reject="emit('rejectLongProposal', $event)"
        @retry-preview="emit('retryLongProposalPreview', $event)"
        @locate="emit('locateLongProposal', $event)"
      />
      <ConversationDetails
        v-if="earlierWrites.length"
        :detail-id="`file-change-history:${row.key}`"
        class="file-change-history"
      >
        <template #summary>
          <AppIcon name="chevron" :size="12" />
          <span>{{ t("earlier", { count: earlierWrites.length }) }}</span>
        </template>
        <section
          v-for="write in earlierWrites"
          :key="write.id"
          class="file-change-history-item"
        >
          <header>
            <span>{{
              t("nth", { count: write.proposal.generation ?? 1 })
            }}</span>
            <span
              class="edit-proposal-status"
              :class="`is-${proposalVisualStatus(write.proposal)}`"
            >
              {{ proposalStatusLabel(editView(write)) }}
            </span>
            <span class="file-change-stats">
              <span class="is-addition">+{{ write.proposal.additions }}</span>
              <span class="is-deletion">−{{ write.proposal.deletions }}</span>
            </span>
          </header>
          <AgentEditProposalCard
            v-if="showProposalReviewActions(editView(write))"
            variant="row"
            :proposal="write.proposal"
            :message-status="messageStatus"
            :allow-live-edit-review="allowLiveEditReview"
            :remote-device="write.remoteDevice"
            @review="emit('reviewEdit', $event)"
          />
          <AgentEditProposalDiff v-else :proposal="write.proposal" inline />
        </section>
      </ConversationDetails>
    </div>
  </section>
</template>
