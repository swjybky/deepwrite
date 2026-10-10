// Dependency preload manifests are loaded with optional features, never during workspace startup.
export const loadAuthorSupportDialog = () =>
  import("./AuthorSupportDialog.vue");
export const loadAgentTeamSettingsPanel = () =>
  import("./AgentTeamCatalogFeature.vue");
export const loadShortBookAnalysisPage = async () =>
  (await import("../extras/short-book-analysis/loader")).loadPage();
export const loadLongBookAnalysisPage = async () =>
  (await import("../extras/long-book-analysis/loader")).loadPage();
export const loadLongWorkspaceModule = () =>
  import("./LongWorkspaceModule.vue");
export const loadSettingsPage = () => import("./SettingsPage.vue");
export const loadSkillMarketplacePage = () =>
  import("./SkillMarketplacePage.vue");
export const loadAgentTeamMarketplacePage = () =>
  import("../extras/agent-team-marketplace/AgentTeamMarketplacePage.vue");
export const loadCloudBackupPage = () =>
  import("../extras/cloud-backup/CloudBackupPage.vue");
export const loadZhuqueDetectionPage = () =>
  import("../extras/zhuque-detection/ZhuqueDetectionPage.vue");
export const loadWorkspaceDirectoryFeature = () =>
  import("./WorkspaceDirectoryFeature.vue");
export const loadWorkspaceFeatureModules = () =>
  import("./WorkspaceFeatureModules.vue");
export const loadWorkspaceDialogLayer = () =>
  import("./WorkspaceDialogLayer.vue");
export const loadAgentConversation = () => import("./AgentConversation.vue");
export const loadChatAssistantOverlay = () =>
  import("../features/chat-assistant/ChatAssistantOverlay.vue");
export const loadBookResourceDialog = () => import("./BookResourceDialog.vue");
export const loadBookTransferDialog = () => import("./BookTransferDialog.vue");
export const loadCharacterItemDialog = () =>
  import("./CharacterItemDialog.vue");
export const loadCreateBookDialog = () => import("./CreateBookDialog.vue");
export const loadCreateExpertSectionDialog = () =>
  import("./CreateExpertSectionDialog.vue");
export const loadCreateLongChapterCardDialog = () =>
  import("./CreateLongChapterCardDialog.vue");
export const loadCreateLongCharacterDialog = () =>
  import("./CreateLongCharacterDialog.vue");
export const loadCreateLongPlotPointDialog = () =>
  import("./CreateLongPlotPointDialog.vue");
export const loadCreateLongVolumeDialog = () =>
  import("./CreateLongVolumeDialog.vue");
export const loadCreateLongWorldbuildingItemDialog = () =>
  import("./CreateLongWorldbuildingItemDialog.vue");
export const loadDeleteExpertSectionDialog = () =>
  import("./DeleteExpertSectionDialog.vue");
export const loadDeleteLongDraftSectionDialog = () =>
  import("./DeleteLongDraftSectionDialog.vue");
export const loadExportLongManuscriptDialog = () =>
  import("./ExportLongManuscriptDialog.vue");
export const loadExportShortManuscriptDialog = () =>
  import("./ExportShortManuscriptDialog.vue");
export const loadExternalSkillImportDialog = () =>
  import("./ExternalSkillImportDialog.vue");
export const loadImportLibraryPackageDialog = () =>
  import("./ImportLibraryPackageDialog.vue");
export const loadLibraryEntryMoveDialog = () =>
  import("./LibraryEntryMoveDialog.vue");
export const loadLibraryGroupDialog = () => import("./LibraryGroupDialog.vue");
export const loadLibraryProjectDialog = () =>
  import("./LibraryProjectDialog.vue");
export const loadLibraryRemovalDialog = () =>
  import("./LibraryRemovalDialog.vue");
export const loadLongBookBindingsDialog = () =>
  import("./LongBookBindingsDialog.vue");
export const loadLongBookRemovalDialog = () =>
  import("./LongBookRemovalDialog.vue");
export const loadLongBookRenameDialog = () =>
  import("./LongBookRenameDialog.vue");
export const loadLongContinuationImportDialog = () =>
  import("./LongContinuationImportDialog.vue");
export const loadLongLegacySyncDialog = () =>
  import("./LongLegacySyncDialog.vue");
export const loadLongStructureDialog = () =>
  import("./LongStructureDialog.vue");
export const loadPlotStructureDialog = () =>
  import("./PlotStructureDialog.vue");
export const loadSaveConflictDialog = () => import("./SaveConflictDialog.vue");
export const loadStartupAlertDialog = () => import("./StartupAlertDialog.vue");
export const loadDeviceSyncPage = () =>
  import("../extras/device-sync/DeviceSyncPage.vue");
export const loadStyleComparisonPage = () =>
  import("../extras/style-comparison/StyleComparisonPage.vue");
export const loadRevisionAnalysisPage = async () =>
  (await import("../extras/revision-analysis/loader")).loadPage();

export const loadWindowMenuBar = () => import("./WindowMenuBar.vue");
export const loadLongBookDecompositionPage = async () =>
  (await import("../extras/long-book-decomposition/loader")).loadPage();

export const loadBookIdentityPage = () =>
  import("../extras/book-identity/BookIdentityPage.vue");
export const loadLongMaterialPackPage = () =>
  import("../extras/long-material-pack/LongMaterialPackPage.vue");
