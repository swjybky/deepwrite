import { defineAsyncComponent, type Component } from "vue";
import LongWorkspaceLoading from "./LongWorkspaceLoading.vue";
type FeatureImports = typeof import("./lazyFeatureImports");
/** Share the import boundary without repeating dependency manifests in startup code. */
function lazyFeature<T extends Component>(
  load: (features: FeatureImports) => Promise<{ default: T }>,
  loadingComponent?: Component
): T {
  return defineAsyncComponent<T>({
    loader: async () =>
      (await load(await import("./lazyFeatureImports"))).default,
    ...(loadingComponent ? { loadingComponent, delay: 0 } : {})
  });
}
// The default writing surface remains eager; optional pages and dialogs load on demand.
export const AuthorSupportDialog = lazyFeature((features) =>
  features.loadAuthorSupportDialog()
);
export const AgentTeamSettingsPanel = lazyFeature((features) =>
  features.loadAgentTeamSettingsPanel()
);
export const ShortBookAnalysisPage = lazyFeature((features) =>
  features.loadShortBookAnalysisPage()
);
export const LongBookAnalysisPage = lazyFeature((features) =>
  features.loadLongBookAnalysisPage()
);
export const LongBookDecompositionPage = lazyFeature((features) =>
  features.loadLongBookDecompositionPage()
);
export const LongWorkspaceModule = lazyFeature(
  (features) => features.loadLongWorkspaceModule(),
  LongWorkspaceLoading
);
export const SettingsPage = lazyFeature((features) =>
  features.loadSettingsPage()
);
export const SkillMarketplacePage = lazyFeature((features) =>
  features.loadSkillMarketplacePage()
);
export const AgentTeamMarketplacePage = lazyFeature((features) =>
  features.loadAgentTeamMarketplacePage()
);
export const CloudBackupPage = lazyFeature((features) =>
  features.loadCloudBackupPage()
);
export const ZhuqueDetectionPage = lazyFeature((features) =>
  features.loadZhuqueDetectionPage()
);
export const WorkspaceDirectoryFeature = lazyFeature((features) =>
  features.loadWorkspaceDirectoryFeature()
);
export const WorkspaceFeatureModules = lazyFeature((features) =>
  features.loadWorkspaceFeatureModules()
);
export const WorkspaceDialogLayer = lazyFeature((features) =>
  features.loadWorkspaceDialogLayer()
);
export const AgentConversation = lazyFeature((features) =>
  features.loadAgentConversation()
);
export const ChatAssistantOverlay = lazyFeature((features) =>
  features.loadChatAssistantOverlay()
);
export const BookResourceDialog = lazyFeature((features) =>
  features.loadBookResourceDialog()
);
export const BookTransferDialog = lazyFeature((features) =>
  features.loadBookTransferDialog()
);
export const CharacterItemDialog = lazyFeature((features) =>
  features.loadCharacterItemDialog()
);
export const CreateBookDialog = lazyFeature((features) =>
  features.loadCreateBookDialog()
);
export const CreateExpertSectionDialog = lazyFeature((features) =>
  features.loadCreateExpertSectionDialog()
);
export const CreateLongChapterCardDialog = lazyFeature((features) =>
  features.loadCreateLongChapterCardDialog()
);
export const CreateLongCharacterDialog = lazyFeature((features) =>
  features.loadCreateLongCharacterDialog()
);
export const CreateLongPlotPointDialog = lazyFeature((features) =>
  features.loadCreateLongPlotPointDialog()
);
export const CreateLongVolumeDialog = lazyFeature((features) =>
  features.loadCreateLongVolumeDialog()
);
export const CreateLongWorldbuildingItemDialog = lazyFeature((features) =>
  features.loadCreateLongWorldbuildingItemDialog()
);
export const DeleteExpertSectionDialog = lazyFeature((features) =>
  features.loadDeleteExpertSectionDialog()
);
export const DeleteLongDraftSectionDialog = lazyFeature((features) =>
  features.loadDeleteLongDraftSectionDialog()
);
export const ExportLongManuscriptDialog = lazyFeature((features) =>
  features.loadExportLongManuscriptDialog()
);
export const ExportShortManuscriptDialog = lazyFeature((features) =>
  features.loadExportShortManuscriptDialog()
);
export const ExternalSkillImportDialog = lazyFeature((features) =>
  features.loadExternalSkillImportDialog()
);
export const ImportLibraryPackageDialog = lazyFeature((features) =>
  features.loadImportLibraryPackageDialog()
);
export const LibraryEntryMoveDialog = lazyFeature((features) =>
  features.loadLibraryEntryMoveDialog()
);
export const LibraryGroupDialog = lazyFeature((features) =>
  features.loadLibraryGroupDialog()
);
export const LibraryProjectDialog = lazyFeature((features) =>
  features.loadLibraryProjectDialog()
);
export const LibraryRemovalDialog = lazyFeature((features) =>
  features.loadLibraryRemovalDialog()
);
export const LongBookBindingsDialog = lazyFeature((features) =>
  features.loadLongBookBindingsDialog()
);
export const LongBookRemovalDialog = lazyFeature((features) =>
  features.loadLongBookRemovalDialog()
);
export const LongBookRenameDialog = lazyFeature((features) =>
  features.loadLongBookRenameDialog()
);
export const LongContinuationImportDialog = lazyFeature((features) =>
  features.loadLongContinuationImportDialog()
);
export const LongLegacySyncDialog = lazyFeature((features) =>
  features.loadLongLegacySyncDialog()
);
export const LongStructureDialog = lazyFeature((features) =>
  features.loadLongStructureDialog()
);
export const PlotStructureDialog = lazyFeature((features) =>
  features.loadPlotStructureDialog()
);
export const SaveConflictDialog = lazyFeature((features) =>
  features.loadSaveConflictDialog()
);
export const StartupAlertDialog = lazyFeature((features) =>
  features.loadStartupAlertDialog()
);
export const DeviceSyncPage = lazyFeature((features) =>
  features.loadDeviceSyncPage()
);
export const StyleComparisonPage = lazyFeature((features) =>
  features.loadStyleComparisonPage()
);
export const RevisionAnalysisPage = lazyFeature((features) =>
  features.loadRevisionAnalysisPage()
);

export const WindowMenuBar = lazyFeature((features) =>
  features.loadWindowMenuBar()
);

export const LongMaterialPackPage = lazyFeature((features) =>
  features.loadLongMaterialPackPage()
);
export const BookIdentityPage = lazyFeature((features) =>
  features.loadBookIdentityPage()
);
