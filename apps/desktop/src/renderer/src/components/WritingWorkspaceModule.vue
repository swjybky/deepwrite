<script setup lang="ts">
import { t } from "../i18n";
import type {
  AgentTeamRunMode,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspacePaneLayout
} from "@deepwrite/contracts";
import type {
  AgentApprovalMode,
  EditorTextReference
} from "../types/conversation";
import type { AgentConversationController } from "../composables/useAgentConversation";
import { AgentConversation } from "./lazyAppComponents";
import RightEditorPane from "./RightEditorPane.vue";
import type { EditorCompositionChange } from "../composables/useEditorComposition";

type AgentConversationPublicProps = InstanceType<
  typeof AgentConversation
>["$props"];
type RightEditorPanePublicProps = InstanceType<
  typeof RightEditorPane
>["$props"];

type WritingConversationContext = Readonly<
  Pick<
    AgentConversationPublicProps,
    | "runtimeAvailable"
    | "canRewriteHistory"
    | "submitEditedMessage"
    | "contextTitle"
    | "bookTitle"
    | "stageLabel"
    | "agentLabel"
    | "agentId"
    | "agentWorkspaceType"
    | "agentBookId"
    | "allowLiveEditReview"
    | "libraryDomain"
    | "librarySkills"
    | "welcomeShortcuts"
    | "availableSkills"
    | "availableMaterials"
    | "editorReferences"
    | "leftCollapsed"
    | "rightCollapsed"
  >
>;

type WritingEditorViewModel = Readonly<
  Pick<
    RightEditorPanePublicProps,
    | "document"
    | "resourceId"
    | "draftState"
    | "locateReference"
    | "locked"
    | "lockedLabel"
    | "saving"
    | "manualSaving"
    | "formatAllPending"
    | "autoSaveEnabled"
    | "defaultViewMode"
    | "boundToCurrentBook"
    | "sectionTabs"
    | "activeSectionId"
    | "sectionTabsLabel"
    | "canCreateSection"
    | "createSectionLabel"
    | "showDeleteSection"
    | "canDeleteSection"
    | "deleteSectionLabel"
    | "entrySearchItems"
  >
>;

defineProps<{
  conversationController: AgentConversationController;
  conversationContext: WritingConversationContext;
  editor: WritingEditorViewModel;
  paneLayout: WorkspacePaneLayout;
  rightPane: Readonly<{
    collapsed: boolean;
    minWidth: number;
    maxWidth: number;
    width: number;
  }>;
}>();

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
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  compositionChange: [change: EditorCompositionChange];
  formatAllBodies: [];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  deleteSection: [];
  selectDraftFile: [fileKind: "body" | "character-state"];
  selectEntrySearchResult: [documentId: string];
  prepareEntrySearch: [];
  resizeStart: [event: PointerEvent];
  resizeKeydown: [event: KeyboardEvent];
}>();
</script>

<template>
  <AgentConversation
    v-if="paneLayout === 'agent-editor' || !rightPane.collapsed"
    v-bind="conversationContext"
    :right-pane="paneLayout === 'editor-agent'"
    :messages="conversationController.messages.value"
    :conversation-history="conversationController.history.value"
    :current-session-id="conversationController.sessionId.value"
    :draft="conversationController.draft.value"
    :responding="conversationController.isBusy.value"
    :can-send="conversationController.canSend.value"
    :can-send-attachments="conversationController.canSendAttachments.value"
    :can-stop="conversationController.canStop.value"
    :follow-ups="conversationController.followUps"
    :models="conversationController.configuredModels.value"
    :selected-model-id="conversationController.selectedModelId.value"
    :thinking-level="conversationController.thinkingLevel.value"
    :web-search-enabled="conversationController.webSearchEnabled.value"
    :temperature="conversationController.temperature.value"
    :approval-mode="conversationController.approvalMode.value"
    :agent-team-mode="conversationController.agentTeamMode.value"
    :user-input-request="conversationController.pendingUserInput.value"
    :user-input-submitting="conversationController.submittingUserInput.value"
    @update:draft="emit('update:draft', $event)"
    @new-conversation="emit('newConversation')"
    @select-conversation="emit('selectConversation', $event)"
    @send="emit('send', $event)"
    @stop="emit('stop')"
    @suggestion="emit('suggestion', $event)"
    @toggle-left="emit('toggleLeft')"
    @toggle-right="emit('toggleRight')"
    @select-model="emit('selectModel', $event)"
    @select-thinking="emit('selectThinking', $event)"
    @toggle-web-search="conversationController.selectWebSearchEnabled($event)"
    @select-temperature="emit('selectTemperature', $event)"
    @select-approval="emit('selectApproval', $event)"
    @select-agent-team-mode="emit('selectAgentTeamMode', $event)"
    @review-edit="emit('reviewEdit', $event)"
    @locate-edit-proposal="emit('locateEditProposal', $event)"
    @discard-edit-proposal="emit('discardEditProposal', $event)"
    @clear-editor-references="emit('clearEditorReferences')"
    @remove-editor-reference="emit('removeEditorReference', $event)"
    @locate-editor-reference="emit('locateEditorReference', $event)"
    @submit-user-input="conversationController.submitUserInput($event)"
  />

  <RightEditorPane
    v-if="paneLayout === 'editor-agent' || !rightPane.collapsed"
    v-bind="editor"
    :right-pane="paneLayout === 'agent-editor'"
    :right-pane-collapsed="rightPane.collapsed"
    @collapse="emit('collapse')"
    @toggle-right="emit('toggleRight')"
    @save="emit('save', $event)"
    @live-change="emit('liveChange', $event)"
    @composition-change="emit('compositionChange', $event)"
    @format-all-bodies="emit('formatAllBodies')"
    @insert-selection="emit('insertSelection', $event)"
    @select-section="emit('selectSection', $event)"
    @create-section="emit('createSection')"
    @delete-section="emit('deleteSection')"
    @select-draft-file="emit('selectDraftFile', $event)"
    @select-entry-search-result="emit('selectEntrySearchResult', $event)"
    @prepare-entry-search="emit('prepareEntrySearch')"
  />

  <div
    v-if="!rightPane.collapsed"
    class="pane-resizer pane-resizer-right"
    role="separator"
    :aria-label="t('components.writingWorkspaceModule.resizeRightPane')"
    aria-orientation="vertical"
    :aria-valuemin="rightPane.minWidth"
    :aria-valuemax="rightPane.maxWidth"
    :aria-valuenow="rightPane.width"
    tabindex="0"
    @pointerdown="emit('resizeStart', $event)"
    @keydown="emit('resizeKeydown', $event)"
  />
</template>
