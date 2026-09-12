import type { SettingsFeatureModule } from "../components/WorkspaceFeatureModules.types";
import type { WorkspaceFeatureHostCoordinatorOptions } from "./workspaceFeatureHostTypes";

export function buildSettingsFeatureModule(
  options: WorkspaceFeatureHostCoordinatorOptions
): SettingsFeatureModule {
  const { settingsStore } = options;
  return {
    kind: "settings",
    initialCategory: options.view.settingsInitialCategory.value,
    permissionMode: settingsStore.generalSettings.permissionMode,
    autoApproveCrossStageOperations:
      settingsStore.generalSettings.autoApproveCrossStageOperations,
    autoSaveEnabled: settingsStore.editorAutoSaveEnabled,
    language: settingsStore.generalSettings.language,
    showContextUsage: settingsStore.generalSettings.showContextUsage,
    showInMenuBar: settingsStore.generalSettings.showInMenuBar,
    useNetworkProxy: settingsStore.generalSettings.useNetworkProxy,
    workspacePaneLayout: settingsStore.generalSettings.workspacePaneLayout,
    defaultTextViewMode: settingsStore.generalSettings.defaultTextViewMode,
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
    learningImitationSettings: settingsStore.learningImitationSettings,
    learningImitationLoading: settingsStore.learningImitationLoading,
    learningImitationSaving: settingsStore.learningImitationSaving,
    modelUsageDashboard: settingsStore.modelUsageDashboard,
    modelUsageLoading: settingsStore.modelUsageLoading,
    modelSettings: settingsStore.modelSettings,
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
    officialModelUsageDashboard: settingsStore.officialModelUsageDashboard,
    officialModelBalance: settingsStore.officialModelBalance,
    officialModelsLoading: settingsStore.officialModelsLoading,
    officialModelsSaving: settingsStore.officialModelsSaving,
    runtimeAvailable: Boolean(options.api())
  };
}
