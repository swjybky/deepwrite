import type {
  AppLanguage,
  AgentTeamCatalogSnapshot,
  CatalogSnapshot,
  CreativePlotStage,
  GeneralPermissionMode,
  LearningImitationSettings,
  LibraryAgentSettings,
  LongAgentSettings,
  ModelConfig,
  MarketplaceSession,
  ModelSettings,
  ModelUsageDashboard,
  OfficialModelBalance,
  SiteOfficialQuota,
  SkillLibrary,
  TextViewMode,
  WorkspacePaneLayout,
  WorkspaceAgentSettings
} from "@deepwrite/contracts";
import type { LearningImitationController } from "../composables/useLearningImitation";
import type { LongBookAnalysisController } from "../extras/long-book-analysis/useLongBookAnalysis";
import type { SubagentAuthoringController } from "../composables/useSubagentAuthoring";

export interface SettingsFeatureModule {
  kind: "settings";
  initialCategory: string;
  permissionMode: GeneralPermissionMode;
  autoApproveCrossStageOperations: boolean;
  autoSaveEnabled: boolean;
  language: AppLanguage;
  showContextUsage: boolean;
  showInMenuBar: boolean;
  useNetworkProxy: boolean;
  workspacePaneLayout: WorkspacePaneLayout;
  defaultTextViewMode: TextViewMode;
  workspaceAgentSettings: readonly WorkspaceAgentSettings[];
  creativePlotStages: readonly CreativePlotStage[];
  longAgentSettings: LongAgentSettings | null;
  workspaceAgentLoading: boolean;
  workspaceAgentSaving: boolean;
  longAgentLoading: boolean;
  longAgentSaving: boolean;
  longAgentError: string | null;
  libraryAgentSettings: LibraryAgentSettings | null;
  libraryAgentLoading: boolean;
  libraryAgentSaving: boolean;
  learningImitationSettings: LearningImitationSettings | null;
  learningImitationLoading: boolean;
  learningImitationSaving: boolean;
  modelUsageDashboard: ModelUsageDashboard | null;
  modelUsageLoading: boolean;
  modelSettings: ModelSettings | null;
  modelLoading: boolean;
  modelSaving: boolean;
  freeModelsRefreshing: boolean;
  freeModelsSaving: boolean;
  siteOfficialModelsRefreshing: boolean;
  siteOfficialModelsSaving: boolean;
  siteOfficialQuota: SiteOfficialQuota | null;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
  officialModelUsageDashboard: ModelUsageDashboard | null;
  officialModelBalance: OfficialModelBalance | null;
  officialModelsLoading: boolean;
  officialModelsSaving: boolean;
  runtimeAvailable: boolean;
}

export interface AgentTeamFeatureModule {
  kind: "agent-team";
  navigationEpoch: number;
  catalog: AgentTeamCatalogSnapshot | null;
  models: readonly ModelConfig[];
  skills: readonly SkillLibrary[];
  preferredModelId: string | null;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  runtimeAvailable: boolean;
  authoring: SubagentAuthoringController | null;
}

export interface DirectoryFeatureModule {
  kind: "directory";
  path: string | null;
  loading: boolean;
}

export interface ModelsFeatureModule {
  kind: "models";
  settings: ModelSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  testMessage: string | null;
  testingModelId: string | null;
  alertMessages: readonly string[];
}

export interface ImitationFeatureModule {
  kind: "imitation";
  controller: LearningImitationController | null;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
  approvalMode: GeneralPermissionMode;
}

export interface LongBookAnalysisFeatureModule {
  kind: "long-book-analysis";
  controller: LongBookAnalysisController | null;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}

export interface MarketplaceFeatureModule {
  kind: "marketplace";
  catalogSnapshot: CatalogSnapshot | null;
  session: MarketplaceSession | null;
}

export interface DeviceSyncFeatureModule {
  kind: "device-sync";
  prepareSync(): Promise<boolean>;
  refreshSync(): Promise<void>;
}

export interface CloudBackupFeatureModule {
  kind: "cloud-backup";
}

export interface ZhuqueDetectionFeatureModule {
  kind: "zhuque-detection";
}

export type WorkspaceFeatureModule =
  | SettingsFeatureModule
  | AgentTeamFeatureModule
  | DirectoryFeatureModule
  | ModelsFeatureModule
  | ImitationFeatureModule
  | {
      kind: "style-comparison";
      models: readonly ModelConfig[];
      preferredModelId: string | null;
    }
  | LongBookAnalysisFeatureModule
  | MarketplaceFeatureModule
  | DeviceSyncFeatureModule
  | CloudBackupFeatureModule
  | ZhuqueDetectionFeatureModule;
