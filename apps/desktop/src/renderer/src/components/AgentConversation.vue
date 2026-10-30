<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, inject, ref } from "vue";
import {
  type AgentTeamRunMode,
  type AgentUserInputAnswer,
  type AgentUserInputRequestedPayload,
  type LibraryAgentDomain,
  type LibraryAgentSkill,
  type LongAgentId,
  type LongWorkspaceIndexSnapshot,
  type ModelConfig,
  type WorkspaceAgentId,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { resolveAgentWelcome } from "../data/agentWelcome";
import { useConversationTextReferences } from "../composables/useConversationTextReferences";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { FollowUpQueueController } from "../composables/agent-conversation/follow-up-queue";
import type {
  AgentApprovalMode,
  ChatMessage,
  ComposerReferenceOption,
  ConversationHistoryItem,
  ConversationMessageRewriteRequest,
  EditorTextReference
} from "../types/conversation";
import { uiMessage } from "../ui-feedback";
import { useConversationScrollFollow } from "../composables/useConversationScrollFollow";
import { useConversationModelOptions } from "../composables/useConversationModelOptions";
import { useWebSearchStatusStore } from "../stores/webSearchStatus";
import { useConversationTurnNavigator } from "../composables/useConversationTurnNavigator";
import AppIcon from "./AppIcon.vue";
import ConversationHistoryMenu from "./ConversationHistoryMenu.vue";
import AgentActivityFloatPanel from "./AgentActivityFloatPanel.vue";
import AgentUserInputCard from "./AgentUserInputCard.vue";
import SubagentDrawPickerCard from "./SubagentDrawPickerCard.vue";
import ConversationComposer from "./ConversationComposer.vue";
import ConversationMessageList from "./ConversationMessageList.vue";
import ConversationTurnNavigator from "./ConversationTurnNavigator.vue";
import { AGENT_ACTIVITY_CONTEXT_KEY } from "../composables/agentActivityContext";
import { workspaceWebSearchDisabledReason } from "../composables/agent-conversation/web-search";

const t = createScopedTranslator("components.agentConversation");

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    conversationHistory: ConversationHistoryItem[];
    currentSessionId: string;
    draft: string;
    responding: boolean;
    canSend: boolean;
    canSendAttachments: boolean;
    canRewriteHistory?: boolean;
    submitEditedMessage?:
      | ((request: ConversationMessageRewriteRequest) => Promise<boolean>)
      | undefined;
    canStop: boolean;
    followUps?: FollowUpQueueController | undefined;
    runtimeAvailable: boolean;
    deferHistoryRendering?: boolean;
    models: ModelConfig[];
    selectedModelId: string;
    thinkingLevel: ThinkingLevel;
    webSearchEnabled: boolean;
    temperature: number;
    approvalMode: AgentApprovalMode;
    agentTeamMode: AgentTeamRunMode;
    contextTitle: string;
    bookTitle: string;
    stageLabel: string;
    agentLabel: string;
    agentId: WorkspaceAgentId | LongAgentId | undefined;
    agentWorkspaceType?: "short" | "script" | "long";
    allowLiveEditReview?: boolean;
    libraryDomain: LibraryAgentDomain | undefined;
    librarySkills: readonly Pick<LibraryAgentSkill, "name">[] | undefined;
    welcomeShortcuts?: readonly [string, string, string] | undefined;
    availableSkills: ComposerReferenceOption[];
    availableMaterials: ComposerReferenceOption[];
    editorReferences: EditorTextReference[];
    longProposalItems?: LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    rightPane?: boolean;
    userInputRequest?: AgentUserInputRequestedPayload | null;
    userInputSubmitting?: boolean;
  }>(),
  {
    allowLiveEditReview: false,
    deferHistoryRendering: true,
    canRewriteHistory: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    rightPane: false,
    userInputRequest: null,
    userInputSubmitting: false
  }
);

const agentActivity = inject(AGENT_ACTIVITY_CONTEXT_KEY, null);
const conversationTitle = computed(() => {
  if (props.libraryDomain || !props.agentWorkspaceType) return props.agentLabel;
  const workspaceLabels = {
    short: t("shortStory"),
    script: t("screenplay"),
    long: t("novel")
  };
  return `${workspaceLabels[props.agentWorkspaceType]} · ${props.bookTitle}`;
});
const agentActivityItems = computed(() => agentActivity?.items.value ?? []);
const agentActivityCollapsed = computed(
  () => agentActivity?.collapsed.value ?? false
);
const agentActivityToggle = ref<HTMLButtonElement>();

function selectAgentActivity(conversationKey: string): void {
  void agentActivity?.selectActivity(conversationKey);
}

function collapseAgentActivity(): void {
  if (agentActivity && !agentActivity.collapsed.value)
    agentActivity.toggleCollapsed();
}

const emit = defineEmits<{
  "update:draft": [value: string];
  clearEditorReferences: [];
  removeEditorReference: [referenceId: string];
  locateEditorReference: [reference: EditorTextReference];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  suggestion: [value: string];
  toggleLeft: [];
  toggleRight: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  toggleWebSearch: [enabled: boolean];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  selectAgentTeamMode: [mode: AgentTeamRunMode];
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
  submitUserInput: [answers: AgentUserInputAnswer[]];
}>();

const {
  scroller,
  followsConversationTail,
  lockConversationTailForCurrentResponse,
  handleConversationWheel,
  handleConversationScroll
} = useConversationScrollFollow({
  messages: () => props.messages,
  responding: () => props.responding,
  currentSessionId: () => props.currentSessionId,
  longProposalItems: () => props.longProposalItems,
  pendingMessageIds: () =>
    props.followUps?.sentItems.value.map((item) => item.id) ?? [],
  onScroll: () => scheduleActiveConversationTurnUpdate()
});
const messageList = ref<HTMLElement>();

function setConversationScroller(element: unknown): void {
  scroller.value = element instanceof HTMLElement ? element : undefined;
}

function setConversationMessageList(element: unknown): void {
  messageList.value = element instanceof HTMLElement ? element : undefined;
}
const {
  composerReferences,
  insertConversationReference,
  clearComposerReferences,
  removeComposerReference,
  locateComposerReference
} = useConversationTextReferences({
  sessionId: () => props.currentSessionId,
  externalReferences: () => props.editorReferences,
  messageList,
  clearExternalReferences: () => emit("clearEditorReferences"),
  removeExternalReference: (referenceId) =>
    emit("removeEditorReference", referenceId),
  locateExternalReference: (reference) =>
    emit("locateEditorReference", reference),
  notifications: uiMessage
});
const {
  activeTurnId: activeConversationTurnId,
  scheduleActiveTurnUpdate: scheduleActiveConversationTurnUpdate,
  scrollToTurn: scrollToConversationTurn,
  turns: conversationTurns
} = useConversationTurnNavigator({
  messages: () => props.messages,
  currentSessionId: () => props.currentSessionId,
  scroller,
  messageList,
  followsTail: () => followsConversationTail.value,
  beforeNavigate: () => {
    lockConversationTailForCurrentResponse();
    followsConversationTail.value = false;
  }
});

const composer = ref<{ focusInput: () => void }>();
const welcomeContent = computed(() =>
  resolveAgentWelcome(
    props.agentId,
    props.libraryDomain,
    props.librarySkills,
    props.welcomeShortcuts,
    props.agentWorkspaceType
  )
);

function applySuggestion(value: string): void {
  emit("suggestion", value);
  composer.value?.focusInput();
}

// Search can be switched on only while the settings let a run search.
const webSearchStatus = useWebSearchStatusStore();
void webSearchStatus.ensureLoaded();
const webSearchAvailable = computed(() => webSearchStatus.usable);

const {
  selectedModel,
  availableThinkingOptions,
  modelOptions,
  showsTemperature,
  temperatureSelectOptions,
  approvalOptions,
  approvalModeIcon
} = useConversationModelOptions(props);
</script>

<template>
  <main class="conversation-pane" :aria-label="t('agentConversation')">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <button
          v-if="leftCollapsed"
          class="icon-button"
          type="button"
          :aria-label="t('expandSidebar')"
          @click="emit('toggleLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <button
          v-if="agentActivity"
          ref="agentActivityToggle"
          class="icon-button agent-activity-toggle"
          :class="{ 'is-collapsed': agentActivityCollapsed }"
          type="button"
          :aria-label="
            agentActivityCollapsed
              ? t('expandAgentActivityList')
              : t('collapseAgentActivityList')
          "
          :aria-expanded="!agentActivityCollapsed"
          aria-controls="agent-activity-panel"
          @click="agentActivity.toggleCollapsed()"
        >
          <AppIcon
            class="agent-activity-toggle-icon"
            name="panel-top"
            :size="18"
          />
          <span
            v-if="agentActivityCollapsed && agentActivityItems.length"
            class="agent-activity-toggle-badge"
            aria-hidden="true"
          >
            {{ Math.min(agentActivityItems.length, 9)
            }}{{ agentActivityItems.length > 9 ? "+" : "" }}
          </span>
        </button>
        <div>
          <strong class="conversation-title" :title="conversationTitle">{{
            conversationTitle
          }}</strong>
          <span
            v-if="libraryDomain || !agentWorkspaceType"
            class="context-caption"
            >{{ contextTitle }}</span
          >
        </div>
      </div>
      <div class="conversation-header-actions">
        <ConversationHistoryMenu
          :conversation-history="conversationHistory"
          :current-session-id="currentSessionId"
          :responding="responding"
          :book-scoped="Boolean(agentWorkspaceType)"
          @select-conversation="emit('selectConversation', $event)"
        />
        <button
          class="header-text-button"
          type="button"
          @click="emit('newConversation')"
        >
          <AppIcon name="plus" :size="16" />
          {{ t("newConversation") }}
        </button>
        <button
          v-if="rightCollapsed && !rightPane"
          class="icon-button"
          type="button"
          :aria-label="t('expandTextPane')"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
        <button
          v-if="rightPane"
          class="icon-button"
          type="button"
          :aria-label="t('collapseAgentPane')"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div
      class="conversation-body"
      :class="{ 'is-welcome': messages.length === 0 && !userInputRequest }"
    >
      <div class="conversation-scroll-shell">
        <AgentActivityFloatPanel
          v-if="agentActivity && !agentActivityCollapsed"
          id="agent-activity-panel"
          :items="agentActivityItems"
          :toggle-button="agentActivityToggle"
          @select="selectAgentActivity"
          @dismiss="collapseAgentActivity"
        />
        <ConversationMessageList
          :messages="messages"
          :responding="responding"
          :conversation-session-id="currentSessionId"
          :runtime-available="runtimeAvailable"
          :defer-history-rendering="deferHistoryRendering"
          :can-rewrite-history="canRewriteHistory"
          :submit-edited-message="submitEditedMessage"
          :allow-live-edit-review="allowLiveEditReview"
          :long-proposal-items="longProposalItems"
          :long-workspace-index="longWorkspaceIndex"
          :pending-messages="followUps?.sentItems.value"
          :welcome-content="welcomeContent"
          :show-welcome-details="
            agentWorkspaceType !== 'short' && agentWorkspaceType !== 'long'
          "
          :handle-conversation-wheel="handleConversationWheel"
          :handle-conversation-scroll="handleConversationScroll"
          :set-scroller="setConversationScroller"
          :set-message-list="setConversationMessageList"
          @suggestion="applySuggestion"
          @review-edit="emit('reviewEdit', $event)"
          @locate-edit-proposal="emit('locateEditProposal', $event)"
          @discard-edit-proposal="emit('discardEditProposal', $event)"
          @approve-long-proposal="emit('approveLongProposal', $event)"
          @reject-long-proposal="emit('rejectLongProposal', $event)"
          @retry-long-proposal-preview="
            emit('retryLongProposalPreview', $event)
          "
          @locate-long-proposal="emit('locateLongProposal', $event)"
          @insert-selection="insertConversationReference"
        />

        <ConversationTurnNavigator
          v-if="conversationTurns.length"
          :turns="conversationTurns"
          :active-turn-id="activeConversationTurnId"
          @select="scrollToConversationTurn"
        />
      </div>

      <footer v-if="userInputRequest" class="composer-wrap">
        <div class="composer-stack">
          <SubagentDrawPickerCard
            v-if="userInputRequest.draw"
            :request="{ ...userInputRequest, draw: userInputRequest.draw }"
            :submitting="userInputSubmitting"
            :messages="messages"
            @submit="emit('submitUserInput', $event)"
          />
          <AgentUserInputCard
            v-else
            :request="userInputRequest"
            :submitting="userInputSubmitting"
            @submit="emit('submitUserInput', $event)"
          />
        </div>
      </footer>

      <ConversationComposer
        v-else
        ref="composer"
        :draft="draft"
        :responding="responding"
        :can-send="canSend"
        :can-send-attachments="canSendAttachments"
        :can-stop="canStop"
        :follow-ups="followUps"
        :runtime-available="runtimeAvailable"
        :current-session-id="currentSessionId"
        :messages="messages"
        :messages-empty="messages.length === 0"
        :book-title="bookTitle"
        :stage-label="stageLabel"
        :selected-model-id="selectedModelId"
        :selected-model="selectedModel"
        :thinking-level="thinkingLevel"
        :web-search-enabled="webSearchEnabled"
        :web-search-available="webSearchAvailable"
        :web-search-disabled-reason="workspaceWebSearchDisabledReason()"
        :temperature="temperature"
        :approval-mode="approvalMode"
        :agent-team-mode="agentTeamMode"
        :agent-id="agentId"
        :agent-workspace-type="agentWorkspaceType"
        :library-domain="libraryDomain"
        :available-skills="availableSkills"
        :available-materials="availableMaterials"
        :editor-references="composerReferences"
        :model-options="modelOptions"
        :available-thinking-options="availableThinkingOptions"
        :shows-temperature="showsTemperature"
        :temperature-select-options="temperatureSelectOptions"
        :approval-options="approvalOptions"
        :approval-mode-icon="approvalModeIcon"
        @update:draft="emit('update:draft', $event)"
        @send="emit('send', $event)"
        @stop="emit('stop')"
        @clear-editor-references="clearComposerReferences"
        @remove-editor-reference="removeComposerReference"
        @locate-editor-reference="locateComposerReference"
        @select-model="emit('selectModel', $event)"
        @select-thinking="emit('selectThinking', $event)"
        @toggle-web-search="emit('toggleWebSearch', $event)"
        @select-temperature="emit('selectTemperature', $event)"
        @select-approval="emit('selectApproval', $event)"
        @select-agent-team-mode="emit('selectAgentTeamMode', $event)"
      />
    </div>
  </main>
</template>

<style scoped>
.conversation-pane {
  grid-template-rows: 50px minmax(0, 1fr);
}

html[data-platform="darwin"] .conversation-pane {
  grid-template-rows: 52px minmax(0, 1fr);
}

.conversation-body {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.conversation-body.is-welcome {
  grid-template-rows: minmax(max-content, 1fr) auto minmax(0, 1fr);
  row-gap: 36px;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  padding-top: 72px;
}

.is-welcome .conversation-scroll-shell {
  position: static;
  align-self: end;
  width: 100%;
  overflow: visible;
}

.is-welcome :deep(.conversation-scroll) {
  height: auto;
  overflow: visible;
}

.is-welcome :deep(.conversation-empty) {
  min-height: 0;
  padding: 0;
}

.is-welcome :deep(.composer-wrap) {
  width: 100%;
  padding-top: 0;
  padding-bottom: 0;
  background: none;
}

.is-welcome :deep(.composer textarea) {
  min-height: 74px;
}

.conversation-heading-start .conversation-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-header-actions {
  flex-shrink: 0;
}
</style>
