<script setup lang="ts">
import { ref } from "vue";
import { useConversationContentGroups } from "../composables/useConversationContentGroups";
import { useConversationLongProposals } from "../composables/useConversationLongProposals";
import { useConversationWindowPins } from "../composables/conversation-window/useConversationWindowPins";
import { useConversationMessageEditing } from "../composables/useConversationMessageEditing";
import { provideConversationDisclosureState } from "../composables/conversationDisclosureState";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { QueuedComposerMessage } from "../composables/agent-conversation/follow-up-queue";
import { useConversationSelectionInsertion } from "../composables/useConversationSelectionInsertion";
import type { AgentWelcomeContent } from "../data/agentWelcome";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest,
  EditorTextReference
} from "../types/conversation";
import AppIcon from "./AppIcon.vue";
import ConversationMessageItem from "./ConversationMessageItem.vue";
import ConversationSteeringNote from "./ConversationSteeringNote.vue";

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    responding: boolean;
    runtimeAvailable: boolean;
    deferHistoryRendering?: boolean;
    conversationSessionId?: string;
    allowLiveEditReview?: boolean;
    canRewriteHistory?: boolean;
    submitEditedMessage?:
      | ((request: ConversationMessageRewriteRequest) => Promise<boolean>)
      | undefined;
    longProposalItems?: readonly LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    /** Sent while the agent works; each joins the reply once it lands. */
    pendingMessages?: readonly QueuedComposerMessage[] | undefined;
    welcomeContent?: AgentWelcomeContent;
    showWelcomeDetails?: boolean;
    handleConversationWheel?: (event: WheelEvent) => void;
    handleConversationScroll?: () => void;
    setScroller?: (el: unknown) => void;
    setMessageList?: (el: unknown) => void;
  }>(),
  {
    allowLiveEditReview: false,
    deferHistoryRendering: true,
    canRewriteHistory: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    pendingMessages: () => [],
    showWelcomeDetails: true,
    handleConversationWheel: () => undefined,
    handleConversationScroll: () => undefined,
    setScroller: () => undefined,
    setMessageList: () => undefined
  }
);

const emit = defineEmits<{
  suggestion: [value: string];
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
  insertSelection: [reference: EditorTextReference];
}>();

provideConversationDisclosureState(() => props.conversationSessionId ?? "");
const { proposalsForRun } = useConversationLongProposals(
  () => props.longProposalItems
);
const { editingMessageId, messageIsEditable, requestEdit, cancelEdit } =
  useConversationMessageEditing({
    messages: () => props.messages,
    sessionId: () => props.conversationSessionId,
    responding: () => props.responding,
    canRewrite: () =>
      Boolean(props.canRewriteHistory && props.submitEditedMessage)
  });
const scroller = ref<HTMLElement>();
const pinnedIds = useConversationWindowPins({
  container: scroller,
  editingIds: () => (editingMessageId.value ? [editingMessageId.value] : []),
  attribute: "data-conversation-message-id"
});
const { groups, canDefer } = useConversationContentGroups({
  messages: () => props.messages,
  enabled: () => props.deferHistoryRendering,
  pinnedIds: () => pinnedIds.value
});
function setConversationScroller(element: unknown): void {
  scroller.value = element instanceof HTMLElement ? element : undefined;
  props.setScroller(element);
}
const { handleConversationContextMenu } = useConversationSelectionInsertion({
  messages: () => props.messages,
  conversationSessionId: () => props.conversationSessionId,
  insert: (reference) => emit("insertSelection", reference)
});
</script>

<template>
  <section
    :ref="setConversationScroller"
    class="conversation-scroll transient-scrollbar"
    aria-live="polite"
    @wheel.passive="handleConversationWheel"
    @scroll.passive="handleConversationScroll"
    @contextmenu="handleConversationContextMenu"
  >
    <slot v-if="messages.length === 0 && !$slots.review" name="empty">
      <div v-if="welcomeContent" class="conversation-empty">
        <div class="conversation-empty-heading">
          <AppIcon class="empty-agent-mark" name="logo" :size="36" />
          <h1>{{ welcomeContent.title }}</h1>
        </div>
        <p v-if="showWelcomeDetails">{{ welcomeContent.description }}</p>
        <div v-if="showWelcomeDetails" class="empty-suggestions">
          <button
            v-for="item in welcomeContent.questions"
            :key="item"
            type="button"
            :disabled="!runtimeAvailable"
            @click="emit('suggestion', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>
    </slot>

    <div v-else-if="messages.length" :ref="setMessageList" class="message-list">
      <div
        v-for="group in groups"
        :key="group.id"
        class="conversation-message-group"
        :class="{ 'is-deferred': canDefer(group) }"
        :style="{
          '--conversation-group-estimate': `${group.messages.length * 12}lh`
        }"
      >
        <ConversationMessageItem
          v-for="message in group.messages"
          :key="message.id"
          :message="message"
          :editable="messageIsEditable(message)"
          :editing="editingMessageId === message.id"
          :submit-edited-message="submitEditedMessage"
          :allow-live-edit-review="allowLiveEditReview"
          :long-proposal-items="proposalsForRun(message.runId)"
          :long-workspace-index="longWorkspaceIndex"
          @review-edit="emit('reviewEdit', $event)"
          @locate-edit-proposal="emit('locateEditProposal', $event)"
          @discard-edit-proposal="emit('discardEditProposal', $event)"
          @approve-long-proposal="emit('approveLongProposal', $event)"
          @reject-long-proposal="emit('rejectLongProposal', $event)"
          @retry-long-proposal-preview="
            emit('retryLongProposalPreview', $event)
          "
          @locate-long-proposal="emit('locateLongProposal', $event)"
          @request-edit="requestEdit"
          @cancel-edit="cancelEdit"
        />
      </div>
      <div v-if="pendingMessages.length" class="conversation-pending-messages">
        <ConversationSteeringNote
          v-for="item in pendingMessages"
          :key="item.id"
          :content="item.content"
          :attachments="item.attachments"
        />
      </div>
    </div>
    <slot name="review" />
  </section>
</template>

<style scoped>
.conversation-message-group {
  display: flow-root;
}
.conversation-message-group.is-deferred {
  content-visibility: auto;
  contain-intrinsic-block-size: auto var(--conversation-group-estimate);
}
.conversation-message-group.is-deferred:focus-within {
  content-visibility: visible;
}
/* Sits where the reply's next step will appear, so landing does not jump. */
.conversation-pending-messages {
  margin-top: -42px;
}
</style>
