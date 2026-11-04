<script setup lang="ts">
import { builtinAgentLabel } from "../i18n/builtinLabels";
import { createScopedTranslator } from "../i18n";
import { computed, watch } from "vue";
import type {
  AgentTeamRunMode,
  LongArcId,
  LongAgentProfile,
  LongBookSummary,
  LongChapterCardId,
  LongCharacterId,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWriteDocumentResult,
  TextViewMode,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspacePaneLayout
} from "@deepwrite/contracts";
import type { AgentConversationController } from "../composables/useAgentConversation";
import { useLongWorkspaceModuleEditorBridge } from "../composables/useLongWorkspaceModuleEditorBridge";
import { usePendingEditorReferences } from "../composables/usePendingEditorReferences";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { LongWorkspaceEditorPort } from "../composables/useLongWorkspaceSessionCoordinator";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import type {
  AgentApprovalMode,
  ComposerReferenceOption,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { LONG_WORKSPACE_ROOT_LABELS } from "../utils/longWorkspaceResourceTree";
import { uiMessage } from "../ui-feedback";
import AgentConversation from "./AgentConversation.vue";
import AppIcon from "./AppIcon.vue";
import LongWorkspaceEditor from "./LongWorkspaceEditor.vue";
import LongWorkspaceLoading from "./LongWorkspaceLoading.vue";
import LongWorkspacePanePlaceholder from "./LongWorkspacePanePlaceholder.vue";

const t = createScopedTranslator("components.longWorkspaceModule");

const props = defineProps<{
  conversationController: AgentConversationController | null;
  book: LongBookSummary | null;
  selection: LongWorkspaceSelection | null;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  agentProfile: LongAgentProfile | null;
  availableSkillReferences: ComposerReferenceOption[];
  availableMaterialReferences: ComposerReferenceOption[];
  proposalItems: LongWorkspaceProposalItem[];
  refreshStatus: LongWorkspaceRefreshStatus | null;
  runtimeAvailable: boolean;
  sendContextReady: boolean;
  sendPreflightPending: boolean;
  editorLocked: boolean;
  editorLockedReason: string | undefined;
  loading: boolean;
  leftCollapsed: boolean;
  paneLayout: WorkspacePaneLayout;
  defaultTextViewMode: TextViewMode;
  autoSaveEnabled: boolean;
  rightPane: Readonly<{
    collapsed: boolean;
    minWidth: number;
    maxWidth: number;
    width: number;
  }>;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  editorPortChange: [port: LongWorkspaceEditorPort | null];
  expandLeft: [];
  toggleLeft: [];
  toggleRight: [];
  collapseRight: [];
  resizeStart: [event: PointerEvent];
  resizeKeydown: [event: KeyboardEvent];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [
    request: UserPromptAttachment[] | ConversationMessageRewriteRequest,
    completion?: (started: boolean) => void
  ];
  stop: [];
  suggestion: [value: string];
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
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
  retryWorkspaceRefresh: [];
  saved: [result: LongWriteDocumentResult];
  contextChange: [context: LongWorkspaceFileContext | null];
  selectCharacter: [
    characterId: LongCharacterId,
    done?: (accepted: boolean) => void
  ];
  selectPlotPoint: [plotPointId: LongArcId];
  selectChapterCard: [chapterCardId: LongChapterCardId];
  selectEntrySearchResult: [fileId: string];
  renameCharacter: [
    input: { characterId: LongCharacterId; name: string },
    completion: (succeeded: boolean) => void
  ];
  renameStructureTitle: [
    input: {
      kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (succeeded: boolean) => void
  ];
  createCharacter: [];
  createWorldbuildingItem: [];
  createPlotPoint: [];
  createChapterCard: [];
  createVolume: [];
  previewDeleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  deleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ];
  saveVolumeOutline: [
    input: { volumeId: string; outline: string },
    completion: (succeeded: boolean) => void
  ];
  savePlotPointContent: [
    input: {
      plotPointId: LongArcId;
      field: "summary";
      content: string;
    },
    completion: (succeeded: boolean) => void
  ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  previewMutation: [
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
}>();

const conversationDraft = computed({
  get: () => props.conversationController?.draft.value ?? "",
  set: (value: string) => emit("update:draft", value)
});
const activeStageLabel = computed(
  () => LONG_WORKSPACE_ROOT_LABELS[props.selection?.root ?? "worldbuilding"]
);
const canRewriteHistory = computed(
  () =>
    Boolean(
      props.conversationController?.canRewriteHistory.value &&
      !props.sendPreflightPending &&
      !props.editorLocked &&
      props.sendContextReady
    ) && props.proposalItems.every((item) => item.status === "accepted")
);
const {
  editorReferences,
  insertEditorReference,
  removeEditorReference,
  clearEditorReferences
} = usePendingEditorReferences(uiMessage);

watch(
  () => [props.book?.id, props.selection?.key] as const,
  clearEditorReferences
);

function submitEditedMessage(
  request: ConversationMessageRewriteRequest
): Promise<boolean> {
  if (!canRewriteHistory.value) return Promise.resolve(false);
  return new Promise((resolve) => emit("send", request, resolve));
}

const { captureEditorPort, locateEditorReference } =
  useLongWorkspaceModuleEditorBridge({
    publish: (port) => emit("editorPortChange", port),
    warn: (message) => uiMessage.warning(message)
  });

function forwardSelectCharacter(
  characterId: LongCharacterId,
  done?: (accepted: boolean) => void
): void {
  emit("selectCharacter", characterId, done);
}

function forwardRenameCharacter(
  input: { characterId: LongCharacterId; name: string },
  completion: (succeeded: boolean) => void
): void {
  emit("renameCharacter", input, completion);
}

function forwardRenameStructureTitle(
  input: {
    kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (succeeded: boolean) => void
): void {
  emit("renameStructureTitle", input, completion);
}

function forwardDeleteStructure(
  input: {
    kind: "character" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
    expectedImpact: LongWorkspaceImpactConfirmation;
  },
  completion: (
    succeeded: boolean,
    changedImpact?: LongWorkspaceImpactConfirmation
  ) => void
): void {
  emit("deleteStructure", input, completion);
}

function forwardPreviewDeleteStructure(
  input: {
    kind: "character" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (impact?: LongWorkspaceImpactConfirmation) => void
): void {
  emit("previewDeleteStructure", input, completion);
}

function forwardSaveVolumeOutline(
  input: { volumeId: string; outline: string },
  completion: (succeeded: boolean) => void
): void {
  emit("saveVolumeOutline", input, completion);
}

function forwardSavePlotPointContent(
  input: {
    plotPointId: LongArcId;
    field: "summary";
    content: string;
  },
  completion: (succeeded: boolean) => void
): void {
  emit("savePlotPointContent", input, completion);
}

function forwardMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion
): void {
  emit("mutation", batch, completion);
}

function forwardPreviewMutation(
  batch: LongWorkspaceOperationBatch,
  completion: (impact?: LongWorkspaceImpactConfirmation) => void
): void {
  emit("previewMutation", batch, completion);
}
</script>

<template>
  <template v-if="book">
    <div
      v-show="paneLayout === 'agent-editor' || !rightPane.collapsed"
      class="long-agent-column"
      :aria-label="t('novelWorkspace')"
    >
      <button
        v-if="leftCollapsed && !(conversationController && agentProfile)"
        class="icon-button long-workspace-expand-sidebar"
        type="button"
        :aria-label="t('expandSidebar')"
        @click="emit('expandLeft')"
      >
        <AppIcon name="panel-left" :size="18" />
      </button>
      <AgentConversation
        v-if="conversationController && agentProfile"
        class="long-agent-conversation"
        v-model:draft="conversationDraft"
        :messages="conversationController.messages.value"
        :conversation-history="conversationController.history.value"
        :current-session-id="conversationController.sessionId.value"
        :responding="conversationController.isBusy.value"
        :can-send="
          !sendPreflightPending &&
          sendContextReady &&
          conversationController.canSend.value
        "
        :can-send-attachments="conversationController.canSendAttachments.value"
        :can-rewrite-history="canRewriteHistory"
        :submit-edited-message="submitEditedMessage"
        :can-stop="conversationController.canStop.value"
        :follow-ups="conversationController.followUps"
        :runtime-available="runtimeAvailable"
        :models="conversationController.configuredModels.value"
        :selected-model-id="conversationController.selectedModelId.value"
        :thinking-level="conversationController.thinkingLevel.value"
        :web-search-enabled="conversationController.webSearchEnabled.value"
        :temperature="conversationController.temperature.value"
        :approval-mode="conversationController.approvalMode.value"
        :agent-team-mode="conversationController.agentTeamMode.value"
        allow-live-edit-review
        :context-title="selection?.title ?? book.title"
        :book-title="book.title"
        :stage-label="activeStageLabel"
        :agent-label="builtinAgentLabel('long', agentProfile.label)"
        :agent-id="agentProfile.id"
        agent-workspace-type="long"
        :agent-book-id="book.id"
        :library-domain="undefined"
        :library-skills="undefined"
        :available-skills="availableSkillReferences"
        :available-materials="availableMaterialReferences"
        :editor-references="editorReferences"
        :long-proposal-items="proposalItems"
        :long-workspace-index="workspaceIndex"
        :user-input-request="conversationController.pendingUserInput.value"
        :user-input-submitting="
          conversationController.submittingUserInput.value
        "
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightPane.collapsed"
        :right-pane="paneLayout === 'editor-agent'"
        @new-conversation="emit('newConversation')"
        @select-conversation="emit('selectConversation', $event)"
        @send="emit('send', $event)"
        @stop="emit('stop')"
        @suggestion="emit('suggestion', $event)"
        @toggle-left="emit('toggleLeft')"
        @toggle-right="emit('toggleRight')"
        @select-model="emit('selectModel', $event)"
        @select-thinking="emit('selectThinking', $event)"
        @toggle-web-search="
          conversationController.selectWebSearchEnabled($event)
        "
        @select-temperature="emit('selectTemperature', $event)"
        @select-approval="emit('selectApproval', $event)"
        @select-agent-team-mode="emit('selectAgentTeamMode', $event)"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
        @clear-editor-references="clearEditorReferences"
        @remove-editor-reference="removeEditorReference"
        @locate-editor-reference="locateEditorReference"
        @submit-user-input="conversationController.submitUserInput($event)"
      />
      <LongWorkspacePanePlaceholder v-else kind="agent" />
      <section
        v-if="refreshStatus?.error"
        class="long-workspace-refresh-status is-error"
        aria-live="polite"
      >
        <span>{{ t("theLatestWorkspaceIndexHasNotSyncedSendingTo") }}</span>
        <button type="button" @click="emit('retryWorkspaceRefresh')">
          {{ t("syncAgain") }}
        </button>
      </section>
    </div>
    <template v-if="workspaceIndex">
      <LongWorkspaceEditor
        v-show="paneLayout === 'editor-agent' || !rightPane.collapsed"
        :ref="captureEditorPort"
        :book-id="book.id"
        :selection="selection"
        :workspace-index="workspaceIndex"
        :locked="editorLocked"
        :locked-reason="editorLockedReason"
        :right-pane="paneLayout === 'agent-editor'"
        :right-pane-collapsed="rightPane.collapsed"
        :default-view-mode="defaultTextViewMode"
        :auto-save-enabled="autoSaveEnabled"
        @insert-selection="insertEditorReference"
        @saved="emit('saved', $event)"
        @context-change="emit('contextChange', $event)"
        @collapse="emit('collapseRight')"
        @toggle-right="emit('toggleRight')"
        @select-character="forwardSelectCharacter"
        @select-plot-point="emit('selectPlotPoint', $event)"
        @select-chapter-card="emit('selectChapterCard', $event)"
        @select-entry-search-result="emit('selectEntrySearchResult', $event)"
        @rename-character="forwardRenameCharacter"
        @rename-structure-title="forwardRenameStructureTitle"
        @create-character="emit('createCharacter')"
        @create-worldbuilding-item="emit('createWorldbuildingItem')"
        @create-plot-point="emit('createPlotPoint')"
        @create-chapter-card="emit('createChapterCard')"
        @create-volume="emit('createVolume')"
        @preview-delete-structure="forwardPreviewDeleteStructure"
        @delete-structure="forwardDeleteStructure"
        @save-volume-outline="forwardSaveVolumeOutline"
        @save-plot-point-content="forwardSavePlotPointContent"
        @preview-mutation="forwardPreviewMutation"
        @mutation="forwardMutation"
      />
    </template>
    <LongWorkspacePanePlaceholder
      v-else-if="paneLayout === 'editor-agent' || !rightPane.collapsed"
      kind="editor"
      :right-pane="paneLayout === 'agent-editor'"
      :loading="loading"
    />
    <div
      v-if="!rightPane.collapsed"
      class="pane-resizer pane-resizer-right"
      role="separator"
      :aria-label="t('resizeRightPane')"
      aria-orientation="vertical"
      :aria-valuemin="rightPane.minWidth"
      :aria-valuemax="rightPane.maxWidth"
      :aria-valuenow="rightPane.width"
      tabindex="0"
      @pointerdown="emit('resizeStart', $event)"
      @keydown="emit('resizeKeydown', $event)"
    />
  </template>
  <LongWorkspaceLoading
    v-else
    :left-collapsed="leftCollapsed"
    :right-pane="rightPane"
    :pane-layout="paneLayout"
    :pending="loading"
    @expand-left="emit('expandLeft')"
  />
</template>
