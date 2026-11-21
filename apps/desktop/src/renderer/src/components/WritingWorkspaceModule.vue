<script setup lang="ts">
import { provideBookImageContext } from "../composables/bookImageContext";
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
import type { DraftFileKind } from "../types/workspace";
import {
  AcademicWorkspaceDialogs,
  AgentConversation
} from "./lazyAppComponents";
import {
  academicDialogTarget,
  useAcademicDialogHostClaim
} from "../stores/academicWorkspaceDialog";
import RightEditorPane from "./RightEditorPane.vue";
import WorkspacePaneResizer from "./WorkspacePaneResizer.vue";
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

const props = defineProps<{
  conversationController: AgentConversationController;
  conversationContext: WritingConversationContext;
  editor: WritingEditorViewModel;
  paneLayout: WorkspacePaneLayout;
  rightCollapsed: boolean;
}>();

provideBookImageContext(() => {
  const document = props.editor.document;
  return document.domain === "creation" &&
    document.workspaceType &&
    document.workspaceId
    ? {
        book: {
          projectType: document.workspaceType,
          projectId: document.workspaceId
        }
      }
    : undefined;
});

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
  selectDraftFile: [fileKind: DraftFileKind];
  selectEntrySearchResult: [documentId: string];
  prepareEntrySearch: [];
}>();

const ownsAcademicDialogHost = useAcademicDialogHostClaim();
</script>

<template>
  <AgentConversation
    v-if="paneLayout === 'agent-editor' || !rightCollapsed"
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
    :write-approval-items="conversationController.writeApprovalItems.value"
    :write-approval-submit-failed="
      conversationController.writeApprovalSubmitFailed.value
    "
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
    @retry-write-approval="conversationController.retryWriteApproval()"
  />

  <RightEditorPane
    v-if="paneLayout === 'editor-agent' || !rightCollapsed"
    v-bind="editor"
    :right-pane="paneLayout === 'agent-editor'"
    :right-pane-collapsed="rightCollapsed"
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

  <WorkspacePaneResizer />
  <AcademicWorkspaceDialogs
    v-if="ownsAcademicDialogHost && academicDialogTarget"
  />
</template>
