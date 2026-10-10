import type { MarketplaceSession } from "@deepwrite/contracts";
import type { WorkspaceFeatureModule } from "../components/WorkspaceFeatureModules.types";
import type {
  ActiveFeature,
  WorkspaceFeatureHostCoordinatorOptions
} from "./workspaceFeatureHostTypes";
import type { buildSettingsFeatureModule } from "./settingsFeatureModule";
import { selectableModelSettings } from "../utils/selectableModelSettings";

export function buildWorkspaceFeatureModule(
  feature: ActiveFeature,
  options: WorkspaceFeatureHostCoordinatorOptions,
  agentTeamNavigationEpoch: number,
  marketplaceSession: MarketplaceSession | null,
  buildSettingsModule?: typeof buildSettingsFeatureModule
): WorkspaceFeatureModule | null {
  const { settingsStore } = options;
  const modelSelectionSettings = settingsStore.modelSettings
    ? selectableModelSettings(settingsStore.modelSettings)
    : null;
  switch (feature) {
    case "settings":
      return buildSettingsModule?.(options) ?? null;
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
    case "revision-analysis":
      return {
        kind: "revision-analysis",
        controller: options.features.revisionAnalysis.controller.value ?? null,
        models: modelSelectionSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value
      };
    case "short-book-analysis":
      return {
        kind: "short-book-analysis",
        controller: options.features.shortBookAnalysis.controller.value,
        models: settingsStore.modelSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value
      };
    case "long-book-analysis":
      return {
        kind: "long-book-analysis",
        controller: options.features.longBookAnalysis.controller.value,
        models: settingsStore.modelSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value
      };
    case "long-book-decomposition":
      return {
        kind: "long-book-decomposition",
        controller:
          options.features.longBookDecomposition?.controller.value ?? null,
        models: modelSelectionSettings?.models ?? [],
        catalogSnapshot: options.catalogSnapshot.value
      };
    case "style-comparison":
    case "long-material-pack":
    case "book-identity":
      return {
        kind: feature,
        models: modelSelectionSettings?.models ?? [],
        preferredModelId: modelSelectionSettings?.defaultModelId ?? null
      };
    case "marketplace":
      return {
        kind: "marketplace",
        catalogSnapshot: options.catalogSnapshot.value,
        session: marketplaceSession
      };
    case "agent-team-marketplace":
      return {
        kind: "agent-team-marketplace",
        catalog: settingsStore.agentTeamCatalog,
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
