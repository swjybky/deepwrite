<script setup lang="ts">
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { ChatMessage } from "../types/conversation";
import {
  hasProcessing,
  hasProcessingDisclosure,
  processingDisplayItems,
  processingLabel
} from "./conversationToolPresentation";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
import ConversationRunClock from "./ConversationRunClock.vue";
import ConversationProcessingItem from "./ConversationProcessingItem.vue";
import SubagentRunList from "./SubagentRunList.vue";

withDefaults(
  defineProps<{
    message: ChatMessage;
    allowLiveEditReview?: boolean;
    longProposalItems?: readonly LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
  }>(),
  {
    allowLiveEditReview: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null
  }
);

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
</script>

<template>
  <div
    v-if="
      (hasProcessing(message) ||
        message.retry ||
        message.processingStartedAt) &&
      message.status === 'streaming'
    "
    class="processing-live-list"
    aria-label="运行过程"
  >
    <div class="processing-live-status" aria-live="off">
      <ConversationRunClock
        v-slot="{ now }"
        :active="message.status === 'streaming'"
      >
        {{ processingLabel(message, now) }}
      </ConversationRunClock>
    </div>
    <ConversationProcessingItem
      v-for="item in processingDisplayItems(message, true, longProposalItems)"
      :key="item.id"
      :item="item"
      streaming
      :message-status="message.status"
      :allow-live-edit-review="allowLiveEditReview"
      :long-workspace-index="longWorkspaceIndex"
      @review-edit="emit('reviewEdit', $event)"
      @locate-edit-proposal="emit('locateEditProposal', $event)"
      @discard-edit-proposal="emit('discardEditProposal', $event)"
      @approve-long-proposal="emit('approveLongProposal', $event)"
      @reject-long-proposal="emit('rejectLongProposal', $event)"
      @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
      @locate-long-proposal="emit('locateLongProposal', $event)"
    />
  </div>

  <ConversationDetails
    v-else-if="hasProcessingDisclosure(message)"
    :detail-id="`${message.id}:processing`"
    class="processing-block"
  >
    <template #summary>
      <span
        ><ConversationRunClock
          v-slot="{ now }"
          :active="message.status === 'streaming'"
        >
          {{ processingLabel(message, now) }}
        </ConversationRunClock></span
      >
      <AppIcon name="chevron" :size="13" />
    </template>
    <div class="processing-content">
      <ConversationProcessingItem
        v-for="item in processingDisplayItems(message)"
        :key="item.id"
        :item="item"
        :streaming="false"
        :message-status="message.status"
        :allow-live-edit-review="allowLiveEditReview"
        :long-workspace-index="longWorkspaceIndex"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @discard-edit-proposal="emit('discardEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
      />
      <SubagentRunList v-if="message.subagentRuns?.length" :message="message" />
    </div>
  </ConversationDetails>

  <SubagentRunList
    v-if="message.subagentRuns?.length && message.status === 'streaming'"
    :message="message"
  />
</template>
