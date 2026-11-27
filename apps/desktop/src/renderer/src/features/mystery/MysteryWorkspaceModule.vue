<script setup lang="ts">
import { jsonClone } from "@deepwrite/shared";
import { deepwriteApi } from "../../api/deepwrite";
import {
  bookBindingsTarget,
  type BookBindingsTarget
} from "../../stores/bookBindingsDialog";
import WorkspacePaneResizer from "../../components/WorkspacePaneResizer.vue";
import type {
  CatalogIndexSnapshot,
  CatalogSnapshot,
  DeepWriteApi,
  MysteryBookManifest,
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
import ExportMysteryDialog from "./ExportMysteryDialog.vue";
import MysteryDialogs, { type MysteryDialogState } from "./MysteryDialogs.vue";
import MysteryEditorPane from "./MysteryEditorPane.vue";
import MysteryOverviewPane from "./MysteryOverviewPane.vue";
import MysteryStructureManager from "./MysteryStructureManager.vue";
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
const { selectedTarget, overviewStage } = storeToRefs(mysteryStore);
const layoutStore = useLayoutStore();
const { leftCollapsed, rightCollapsed } = storeToRefs(layoutStore);

const manifest = computed(() => mysteryStore.activeBook);
const workspaceIndex = computed(() => mysteryStore.activeWorkspaceIndex);

provideBookImageContext(() => ({
  book: { projectType: "mystery", projectId: props.bookId }
}));

const activeStage = computed(
  () => overviewStage.value ?? mysteryStageForTarget(selectedTarget.value)
);

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
  api: () => deepwriteApi()?.mystery,
  bookId: () => props.bookId,
  target: () => selectedTarget.value,
  selectTarget: (target) => {
    selectedTarget.value = target;
  },
  autoSaveEnabled: () => props.autoSaveEnabled,
  async refreshBook(bookId, summary) {
    if (summary) mysteryStore.upsertSummary(summary);
    await mysteryStore.refreshActiveBook(bookId);
  },
  onLoadError: (error) =>
    uiMessage.error(formatError(error, mysteryT("actionFailed"))),
  onSaveError: (error) =>
    uiMessage.error(formatError(error, mysteryT("saveFailed")))
});

// UI state
const opBusy = ref(false);
const activeDialog = ref<Exclude<
  MysteryDialogState,
  { kind: "manage-structure" | "bind" }
> | null>(null);
const structureOpen = ref(false);
const initialStructurePanel = ref<"board" | "context">("board");
const structureManager = ref<InstanceType<typeof MysteryStructureManager>>();

function openStructure(panel: "board" | "context" = "board"): void {
  initialStructurePanel.value = panel;
  structureOpen.value = true;
}

async function flushStructureContext(): Promise<boolean> {
  return (await structureManager.value?.flushContextIfNeeded()) ?? true;
}

async function closeStructure(): Promise<void> {
  if (!(await flushStructureContext())) return;
  if (structureManager.value?.dirty) {
    activeDialog.value = { kind: "discardBoard" };
    return;
  }
  structureOpen.value = false;
}

async function openRenameFromStructure(): Promise<void> {
  if (await flushStructureContext()) activeDialog.value = { kind: "rename" };
}

function discardBoard(): void {
  activeDialog.value = null;
  structureOpen.value = false;
}
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
const contextResourceId = computed(() =>
  mysteryDocumentResourceId(props.bookId, { kind: "agents_md" })
);
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

function openEditorResource(resourceId: string): void {
  if (resourceId === contextResourceId.value) openStructure("context");
  else void openResource?.(resourceId);
}

async function locateReference(reference: EditorTextReference): Promise<void> {
  if (reference.resourceId === contextResourceId.value) {
    openStructure("context");
    return;
  }
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
  openEditorResource(mysteryDocumentResourceId(props.bookId, target));
}

async function handleSelectTarget(
  target: MysteryDocumentTarget
): Promise<boolean> {
  if (!canLocateTarget(target)) return false;
  if (target.kind === "agents_md") {
    openStructure("context");
    return true;
  }
  const loaded =
    (docReady.value &&
      !docLoading.value &&
      mysteryDocumentTargetKey(target) ===
        mysteryDocumentTargetKey(selectedTarget.value)) ||
    (await loadDocument(target));
  if (loaded) overviewStage.value = null;
  return loaded;
}

watch(
  () => [props.bookId, mysteryStore.revisionBump] as const,
  async ([bookId]) => {
    if (
      manifest.value?.id !== bookId ||
      workspaceIndex.value?.bookId !== bookId
    )
      return;
    const target =
      selectedTarget.value.kind !== "agents_md" &&
      canLocateTarget(selectedTarget.value)
        ? selectedTarget.value
        : ({ kind: "truth_doc", docId: "core_truth" } as const);
    await loadDocument(target);
  },
  { immediate: true }
);
watch(
  () => props.bookId,
  async (bookId) => {
    const profiles = await deepwriteApi()
      ?.mystery?.listAgents()
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
  const overview = overviewStage.value;
  const target = { ...selectedTarget.value };
  const targetKey = mysteryDocumentTargetKey(target);
  const controller = conversationController.value;
  const sessionId = controller.sessionId.value;
  if ((!overview && !docReady.value) || !(await flushDocument())) return;
  const book = manifest.value;
  const index = workspaceIndex.value;
  if (!book || book.id !== bookId || index?.bookId !== bookId) return;
  const libraries = await resolveMysteryAttachedLibraries(deepwriteApi(), book);
  if (
    !active ||
    (!overview && !docReady.value) ||
    overviewStage.value !== overview ||
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
      focus: overview
        ? { stage: overview }
        : { stage: mysteryStageForTarget(target), target },
      workspaceIndex: jsonClone(index)
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

async function mutateBook(
  action: (
    api: NonNullable<DeepWriteApi["mystery"]>,
    book: MysteryBookManifest
  ) => Promise<void>
): Promise<boolean> {
  const api = deepwriteApi()?.mystery;
  const bookId = manifest.value?.id;
  if (!api || !bookId || opBusy.value) return false;
  opBusy.value = true;
  try {
    if (!(await flushDocument()) || !active || manifest.value?.id !== bookId)
      return false;
    await action(api, manifest.value);
    return true;
  } finally {
    opBusy.value = false;
  }
}

async function withBook(
  action: Parameters<typeof mutateBook>[0]
): Promise<void> {
  try {
    if (await mutateBook(action)) activeDialog.value = null;
  } catch (error: unknown) {
    uiMessage.error(formatError(error, mysteryT("actionFailed")));
  }
}

function runOperation(op: MysteryOperation): Promise<void> {
  return withBook(async (api, book) => {
    const result = await api.applyOperations({
      bookId: book.id,
      expectedBookRevision: book.revision,
      batch: { operations: [op], documentWrites: [] }
    });
    mysteryStore.applyWorkspaceResult(result);
    uiMessage.success(mysteryT("operationSuccess"));
  });
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

async function handleReorderItem(item: {
  kind: "truth_doc" | "role" | "act" | "clue_round";
  id: string;
  anchorId: string;
  position: "before" | "after";
}): Promise<void> {
  const reorder = { anchorId: item.anchorId, position: item.position };
  if (item.kind === "truth_doc") {
    await runOperation({
      type: "truthDoc.updateMeta",
      docId: item.id,
      reorder
    });
  } else if (item.kind === "role") {
    await runOperation({
      type: "role.updateMeta",
      roleId: item.id,
      reorder
    });
  } else if (item.kind === "act") {
    await runOperation({
      type: "act.updateMeta",
      actId: item.id,
      reorder
    });
  } else {
    await runOperation({
      type: "clueRound.updateMeta",
      roundId: item.id,
      reorder
    });
  }
}

let binding: BookBindingsTarget | undefined;

function openBindings(): void {
  const book = manifest.value;
  if (!book || book.id !== props.bookId) return;
  binding = {
    bookId: book.id,
    title: book.title,
    workspaceType: "mystery",
    initialSkillIds: book.linkedSkillIds,
    initialMaterialIds: book.linkedMaterialIds,
    saveLibrary: (change) =>
      mutateBook(async (api, latest) => {
        const result = await api.updateBindings({
          bookId: book.id,
          linkedMaterialIds: [
            ...(change.domain === "material"
              ? change.ids
              : latest.linkedMaterialIds)
          ],
          linkedSkillIds: [
            ...(change.domain === "skill" ? change.ids : latest.linkedSkillIds)
          ]
        });
        mysteryStore.applyWorkspaceResult(result);
      })
  };
  bookBindingsTarget.value = binding;
}

onScopeDispose(() => {
  if (bookBindingsTarget.value === binding) bookBindingsTarget.value = null;
});

function handleExportBundle(payload: {
  format: "md" | "docx";
  playerScriptLayout: "by-role" | "by-role-act";
}): Promise<void> {
  return withBook(async (api, book) => {
    const result = await api.exportBundle({ bookId: book.id, ...payload });
    if (result.status === "saved") {
      uiMessage.success(
        mysteryT("exportSuccess", {
          count: result.fileCount,
          dir: result.bundleDirectory
        })
      );
    } else {
      uiMessage.info(mysteryT("exportCancelled"));
    }
  });
}

function handleRenameBook(title: string): Promise<void> {
  return withBook(async (api, book) => {
    const result = await api.rename({ bookId: book.id, title });
    mysteryStore.applyWorkspaceResult(result);
    uiMessage.success(mysteryT("operationSuccess"));
  });
}

function handleDuplicateBook(): Promise<void> {
  return withBook(async (api, book) => {
    const result = await api.duplicateBook({ bookId: book.id });
    mysteryStore.upsertSummary(result.summary);
    uiMessage.success(mysteryT("operationSuccess"));
  });
}

function handleRemoveOrDelete(mode: "unregister" | "delete"): Promise<void> {
  return withBook(async (api, book) => {
    if (mode === "unregister") {
      await api.unregister({ bookId: book.id });
    } else {
      await api.delete({ bookId: book.id });
    }
    mysteryStore.deactivateBook();
    await mysteryStore.loadBooks();
    props.onBookRemoved?.();
  });
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
    save: async () =>
      !opBusy.value &&
      (await flushStructureContext()) &&
      (await flushDocument()),
    send: () => handleSend([]),
    selectTarget: handleSelectTarget,
    openDialog: (dialog) => {
      if (dialog.kind === "manage-structure") {
        openStructure();
      } else if (dialog.kind === "bind") {
        openBindings();
      } else {
        activeDialog.value = dialog;
      }
    },
    duplicateBook: handleDuplicateBook,
    moveItem: handleMoveItem,
    reorderItem: handleReorderItem
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

    <MysteryOverviewPane
      v-if="overviewStage && (paneLayout === 'editor-agent' || !rightCollapsed)"
      :index="workspaceIndex"
      :stage="overviewStage"
      :left-collapsed="leftCollapsed"
      :right-pane="paneLayout === 'agent-editor'"
      :right-pane-collapsed="rightCollapsed"
      @open-resource="openEditorResource"
      @expand-left="layoutStore.setPaneCollapsed('left', false)"
      @toggle-right="layoutStore.togglePane('right')"
    />
    <MysteryEditorPane
      v-else-if="paneLayout === 'editor-agent' || !rightCollapsed"
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
      @open-resource="openEditorResource"
      @insert-selection="insertEditorReference"
      @expand-left="layoutStore.setPaneCollapsed('left', false)"
      @toggle-right="layoutStore.togglePane('right')"
    />

    <WorkspacePaneResizer />

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
    <MysteryStructureManager
      v-if="structureOpen"
      :key="bookId"
      ref="structureManager"
      open
      :book-title="manifest.title"
      :index="workspaceIndex"
      :busy="opBusy"
      :initial-panel="initialStructurePanel"
      :child-open="Boolean(activeDialog)"
      @rename="openRenameFromStructure"
      @close="closeStructure"
      @open-item="activeDialog = $event"
      @move="handleMoveItem"
      @apply-operation="runOperation"
    />
    <ExportMysteryDialog
      :open="activeDialog?.kind === 'export'"
      :book-title="manifest.title"
      :submitting="opBusy"
      :nested="structureOpen"
      @close="activeDialog = null"
      @export-bundle="handleExportBundle"
    />
    <MysteryDialogs
      :dialog="activeDialog?.kind === 'export' ? null : activeDialog"
      :manifest="manifest"
      :busy="opBusy"
      :nested="structureOpen"
      @close="activeDialog = null"
      @discard-board="discardBoard"
      @apply-operation="runOperation"
      @rename-book="handleRenameBook"
      @unregister-book="handleRemoveOrDelete('unregister')"
      @delete-book="handleRemoveOrDelete('delete')"
    />
  </template>
</template>

<style src="./mystery-workspace.css"></style>
