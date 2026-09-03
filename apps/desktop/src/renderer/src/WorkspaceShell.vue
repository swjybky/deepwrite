<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch
} from "vue";
import { storeToRefs } from "pinia";
import type {
  CreateLongBookInput,
  CreateScriptBookInput,
  CreateShortBookInput,
  GeneralPermissionMode
} from "@deepwrite/contracts";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type {
  BookTransferAction,
  BookTransferDialogMode
} from "./components/BookTransferDialog.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import ToastHost from "./components/ToastHost.vue";
import WritingWorkspaceModule from "./components/WritingWorkspaceModule.vue";
import { registerWorkspaceSystemEventRoutes } from "./events/registerWorkspaceSystemEventRoutes";
import { systemEventCenter } from "./events/systemEventCenter";
import {
  ChatAssistantOverlay,
  LongWorkspaceModule,
  WorkspaceDialogLayer,
  WorkspaceFeatureModules
} from "./components/lazyAppComponents";
import { useAgentConversation } from "./composables/useAgentConversation";
import { useAppearance } from "./composables/useAppearance";
import { useCatalogDocumentLoader } from "./composables/useCatalogDocumentLoader";
import { useCatalogDocumentPersistence } from "./composables/useCatalogDocumentPersistence";
import { useCatalogWorkspaceProjectionCoordinator } from "./composables/useCatalogWorkspaceProjectionCoordinator";
import { useConversationRuntimeRegistryCoordinator } from "./composables/useConversationRuntimeRegistryCoordinator";
import { AGENT_ACTIVITY_CONTEXT_KEY } from "./composables/agentActivityContext";
import { useAgentActivityCoordinator } from "./composables/useAgentActivityCoordinator";
import { useCurrentAgentActivityView } from "./composables/useCurrentAgentActivityView";
import {
  MATERIAL_KIND_ALLOWED_STAGES,
  useCatalogLibraryTransactionsCoordinator
} from "./composables/useCatalogLibraryTransactionsCoordinator";
import { useDraftRecoveryPersistence } from "./composables/useDraftRecoveryPersistence";
import { useEditorAutoSaveCoordinator } from "./composables/useEditorAutoSaveCoordinator";
import { useGeneralSettingsCoordinator } from "./composables/useGeneralSettingsCoordinator";
import { useWorkspaceLifecycleCoordinator } from "./composables/useWorkspaceLifecycleCoordinator";
import {
  useLazyLearningImitationController,
  useLazyLongBookAnalysisController,
  useLazySubagentAuthoringController
} from "./composables/useLazyFeatureControllers";
import { useLazyApprovalNavigationCoordinator } from "./composables/useLazyApprovalNavigationCoordinator";
import { useLazyLongBookLifecycleCoordinator } from "./composables/useLazyLongBookLifecycleCoordinator";
import { useLazyShortBookLifecycleCoordinator } from "./composables/useLazyShortBookLifecycleCoordinator";
import { useLazyProposalCoordinator } from "./composables/useLazyProposalCoordinator";
import { useLongConversationCoordinator } from "./composables/useLongConversationCoordinator";
import { useLongLedgerCommitDeletionCoordinator } from "./composables/useLongLedgerCommitDeletionCoordinator";
import { useLongWorkspacePresentationCoordinator } from "./composables/useLongWorkspacePresentationCoordinator";
import { useLongProposalRuntimeCoordinator } from "./composables/useLongProposalRuntimeCoordinator";
import { useLazyLongStructureTransactionsCoordinator } from "./composables/useLazyLongStructureTransactionsCoordinator";
import {
  useLongWorkspaceSessionCoordinator,
  type LongWorkspaceEditorPort
} from "./composables/useLongWorkspaceSessionCoordinator";
import { useSettingsFeatureCoordinator } from "./composables/useSettingsFeatureCoordinator";
import { useShortConversationCoordinator } from "./composables/useShortConversationCoordinator";
import { useShortWorkspaceStructureCoordinatorWithContext } from "./composables/useShortWorkspaceStructureCoordinatorWithContext";
import { useWorkspaceResourceCoordinator } from "./composables/useWorkspaceResourceCoordinator";
import { useWorkspaceResourceTreeCoordinator } from "./composables/useWorkspaceResourceTreeCoordinator";
import { useWorkspaceStageNavigator } from "./composables/useWorkspaceStageNavigator";
import { useWorkspaceDialogModuleCoordinator } from "./composables/useWorkspaceDialogModuleCoordinator";
import { useWorkspaceFeatureHostCoordinator } from "./composables/useWorkspaceFeatureHostCoordinator";
import { useChatAssistant } from "./features/chat-assistant/useChatAssistant";
import { uiMessage } from "./ui-feedback";
import { resourceSections } from "./data/demoWorkspace";
import { EMPTY_WORKSPACE_DOCUMENT } from "./data/emptyWorkspaceDocument";
import {
  MATERIAL_STAGE_LABELS,
  resolveBookWorkspaceId,
  resolveDraftSectionResourceId,
  resolvePreferredBookResourceId
} from "./data/catalogWorkspace";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "./types/conversation";
import type {
  EditorDraftState,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  WorkspaceDocument
} from "./types/workspace";
import {
  longBookResourceId,
  resolveLongWorkspaceApi
} from "./types/longWorkspace";
import { createConversationPersistenceAdapter } from "./utils/conversationPersistence";
import { createBookConversationEntries } from "./utils/bookConversationEntries";
import {
  editorEntrySearchDocuments,
  editorEntrySearchSources
} from "./utils/editorEntrySearch";
import {
  resolveAgentActivityDescriptor,
  resolveAgentActivityNavigationNode
} from "./utils/agentActivityDescriptors";
import type { ApprovalNavigationTarget } from "./utils/approvalNavigation";
import { loadGeneralPreferences } from "./utils/generalPreferences";
import { longNavigationNodeId } from "./utils/longWorkspaceResourceTree";
import { withShortBookDefaultPlotStages } from "./utils/shortBookDefaultPlotStages";
import {
  LEFT_PANE_MAX,
  LEFT_PANE_MIN,
  useLayoutStore
} from "./stores/layoutStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useCatalogIndexStore } from "./stores/catalogIndexStore";
import { useConversationStore } from "./stores/conversationStore";
import { useLongWorkspaceStore } from "./stores/longWorkspaceStore";

useAppearance();

const layoutStore = useLayoutStore();
const {
  currentView,
  settingsInitialCategory,
  workspaceMainView,
  activePrimaryFeature,
  leftCollapsed,
  rightCollapsed,
  desktopShell,
  leftPaneWidth,
  shellClasses,
  shellStyle,
  writingRightPaneViewModel
} = storeToRefs(layoutStore);
const {
  reconcilePaneWidths,
  startPaneResize,
  handleResizeKeydown,
  disposeLayout
} = layoutStore;
// Keep the workspace unselected on launch. A resource ID is set only after the
// user explicitly opens a book or another resource from the tree.
const selectedResourceId = ref("");
const activeCreationResourceId = ref("");
// Catalog documents are immutable snapshots replaced as a unit. Avoid creating
// deep reactive proxies for every document body in a potentially large library.
const documents = shallowRef<WorkspaceDocument[]>([
  { ...EMPTY_WORKSPACE_DOCUMENT }
]);
const editorDrafts = shallowRef<Record<string, EditorDraftState>>({});
const draftRecoveryPersistence = useDraftRecoveryPersistence({
  drafts: editorDrafts,
  api: () => window.deepwrite?.catalog,
  warning: (message) => uiMessage.warning(message)
});
const nextDraftRecoveryTimestamp = draftRecoveryPersistence.nextTimestamp;
const settingsStore = useSettingsStore();
const {
  generalSettings,
  editorAutoSaveEnabled,
  modelSettings,
  startupAlertMessages,
  workspaceAgentSettings,
  longAgentSettings,
  longAgentLoadError,
  libraryAgentSettings
} = storeToRefs(settingsStore);
const legacyGeneralPreferences = loadGeneralPreferences(window.localStorage);
const selectedExpertSectionIds = ref<Record<string, string>>({});
const selectedDraftFileKinds = ref<Record<string, "body" | "character-state">>(
  {}
);
const pendingEditorReferences = ref<EditorTextReference[]>([]);
const editorReferenceNavigation = ref<EditorTextReferenceNavigation>();
const acceptingAgentEditDocumentIds = ref<Set<string>>(new Set());
const acceptingAgentEditWorkspaceIds = ref<Set<string>>(new Set());
const learningImitationFeature = useLazyLearningImitationController({
  api: () => window.deepwrite
});
const learningImitationRunning = learningImitationFeature.isBusy;
const longBookAnalysisFeature = useLazyLongBookAnalysisController({
  api: () => window.deepwrite
});
const longBookAnalysisRunning = longBookAnalysisFeature.isBusy;
const subagentAuthoringFeature = useLazySubagentAuthoringController({
  api: () => window.deepwrite
});
// The catalog can contain all manuscript and library bodies. It is never
// mutated in place, so deep observation only adds proxy/allocation overhead.
const catalogIndexStore = useCatalogIndexStore();
const catalogDocumentLoader = useCatalogDocumentLoader({
  catalogIndex: catalogIndexStore,
  reader: () => window.deepwrite?.catalog,
  documents
});
const documentById = catalogDocumentLoader.documentsById;
const {
  snapshot: catalogSnapshot,
  projection: catalogProjection,
  snapshotLoading: catalogLoading
} = storeToRefs(catalogIndexStore);
const catalogWorkspaceProjection = useCatalogWorkspaceProjectionCoordinator({
  api: () => window.deepwrite?.catalog,
  index: {
    snapshot: catalogSnapshot,
    projection: catalogProjection,
    ensureSnapshot: (loader) => catalogIndexStore.ensureSnapshot(loader)
  },
  documents: {
    values: documents,
    reconcileProjection: (projection) =>
      catalogDocumentLoader.reconcileProjection(projection)
  },
  state: {
    drafts: editorDrafts,
    selectedResourceId,
    activeCreationResourceId
  },
  proposals: {
    all: () => allConversations(),
    resume: (candidates) => resumeRecoveredAutomaticAgentEdits(candidates)
  },
  scheduler: {
    queueMicrotask: (task) => queueMicrotask(task)
  },
  notifications: uiMessage
});
const {
  findBook: catalogBook,
  loadSnapshot: loadCatalogSnapshot,
  notifyRecoveredDrafts,
  recordRecoveredDraftCount,
  reconciledProjection: reconciledCatalogProjection,
  resumeRecoveredAutomaticEditsIfNeeded:
    resumeRecoveredAutomaticAgentEditsIfNeeded,
  dispose: disposeCatalogWorkspaceProjection
} = catalogWorkspaceProjection;
const {
  savingDocumentIds,
  saveConflict,
  saveConflictSubmitting,
  applyAcceptedAgentDocumentLocally,
  refreshBookAfterSuccessfulDocumentSave,
  retryPendingBookReconciliations,
  applySavedLibraryEntry,
  applyUpdatedCatalogLibrary,
  applyCreatedLibraryEntry,
  isCatalogConflict,
  persistEditorDocument,
  persistEditorDocumentWithOutcome,
  keepSaveConflictDraft,
  reloadSaveConflictFromDisk,
  overwriteSaveConflictOnDisk,
  dispose: disposeCatalogDocumentPersistence
} = useCatalogDocumentPersistence({
  api: () => window.deepwrite?.catalog,
  documents,
  drafts: editorDrafts,
  acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
  loader: catalogDocumentLoader,
  catalog: {
    refreshIndex: loadCatalogSnapshot,
    findBook: catalogBook,
    findLibrary: findCatalogLibrary
  },
  nextRecoveryTimestamp: nextDraftRecoveryTimestamp,
  scheduleAutoSave: (documentId) => scheduleEditorAutoSave(documentId),
  notifications: uiMessage
});
let documentHasAgentRunWriteBarrier = (_document: WorkspaceDocument): boolean =>
  false;
const {
  apply: applyDocument,
  cancel: cancelEditorAutoSave,
  dispose: disposeEditorAutoSave,
  drain: drainEditorSaves,
  manualSavingDocumentIds,
  schedule: scheduleEditorAutoSave,
  scheduleDirty: scheduleDirtyEditorDraftsForAutoSave
} = useEditorAutoSaveCoordinator({
  enabled: editorAutoSaveEnabled,
  drafts: editorDrafts,
  documents,
  timer: window,
  persist: persistEditorDocumentWithOutcome,
  isConflicted: () => saveConflict.value !== null,
  isWriteBlocked: (document) =>
    savingDocumentIds.value.size > 0 ||
    documentHasAgentRunWriteBarrier(document) ||
    acceptingAgentEditDocumentIds.value.has(document.id) ||
    (document.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(document.workspaceId)),
  onIdle: async () => {
    await retryPendingBookReconciliations();
  },
  onUnexpectedError: (error) =>
    uiMessage.error(
      error instanceof Error ? error.message : "保存编辑器草稿失败。"
    )
});
const {
  dispose: disposeGeneralSettings,
  load: loadGeneralSettings,
  updateAutoApproveCrossStageOperations,
  updateAutoSave: updateEditorAutoSave,
  updateDefaultTextViewMode,
  updateLanguage: updateAppLanguage,
  updatePermissionMode,
  updateShowContextUsage,
  updateShowInMenuBar,
  updateUseNetworkProxy,
  updateWorkspacePaneLayout
} = useGeneralSettingsCoordinator({
  settings: generalSettings,
  autoSaveEnabled: editorAutoSaveEnabled,
  api: () => window.deepwrite?.generalSettings,
  publishLoaded: (settings) => settingsStore.markLoaded("general", settings),
  legacyAutoSave: legacyGeneralPreferences.autoSave,
  storage: window.localStorage,
  documentRoot: document.documentElement,
  browserLanguage: () => navigator.language,
  applyApprovalMode: applyDefaultApprovalMode,
  scheduleDirtyAutoSave: scheduleDirtyEditorDraftsForAutoSave,
  cancelAutoSave: cancelEditorAutoSave,
  resumeAutomaticAgentEdits: resumeRecoveredAutomaticAgentEditsIfNeeded,
  notifications: uiMessage
});

function revealTextPane(): void {
  if (generalSettings.value.workspacePaneLayout === "agent-editor") {
    layoutStore.setPaneCollapsed("right", false);
  }
}
const catalogMutationPending = ref(false);
const createBookDialogOpen = ref(false);
const bookTransferDialogMode = ref<BookTransferDialogMode | null>(null);
const longWorkspaceStore = useLongWorkspaceStore();
const {
  longBooks,
  longCatalogDiagnostics,
  activeBookId: activeLongBookId,
  activeBookSummary: activeLongBookSummary,
  workspaceIndex: activeLongWorkspaceIndex,
  selection: activeLongSelection,
  fileContext: activeLongFileContext,
  refreshStatus: longWorkspaceRefreshStatus,
  activeRefreshStatus: activeLongWorkspaceRefreshStatus,
  activeContextReady: activeLongWorkspaceContextReady,
  bookListError: longCatalogLoadError,
  workspaceLoading: longWorkspaceLoading,
  sendPreflightPending: longSendPreflightPending,
  mutationPending: longMutationPending,
  proposalApprovalPending: longProposalApprovalPending,
  structureDialogOpen: longStructureDialogOpen,
  structureAgentsMd: longStructureAgentsMd,
  structureAgentsMdPending: longStructureAgentsMdPending,
  characterCreateTarget: longCharacterCreate,
  worldbuildingItemCreateTarget: longWorldbuildingItemCreate,
  plotPointCreateTarget: longPlotPointCreate,
  chapterCardCreateTarget: longChapterCardCreate,
  draftSectionDeleteTarget: longDraftSectionDelete,
  treeItemDeleteTarget: longTreeItemDelete,
  ledgerCommitDeleteTarget: longLedgerCommitDelete,
  volumeCreateTarget: longVolumeCreate,
  bindingsDialogMode: longBindingsDialogMode,
  bookActionPending: longBookActionPending,
  manuscriptExportPending: longManuscriptExportPending,
  continuationImportPreview,
  legacySyncPreview,
  legacySyncResult,
  exportTarget: longExportTarget,
  bookRenameTarget: longBookRenameDialog,
  bookRemovalTarget: longBookRemovalDialog
} = storeToRefs(longWorkspaceStore);
const {
  libraryProjectDialog,
  externalSkillImportDialog,
  libraryGroupDialog,
  libraryRemovalDialog,
  libraryEntryClipboardDomain,
  pendingLibraryEntryMove,
  activeLibraryGroup,
  createCatalogLibrary,
  saveCatalogLibraryGroup,
  createCatalogLibraryEntry,
  renameCatalogLibrary,
  renameCatalogLibraryEntry,
  removeCatalogLibraryEntry,
  requestCatalogLibraryEntryMove,
  confirmCatalogLibraryEntryMove,
  importExternalSkills,
  confirmLibraryRemoval,
  handleResourceNodeAction
} = useCatalogLibraryTransactionsCoordinator({
  api: () => window.deepwrite?.catalog,
  snapshot: catalogSnapshot,
  documents,
  drafts: editorDrafts,
  mutationPending: catalogMutationPending,
  findLibrary: findCatalogLibrary,
  ensureDocumentLoaded: (document) => ensureCatalogDocumentLoaded(document),
  refreshCatalog: loadCatalogSnapshot,
  refreshWorkspaceDirectory() {
    return loadWorkspaceDirectory();
  },
  advanceDraftProjectRevision: advanceLibraryDraftProjectRevision,
  isConflict: isCatalogConflict,
  prepareProjectsForDuplicate: prepareLibraryProjectsForDuplicate,
  selectDocument(documentId, revealEditor) {
    selectedResourceId.value = documentId;
    if (revealEditor) revealTextPane();
  },
  async navigateToDocumentResource(documentId) {
    const targetNode = findResourceNodeIn(
      resourceTreeSections.value,
      documentId
    );
    if (targetNode) await selectResource(targetNode);
  },
  collectResourceNodeIds: (node) => collectResourceNodeIds(node),
  disposeLibraryConversation,
  notifications: uiMessage
});
type CreateCreativeBookPayload =
  | ({ workspaceType: "short" } & CreateShortBookInput)
  | ({ workspaceType: "script" } & CreateScriptBookInput)
  | ({ workspaceType: "long" } & CreateLongBookInput);

const conversationStore = useConversationStore();
const {
  controllers: conversationControllers,
  scopesByKey: conversationScopesByKey,
  controllerRegistryRevision,
  agentRunPreferences,
  sessionAgentModelSelection
} = storeToRefs(conversationStore);
// These stores deliberately keep Map identity stable so the lazy proposal
// coordinator can retain a registry reference while controllers are added.
const conversations = conversationControllers.value;
const conversationScopes = conversationScopesByKey.value;
const conversationPersistenceAdapter = createConversationPersistenceAdapter(
  window.deepwrite?.conversationPersistence,
  { storage: window.localStorage }
);
const conversationRuntimeRegistry = useConversationRuntimeRegistryCoordinator({
  store: {
    sessionAgentModelSelection,
    agentRunPreferences,
    configurePersistenceAdapter: conversationStore.configurePersistenceAdapter,
    registerController: conversationStore.registerController,
    controllerForKey: conversationStore.controllerForKey,
    scopeForKey: conversationStore.scopeForKey,
    setControllerScope: conversationStore.setControllerScope,
    listControllers: conversationStore.listControllers,
    controllerEntries: () => conversations.entries(),
    setSessionAgentModelSelection:
      conversationStore.setSessionAgentModelSelection,
    setAgentRunPreferences: conversationStore.setAgentRunPreferences,
    removeAgentRunPreferences: conversationStore.removeAgentRunPreferences,
    schedulePersistence: conversationStore.schedulePersistence,
    schedulePersistenceFactory: conversationStore.schedulePersistenceFactory,
    loadPersistence: conversationStore.loadPersistence,
    removePersistence: conversationStore.removePersistence,
    hydratePreferences: conversationStore.hydratePreferences
  },
  persistenceAdapter: conversationPersistenceAdapter,
  modelSettings,
  permissionMode: () => generalSettings.value.permissionMode,
  createController: (hooks) =>
    useAgentConversation({
      api: () => window.deepwrite,
      autoApproveCrossStageOperations: () =>
        generalSettings.value.autoApproveCrossStageOperations,
      onContextWarning: (message) => uiMessage.warning(message),
      ...hooks
    }),
  resumeRecovered: (controllers) =>
    resumeRecoveredAutomaticAgentEditsIfNeeded(controllers),
  notifications: uiMessage
});
const {
  allConversations,
  applyModelSettingsToConversations,
  conversationForKey,
  dispose: disposeConversationRuntimeRegistry,
  hydrateConversationPreferences,
  persistenceEnabled: conversationPersistenceEnabled,
  removeAgentRunPreferences,
  synchronizeAgentRunPreferences,
  synchronizeSessionAgentModelSelection
} = conversationRuntimeRegistry;
const handledWorkspaceMutationEventIds = new Set<string>();
const {
  collectResourceNodeIds,
  longBookResourceNodes,
  preferredLongResourceIdForSelection,
  resourceTreeLookup,
  resourceTreeSections,
  synchronizeSelectedLongResourceForLayout,
  updateBookPreference
} = useWorkspaceResourceTreeCoordinator({
  catalogProjection,
  fallbackSections: resourceSections,
  longBooks,
  longCatalogDiagnostics,
  activeLongBookId,
  activeLongWorkspaceIndex,
  activeLongSelection,
  selectedResourceId,
  storage: () => window.localStorage,
  notifications: uiMessage
});

const {
  isLongWorkspaceActive,
  activeFeature,
  workspaceFeatureModule,
  marketplaceDisplayName,
  showConversation,
  newConversation,
  openWorkspaceDialog,
  openSettings,
  openOfficialModelsSettings,
  openAgentTeams,
  openMarketplace,
  openCloudBackup,
  openZhuqueDetection,
  loadWorkspaceDirectory,
  chooseWorkspaceDirectory,
  closeSettings,
  applyMarketplaceSession,
  loadMarketplaceSession,
  ensureActiveFeatureDependencies,
  dispose: disposeWorkspaceFeatureHost
} = useWorkspaceFeatureHostCoordinator({
  api: () => window.deepwrite,
  view: {
    current: currentView,
    settingsInitialCategory,
    workspaceMain: workspaceMainView,
    activeLongBookId
  },
  settingsStore,
  catalogSnapshot,
  features: {
    learningImitation: learningImitationFeature,
    longBookAnalysis: longBookAnalysisFeature,
    subagentAuthoring: subagentAuthoringFeature
  },
  actions: {
    saveActiveLongEditorBeforeLeaving: () =>
      saveActiveLongEditorBeforeLeaving(),
    newShortConversation: () => newShortConversation(),
    newLongConversation: () => newLongConversation()
  },
  loaders: {
    loadModelSettings: () => loadModelSettings(),
    loadOfficialModels: () => loadOfficialModels(),
    loadShortAndScriptAgentSettings: () => loadShortAndScriptAgentSettings(),
    ensureLongAgentSettingsLoaded: () => ensureLongAgentSettingsLoaded(),
    loadWorkspaceAgentSettings: () => loadWorkspaceAgentSettings(),
    loadAgentTeamSettings: () => loadAgentTeamSettings(),
    loadLibraryAgentSettings: () => loadLibraryAgentSettings(),
    loadLearningImitationSettings: () => loadLearningImitationSettings(),
    loadCatalogSnapshot: () => loadCatalogSnapshot()
  },
  notifications: uiMessage
});

const longWorkspacePresentation = useLongWorkspacePresentationCoordinator({
  isLongWorkspaceActive,
  long: {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    selection: activeLongSelection,
    fileContext: activeLongFileContext,
    contextReady: activeLongWorkspaceContextReady,
    agentSettings: longAgentSettings,
    refreshStatus: activeLongWorkspaceRefreshStatus,
    sendPreflightPending: longSendPreflightPending,
    proposalApprovalPending: longProposalApprovalPending
  },
  catalog: {
    documents
  },
  conversations: {
    controllers: conversationControllers,
    scopesByKey: conversationScopesByKey
  },
  edits: {
    acceptingDocumentIds: acceptingAgentEditDocumentIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
    savingDocumentIds
  }
});
const {
  activeLongRoot,
  activeLongAgentProfile,
  activeLongRuntimeContext,
  longEditorLocked,
  longEditorLockedReason,
  editorLocked,
  editorLockedLabel,
  editorSaving,
  buildLongLibraryAttachmentsForProfile,
  filterLongReadableAttachmentsForProfile,
  longCatalogContextDocuments,
  agentRunScopeHasWriteBarrier,
  documentHasWriteBarrier
} = longWorkspacePresentation;
documentHasAgentRunWriteBarrier = documentHasWriteBarrier;
const {
  workspaceProposals: longWorkspaceProposals,
  activeConversationProposalItems: activeLongConversationProposalItems,
  conversationKey: longConversationKey,
  conversationForProposalEvent: longConversationForProposalEvent,
  refreshWorkspaceAfterProposal: refreshLongProposalWorkspace,
  stopBookAgentRuns: stopLongBookAgentRuns,
  disposeBookProposalState: disposeLongBookProposalState,
  disposeBookConversations: disposeLongBookConversations,
  stopActiveGeneration: stopLongGenerationCommand,
  approveProposal: approveLongProposal,
  rejectProposal: rejectLongProposal,
  retryProposalPreview: retryLongProposalPreview,
  locateAcceptedProposal: locateAcceptedLongProposal,
  dispose: disposeLongProposalRuntime
} = useLongProposalRuntimeCoordinator({
  state: {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    proposalApprovalPending: longProposalApprovalPending
  },
  api: resolveLongWorkspaceApi,
  conversations: {
    byKey: conversations,
    remove: (key, options) => conversationStore.removeController(key, options),
    active: () => activeLongConversation.value
  },
  workspace: {
    saveActiveEditorChanges: () => saveActiveLongEditorChanges(),
    refreshActiveWorkspace: (bookId) => refreshActiveLongWorkspace(bookId),
    refreshBookList: () => loadLongBookList({ force: true })
  },
  removeAgentRunPreferences,
  navigateToAcceptedProposal: async (item) => {
    const { resolveLongProposalApprovalTarget } =
      await import("./utils/approvalNavigation");
    return navigateToApprovalTarget(resolveLongProposalApprovalTarget(item));
  },
  notifications: uiMessage
});
const {
  editor: longWorkspaceEditor,
  loadBookList: loadLongBookList,
  saveActiveEditorChanges: saveActiveLongEditorChanges,
  saveActiveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
  openBook: openLongBook,
  refreshActiveWorkspace: refreshActiveLongWorkspace,
  selectWorkspaceFile: selectLongWorkspaceFile,
  selectCharacterTab: selectLongCharacterTab,
  selectPlotPointTab: selectLongPlotPointTab,
  selectChapterCardTab: selectLongChapterCardTab,
  handleFileContextChange: handleLongFileContextChange,
  handleDocumentSaved: handleLongDocumentSaved,
  retryActiveRefresh: retryActiveLongWorkspaceRefresh,
  refreshOnWindowFocus: refreshLongWorkspaceOnWindowFocus,
  invalidateRefresh: invalidateLongWorkspaceRefresh,
  deactivateActiveBook: deactivateActiveLongBook,
  clearActiveBook: clearActiveLongBook,
  activateOpenedBook: activateOpenedLongBook,
  dispose: disposeLongWorkspaceSession
} = useLongWorkspaceSessionCoordinator({
  store: longWorkspaceStore,
  state: {
    longBooks,
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    selection: activeLongSelection,
    fileContext: activeLongFileContext,
    refreshStatus: longWorkspaceRefreshStatus,
    activeRefreshStatus: activeLongWorkspaceRefreshStatus
  },
  api: resolveLongWorkspaceApi,
  isWorkspaceActive: () => isLongWorkspaceActive.value,
  prepareOpenDependencies: () =>
    Promise.all([loadModelSettings(), ensureLongAgentSettingsLoaded()]),
  activateProposalBook: (bookId) => longWorkspaceProposals.activateBook(bookId),
  synchronizeSelectedResourceForLayout:
    synchronizeSelectedLongResourceForLayout,
  async selectFallbackAfterClear() {
    const fallback = resourceTreeSections.value
      .find(({ id }) => id === "creation")
      ?.nodes.find((node) => !node.longBookId);
    if (fallback) {
      await selectResource(fallback);
    } else {
      selectedResourceId.value = "";
    }
  },
  notifications: uiMessage,
  scheduler: {
    setTimeout: (task, delayMs) => window.setTimeout(task, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle)
  }
});

const {
  request: requestDeleteLongLedgerCommit,
  close: closeDeleteLongLedgerCommit,
  confirm: confirmDeleteLongLedgerCommit
} = useLongLedgerCommitDeletionCoordinator({
  api: resolveLongWorkspaceApi,
  activeBookId: activeLongBookId,
  workspaceIndex: activeLongWorkspaceIndex,
  target: longLedgerCommitDelete,
  pending: longBookActionPending,
  saveActiveEditorChanges: saveActiveLongEditorChanges,
  refreshActiveWorkspace: refreshActiveLongWorkspace,
  notifications: uiMessage
});

function updateLongWorkspaceEditorPort(
  port: LongWorkspaceEditorPort | null
): void {
  longWorkspaceEditor.value = port;
}

const {
  activeAgentDocument,
  activeCharacterItemTabs,
  activeDocument,
  activeEditorDraft,
  activeEditorSectionId,
  activeEditorSectionTabs,
  activeExpertSectionId,
  activeLibraryBoundToBook,
  activePromptDocument,
  activeRightPanePreferenceKey,
  canCreateEditorSection,
  canDeleteEditorSection,
  clearEditorSelectionReferences,
  dispose: disposeWorkspaceResources,
  documentForResourceId,
  draftDirectoryForResourceId,
  draftFileDocument,
  editorCreateSectionLabel,
  editorDeleteSectionLabel,
  editorSectionTabsLabel,
  editorShowsCharacterItemTabs,
  ensureCatalogDocumentLoaded,
  ensureCatalogDocumentsLoaded,
  fallbackCreationResourceId: resolveFallbackCreationResourceId,
  findResourceNodeIn,
  findResourceNodeWhere,
  hydratedCatalogSnapshot,
  insertEditorSelectionReference,
  liveDocument,
  liveWorkspaceDocuments,
  locateEditorSelectionReference,
  promptDocumentForResourceId,
  removeEditorSelectionReference,
  resourceIdForDocumentId,
  resourceNode,
  selectDraftFile,
  selectExpertSection,
  selectResource,
  shortCatalogContextDocuments,
  showEditorDeleteSection
} = useWorkspaceResourceCoordinator({
  state: {
    selectedResourceId,
    activeCreationResourceId,
    selectedExpertSectionIds,
    selectedDraftFileKinds,
    pendingEditorReferences,
    editorReferenceNavigation,
    documents,
    editorDrafts
  },
  catalog: {
    snapshot: catalogSnapshot,
    projection: catalogProjection,
    reconciledProjection: reconciledCatalogProjection,
    loader: catalogDocumentLoader,
    findBook: catalogBook
  },
  tree: {
    sections: resourceTreeSections,
    lookup: resourceTreeLookup
  },
  longNavigation: {
    books: longBooks,
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    activeRoot: activeLongRoot,
    workspaceActive: isLongWorkspaceActive,
    saveActiveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
    openBook: openLongBook,
    selectWorkspaceFile: selectLongWorkspaceFile,
    deactivateActiveBook: deactivateActiveLongBook
  },
  emptyDocument: EMPTY_WORKSPACE_DOCUMENT,
  showConversation,
  revealEditor: () => {
    revealTextPane();
  },
  notifications: uiMessage
});
longWorkspacePresentation.bindEditor({
  selectedResourceId,
  activeDocument,
  activeAgentDocument,
  promptDocumentForResourceId
});

const {
  createLongBook,
  openExistingLongBook,
  chooseContinuationImportSource,
  importPortableLongBook,
  confirmContinuationImport,
  closeContinuationImportDialog,
  handleLongBookAction,
  closeLegacySyncDialog,
  confirmLegacySync,
  closeLongExportDialog,
  exportLongBookManuscript,
  closeLongBookRenameDialog,
  renameLongBook,
  closeLongBookBindingsDialog,
  updateLongBookBindings,
  closeLongBookRemovalDialog,
  confirmLongBookRemoval,
  saveLongAgentsMd,
  dispose: disposeLongBookLifecycle
} = useLazyLongBookLifecycleCoordinator({
  api: resolveLongWorkspaceApi,
  state: {
    longBooks,
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    refreshStatus: longWorkspaceRefreshStatus,
    mutationPending: longMutationPending,
    bookActionPending: longBookActionPending,
    manuscriptExportPending: longManuscriptExportPending,
    continuationImportPreview,
    legacySyncPreview,
    legacySyncResult,
    structureDialogOpen: longStructureDialogOpen,
    structureAgentsMd: longStructureAgentsMd,
    structureAgentsMdPending: longStructureAgentsMdPending,
    bindingsDialogMode: longBindingsDialogMode,
    exportTarget: longExportTarget,
    bookRenameTarget: longBookRenameDialog,
    bookRemovalTarget: longBookRemovalDialog,
    createBookDialogOpen,
    selectedResourceId
  },
  session: {
    activateOpenedBook: activateOpenedLongBook,
    loadAgentSettings: () => loadLongAgentSettings(),
    saveActiveEditorChanges: saveActiveLongEditorChanges,
    saveActiveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
    openBook: openLongBook,
    refreshActiveWorkspace: refreshActiveLongWorkspace,
    clearActiveBook: clearActiveLongBook,
    invalidateWorkspaceRefresh: invalidateLongWorkspaceRefresh,
    selectWorkspaceFile: selectLongWorkspaceFile
  },
  workflow: {
    stopBookAgentRuns: stopLongBookAgentRuns,
    quarantineBook: (bookId) => longWorkspaceProposals.discardBook(bookId),
    reactivateBook: (bookId) => longWorkspaceProposals.activateBook(bookId),
    disposeBookProposalState: disposeLongBookProposalState
  },
  conversations: {
    disposeBookConversations: disposeLongBookConversations
  },
  catalog: {
    loadBookList: loadLongBookList,
    refreshWorkspaceDirectory: loadWorkspaceDirectory
  },
  resources: {
    async selectBook(bookId) {
      const target = longBookResourceNodes.value.find(
        (node) => node.longBookId === bookId
      );
      if (target) await selectResource(target);
    },
    showConversation,
    revealEditor: () => {
      revealTextPane();
    }
  },
  manuscript: {
    available: () => Boolean(window.deepwrite),
    async createInput(input) {
      const { createLongManuscriptExportInput } =
        await import("./utils/longManuscriptExport");
      return createLongManuscriptExportInput(input);
    },
    exportLong(input) {
      const desktop = window.deepwrite;
      if (!desktop) {
        throw new Error("桌面运行时已断开，无法导出长篇。");
      }
      return desktop.manuscript.exportLong(input);
    }
  },
  scheduler: {
    settleUi: () => nextTick()
  },
  notifications: uiMessage
});

const {
  longWorldbuildingSyncBookOptions,
  openLongChapterCardCreate,
  requestCreateLongDraftSection,
  handleLongDraftSectionAction,
  handleCreateLongTreeItem,
  handleLongTreeItemAction,
  confirmDeleteLongTreeItem,
  confirmDeleteLongDraftSection,
  renameLongCharacter,
  renameLongStructureTitle,
  openLongCharacterCreate,
  openLongWorldbuildingItemCreate,
  openLongVolumeCreate,
  openLongPlotPointCreate,
  saveLongVolumeOutline,
  saveLongPlotPointContent,
  createLongVolume,
  createLongWorldbuildingItem,
  createLongPlotPoint,
  createLongChapterCard,
  handleActiveLongStructureMutation,
  previewActiveLongStructureMutation,
  handleLongWorldbuildingSync,
  previewActiveLongNavigationStructure,
  deleteActiveLongNavigationStructure,
  createLongCharacter,
  closeLongStructureDialog,
  closeLongCharacterCreate,
  closeLongWorldbuildingItemCreate,
  closeLongPlotPointCreate,
  closeLongChapterCardCreate,
  closeLongDraftSectionDelete,
  closeLongTreeItemDelete,
  closeLongVolumeCreate,
  dispose: disposeLongStructureTransactions
} = useLazyLongStructureTransactionsCoordinator({
  api: resolveLongWorkspaceApi,
  state: {
    longBooks,
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    selection: activeLongSelection,
    mutationPending: longBookActionPending,
    structureDialogOpen: longStructureDialogOpen,
    characterCreateTarget: longCharacterCreate,
    worldbuildingItemCreateTarget: longWorldbuildingItemCreate,
    plotPointCreateTarget: longPlotPointCreate,
    chapterCardCreateTarget: longChapterCardCreate,
    draftSectionDeleteTarget: longDraftSectionDelete,
    treeItemDeleteTarget: longTreeItemDelete,
    volumeCreateTarget: longVolumeCreate,
    selectedResourceId
  },
  session: {
    saveActiveEditorChanges: saveActiveLongEditorChanges,
    saveActiveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
    openBook: openLongBook,
    refreshActiveWorkspace: refreshActiveLongWorkspace,
    refreshWorkspaceAfterProposal: refreshLongProposalWorkspace,
    selectWorkspaceFile: selectLongWorkspaceFile,
    selectChapterCardTab: selectLongChapterCardTab,
    editor: longWorkspaceEditor
  },
  resources: {
    node: resourceNode,
    select: selectResource,
    synchronizeSelectedResourceForLayout:
      synchronizeSelectedLongResourceForLayout,
    revealEditor: () => {
      revealTextPane();
    }
  },
  notifications: uiMessage
});

const {
  plotStructureBookId,
  plotStructureBook,
  writingContext,
  writingContextLoading,
  writingContextPending,
  saveWritingContext,
  characterItemDialog,
  pendingExpertSectionCreation,
  pendingExpertSectionDeletion,
  legacyDraftSectionConversationKeys,
  prepareBookMutation,
  duplicateCatalogBook,
  openPlotStructureDialog,
  closePlotStructureDialog,
  mutateCharacterStructure,
  mutatePlotStructure,
  selectCharacterItemTab,
  addCharacterItemFromEditor,
  deleteCharacterItemFromEditor,
  requestCreateCharacterItem,
  handleCharacterItemAction,
  closeCharacterItemDialog,
  submitCharacterItemDialog,
  addExpertSection,
  closeCreateExpertSectionDialog,
  confirmCreateExpertSection,
  addExpertSectionFromEditor,
  moveExpertSection,
  removeExpertSectionFromEditor,
  requestRemoveExpertSection,
  closeRemoveExpertSectionDialog,
  confirmRemoveExpertSection,
  dispose: disposeShortWorkspaceStructure
} = useShortWorkspaceStructureCoordinatorWithContext({
  api: () => window.deepwrite?.catalog,
  state: {
    documents,
    drafts: editorDrafts,
    mutationPending: catalogMutationPending,
    selectedResourceId,
    activeCreationResourceId,
    selectedExpertSectionIds,
    selectedDraftFileKinds,
    savingDocumentIds,
    acceptingDocumentIds: acceptingAgentEditDocumentIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds
  },
  catalog: {
    projection: catalogProjection,
    findBook: catalogBook,
    refresh: loadCatalogSnapshot,
    isConflict: isCatalogConflict
  },
  saves: {
    conflict: saveConflict,
    drain: drainEditorSaves,
    cancel: cancelEditorAutoSave,
    persist: persistEditorDocument
  },
  resources: {
    sections: resourceTreeSections,
    activeDocument,
    activeCharacterItemTabs,
    activeExpertSectionId,
    documentForResourceId,
    resourceIdForDocumentId,
    resourceNode,
    draftDirectoryForResourceId,
    draftFileDocument,
    ensureDocumentLoaded: ensureCatalogDocumentLoaded,
    liveDocument,
    selectResource,
    async revealCatalogBook(projectId) {
      const targetResourceId = resolvePreferredBookResourceId(
        catalogProjection.value ?? undefined,
        projectId
      );
      const targetNode = targetResourceId
        ? findResourceNodeIn(resourceTreeSections.value, targetResourceId)
        : undefined;
      if (targetNode) await selectResource(targetNode);
    }
  },
  conversations: {
    forKey: conversationForKey,
    entries: () => conversations.entries(),
    hasWriteBarrier: agentRunScopeHasWriteBarrier,
    remove: (key, options) => conversationStore.removeController(key, options)
  },
  refreshWorkspaceDirectory: loadWorkspaceDirectory,
  notifications: uiMessage
});

const shortBookConversationEntries = createBookConversationEntries(
  () => conversations.entries(),
  conversationScopes
);

const shortBookLifecycle = useLazyShortBookLifecycleCoordinator({
  state: {
    catalogMutationPending,
    createBookDialogOpen,
    documents,
    drafts: editorDrafts,
    selectedResourceId,
    activeCreationResourceId,
    selectedExpertSectionIds,
    selectedDraftFileKinds
  },
  catalog: {
    api: () => window.deepwrite?.catalog,
    book: catalogBook,
    refresh: loadCatalogSnapshot,
    refreshWorkspaceDirectory: loadWorkspaceDirectory,
    isConflict: isCatalogConflict
  },
  preparation: {
    prepareBookMutation
  },
  structure: {
    duplicateBook: duplicateCatalogBook,
    openStructure: openPlotStructureDialog
  },
  conversations: {
    async stopBookRuns(bookId) {
      const stopped = await Promise.all(
        shortBookConversationEntries(bookId).flatMap(([, conversation]) =>
          conversation.isBusy.value ? [conversation.stopGeneration()] : []
        )
      );
      if (stopped.some((accepted) => !accepted)) {
        throw new Error("当前智能体未能安全停止，作品操作已取消。");
      }
    },
    disposeBook(bookId, options) {
      for (const [key] of shortBookConversationEntries(bookId)) {
        conversationStore.removeController(key, {
          clearPersistence: options.clearPersistence
        });
      }
    },
    removeRunPreferences: (scope) => removeAgentRunPreferences(scope)
  },
  resources: {
    async selectPreferredBook(bookId) {
      const targetResourceId = resolvePreferredBookResourceId(
        catalogProjection.value ?? undefined,
        bookId
      );
      const target = targetResourceId
        ? findResourceNodeIn(resourceTreeSections.value, targetResourceId)
        : undefined;
      if (!target) return false;
      await selectResource(target);
      return (
        resolveBookWorkspaceId(
          catalogProjection.value ?? undefined,
          selectedResourceId.value
        ) === bookId
      );
    },
    settleUi: () => nextTick(),
    fallbackCreationResourceId(excludedBookId) {
      const fallback = resolveFallbackCreationResourceId(
        resourceTreeSections.value,
        selectedResourceId.value
      );
      if (
        resolveBookWorkspaceId(
          catalogProjection.value ?? undefined,
          fallback
        ) !== excludedBookId
      ) {
        return fallback;
      }
      return (
        catalogProjection.value?.draftDirectories.find(
          (directory) => directory.workspaceId !== excludedBookId
        )?.id ??
        documents.value.find(
          (document) =>
            document.domain === "creation" &&
            document.workspaceId !== excludedBookId
        )?.id ??
        ""
      );
    }
  },
  legacy: {
    hasBook: (target) =>
      !catalogBook(target.bookId) && Boolean(resourceNode(target.bookId)),
    rename(target, label) {
      const resourceIds = new Set(target.resourceIds);
      documents.value = documents.value.map((document) =>
        document.workspaceId !== target.bookId && !resourceIds.has(document.id)
          ? document
          : {
              ...document,
              path: document.path.length
                ? [label, ...document.path.slice(1)]
                : [label],
              ...(document.workspaceId === target.bookId
                ? { workspaceTitle: label }
                : {})
            }
      );
      updateBookPreference(target.bookId, { label });
    },
    updateBindings(target, payload) {
      updateBookPreference(
        target.bookId,
        payload.domain === "skill"
          ? {
              skillLibraryIds: [
                ...new Set(Object.values(payload.linksByKind).flat())
              ]
            }
          : {
              materialLibraryIds: [
                ...new Set(Object.values(payload.linksByKind).flat())
              ]
            }
      );
    },
    remove(target) {
      const resourceIds = new Set(target.resourceIds);
      documents.value = documents.value.filter(
        (document) =>
          document.workspaceId !== target.bookId &&
          !resourceIds.has(document.id)
      );
      updateBookPreference(target.bookId, { removed: true });
    }
  },
  manuscript: {
    api: () => window.deepwrite?.manuscript,
    ensureDocumentsLoaded: ensureCatalogDocumentsLoaded
  },
  clipboard: {
    writeText: (text) => navigator.clipboard.writeText(text)
  },
  notifications: uiMessage
});
const {
  bookDialogMode,
  activeBook,
  exportBookTarget,
  manuscriptExportPending,
  openBookDialog,
  closeBookDialog,
  openBookExportDialog,
  closeBookExportDialog,
  renameBook,
  updateBookBindings,
  removeBook,
  deleteBook,
  exportBookManuscript,
  dispose: disposeShortBookLifecycle
} = shortBookLifecycle;
const skillLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    return catalogSnapshot.value.skills.map((library) => ({
      id: library.id,
      label: library.title,
      icon: "library",
      ...(library.isBuiltin ? { badge: "官方" } : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      skillKind: library.skillKind,
      workspaceType: library.skillType
    }));
  }
  return (
    resourceTreeSections.value.find((section) => section.id === "skill")
      ?.nodes ?? []
  );
});
const materialLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    return catalogSnapshot.value.materials.map((library) => ({
      id: library.id,
      label: library.title,
      icon: "archive",
      ...([library.parentGenre, library.subGenre].filter(Boolean).join(" / ")
        ? {
            badge: [library.parentGenre, library.subGenre]
              .filter(Boolean)
              .join(" / ")
          }
        : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      materialKind: library.materialKind,
      workspaceType: library.materialType,
      ...(library.parentGenre ? { parentGenre: library.parentGenre } : {}),
      ...(library.subGenre ? { subGenre: library.subGenre } : {})
    }));
  }
  return (
    resourceTreeSections.value.find((section) => section.id === "material")
      ?.nodes ?? []
  );
});

// A single descriptor decides which dialog subtree exists. Parent dialogs may
// keep state while a child confirmation is active, but only the highest
// priority descriptor reaches the lazy dialog layer.
const workspaceDialogModule = useWorkspaceDialogModuleCoordinator({
  startup: {
    messages: startupAlertMessages
  },
  save: {
    conflict: saveConflict,
    submitting: saveConflictSubmitting
  },
  shortStructure: {
    expertCreation: pendingExpertSectionCreation,
    expertDeletion: pendingExpertSectionDeletion,
    characterDialog: characterItemDialog,
    plotBookId: plotStructureBookId,
    plotBook: plotStructureBook,
    writingContext,
    writingContextLoading,
    writingContextPending
  },
  longStructure: {
    characterCreation: longCharacterCreate,
    worldbuildingItemCreation: longWorldbuildingItemCreate,
    plotPointCreation: longPlotPointCreate,
    chapterCardCreation: longChapterCardCreate,
    draftDeletion: longDraftSectionDelete,
    treeDeletion: longTreeItemDelete,
    ledgerCommitDeletion: longLedgerCommitDelete,
    volumeCreation: longVolumeCreate,
    dialogOpen: longStructureDialogOpen,
    agentsMd: longStructureAgentsMd,
    agentsMdPending: longStructureAgentsMdPending,
    syncBookOptions: longWorldbuildingSyncBookOptions
  },
  longLifecycle: {
    continuationPreview: continuationImportPreview,
    legacyPreview: legacySyncPreview,
    legacyResult: legacySyncResult,
    mutationPending: longMutationPending,
    activeBookSummary: activeLongBookSummary,
    activeBookId: activeLongBookId,
    workspaceIndex: activeLongWorkspaceIndex,
    bindingsMode: longBindingsDialogMode,
    bookActionPending: longBookActionPending,
    renameTarget: longBookRenameDialog,
    removalTarget: longBookRemovalDialog,
    exportTarget: longExportTarget,
    manuscriptExportPending: longManuscriptExportPending
  },
  shortLifecycle: {
    exportTarget: exportBookTarget,
    manuscriptExportPending,
    createDialogOpen: createBookDialogOpen,
    transferMode: bookTransferDialogMode,
    resourceMode: bookDialogMode,
    activeBookTarget: activeBook
  },
  library: {
    removalDialog: libraryRemovalDialog,
    projectDialog: libraryProjectDialog,
    externalSkillImportDialog,
    entryMove: pendingLibraryEntryMove,
    groupDialog: libraryGroupDialog,
    activeGroup: activeLibraryGroup
  },
  catalog: {
    snapshot: catalogSnapshot,
    loading: catalogLoading,
    mutationPending: catalogMutationPending,
    skillLibraries,
    materialLibraries,
    materialStageOptions(materialKind) {
      return (MATERIAL_KIND_ALLOWED_STAGES[materialKind] ?? []).map(
        (value) => ({
          value,
          label: MATERIAL_STAGE_LABELS[value]
        })
      );
    }
  }
});

const {
  loadModelSettings,
  loadAppAlerts,
  closeStartupAlert,
  loadModelUsage,
  loadOfficialModels,
  loadSiteOfficialModels,
  saveOfficialToken,
  clearOfficialToken,
  saveSiteOfficialToken,
  clearSiteOfficialToken,
  refreshSiteOfficialModels,
  setSiteOfficialModelEnabled,
  setOfficialModelEnabled,
  saveModelSettings,
  refreshFreeModels,
  setFreeModelEnabled,
  testModel,
  loadShortAndScriptAgentSettings,
  loadLongAgentSettings,
  ensureLongAgentSettingsLoaded,
  loadWorkspaceAgentSettings,
  saveWorkspaceAgentSettings,
  saveLongAgentSettings,
  loadAgentTeamSettings,
  createAgentTeam,
  renameAgentTeam,
  deleteAgentTeam,
  downloadAgentTeam,
  installAgentTeam,
  setAgentTeamEnabled,
  saveAgentTeamSettings,
  loadLibraryAgentSettings,
  saveLibraryAgentSettings,
  resetLibraryAgentSettings,
  loadLearningImitationSettings,
  saveLearningImitationSettings,
  resetLearningImitationSettings
} = useSettingsFeatureCoordinator({
  api: () => window.deepwrite,
  settingsStore,
  notifications: uiMessage,
  onModelsLoaded(settings) {
    learningImitationFeature.setConfiguredModels(
      settings.models,
      settings.defaultModelId
    );
    longBookAnalysisFeature.setConfiguredModels(
      settings.models,
      settings.defaultModelId
    );
    applyModelSettingsToConversations(settings);
  }
});

conversationForKey("general");

const chatAssistant = useChatAssistant({
  ensureModelSettingsLoaded: loadModelSettings,
  persistenceAdapter: conversationPersistenceAdapter
});

const {
  activeConversation: activeLongConversation,
  availableMaterialReferences: activeLongMaterialReferences,
  availableSkillReferences: activeLongSkillReferences,
  dispose: disposeLongConversation,
  newConversation: newLongConversation,
  selectAgentTeamMode: selectLongAgentTeamMode,
  selectApprovalMode: selectLongApprovalMode,
  selectConversation: selectLongConversation,
  selectModel: selectLongModel,
  selectTemperature: selectLongTemperature,
  selectThinking: selectLongThinking,
  sendLongMessage,
  stopGeneration: stopLongGeneration,
  updateDraft: updateLongComposerDraft,
  useSuggestion: useLongSuggestion
} = useLongConversationCoordinator({
  state: {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    selection: activeLongSelection,
    fileContext: activeLongFileContext,
    activeRoot: activeLongRoot,
    activeAgentProfile: activeLongAgentProfile,
    activeRuntimeContext: activeLongRuntimeContext,
    sendPreflightPending: longSendPreflightPending,
    agentLoadError: longAgentLoadError
  },
  runtime: {
    conversationKey: longConversationKey,
    conversationForKey,
    synchronizeSessionModelSelection: synchronizeSessionAgentModelSelection,
    synchronizeRunPreferences: synchronizeAgentRunPreferences
  },
  workspace: {
    ensureAgentSettingsLoaded: ensureLongAgentSettingsLoaded,
    saveActiveEditorChanges: saveActiveLongEditorChanges,
    refreshActiveWorkspace: refreshActiveLongWorkspace,
    captureForeshadowingFocus: () =>
      longWorkspaceEditor.value?.captureForeshadowingFocus() ?? {
        threadId: null,
        beatId: null
      },
    api: resolveLongWorkspaceApi
  },
  catalog: {
    indexSnapshot: catalogSnapshot,
    documentsForProfile: longCatalogContextDocuments,
    ensureDocumentsLoaded: ensureCatalogDocumentsLoaded,
    hydratedSnapshot: hydratedCatalogSnapshot,
    buildAttachments: buildLongLibraryAttachmentsForProfile,
    filterReadableAttachments: filterLongReadableAttachmentsForProfile
  },
  settings: {
    permissionMode: () => generalSettings.value.permissionMode,
    updatePermissionMode
  },
  commands: {
    stopGeneration: stopLongGenerationCommand
  },
  showConversation,
  notifications: uiMessage
});
const hasDesktopRuntime = computed(() => Boolean(window.deepwrite));
const proposalEditQueueBridge = {
  hasQueued: (): boolean => false
};
const {
  activeConversation,
  conversationContext: writingConversationContext,
  dispose: disposeShortConversation,
  newConversation: newShortConversation,
  selectAgentTeamMode,
  selectApprovalMode,
  selectConversation,
  selectModel,
  selectTemperature,
  selectThinking,
  sendMessage,
  stopGeneration,
  updateDraft: updateComposerDraft,
  useSuggestion
} = useShortConversationCoordinator({
  runtime: {
    conversationForKey,
    synchronizeSessionModelSelection: synchronizeSessionAgentModelSelection,
    synchronizeRunPreferences: synchronizeAgentRunPreferences
  },
  resource: {
    selectedResourceId,
    activeCreationResourceId,
    activeAgentDocument,
    activePromptDocument,
    liveWorkspaceDocuments,
    pendingEditorReferences,
    leftCollapsed,
    rightCollapsed,
    clearEditorSelectionReferences,
    contextDocuments: shortCatalogContextDocuments,
    ensureDocumentsLoaded: ensureCatalogDocumentsLoaded,
    hydratedCatalogSnapshot
  },
  catalog: {
    snapshot: catalogSnapshot,
    findBook: catalogBook
  },
  profiles: {
    workspaceAgents: workspaceAgentSettings,
    libraryAgents: libraryAgentSettings
  },
  edits: {
    acceptingDocumentIds: acceptingAgentEditDocumentIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
    hasQueued: () => proposalEditQueueBridge.hasQueued(),
    schedule: (predicate) => scheduleQueuedAgentEdits(predicate),
    resumeRecovered: (conversations) =>
      resumeRecoveredAutomaticAgentEditsIfNeeded(conversations)
  },
  settings: {
    permissionMode: () => generalSettings.value.permissionMode,
    updatePermissionMode
  },
  runtimeAvailable: () => hasDesktopRuntime.value,
  showConversation,
  notifications: uiMessage
});
const shortAgentActivityResourceId = computed(
  () =>
    resourceTreeLookup.value.resourceIdByDocumentId.get(
      activeAgentDocument.value.id
    ) ??
    (activeCreationResourceId.value || selectedResourceId.value)
);
const longAgentActivityResourceId = computed(() => {
  const bookId = activeLongBookId.value;
  const index = activeLongWorkspaceIndex.value;
  const selection = activeLongSelection.value;
  if (bookId && index && selection) {
    const preferred = preferredLongResourceIdForSelection(
      bookId,
      index,
      selection
    );
    if (preferred && resourceTreeLookup.value.nodeById.has(preferred)) {
      return preferred;
    }
  }
  return selectedResourceId.value;
});
const currentAgentActivityView = useCurrentAgentActivityView({
  activeFeature,
  shortResourceId: shortAgentActivityResourceId,
  longResourceId: longAgentActivityResourceId,
  shortConversation: activeConversation,
  shortContext: writingConversationContext,
  longConversation: activeLongConversation,
  longProfile: activeLongAgentProfile,
  longBook: activeLongBookSummary,
  longSelection: activeLongSelection,
  longRoot: activeLongRoot
});
const agentActivity = useAgentActivityCoordinator({
  controllers: conversationControllers,
  scopesByKey: conversationScopesByKey,
  registryRevision: controllerRegistryRevision,
  currentView: currentAgentActivityView,
  resolveDescriptor: (conversationKey) =>
    resolveAgentActivityDescriptor(conversationKey, {
      documents: documents.value,
      resourceTree: resourceTreeLookup.value,
      workspaceAgents: workspaceAgentSettings.value,
      longAgents: longAgentSettings.value,
      libraryAgents: libraryAgentSettings.value,
      longBooks: longBooks.value
    }),
  async navigate(item) {
    const node = resolveAgentActivityNavigationNode(item, {
      documents: documents.value,
      resourceTree: resourceTreeLookup.value,
      workspaceAgents: workspaceAgentSettings.value,
      longAgents: longAgentSettings.value,
      libraryAgents: libraryAgentSettings.value,
      longBooks: longBooks.value
    });
    if (!node) return "missing";
    await selectResource(node);
    if (item.chapterCardId) {
      await selectLongChapterCardTab(item.chapterCardId);
    }
    return selectedResourceId.value === node.id ||
      (item.chapterCardId !== undefined &&
        activeLongSelection.value?.chapterCardId === item.chapterCardId)
      ? "navigated"
      : "blocked";
  },
  notifications: uiMessage
});
provide(AGENT_ACTIVITY_CONTEXT_KEY, agentActivity.context);
const activeEditorEntrySearchItems = computed(() =>
  editorEntrySearchSources(liveWorkspaceDocuments.value, activeDocument.value)
);
const writingEditorViewModel = computed(() => ({
  document: activeDocument.value,
  resourceId: selectedResourceId.value,
  draftState: activeEditorDraft.value,
  locateReference: editorReferenceNavigation.value,
  locked: editorLocked.value,
  lockedLabel: editorLockedLabel.value,
  saving: editorSaving.value,
  manualSaving: manualSavingDocumentIds.value.has(activeDocument.value.id),
  autoSaveEnabled: editorAutoSaveEnabled.value,
  defaultViewMode: generalSettings.value.defaultTextViewMode,
  boundToCurrentBook: activeLibraryBoundToBook.value,
  sectionTabs: activeEditorSectionTabs.value,
  activeSectionId: activeEditorSectionId.value,
  sectionTabsLabel: editorSectionTabsLabel.value,
  canCreateSection: canCreateEditorSection.value,
  createSectionLabel: editorCreateSectionLabel.value,
  showDeleteSection: showEditorDeleteSection.value,
  canDeleteSection: canDeleteEditorSection.value,
  deleteSectionLabel: editorDeleteSectionLabel.value,
  entrySearchItems: activeEditorEntrySearchItems.value
}));
async function prepareLibraryProjectsForDuplicate(
  libraryIds: ReadonlySet<string>
): Promise<boolean> {
  await drainEditorSaves();
  const scopedDocuments = documents.value.filter(
    (document) => document.libraryId && libraryIds.has(document.libraryId)
  );
  if (
    saveConflict.value &&
    scopedDocuments.some(({ id }) => id === saveConflict.value?.documentId)
  ) {
    uiMessage.warning("请先处理资料库尚未解决的保存冲突。");
    return false;
  }
  for (const document of scopedDocuments) {
    if (document.readOnly) continue;
    const draft = editorDrafts.value[document.id];
    if (!draft?.dirty) continue;
    cancelEditorAutoSave(document.id);
    const saved = await persistEditorDocument(
      { id: document.id, title: draft.title, content: draft.content },
      false
    );
    if (!saved) {
      uiMessage.warning("存在无法安全保存的资料库草稿，复制已取消。");
      return false;
    }
  }
  return true;
}

function selectEditorSection(sectionId: string): void {
  if (editorShowsCharacterItemTabs.value) {
    void selectCharacterItemTab(sectionId);
    return;
  }
  void selectExpertSection(sectionId);
}

function createEditorSection(): void {
  if (editorShowsCharacterItemTabs.value) {
    addCharacterItemFromEditor();
    return;
  }
  void addExpertSectionFromEditor();
}

function deleteEditorSection(): void {
  if (editorShowsCharacterItemTabs.value) {
    deleteCharacterItemFromEditor();
    return;
  }
  removeExpertSectionFromEditor();
}
function closeShortStructureDialog(): void {
  if (!catalogMutationPending.value) closePlotStructureDialog();
}
function disposeLibraryConversation(
  domain: "material" | "skill",
  libraryId: string
): void {
  const key = `library:${domain}:${libraryId}`;
  conversationStore.removeController(key);
  removeAgentRunPreferences(key);
}
function closeCreateBookDialog(): void {
  if (catalogMutationPending.value || longMutationPending.value) return;
  createBookDialogOpen.value = false;
}
function openCreateBookDialog(): void {
  if (!window.deepwrite) {
    uiMessage.warning("浏览器预览不能保存作品，请使用桌面客户端创建。");
    return;
  }
  createBookDialogOpen.value = true;
}
async function createCreativeBook(
  input: CreateCreativeBookPayload
): Promise<void> {
  if (input.workspaceType === "long") {
    await createLongBook({
      title: input.title,
      genre: input.genre,
      linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: input.linkedSkillIdsByKind
    });
    return;
  }
  await shortBookLifecycle.createBook(
    withShortBookDefaultPlotStages(
      input,
      workspaceAgentSettings.value,
      catalogSnapshot.value?.creativePlotStages ?? []
    )
  );
}
async function handleResourceAction(
  payload: ResourceSectionActionPayload
): Promise<void> {
  if (
    payload.domain === "creation" &&
    (payload.action === "choose-open-book" ||
      payload.action === "choose-import-book")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能打开本地作品，请使用桌面客户端。");
      return;
    }
    bookTransferDialogMode.value =
      payload.action === "choose-open-book" ? "open" : "import";
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "refresh-long-books"
  ) {
    if (!resolveLongWorkspaceApi()) {
      uiMessage.warning("浏览器预览不能刷新本地长篇，请使用桌面客户端。");
      return;
    }
    await loadLongBookList({ notify: true, force: true });
    if (!longCatalogLoadError.value) {
      uiMessage.success("长篇列表已刷新");
    }
    return;
  }

  if (payload.domain === "creation" && payload.action === "open-long-book") {
    await openExistingLongBook();
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "import-continuation-long-book"
  ) {
    await chooseContinuationImportSource();
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "import-portable-long-book"
  ) {
    await importPortableLongBook();
    return;
  }

  if (payload.domain === "creation" && payload.action === "create") {
    openCreateBookDialog();
    return;
  }

  if (
    payload.action === "create" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地资料库，请使用桌面客户端。");
      return;
    }
    libraryProjectDialog.value = {
      operation: "create-library",
      domain: payload.domain
    };
    return;
  }

  if (
    payload.action === "create-group" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地分组，请使用桌面客户端。");
      return;
    }
    libraryGroupDialog.value = { domain: payload.domain };
    return;
  }

  if (
    payload.action === "import-legacy-library" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能导入旧版资料库，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    catalogMutationPending.value = true;
    try {
      const result = await window.deepwrite.catalog.importLegacyLibrary(
        payload.domain
      );
      if (!result) {
        return;
      }
      await loadWorkspaceDirectory();
      await loadCatalogSnapshot();
      const imported = result.imported.at(-1);
      const target = documents.value.find(
        (document) => document.libraryId === imported?.id
      );
      if (target) {
        selectedResourceId.value = target.id;
        revealTextPane();
      }
      const libraryLabel = payload.domain === "material" ? "素材" : "技能";
      if (result.failures.length === 0) {
        uiMessage.success(
          result.imported.length === 1
            ? `已导入旧版${libraryLabel}库“${result.imported[0]!.title}”并新建资料库`
            : `已导入 ${result.imported.length} 个旧版${libraryLabel}库并新建资料库`
        );
      } else {
        const failureSummary = result.failures
          .map(({ fileName, message }) => `${fileName}：${message}`)
          .join("；");
        if (result.imported.length > 0) {
          uiMessage.warning(
            `已导入 ${result.imported.length} 个旧版${libraryLabel}库，${result.failures.length} 个失败：${failureSummary}`
          );
        } else {
          uiMessage.error(`导入旧版${libraryLabel}库失败：${failureSummary}`);
        }
      }
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "导入旧版资料库失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  if (payload.action === "import") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能打开本地文件夹，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    const domain =
      payload.domain === "creation"
        ? "book"
        : payload.domain === "material"
          ? "material"
          : "skill";
    catalogMutationPending.value = true;
    try {
      const opened = await window.deepwrite.catalog.openProject(domain);
      if (!opened) {
        return;
      }
      await loadWorkspaceDirectory();
      await loadCatalogSnapshot();
      const targetResourceId =
        opened.domain === "book"
          ? resolvePreferredBookResourceId(
              catalogProjection.value ?? undefined,
              opened.id
            )
          : documents.value.find((document) => document.libraryId === opened.id)
              ?.id;
      if (targetResourceId) {
        const targetNode = findResourceNodeIn(
          resourceTreeSections.value,
          targetResourceId
        );
        if (targetNode) {
          await selectResource(targetNode);
        }
      }
      uiMessage.success(
        `已打开${opened.domain === "book" ? "书籍" : opened.domain === "material" ? "素材库" : "技能库"}“${opened.title}”`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "打开本地项目失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  uiMessage.info("当前资源操作暂不可用。");
}

function handleBookTransferSelect(action: BookTransferAction): void {
  bookTransferDialogMode.value = null;
  void handleResourceAction({
    domain: "creation",
    action: action === "open-book" ? "import" : action
  });
}

function findCatalogLibrary(domain: "material" | "skill", libraryId: string) {
  return domain === "material"
    ? catalogSnapshot.value?.materials.find(
        (library) => library.id === libraryId
      )
    : catalogSnapshot.value?.skills.find((library) => library.id === libraryId);
}

function advanceLibraryDraftProjectRevision(
  domain: "material" | "skill",
  libraryId: string,
  expectedProjectRevision: number | undefined
): void {
  const projectRevision = findCatalogLibrary(
    domain,
    libraryId
  )?.projectRevision;
  if (
    projectRevision === undefined ||
    expectedProjectRevision === undefined ||
    projectRevision !== expectedProjectRevision
  ) {
    return;
  }
  const documentIds = new Set(
    documents.value
      .filter(
        (document) =>
          document.domain === domain && document.libraryId === libraryId
      )
      .map((document) => document.id)
  );
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).map(([documentId, draft]) => [
      documentId,
      documentIds.has(documentId) && draft.dirty
        ? {
            ...draft,
            recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
            baseProjectRevision: projectRevision
          }
        : draft
    ])
  );
}

function applyDefaultApprovalMode(permissionMode: GeneralPermissionMode): void {
  conversationRuntimeRegistry.applyDefaultApprovalMode(permissionMode);
}

function stageEditorDraft(payload: {
  id: string;
  title: string;
  content: string;
}): void {
  const persisted = documents.value.find(
    (document) => document.id === payload.id
  );
  const existingDraft = editorDrafts.value[payload.id];
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: {
      title: payload.title,
      content: payload.content,
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      ...(existingDraft?.baseRevision
        ? { baseRevision: existingDraft.baseRevision }
        : persisted
          ? {
              baseRevision: createShortWorkspaceContentRevision(
                persisted.content
              )
            }
          : {}),
      ...(existingDraft?.baseProjectRevision !== undefined
        ? { baseProjectRevision: existingDraft.baseProjectRevision }
        : persisted?.catalogProjectRevision === undefined
          ? {}
          : { baseProjectRevision: persisted.catalogProjectRevision })
    }
  };
}

function handleLiveDocumentChange(rawPayload: {
  id: string;
  title: string;
  content: string;
}): void {
  stageEditorDraft(rawPayload);
  scheduleEditorAutoSave(rawPayload.id);
}

const approvalNavigation = useLazyApprovalNavigationCoordinator({
  context: {
    catalog: {
      documents: () => documents.value,
      documentById: (documentId) => documentById.value.get(documentId),
      draftDirectoryForWorkspace: (workspaceId) =>
        catalogProjection.value?.draftDirectories.find(
          (candidate) => candidate.workspaceId === workspaceId
        ),
      draftFileDocument,
      refresh: loadCatalogSnapshot
    },
    resources: {
      resourceIdForDocumentId,
      node: resourceNode,
      libraryNode: (libraryId) =>
        findResourceNodeWhere(
          (node) =>
            node.catalogNodeType === "library" && node.libraryId === libraryId
        ),
      draftSectionResourceId: resolveDraftSectionResourceId,
      select: selectResource,
      selectedResourceId: () => selectedResourceId.value,
      documentForResourceId,
      preferredLongResourceId: preferredLongResourceIdForSelection,
      longNavigationResourceId: longNavigationNodeId,
      longBookResourceId,
      setSelectedResourceId: (resourceId) => {
        selectedResourceId.value = resourceId;
      }
    },
    longWorkspace: {
      activeBookId: () => activeLongBookId.value,
      activeBookSummary: () => activeLongBookSummary.value,
      workspaceIndex: () => activeLongWorkspaceIndex.value,
      editor: () => longWorkspaceEditor.value,
      saveEditorBeforeLeaving: saveActiveLongEditorBeforeLeaving,
      saveActiveEditorChanges: saveActiveLongEditorChanges,
      async openBook(bookId) {
        await openLongBook(bookId);
      },
      refresh: refreshActiveLongWorkspace,
      selectFile: selectLongWorkspaceFile,
      async resolveNavigation(target, summary, index) {
        const { resolveLongApprovalNavigation } =
          await import("./utils/approvalNavigation");
        return resolveLongApprovalNavigation(target, summary, index);
      }
    },
    view: {
      selectExpertSection(directoryId, sectionId) {
        selectedExpertSectionIds.value = {
          ...selectedExpertSectionIds.value,
          [directoryId]: sectionId
        };
      },
      selectDraftFile(directoryId, fileKind) {
        selectedDraftFileKinds.value = {
          ...selectedDraftFileKinds.value,
          [directoryId]: fileKind
        };
      },
      showConversation,
      expandRightPane() {
        revealTextPane();
      },
      afterUpdate: nextTick,
      info: (message) => uiMessage.info(message)
    }
  },
  notifications: uiMessage
});

function navigateToApprovalTarget(
  target: ApprovalNavigationTarget
): Promise<boolean> {
  return approvalNavigation.navigateToTarget(target);
}

async function selectEditorEntrySearchResult(
  documentId: string
): Promise<void> {
  const target = liveWorkspaceDocuments.value.find(
    (document) => document.id === documentId
  );
  if (!target) {
    uiMessage.warning("目标条目已不存在，无法跳转。");
    return;
  }
  const navigated = await navigateToApprovalTarget({
    kind: "document",
    workspaceId: target.workspaceId ?? target.libraryId ?? target.id,
    documentId: target.id
  });
  if (!navigated) uiMessage.warning("目标条目暂时无法打开。");
}

async function prepareEditorEntrySearch(): Promise<void> {
  await ensureCatalogDocumentsLoaded(
    editorEntrySearchDocuments(
      liveWorkspaceDocuments.value,
      activeDocument.value
    )
  );
}

async function selectLongEntrySearchResult(fileId: string): Promise<void> {
  const bookId = activeLongBookId.value;
  if (!bookId) return;
  const navigated = await navigateToApprovalTarget({
    kind: "long",
    bookId,
    candidates: [{ kind: "file", fileId }]
  });
  if (!navigated) uiMessage.warning("目标长篇条目暂时无法打开。");
}

const disposeLazyApprovalNavigationCoordinator = approvalNavigation.dispose;
async function locateAcceptedEditProposal(input: {
  runId: string;
  proposalId: string;
}): Promise<void> {
  const conversation = isLongWorkspaceActive.value
    ? activeLongConversation.value
    : activeConversation.value;
  const proposal = conversation?.getEditProposal(input.runId, input.proposalId);
  if (!proposal || proposal.status !== "accepted") return;
  const { resolveAgentEditApprovalTarget } =
    await import("./utils/approvalNavigation");
  if (
    !(await navigateToApprovalTarget(resolveAgentEditApprovalTarget(proposal)))
  ) {
    uiMessage.warning("目标文件或所属条目已不存在，无法跳转。");
  }
}

function setAgentEditDocumentAccepting(
  documentId: string,
  accepting: boolean
): void {
  const next = new Set(acceptingAgentEditDocumentIds.value);
  if (accepting) {
    next.add(documentId);
  } else {
    next.delete(documentId);
  }
  acceptingAgentEditDocumentIds.value = next;
}

function setAgentEditWorkspaceAccepting(
  workspaceId: string,
  accepting: boolean
): void {
  const next = new Set(acceptingAgentEditWorkspaceIds.value);
  if (accepting) {
    next.add(workspaceId);
  } else {
    next.delete(workspaceId);
  }
  acceptingAgentEditWorkspaceIds.value = next;
}

function rememberWorkspaceMutationEvent(eventId: string): boolean {
  if (handledWorkspaceMutationEventIds.has(eventId)) return false;
  handledWorkspaceMutationEventIds.add(eventId);
  while (handledWorkspaceMutationEventIds.size > 2_000) {
    const oldest = handledWorkspaceMutationEventIds.values().next().value as
      string | undefined;
    if (!oldest) break;
    handledWorkspaceMutationEventIds.delete(oldest);
  }
  return true;
}
const {
  resumeRecoveredAutomaticAgentEdits,
  hasQueuedAgentEdits,
  reviewAgentEdit,
  reviewLongAgentEdit,
  discardAgentEdit,
  scheduleQueuedAgentEdits,
  stageAgentEditProposal,
  stageLibraryEditProposal,
  stageLongCharacterEditProposal,
  stageLongDraftEditProposal,
  stageLongPlotDesignEditProposal,
  stageLongWorldbuildingEditProposal,
  dispose: disposeProposalCoordinator
} = useLazyProposalCoordinator({
  api: () => window.deepwrite,
  notifications: uiMessage,
  catalog: {
    snapshot: catalogSnapshot,
    projection: catalogProjection,
    catalogBook,
    findCatalogLibrary,
    loadSnapshot: loadCatalogSnapshot,
    applyAcceptedDocumentLocally: applyAcceptedAgentDocumentLocally,
    applyCreatedLibraryEntry,
    applySavedLibraryEntry,
    applyUpdatedLibrary: applyUpdatedCatalogLibrary,
    isConflict: isCatalogConflict,
    refreshBookAfterSave: refreshBookAfterSuccessfulDocumentSave
  },
  editor: {
    documents,
    drafts: editorDrafts,
    liveDocuments: liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
    savingDocumentIds,
    rememberWorkspaceMutationEvent,
    setDocumentAccepting: setAgentEditDocumentAccepting,
    setWorkspaceAccepting: setAgentEditWorkspaceAccepting
  },
  conversations: {
    active: activeConversation,
    activeLong: activeLongConversation,
    byKey: conversations,
    all: allConversations,
    remove: (key, options) => conversationStore.removeController(key, options),
    legacyDraftSectionKeys: legacyDraftSectionConversationKeys,
    forLongProposal: longConversationForProposalEvent
  },
  longWorkspace: {
    activeBookId: activeLongBookId,
    books: longBooks,
    refreshWorkspaceAfterProposal: refreshLongProposalWorkspace,
    saveActiveEditorChanges: saveActiveLongEditorChanges
  },
  navigation: {
    selectedResourceId,
    activeCreationResourceId,
    rightCollapsed
  }
});
proposalEditQueueBridge.hasQueued = hasQueuedAgentEdits;

const navigateToWorkspaceStage = useWorkspaceStageNavigator({
  conversations: allConversations,
  documents: liveWorkspaceDocuments,
  selectedResourceId,
  activeCreationResourceId,
  revealTextPane
});

function startWorkspaceSystemEvents(): () => void {
  const removeRoutes = registerWorkspaceSystemEventRoutes(systemEventCenter, {
    learningImitation: learningImitationFeature,
    longBookAnalysis: longBookAnalysisFeature,
    subagentAuthoring: subagentAuthoringFeature,
    stageLongPlotDesignEditProposal,
    stageLongWorldbuildingEditProposal,
    stageLongCharacterEditProposal,
    stageLongDraftEditProposal,
    handleLongWorkspaceProposal: (event) =>
      longWorkspaceProposals.handleEvent(event),
    stageAgentEditProposal,
    stageLibraryEditProposal,
    navigateToWorkspaceStage,
    allConversations,
    scheduleQueuedAgentEdits,
    onAsyncError(error) {
      console.error(
        "DeepWrite long workspace proposal event could not be handled:",
        error
      );
    }
  });
  const removeNativeListener = window.deepwrite?.events.subscribe((event) => {
    systemEventCenter.publish(event);
  });
  let stopped = false;

  return () => {
    if (stopped) return;
    stopped = true;
    removeNativeListener?.();
    removeRoutes();
  };
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openCreateBookDialog();
  }
  if (event.key === "Escape") {
    closeCreateBookDialog();
    bookTransferDialogMode.value = null;
    libraryProjectDialog.value = null;
    libraryGroupDialog.value = null;
    keepSaveConflictDraft();
    closeBookDialog();
    closeShortStructureDialog();
    if (currentView.value === "settings") {
      closeSettings();
    }
  }
}

async function refreshWorkspaceOnWindowFocus(): Promise<void> {
  if (!window.deepwrite) return;
  const refreshCatalog = async (): Promise<void> => {
    if (await loadCatalogSnapshot()) {
      await retryPendingBookReconciliations({
        catalogAlreadyRefreshed: true
      });
    }
  };
  const tasks: Promise<unknown>[] = [loadAppAlerts(), refreshCatalog()];
  const bookId = activeLongBookId.value;
  if (bookId) {
    tasks.push(
      loadLongBookList({ notify: true }),
      refreshLongWorkspaceOnWindowFocus(bookId)
    );
  }
  const results = await Promise.allSettled(tasks);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failure) throw failure.reason;
}
watch(
  activeRightPanePreferenceKey,
  (key) => layoutStore.setActiveRightPanePreferenceKey(key),
  {
    flush: "sync",
    immediate: true
  }
);

const workspaceLifecycle = useWorkspaceLifecycleCoordinator({
  windowTarget: window,
  activeFeature,
  desktopAvailable: () => Boolean(window.deepwrite),
  handleKeydown: handleGlobalKeydown,
  reconcileLayout: reconcilePaneWidths,
  draftRecovery: draftRecoveryPersistence,
  hydrateConversationPreferences,
  loadGeneralSettings,
  startSystemEvents: startWorkspaceSystemEvents,
  startDesktopSideEffects: async () => {
    await Promise.all([loadAppAlerts(), loadMarketplaceSession()]);
  },
  loadCatalog: loadCatalogSnapshot,
  ensureFeatureDependencies: ensureActiveFeatureDependencies,
  scheduleDirtyDraftAutoSave: scheduleDirtyEditorDraftsForAutoSave,
  loadLongBookList: () => loadLongBookList({ notify: false }),
  refreshOnFocus: refreshWorkspaceOnWindowFocus,
  onDraftRecoveryLoaded: recordRecoveredDraftCount,
  notifyRecoveredDrafts,
  cleanupBeforeDraftRecovery: [
    disposeLayout,
    disposeWorkspaceFeatureHost,
    disposeCatalogWorkspaceProjection,
    disposeLazyApprovalNavigationCoordinator,
    disposeShortBookLifecycle,
    disposeLongBookLifecycle,
    disposeShortConversation,
    disposeLongConversation,
    disposeConversationRuntimeRegistry,
    disposeLongProposalRuntime,
    disposeProposalCoordinator,
    disposeLongStructureTransactions,
    disposeShortWorkspaceStructure,
    disposeEditorAutoSave,
    disposeWorkspaceResources,
    disposeLongWorkspaceSession,
    disposeCatalogDocumentPersistence,
    () => catalogDocumentLoader.dispose(),
    () => catalogIndexStore.dispose()
  ],
  cleanup: [
    disposeGeneralSettings,
    () =>
      conversationStore.dispose({
        flush: conversationPersistenceEnabled
      }),
    () => learningImitationFeature.dispose(),
    () => longBookAnalysisFeature.dispose(),
    () => subagentAuthoringFeature.dispose()
  ],
  onError(error, operation) {
    console.error(`DeepWrite workspace lifecycle ${operation} failed:`, error);
  }
});

onMounted(() => {
  void workspaceLifecycle.start().catch((error: unknown) => {
    console.error("DeepWrite workspace startup failed:", error);
  });
});

onBeforeUnmount(() => {
  void workspaceLifecycle.dispose();
});
</script>

<template>
  <ToastHost />
  <WorkspaceFeatureModules
    v-if="workspaceFeatureModule?.kind === 'settings'"
    :module="workspaceFeatureModule"
    :left-collapsed="leftCollapsed"
    @back="closeSettings"
    @update-permission-mode="updatePermissionMode"
    @update-auto-approve-cross-stage-operations="
      updateAutoApproveCrossStageOperations
    "
    @update-auto-save="updateEditorAutoSave"
    @update-language="updateAppLanguage"
    @update-show-context-usage="updateShowContextUsage"
    @update-show-in-menu-bar="updateShowInMenuBar"
    @update-use-network-proxy="updateUseNetworkProxy"
    @update-workspace-pane-layout="updateWorkspacePaneLayout"
    @update-default-text-view-mode="updateDefaultTextViewMode"
    @save-workspace-agents="saveWorkspaceAgentSettings"
    @retry-long-agents="loadLongAgentSettings"
    @save-long-agents="saveLongAgentSettings"
    @save-library-agents="saveLibraryAgentSettings"
    @reset-library-agent="resetLibraryAgentSettings"
    @save-learning-imitation="saveLearningImitationSettings"
    @reset-learning-imitation="resetLearningImitationSettings"
    @load-model-usage="loadModelUsage"
    @load-models="loadModelSettings"
    @save-models="saveModelSettings"
    @test-model="testModel"
    @load-official-models="loadOfficialModels"
    @load-site-official-models="loadSiteOfficialModels"
    @save-official-token="saveOfficialToken"
    @clear-official-token="clearOfficialToken"
    @save-site-official-token="saveSiteOfficialToken"
    @clear-site-official-token="clearSiteOfficialToken"
    @refresh-site-official-models="refreshSiteOfficialModels"
    @set-site-official-model-enabled="setSiteOfficialModelEnabled"
    @set-official-model-enabled="setOfficialModelEnabled"
    @refresh-free-models="refreshFreeModels"
    @set-free-model-enabled="setFreeModelEnabled"
  />
  <div
    v-else
    ref="desktopShell"
    class="desktop-shell"
    :class="[
      shellClasses,
      {
        'is-editor-agent-layout':
          generalSettings.workspacePaneLayout === 'editor-agent'
      }
    ]"
    :style="shellStyle"
    data-testid="desktop-shell"
  >
    <LeftSidebar
      v-if="!leftCollapsed"
      :sections="resourceTreeSections"
      :selected-id="selectedResourceId"
      :imitation-running="learningImitationRunning"
      :long-book-analysis-running="longBookAnalysisRunning"
      :library-entry-clipboard-domain="libraryEntryClipboardDomain"
      :active-primary-feature="
        chatAssistant.active.value ? 'chat-assistant' : activePrimaryFeature
      "
      :marketplace-display-name="marketplaceDisplayName"
      :long-tree-actions-disabled="longBookActionPending"
      @collapse="leftCollapsed = true"
      @create-book="openCreateBookDialog"
      @open-dialog="openWorkspaceDialog"
      @open-chat-assistant="chatAssistant.open"
      @open-agent-teams="openAgentTeams"
      @open-marketplace="openMarketplace"
      @open-cloud-backup="openCloudBackup"
      @open-zhuque-detection="openZhuqueDetection"
      @open-settings="openSettings"
      @select-resource="selectResource"
      @book-action="openBookDialog"
      @export-book="openBookExportDialog"
      @resource-action="handleResourceAction"
      @resource-node-action="handleResourceNodeAction"
      @move-library-entry="requestCatalogLibraryEntryMove"
      @long-book-action="handleLongBookAction"
      @create-expert-section="addExpertSection"
      @create-long-draft-section="requestCreateLongDraftSection"
      @long-draft-section-action="handleLongDraftSectionAction"
      @create-long-tree-item="handleCreateLongTreeItem"
      @long-tree-item-action="handleLongTreeItemAction"
      @delete-long-ledger-commit="requestDeleteLongLedgerCommit"
      @remove-expert-section="requestRemoveExpertSection"
      @expert-section-action="moveExpertSection"
      @create-character-item="requestCreateCharacterItem"
      @character-item-action="handleCharacterItemAction"
    />
    <WorkspaceFeatureModules
      v-if="workspaceFeatureModule"
      :module="workspaceFeatureModule"
      :left-collapsed="leftCollapsed"
      @expand-left="leftCollapsed = false"
      @retry-agent-team="loadAgentTeamSettings"
      @create-agent-team="createAgentTeam"
      @rename-agent-team="renameAgentTeam"
      @delete-agent-team="deleteAgentTeam"
      @download-agent-team="downloadAgentTeam"
      @install-agent-team="installAgentTeam"
      @set-agent-team-enabled="setAgentTeamEnabled"
      @save-agent-team="saveAgentTeamSettings"
      @choose-workspace-directory="chooseWorkspaceDirectory"
      @save-models="saveModelSettings"
      @test-model="testModel"
      @open-official-models="openOfficialModelsSettings"
      @refresh-catalog="loadCatalogSnapshot"
      @marketplace-session-change="applyMarketplaceSession"
    />

    <LongWorkspaceModule
      v-if="activeFeature === 'long-workspace'"
      :conversation-controller="activeLongConversation"
      :book="activeLongBookSummary"
      :selection="activeLongSelection"
      :workspace-index="activeLongWorkspaceIndex"
      :agent-profile="activeLongAgentProfile"
      :available-skill-references="activeLongSkillReferences"
      :available-material-references="activeLongMaterialReferences"
      :proposal-items="activeLongConversationProposalItems"
      :refresh-status="activeLongWorkspaceRefreshStatus"
      :runtime-available="hasDesktopRuntime"
      :send-context-ready="activeLongWorkspaceContextReady"
      :send-preflight-pending="longSendPreflightPending"
      :editor-locked="longEditorLocked"
      :editor-locked-reason="longEditorLockedReason"
      :loading="longWorkspaceLoading"
      :left-collapsed="leftCollapsed"
      :right-pane="writingRightPaneViewModel"
      :pane-layout="generalSettings.workspacePaneLayout"
      :default-text-view-mode="generalSettings.defaultTextViewMode"
      @update:draft="updateLongComposerDraft"
      @editor-port-change="updateLongWorkspaceEditorPort"
      @expand-left="leftCollapsed = false"
      @toggle-left="leftCollapsed = !leftCollapsed"
      @toggle-right="rightCollapsed = !rightCollapsed"
      @collapse-right="rightCollapsed = true"
      @resize-start="startPaneResize('right', $event)"
      @resize-keydown="handleResizeKeydown('right', $event)"
      @new-conversation="newLongConversation"
      @select-conversation="selectLongConversation"
      @send="sendLongMessage"
      @stop="stopLongGeneration"
      @suggestion="useLongSuggestion"
      @select-model="selectLongModel"
      @select-thinking="selectLongThinking"
      @select-temperature="selectLongTemperature"
      @select-approval="selectLongApprovalMode"
      @select-agent-team-mode="selectLongAgentTeamMode"
      @review-edit="reviewLongAgentEdit"
      @locate-edit-proposal="locateAcceptedEditProposal"
      @approve-long-proposal="approveLongProposal"
      @reject-long-proposal="rejectLongProposal"
      @retry-long-proposal-preview="retryLongProposalPreview"
      @locate-long-proposal="locateAcceptedLongProposal"
      @retry-workspace-refresh="retryActiveLongWorkspaceRefresh"
      @saved="handleLongDocumentSaved"
      @context-change="handleLongFileContextChange"
      @select-character="selectLongCharacterTab"
      @select-plot-point="selectLongPlotPointTab"
      @select-chapter-card="selectLongChapterCardTab"
      @select-entry-search-result="selectLongEntrySearchResult"
      @rename-character="renameLongCharacter"
      @rename-structure-title="renameLongStructureTitle"
      @create-character="openLongCharacterCreate"
      @create-worldbuilding-item="openLongWorldbuildingItemCreate"
      @create-plot-point="openLongPlotPointCreate"
      @create-chapter-card="openLongChapterCardCreate"
      @create-volume="openLongVolumeCreate"
      @preview-delete-structure="previewActiveLongNavigationStructure"
      @delete-structure="deleteActiveLongNavigationStructure"
      @save-volume-outline="saveLongVolumeOutline"
      @save-plot-point-content="saveLongPlotPointContent"
      @preview-mutation="previewActiveLongStructureMutation"
      @mutation="handleActiveLongStructureMutation"
    />

    <WritingWorkspaceModule
      v-if="activeFeature === 'conversation'"
      :conversation-controller="activeConversation"
      :conversation-context="writingConversationContext"
      :editor="writingEditorViewModel"
      :right-pane="writingRightPaneViewModel"
      :pane-layout="generalSettings.workspacePaneLayout"
      @update:draft="updateComposerDraft"
      @new-conversation="newConversation"
      @select-conversation="selectConversation"
      @send="sendMessage"
      @stop="stopGeneration"
      @suggestion="useSuggestion"
      @toggle-left="leftCollapsed = !leftCollapsed"
      @toggle-right="rightCollapsed = !rightCollapsed"
      @select-model="selectModel"
      @select-thinking="selectThinking"
      @select-temperature="selectTemperature"
      @select-approval="selectApprovalMode"
      @select-agent-team-mode="selectAgentTeamMode"
      @review-edit="reviewAgentEdit"
      @locate-edit-proposal="locateAcceptedEditProposal"
      @discard-edit-proposal="discardAgentEdit"
      @clear-editor-references="clearEditorSelectionReferences"
      @remove-editor-reference="removeEditorSelectionReference"
      @locate-editor-reference="locateEditorSelectionReference"
      @collapse="rightCollapsed = true"
      @save="applyDocument"
      @live-change="handleLiveDocumentChange"
      @insert-selection="insertEditorSelectionReference"
      @select-section="selectEditorSection"
      @create-section="createEditorSection"
      @delete-section="deleteEditorSection"
      @select-draft-file="selectDraftFile"
      @select-entry-search-result="selectEditorEntrySearchResult"
      @prepare-entry-search="prepareEditorEntrySearch"
      @resize-start="startPaneResize('right', $event)"
      @resize-keydown="handleResizeKeydown('right', $event)"
    />

    <div
      v-if="!leftCollapsed"
      class="pane-resizer pane-resizer-left"
      role="separator"
      aria-label="调整左侧栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="LEFT_PANE_MIN"
      :aria-valuemax="LEFT_PANE_MAX"
      :aria-valuenow="leftPaneWidth"
      tabindex="0"
      @pointerdown="startPaneResize('left', $event)"
      @keydown="handleResizeKeydown('left', $event)"
    />
  </div>

  <Teleport to="body">
    <ChatAssistantOverlay
      v-if="chatAssistant.visible.value"
      active
      :conversation-for-key="conversationForKey"
      :catalog-snapshot="catalogSnapshot"
      :long-books="longBooks"
      :runtime-available="hasDesktopRuntime"
      @minimize="chatAssistant.minimize"
    />
  </Teleport>

  <WorkspaceDialogLayer
    v-if="workspaceDialogModule"
    :module="workspaceDialogModule"
    @close-book-resource="closeBookDialog"
    @rename-book="renameBook"
    @remove-book="removeBook"
    @delete-book="deleteBook"
    @update-book-bindings="updateBookBindings"
    @close-plot-structure="closeShortStructureDialog"
    @plot-structure-mutation="mutatePlotStructure"
    @character-structure-mutation="mutateCharacterStructure"
    @save-writing-context="saveWritingContext"
    @close-character-item="closeCharacterItemDialog"
    @submit-character-item="submitCharacterItemDialog"
    @close-export-short="closeBookExportDialog"
    @export-short="exportBookManuscript"
    @close-export-long="closeLongExportDialog"
    @export-long="exportLongBookManuscript"
    @close-library-removal="libraryRemovalDialog = null"
    @confirm-library-removal="confirmLibraryRemoval"
    @close-create-book="closeCreateBookDialog"
    @submit-create-book="createCreativeBook"
    @close-book-transfer="bookTransferDialogMode = null"
    @select-book-transfer="handleBookTransferSelect"
    @close-continuation-import="closeContinuationImportDialog"
    @confirm-continuation-import="confirmContinuationImport"
    @close-legacy-sync="closeLegacySyncDialog"
    @confirm-legacy-sync="confirmLegacySync"
    @close-long-structure="closeLongStructureDialog"
    @long-structure-mutation="handleActiveLongStructureMutation"
    @save-long-agents-md="saveLongAgentsMd"
    @sync-long-worldbuilding="handleLongWorldbuildingSync"
    @close-create-long-character="closeLongCharacterCreate"
    @submit-create-long-character="createLongCharacter"
    @close-create-long-worldbuilding-item="closeLongWorldbuildingItemCreate"
    @submit-create-long-worldbuilding-item="createLongWorldbuildingItem"
    @close-create-long-plot-point="closeLongPlotPointCreate"
    @submit-create-long-plot-point="createLongPlotPoint"
    @close-create-long-chapter-card="closeLongChapterCardCreate"
    @submit-create-long-chapter-card="createLongChapterCard"
    @close-delete-long-draft="closeLongDraftSectionDelete"
    @confirm-delete-long-draft="confirmDeleteLongDraftSection"
    @close-delete-long-tree="closeLongTreeItemDelete"
    @confirm-delete-long-tree="confirmDeleteLongTreeItem"
    @close-delete-long-ledger-commit="closeDeleteLongLedgerCommit"
    @confirm-delete-long-ledger-commit="confirmDeleteLongLedgerCommit"
    @close-create-long-volume="closeLongVolumeCreate"
    @submit-create-long-volume="createLongVolume"
    @close-long-bindings="closeLongBookBindingsDialog"
    @submit-long-bindings="updateLongBookBindings"
    @close-long-rename="closeLongBookRenameDialog"
    @submit-long-rename="renameLongBook"
    @close-long-removal="closeLongBookRemovalDialog"
    @confirm-long-removal="confirmLongBookRemoval"
    @close-library-project="libraryProjectDialog = null"
    @create-library="createCatalogLibrary"
    @create-library-entry="createCatalogLibraryEntry"
    @rename-library="renameCatalogLibrary"
    @rename-library-entry="renameCatalogLibraryEntry"
    @remove-library-entry="removeCatalogLibraryEntry"
    @close-external-skill-import="externalSkillImportDialog = null"
    @choose-external-skill-import="importExternalSkills"
    @close-library-entry-move="pendingLibraryEntryMove = null"
    @submit-library-entry-move="confirmCatalogLibraryEntryMove"
    @close-library-group="libraryGroupDialog = null"
    @submit-library-group="saveCatalogLibraryGroup"
    @keep-save-conflict="keepSaveConflictDraft"
    @reload-save-conflict="reloadSaveConflictFromDisk"
    @overwrite-save-conflict="overwriteSaveConflictOnDisk"
    @close-create-expert-section="closeCreateExpertSectionDialog"
    @submit-create-expert-section="confirmCreateExpertSection"
    @close-delete-expert-section="closeRemoveExpertSectionDialog"
    @confirm-delete-expert-section="confirmRemoveExpertSection"
    @close-startup-alert="closeStartupAlert"
  />
</template>
