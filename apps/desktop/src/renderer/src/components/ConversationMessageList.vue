<script setup lang="ts">
import { computed, ref } from "vue";
import { useConversationContentGroups } from "../composables/useConversationContentGroups";
import { useConversationWindowPins } from "../composables/conversation-window/useConversationWindowPins";
import { useConversationMessageEditing } from "../composables/useConversationMessageEditing";
import { provideConversationDisclosureState } from "../composables/conversationDisclosureState";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { useSelectionInsertionMenu } from "../composables/useSelectionInsertionMenu";
import type { AgentWelcomeContent } from "../data/agentWelcome";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest,
  EditorTextReference
} from "../types/conversation";
import { createConversationTextReference } from "../utils/editorTextReferences";
import AppIcon from "./AppIcon.vue";
import ConversationMessageItem from "./ConversationMessageItem.vue";
import EditorSelectionMenu from "./EditorSelectionMenu.vue";

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
    welcomeContent?: AgentWelcomeContent;
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

const hasStreamingAssistant = computed(() =>
  props.messages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
);
provideConversationDisclosureState(() => props.conversationSessionId ?? "");
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
const {
  selectionAction,
  closeSelectionAction,
  openSelectionAction,
  insertSelectedText
} = useSelectionInsertionMenu({
  insert: (reference) => emit("insertSelection", reference)
});

function handleConversationContextMenu(event: MouseEvent): void {
  const target = event.target;
  const list = event.currentTarget;
  if (!(target instanceof Element) || !(list instanceof HTMLElement)) return;
  const response = target.closest<HTMLElement>(
    "[data-assistant-response-message-id]"
  );
  const selection = globalThis.getSelection?.();
  if (
    !response ||
    !list.contains(response) ||
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount !== 1 ||
    !response.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    closeSelectionAction();
    return;
  }

  const messageId = response.dataset.assistantResponseMessageId;
  const sessionId = props.conversationSessionId;
  if (!messageId || !sessionId) return;
  const responseNumber =
    props.messages
      .filter(({ role }) => role === "assistant")
      .findIndex(({ id }) => id === messageId) + 1;
  if (responseNumber < 1) return;
  const reference = createConversationTextReference({
    id: randomHex8(),
    sessionId,
    messageId,
    messageLabel: `智能体回复 ${responseNumber}`,
    text: selection.toString()
  });
  if (!reference) return;
  openSelectionAction(reference, event);
  event.preventDefault();
}
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
    <slot v-if="messages.length === 0" name="empty">
      <div v-if="welcomeContent" class="conversation-empty">
        <span class="empty-agent-mark"><AppIcon name="logo" :size="40" /></span>
        <h1>{{ welcomeContent.title }}</h1>
        <p>{{ welcomeContent.description }}</p>
        <div class="empty-suggestions">
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

    <div v-else :ref="setMessageList" class="message-list">
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
          :long-proposal-items="longProposalItems"
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

      <article
        v-if="responding && !hasStreamingAssistant"
        class="message is-assistant is-thinking"
      >
        <div class="thinking-row"><span>正在思考</span></div>
      </article>
    </div>
  </section>
  <EditorSelectionMenu
    v-if="selectionAction"
    :left="selectionAction.left"
    :top="selectionAction.top"
    @insert="insertSelectedText"
  />
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
</style>
