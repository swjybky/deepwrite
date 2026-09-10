import type { MarketplaceSession } from "@deepwrite/contracts";
import type { WorkspaceFeatureModule } from "../components/WorkspaceFeatureModules.types";
import type {
  ActiveFeature,
  WorkspaceFeatureHostCoordinatorOptions
} from "./workspaceFeatureHostTypes";
import { selectableModelSettings } from "../utils/selectableModelSettings";

export function buildWorkspaceFeatureModule(
  feature: ActiveFeature,
  options: WorkspaceFeatureHostCoordinatorOptions,
  agentTeamNavigationEpoch: number,
  marketplaceSession: MarketplaceSession | null
): WorkspaceFeatureModule | null {
  const { settingsStore } = options;
  const modelSelectionSettings = settingsStore.modelSettings
    ? selectableModelSettings(settingsStore.modelSettings)
    : null;
  switch (feature) {
    case "settings":
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
        creativePlotStages:
          options.catalogSnapshot.value?.creativePlotStages ?? [],
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
        siteOfficialModelsRefreshing:
          settingsStore.siteOfficialModelsRefreshing,
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
    case "agent-team":
      return {
        kind: "agent-team",
        navigationEpoch: agentTeamNavigationEpoch,
        catalog: settingsStore.agentTeamCatalog,
        models: modelSelectionSettings?.models ?? [],
        skills: options.catalogSnapshot.value?.skills ?? [],
        preferredModelId: modelSelectionSettings?.defaultModelId ?? null,
        loading: settingsStore.agentTeamLoading,
        saving: settingsStore.agentTeamSaving,
        loadError: settingsStore.agentTeamLoadError,
        runtimeAvailable: Boolean(options.api()),
        authoring: options.features.subagentAuthoring.controller.value
      };
    case "directory":
      return {
        kind: "directory",
        path: settingsStore.workspaceDirectoryPath,
        loading: settingsStore.workspaceDirectoryLoading
      };
    case "models":
      return {
        kind: "models",
        settings: settingsStore.modelSettings,
        loading: settingsStore.modelLoading,
        saving: settingsStore.modelSaving,
        error: settingsStore.modelError,
        testMessage: settingsStore.modelTestMessage,
        testingModelId: settingsStore.testingModelId,
        alertMessages: settingsStore.modelAlertMessages
      };
    case "imitation":
      return {
        kind: "imitation",
        controller: options.features.learningImitation.controller.value,
        models: settingsStore.modelSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value,
        approvalMode: settingsStore.generalSettings.permissionMode
      };
    case "long-book-analysis":
      return {
        kind: "long-book-analysis",
        controller: options.features.longBookAnalysis.controller.value,
        models: settingsStore.modelSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value
      };
    case "style-comparison":
      return {
        kind: "style-comparison",
        models: modelSelectionSettings?.models ?? [],
        preferredModelId: modelSelectionSettings?.defaultModelId ?? null
      };
    case "marketplace":
      return {
        kind: "marketplace",
        catalogSnapshot: options.catalogSnapshot.value,
        session: marketplaceSession
      };
    case "device-sync":
      return {
        kind: "device-sync",
        prepareSync: () =>
          options.actions.prepareDeviceSync?.() ?? Promise.resolve(false),
        refreshSync: () => refreshDeviceSyncFeature(options)
      };
    case "cloud-backup":
      return { kind: "cloud-backup" };
    case "zhuque-detection":
      return { kind: "zhuque-detection" };
    case "conversation":
    case "long-workspace":
      return null;
  }
}

async function refreshDeviceSyncFeature(
  options: WorkspaceFeatureHostCoordinatorOptions
): Promise<void> {
  await options.loaders.loadCatalogSnapshot();
  await options.loaders.loadSyncLongBooks?.();
  const id = options.view.activeLongBookId.value;
  if (id) await options.loaders.refreshSyncLongBook?.(id);
}
