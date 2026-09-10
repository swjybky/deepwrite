import type {
  CatalogSnapshot,
  DeepWriteApi,
  MarketplaceSession
} from "@deepwrite/contracts";
import type { ComputedRef, Ref } from "vue";
import type { WorkspaceFeatureModule } from "../components/WorkspaceFeatureModules.types";
import type { AppView, WorkspaceMainView } from "../stores/layoutStore";
import type { useSettingsStore } from "../stores/settingsStore";
import type { DialogMode } from "../types/workspace";
import type {
  LazyLearningImitationController,
  LazyLongBookAnalysisController,
  LazySubagentAuthoringController
} from "./useLazyFeatureControllers";

export type ActiveFeature = WorkspaceMainView | "settings" | "long-workspace";

export interface WorkspaceFeatureHostNotifications {
  error(message: string): void;
  success(message: string): void;
}

export interface WorkspaceFeatureHostApi {
  marketplace: Pick<DeepWriteApi["marketplace"], "session">;
  workspaceDirectory: Pick<
    DeepWriteApi["workspaceDirectory"],
    "choose" | "list"
  >;
}

export interface WorkspaceFeatureHostCoordinatorOptions {
  api(): WorkspaceFeatureHostApi | undefined;
  view: {
    current: Ref<AppView>;
    settingsInitialCategory: Ref<string>;
    workspaceMain: Ref<WorkspaceMainView>;
    activeLongBookId: Readonly<Ref<string | null>>;
  };
  settingsStore: ReturnType<typeof useSettingsStore>;
  catalogSnapshot: Readonly<Ref<CatalogSnapshot | null>>;
  features: {
    learningImitation: {
      controller: LazyLearningImitationController["controller"];
      ensureLoaded(): Promise<unknown>;
    };
    longBookAnalysis: {
      controller: LazyLongBookAnalysisController["controller"];
      ensureLoaded(): Promise<unknown>;
    };
    subagentAuthoring: {
      controller: LazySubagentAuthoringController["controller"];
      ensureLoaded(): Promise<unknown>;
    };
  };
  actions: {
    prepareDeviceSync?(): Promise<boolean>;
    saveActiveLongEditorBeforeLeaving(): Promise<boolean>;
    newShortConversation(): void;
    newLongConversation(): void;
  };
  loaders: {
    loadSyncLongBooks?(): Promise<unknown>;
    refreshSyncLongBook?(id: string): Promise<unknown>;
    loadModelSettings(): Promise<unknown>;
    loadOfficialModels(): Promise<unknown>;
    loadShortAndScriptAgentSettings(): Promise<unknown>;
    ensureLongAgentSettingsLoaded(): Promise<unknown>;
    loadWorkspaceAgentSettings(): Promise<unknown>;
    loadAgentTeamSettings(): Promise<unknown>;
    loadLibraryAgentSettings(): Promise<unknown>;
    loadLearningImitationSettings(): Promise<unknown>;
    loadCatalogSnapshot(): Promise<unknown>;
  };
  notifications: WorkspaceFeatureHostNotifications;
}

export interface WorkspaceFeatureHostCoordinator {
  isLongWorkspaceActive: ComputedRef<boolean>;
  activeFeature: ComputedRef<ActiveFeature>;
  workspaceFeatureModule: ComputedRef<WorkspaceFeatureModule | null>;
  marketplaceDisplayName: Ref<string | undefined>;
  showConversation(): void;
  newConversation(): void;
  openWorkspaceDialog(mode: DialogMode): Promise<void>;
  openSettings(category?: string): Promise<void>;
  openOfficialModelsSettings(): void;
  openAgentTeams(): Promise<void>;
  openMarketplace(): Promise<void>;
  openDeviceSync(): Promise<void>;
  openCloudBackup(): Promise<void>;
  openZhuqueDetection(): Promise<void>;
  loadWorkspaceDirectory(): Promise<void>;
  chooseWorkspaceDirectory(): Promise<void>;
  closeSettings(): void;
  applyMarketplaceSession(session: MarketplaceSession): void;
  loadMarketplaceSession(): Promise<void>;
  ensureActiveFeatureDependencies(feature: ActiveFeature): Promise<void>;
  dispose(): void;
}
