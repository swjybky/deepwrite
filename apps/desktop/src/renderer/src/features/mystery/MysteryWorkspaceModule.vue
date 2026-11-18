<script setup lang="ts">
import type {
  CatalogIndexSnapshot,
  CatalogSnapshot,
  MysteryAgentProfile,
  MysteryDocumentTarget,
  MysteryOperation,
  RestoreDocumentVersionResult,
  TextViewMode,
  UserPromptAttachment,
  WorkspacePaneLayout
} from "@deepwrite/contracts";
import {
  getDefaultMysteryAgentProfile,
  mysteryDocumentTargetKey,
  mysteryDocumentTitle,
  mysteryDocumentExistsInManifest,
  mysteryStageForTarget
} from "@deepwrite/contracts/renderer";
import { computed, inject, onScopeDispose, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { SaveConflictDialog } from "../../components/lazyAppComponents";
import AgentConversation from "../../components/AgentConversation.vue";
import { OPEN_WORKSPACE_RESOURCE } from "../../composables/composerContextNavigationContext";
import { usePendingEditorReferences } from "../../composables/usePendingEditorReferences";
import { provideBookImageContext } from "../../composables/bookImageContext";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { formatError } from "../../i18n/errors";
import { t } from "../../i18n";
import { useLayoutStore } from "../../stores/layoutStore";
import { registerMysteryWorkspaceNavigation } from "../../stores/mysteryWorkspaceNavigation";
import {
  mysteryConversationKey,
  mysteryDocumentResourceId,
  useMysteryWorkspaceStore
} from "../../stores/mysteryWorkspaceStore";
import type {
  ConversationMessageRewriteRequest,
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../../types/conversation";
import { uiMessage } from "../../ui-feedback";
import { mysteryStagePresentation } from "../../utils/mysteryWorkspaceResourceTree";
import { mysteryT } from "./messages";
import {
  buildMysteryReferenceOptions,
  resolveMysteryAttachedLibraries
} from "./mysteryAttachments";
import { mysteryLabels } from "./mysterySharedLabels";
import MysteryDialogs, { type MysteryDialogState } from "./MysteryDialogs.vue";
import MysteryEditorPane from "./MysteryEditorPane.vue";
import MysteryProposalBanner from "./MysteryProposalBanner.vue";
import { useMysteryDocument } from "./useMysteryDocument";

const props = defineProps<{
  bookId: string;
  catalogSnapshot: CatalogIndexSnapshot | CatalogSnapshot | null;
  conversationForKey: (
    key: string,
    scope: string
  ) => AgentConversationController;
  autoSaveEnabled: boolean;
  defaultTextViewMode: TextViewMode;
  paneLayout: WorkspacePaneLayout;
  runtimeAvailable: boolean;
  onBookRemoved?: (() => void) | undefined;
}>();

let active = true;
onScopeDispose(() => {
  active = false;
});
const mysteryStore = useMysteryWorkspaceStore();
const { selectedTarget } = storeToRefs(mysteryStore);
const layoutStore = useLayoutStore();
const {
  leftCollapsed,
  rightCollapsed,
  writingRightPaneViewModel: rightPane
} = storeToRefs(layoutStore);

const manifest = computed(() => mysteryStore.activeBook);
const workspaceIndex = computed(() => mysteryStore.activeWorkspaceIndex);

provideBookImageContext(() => ({
  book: { projectType: "mystery", projectId: props.bookId }
}));

const activeStage = computed(() => mysteryStageForTarget(selectedTarget.value));

const {
  docContent,
  docDirty,
  docLoading,
  docSaving,
  conflict,
  reloadConflict,
  overwriteConflict,
  docReady,
  composing,
  handleContentUpdate,
  loadDocument,
  flushDocument
} = useMysteryDocument({
  api: () => window.deepwrite?.mystery,
  bookId: () => props.bookId,
  target: () => selectedTarget.value,
  selectTarget: (target) => {
    selectedTarget.value = target;
  },
  autoSaveEnabled: () => props.autoSaveEnabled,
  async refreshBook(summary) {
    mysteryStore.upsertSummary(summary);
    await mysteryStore.refreshActiveBook(summary.id);
  },
  onLoadError: (error) =>
    uiMessage.error(formatError(error, mysteryT("actionFailed"))),
  onSaveError: (error) =>
    uiMessage.error(formatError(error, mysteryT("saveFailed")))
});

// UI state
const opBusy = ref(false);
const activeDialog = ref<MysteryDialogState | null>(null);
const agentProfile = ref<MysteryAgentProfile>(
  getDefaultMysteryAgentProfile("mystery")
);

const conversationController = computed(() =>
  props.conversationForKey(mysteryConversationKey(props.bookId), "mystery")
);

const pendingProposals = computed(() =>
  (mysteryStore.proposalsByBookId[props.bookId] ?? []).filter(
    (proposal) =>
      proposal.status === "pending" || proposal.status === "applying"
  )
);
const lastRestore = computed(
  () => mysteryStore.lastRestoreByBookId[props.bookId]
);

const libraryRefs = computed(() =>
  buildMysteryReferenceOptions(props.catalogSnapshot, manifest.value)
);

const stage = computed(() => mysteryStagePresentation(activeStage.value));
const openResource = inject(OPEN_WORKSPACE_RESOURCE);
const referenceNavigation = ref<EditorTextReferenceNavigation>();
const {
  editorReferences,
  insertEditorReference,
  removeEditorReference,
  clearEditorReferences
} = usePendingEditorReferences(uiMessage);
watch(
  [() => props.bookId, () => conversationController.value.sessionId.value],
  clearEditorReferences
);

async function locateReference(reference: EditorTextReference): Promise<void> {
  if (await openResource?.(reference.resourceId)) {
    referenceNavigation.value = {
      requestId: (referenceNavigation.value?.requestId ?? 0) + 1,
      reference
    };
  }
}
function canLocateTarget(target: MysteryDocumentTarget): boolean {
  return Boolean(
    manifest.value && mysteryDocumentExistsInManifest(manifest.value, target)
  );
}
function locateTarget(target: MysteryDocumentTarget): void {
  void openResource?.(mysteryDocumentResourceId(props.bookId, target));
}

async function handleSelectTarget(
  target: MysteryDocumentTarget
): Promise<boolean> {
  if (!canLocateTarget(target)) return false;
  if (
    docReady.value &&
    !docLoading.value &&
    mysteryDocumentTargetKey(target) ===
      mysteryDocumentTargetKey(selectedTarget.value)
  )
    return true;
  return loadDocument(target);
}

watch(
  () => [props.bookId, mysteryStore.revisionBump] as const,
  async ([bookId]) => {
    if (
      manifest.value?.id !== bookId ||
      workspaceIndex.value?.bookId !== bookId
    )
      return;
    const target = canLocateTarget(selectedTarget.value)
      ? selectedTarget.value
      : ({ kind: "truth_doc", docId: "core_truth" } as const);
    await loadDocument(target);
  },
  { immediate: true }
);
watch(
  () => props.bookId,
  async (bookId) => {
    const profiles = await window.deepwrite?.mystery
      ?.listAgents()
      .catch(() => undefined);
    if (bookId === props.bookId && profiles?.agents[0])
      agentProfile.value = profiles.agents[0];
  },
  { immediate: true }
);

async function reloadRestoredDocument(
  result: RestoreDocumentVersionResult
): Promise<void> {
  if (result.workspace !== "mystery") return;
  const { bookId, target, summary } = result.document;
  if (
    bookId === props.bookId &&
    mysteryDocumentTargetKey(target) ===
      mysteryDocumentTargetKey(selectedTarget.value)
  )
    await loadDocument();
  mysteryStore.upsertSummary(summary);
  await mysteryStore.refreshActiveBook(bookId);
}

async function prepareMessage() {
  const bookId = props.bookId;
  const target = { ...selectedTarget.value };
  const targetKey = mysteryDocumentTargetKey(target);
  const controller = conversationController.value;
  const sessionId = controller.sessionId.value;
  if (!docReady.value || !(await flushDocument())) return;
  const book = manifest.value;
  const index = workspaceIndex.value;
  if (!book || book.id !== bookId || index?.bookId !== bookId) return;
  const libraries = await resolveMysteryAttachedLibraries(
    window.deepwrite,
    book
  );
  if (
    !active ||
    !docReady.value ||
    manifest.value?.id !== bookId ||
    props.bookId !== bookId ||
    controller.sessionId.value !== sessionId ||
    mysteryDocumentTargetKey(selectedTarget.value) !== targetKey
  )
    return;
  return {
    controller,
    libraries,
    context: {
      bookId,
      title: book.title,
      genre: book.genre,
      activeAgentId: "mystery" as const,
      focus: { stage: mysteryStageForTarget(target), target },
      workspaceIndex: JSON.parse(JSON.stringify(index))
    }
  };
}

async function handleSend(attachments: UserPromptAttachment[]): Promise<void> {
  const request = await prepareMessage();
  if (request)
    await request.controller.sendMysteryMessage(
      request.context,
      request.libraries,
      attachments
    );
}

async function handleRewrite(
  request: ConversationMessageRewriteRequest
): Promise<boolean> {
  const prepared = await prepareMessage();
  return prepared
    ? prepared.controller.resendMysteryMessage(
        request,
        prepared.context,
        prepared.libraries
      )
    : false;
}

async function runOperation(op: MysteryOperation): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value || opBusy.value) return;
  opBusy.value = true;
  try {
    if (!(await flushDocument())) return;
    const res = await api.applyOperations({
      bookId: manifest.value.id,
      expectedBookRevision: manifest.value.revision,
      batch: {
        operations: [JSON.parse(JSON.stringify(op))],
        documentWrites: []
      }
    });
    mysteryStore.applyWorkspaceResult(res);
    activeDialog.value = null;
    uiMessage.success(mysteryT("operationSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleMoveItem(item: {
  kind: "truth_doc" | "role" | "act" | "clue_round";
  id: string;
  move: "up" | "down";
}): Promise<void> {
  if (item.kind === "truth_doc") {
    await runOperation({
      type: "truthDoc.updateMeta",
      docId: item.id,
      move: item.move
    });
  } else if (item.kind === "role") {
    await runOperation({
      type: "role.updateMeta",
      roleId: item.id,
      move: item.move
    });
  } else if (item.kind === "act") {
    await runOperation({
      type: "act.updateMeta",
      actId: item.id,
      move: item.move
    });
  } else {
    await runOperation({
      type: "clueRound.updateMeta",
      roundId: item.id,
      move: item.move
    });
  }
}

async function handleSaveBindings(payload: {
  linkedMaterialIds: string[];
  linkedSkillIds: string[];
}): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value) return;
  opBusy.value = true;
  try {
    const res = await api.updateBindings({
      bookId: manifest.value.id,
      linkedMaterialIds: [...payload.linkedMaterialIds],
      linkedSkillIds: [...payload.linkedSkillIds]
    });
    mysteryStore.applyWorkspaceResult(res);
    activeDialog.value = null;
    uiMessage.success(mysteryT("operationSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleExportBundle(payload: {
  format: "md" | "docx";
  playerScriptLayout: "by-role" | "by-role-act";
}): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value) return;
  opBusy.value = true;
  try {
    if (!(await flushDocument())) return;
    const res = await api.exportBundle({
      bookId: manifest.value.id,
      format: payload.format,
      playerScriptLayout: payload.playerScriptLayout
    });
    activeDialog.value = null;
    if (res.status === "saved") {
      uiMessage.success(
        mysteryT("exportSuccess", {
          count: res.fileCount,
          dir: res.bundleDirectory
        })
      );
    } else {
      uiMessage.info(mysteryT("exportCancelled"));
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleRenameBook(title: string): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value) return;
  opBusy.value = true;
  try {
    const res = await api.rename({ bookId: manifest.value.id, title });
    mysteryStore.applyWorkspaceResult(res);
    activeDialog.value = null;
    uiMessage.success(mysteryT("operationSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleDuplicateBook(): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value) return;
  opBusy.value = true;
  try {
    const res = await api.duplicateBook({ bookId: manifest.value.id });
    mysteryStore.upsertSummary(res.summary);
    activeDialog.value = null;
    uiMessage.success(mysteryT("operationSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleRemoveOrDelete(
  mode: "unregister" | "delete"
): Promise<void> {
  const api = window.deepwrite?.mystery;
  if (!api || !manifest.value) return;
  opBusy.value = true;
  try {
    const bookId = manifest.value.id;
    if (mode === "unregister") {
      await api.unregister({ bookId });
    } else {
      await api.delete({ bookId });
    }
    mysteryStore.deactivateBook();
    await mysteryStore.loadBooks();
    activeDialog.value = null;
    props.onBookRemoved?.();
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  } finally {
    opBusy.value = false;
  }
}

async function handleAcceptProposal(proposalId: string): Promise<void> {
  try {
    if (!(await flushDocument())) return;
    await mysteryStore.applyProposal(props.bookId, proposalId);
    await loadDocument();
    uiMessage.success(mysteryT("proposalAcceptedToast"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  }
}

async function handleUndoLastProposal(): Promise<void> {
  try {
    if (!(await flushDocument())) return;
    await mysteryStore.undoLastProposal(props.bookId);
    await loadDocument();
    uiMessage.info(mysteryT("proposalUndone"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  }
}

onScopeDispose(
  registerMysteryWorkspaceNavigation({
    bookId: () => props.bookId,
    busy: () =>
      opBusy.value || docLoading.value || manifest.value?.id !== props.bookId,
    save: flushDocument,
    send: () => handleSend([]),
    selectTarget: handleSelectTarget,
    openDialog: (dialog) => {
      activeDialog.value = dialog;
    },
    moveItem: handleMoveItem
  })
);
</script>

<template>
  <div
    v-if="
      manifest?.id !== bookId ||
      workspaceIndex?.bookId !== bookId ||
      !manifest ||
      !workspaceIndex
    "
    class="mystery-empty-state long-workspace-loading-state"
  >
    {{ mysteryT("loadingTitle") }}
  </div>
  <template v-else>
    <AgentConversation
      v-if="paneLayout === 'agent-editor' || !rightCollapsed"
      :draft="conversationController.draft.value"
      :messages="conversationController.messages.value"
      :conversation-history="conversationController.history.value"
      :current-session-id="conversationController.sessionId.value"
      :responding="conversationController.isBusy.value"
      :can-send="conversationController.canSend.value"
      :can-send-attachments="conversationController.canSendAttachments.value"
      :can-rewrite-history="conversationController.canRewriteHistory.value"
      :submit-edited-message="handleRewrite"
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
      :context-title="manifest.title"
      :book-title="manifest.title"
      :stage-label="stage.label"
      :stage-icon="stage.icon"
      :agent-label="mysteryLabels('mysteryCoordinatorLabel')"
      agent-id="mystery"
      agent-workspace-type="mystery"
      :agent-book-id="manifest.id"
      :library-domain="undefined"
      :library-skills="undefined"
      :welcome-shortcuts="agentProfile.welcomeShortcuts"
      :available-skills="libraryRefs.availableSkills"
      :available-materials="libraryRefs.availableMaterials"
      :editor-references="editorReferences"
      @clear-editor-references="clearEditorReferences"
      @remove-editor-reference="removeEditorReference"
      @locate-editor-reference="locateReference"
      :user-input-request="conversationController.pendingUserInput.value"
      :user-input-submitting="conversationController.submittingUserInput.value"
      :write-approval-items="conversationController.writeApprovalItems.value"
      :write-approval-submit-failed="
        conversationController.writeApprovalSubmitFailed.value
      "
      :left-collapsed="leftCollapsed"
      :right-collapsed="rightCollapsed"
      :right-pane="paneLayout === 'editor-agent'"
      @update:draft="conversationController.draft.value = $event"
      @new-conversation="conversationController.newConversation()"
      @select-conversation="conversationController.selectConversation($event)"
      @send="handleSend"
      @stop="conversationController.stopGeneration()"
      @suggestion="conversationController.useSuggestion($event)"
      @toggle-left="layoutStore.togglePane('left')"
      @toggle-right="layoutStore.togglePane('right')"
      @select-model="conversationController.selectModel($event)"
      @select-thinking="conversationController.selectThinkingLevel($event)"
      @toggle-web-search="conversationController.selectWebSearchEnabled($event)"
      @select-temperature="conversationController.selectTemperature($event)"
      @select-approval="conversationController.selectApprovalMode($event)"
      @select-agent-team-mode="
        conversationController.selectAgentTeamMode($event)
      "
      @submit-user-input="conversationController.submitUserInput($event)"
      @retry-write-approval="conversationController.retryWriteApproval()"
    >
      <template v-if="pendingProposals.length || lastRestore" #review>
        <MysteryProposalBanner
          :proposals="pendingProposals"
          :last-restore="lastRestore"
          :busy="opBusy"
          :can-locate="canLocateTarget"
          @locate="locateTarget"
          @accept="handleAcceptProposal"
          @reject="mysteryStore.rejectProposal(props.bookId, $event)"
          @undo="handleUndoLastProposal"
        />
      </template>
    </AgentConversation>

    <MysteryEditorPane
      v-if="paneLayout === 'editor-agent' || !rightCollapsed"
      :manifest="manifest"
      :target="selectedTarget"
      :content="docReady ? docContent : ''"
      :dirty="docDirty"
      :locked="docLoading || !docReady"
      :agent-busy="conversationController.isBusy.value"
      :locate-reference="referenceNavigation"
      :save-document="flushDocument"
      :reload-restored-document="reloadRestoredDocument"
      :saving="docSaving"
      :auto-save-enabled="autoSaveEnabled"
      :default-text-view-mode="defaultTextViewMode"
      :left-collapsed="leftCollapsed"
      :right-pane="paneLayout === 'agent-editor'"
      :right-pane-collapsed="rightCollapsed"
      @update:content="handleContentUpdate"
      @composing="composing = $event"
      @open-resource="openResource?.($event)"
      @insert-selection="insertEditorReference"
      @expand-left="layoutStore.setPaneCollapsed('left', false)"
      @toggle-right="layoutStore.togglePane('right')"
    />

    <div
      v-if="!rightCollapsed"
      class="pane-resizer pane-resizer-right"
      role="separator"
      :aria-label="t('components.writingWorkspaceModule.resizeRightPane')"
      aria-orientation="vertical"
      :aria-valuemin="rightPane.minWidth"
      :aria-valuemax="rightPane.maxWidth"
      :aria-valuenow="rightPane.width"
      tabindex="0"
      @pointerdown="layoutStore.startPaneResize('right', $event)"
      @keydown="layoutStore.handleResizeKeydown('right', $event)"
    />

    <SaveConflictDialog
      v-if="conflict"
      open
      :title="mysteryDocumentTitle(manifest, selectedTarget)"
      :draft-content="docContent"
      :disk-content="conflict.content"
      :submitting="docLoading || docSaving"
      @keep="conflict = null"
      @reload="reloadConflict"
      @overwrite="overwriteConflict"
    />
    <MysteryDialogs
      :dialog="activeDialog"
      :manifest="manifest"
      :catalog-snapshot="catalogSnapshot"
      :busy="opBusy"
      @close="activeDialog = null"
      @apply-operation="runOperation"
      @save-bindings="handleSaveBindings"
      @export-bundle="handleExportBundle"
      @rename-book="handleRenameBook"
      @duplicate-book="handleDuplicateBook"
      @unregister-book="handleRemoveOrDelete('unregister')"
      @delete-book="handleRemoveOrDelete('delete')"
    />
  </template>
</template>

<style src="./mystery-workspace.css"></style>
