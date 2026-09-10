import { defineAsyncComponent } from "vue";

// The default three-pane writing surface stays in the entry chunk. Each
// top-level feature and modal-only component gets its own on-demand chunk.
export const AgentTeamSettingsPanel = defineAsyncComponent(
  () => import("./AgentTeamCatalogFeature.vue")
);
export const LearningImitationDialog = defineAsyncComponent(
  () => import("./LearningImitationDialog.vue")
);
export const LongBookAnalysisPage = defineAsyncComponent(
  () => import("../extras/long-book-analysis/LongBookAnalysisPage.vue")
);
export const LongWorkspaceModule = defineAsyncComponent(
  () => import("./LongWorkspaceModule.vue")
);
export const SettingsPage = defineAsyncComponent(
  () => import("./SettingsPage.vue")
);
export const SkillMarketplacePage = defineAsyncComponent(
  () => import("./SkillMarketplacePage.vue")
);
export const CloudBackupPage = defineAsyncComponent(
  () => import("../extras/cloud-backup/CloudBackupPage.vue")
);
export const ZhuqueDetectionPage = defineAsyncComponent(
  () => import("../extras/zhuque-detection/ZhuqueDetectionPage.vue")
);
export const ModelSettingsFeature = defineAsyncComponent(
  () => import("./ModelSettingsFeature.vue")
);
export const WorkspaceDirectoryFeature = defineAsyncComponent(
  () => import("./WorkspaceDirectoryFeature.vue")
);
export const WorkspaceFeatureModules = defineAsyncComponent(
  () => import("./WorkspaceFeatureModules.vue")
);
export const WorkspaceDialogLayer = defineAsyncComponent(
  () => import("./WorkspaceDialogLayer.vue")
);
export const AgentConversation = defineAsyncComponent(
  () => import("./AgentConversation.vue")
);
export const ChatAssistantOverlay = defineAsyncComponent(
  () => import("../features/chat-assistant/ChatAssistantOverlay.vue")
);

export const BookResourceDialog = defineAsyncComponent(
  () => import("./BookResourceDialog.vue")
);
export const BookTransferDialog = defineAsyncComponent(
  () => import("./BookTransferDialog.vue")
);
export const CharacterItemDialog = defineAsyncComponent(
  () => import("./CharacterItemDialog.vue")
);
export const CreateBookDialog = defineAsyncComponent(
  () => import("./CreateBookDialog.vue")
);
export const CreateExpertSectionDialog = defineAsyncComponent(
  () => import("./CreateExpertSectionDialog.vue")
);
export const CreateLongChapterCardDialog = defineAsyncComponent(
  () => import("./CreateLongChapterCardDialog.vue")
);
export const CreateLongCharacterDialog = defineAsyncComponent(
  () => import("./CreateLongCharacterDialog.vue")
);
export const CreateLongPlotPointDialog = defineAsyncComponent(
  () => import("./CreateLongPlotPointDialog.vue")
);
export const CreateLongVolumeDialog = defineAsyncComponent(
  () => import("./CreateLongVolumeDialog.vue")
);
export const CreateLongWorldbuildingItemDialog = defineAsyncComponent(
  () => import("./CreateLongWorldbuildingItemDialog.vue")
);
export const DeleteExpertSectionDialog = defineAsyncComponent(
  () => import("./DeleteExpertSectionDialog.vue")
);
export const DeleteLongDraftSectionDialog = defineAsyncComponent(
  () => import("./DeleteLongDraftSectionDialog.vue")
);
export const ExportLongManuscriptDialog = defineAsyncComponent(
  () => import("./ExportLongManuscriptDialog.vue")
);
export const ExportShortManuscriptDialog = defineAsyncComponent(
  () => import("./ExportShortManuscriptDialog.vue")
);
export const ExternalSkillImportDialog = defineAsyncComponent(
  () => import("./ExternalSkillImportDialog.vue")
);
export const LibraryEntryMoveDialog = defineAsyncComponent(
  () => import("./LibraryEntryMoveDialog.vue")
);
export const LibraryGroupDialog = defineAsyncComponent(
  () => import("./LibraryGroupDialog.vue")
);
export const LibraryProjectDialog = defineAsyncComponent(
  () => import("./LibraryProjectDialog.vue")
);
export const LibraryRemovalDialog = defineAsyncComponent(
  () => import("./LibraryRemovalDialog.vue")
);
export const LongBookBindingsDialog = defineAsyncComponent(
  () => import("./LongBookBindingsDialog.vue")
);
export const LongBookRemovalDialog = defineAsyncComponent(
  () => import("./LongBookRemovalDialog.vue")
);
export const LongBookRenameDialog = defineAsyncComponent(
  () => import("./LongBookRenameDialog.vue")
);
export const LongContinuationImportDialog = defineAsyncComponent(
  () => import("./LongContinuationImportDialog.vue")
);
export const LongLegacySyncDialog = defineAsyncComponent(
  () => import("./LongLegacySyncDialog.vue")
);
export const LongStructureDialog = defineAsyncComponent(
  () => import("./LongStructureDialog.vue")
);
export const PlotStructureDialog = defineAsyncComponent(
  () => import("./PlotStructureDialog.vue")
);
export const SaveConflictDialog = defineAsyncComponent(
  () => import("./SaveConflictDialog.vue")
);
export const StartupAlertDialog = defineAsyncComponent(
  () => import("./StartupAlertDialog.vue")
);

export const DeviceSyncPage = defineAsyncComponent(
  () => import("../extras/device-sync/DeviceSyncPage.vue")
);

export const StyleComparisonPage = defineAsyncComponent(
  () => import("../extras/style-comparison/StyleComparisonPage.vue")
);
