import type { SettingsFeatureModule } from "../components/WorkspaceFeatureModules.types";
import type { WorkspaceFeatureHostCoordinatorOptions } from "./workspaceFeatureHostTypes";

export function buildSettingsFeatureModule(
  options: WorkspaceFeatureHostCoordinatorOptions
): SettingsFeatureModule {
  const { settingsStore } = options;
  return {
    kind: "settings",
    workspaceDirectoryPath: settingsStore.workspaceDirectoryPath,
    workspaceDirectoryLoading: settingsStore.workspaceDirectoryLoading,
    initialCategory: options.view.settingsInitialCategory.value,
    permissionMode: settingsStore.generalSettings.permissionMode,
    autoApproveCrossStageOperations:
      settingsStore.generalSettings.autoApproveCrossStageOperations,
    autoSaveEnabled: settingsStore.editorAutoSaveEnabled,
    language: settingsStore.generalSettings.language,
    showContextUsage: settingsStore.generalSettings.showContextUsage,
    textAttachmentMaxCharacters:
      settingsStore.generalSettings.textAttachmentMaxCharacters,
    contextCompaction: settingsStore.generalSettings.contextCompaction,
    showInMenuBar: settingsStore.generalSettings.showInMenuBar,
    taskNotification: settingsStore.generalSettings.taskNotification,
    useNetworkProxy: settingsStore.generalSettings.useNetworkProxy,
    workspacePaneLayout: settingsStore.generalSettings.workspacePaneLayout,
    defaultTextViewMode: settingsStore.generalSettings.defaultTextViewMode,
    bodyTextFormats: settingsStore.generalSettings.bodyTextFormats,
    moreFeaturesSettings: settingsStore.generalSettings.moreFeatures,
    workspaceAgentSettings: settingsStore.workspaceAgentSettings,
    creativePlotStages: options.catalogSnapshot.value?.creativePlotStages ?? [],
    longAgentSettings: settingsStore.longAgentSettings,
    workspaceAgentLoading: settingsStore.workspaceAgentLoading,
    workspaceAgentSaving: settingsStore.workspaceAgentSaving,
    longAgentLoading: settingsStore.longAgentLoading,
    longAgentSaving: settingsStore.longAgentSaving,
    longAgentError: settingsStore.longAgentLoadError,
    libraryAgentSettings: settingsStore.libraryAgentSettings,
    libraryAgentLoading: settingsStore.libraryAgentLoading,
    libraryAgentSaving: settingsStore.libraryAgentSaving,
    modelUsageDashboard: settingsStore.modelUsageDashboard,
    modelUsageLoading: settingsStore.modelUsageLoading,
    modelSettings: settingsStore.modelSettings,
    modelAlertMessages: settingsStore.modelAlertMessages,
    modelLoading: settingsStore.modelLoading,
    modelSaving: settingsStore.modelSaving,
    freeModelsRefreshing: settingsStore.freeModelsRefreshing,
    freeModelsSaving: settingsStore.freeModelsSaving,
    siteOfficialModelsRefreshing: settingsStore.siteOfficialModelsRefreshing,
    siteOfficialModelsSaving: settingsStore.siteOfficialModelsSaving,
    siteOfficialQuota: settingsStore.siteOfficialQuota,
    modelError: settingsStore.modelError,
    modelTestMessage: settingsStore.modelTestMessage,
    testingModelId: settingsStore.testingModelId,
    runtimeAvailable: Boolean(options.api())
  };
}
