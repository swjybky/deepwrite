import type { BrowserWindow } from "electron";
import type {
  AgentRuntimeRef,
  AppearanceSettings,
  GeneralSettings,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import type { AgentTeamConfigStore } from "../agent-team-config-store";
import type { AppearanceService } from "../appearance-service";
import type { ChatAssistantProjectConfigStore } from "../chat-assistant-project-config-store";
import type { ContinuationImportPreviewRegistry } from "../continuation-import-preview-registry";
import type { readExternalLibraryEntries } from "../external-library-import";
import type { GeneralSettingsStore } from "../general-settings-store";
import type {
  authorizeMainInternalCommand,
  MainInternalCommandActiveRun
} from "../internal-command-authorizer";
import type { LearningImitationConfigStore } from "../learning-imitation-config-store";
import type { LongBookAnalysisConfigStore } from "../extras/long-book-analysis/config-store";
import type { importLegacyLibraryArchives } from "../legacy-library-import-batch";
import type { LegacySyncPreviewRegistry } from "../legacy-sync-preview-registry";
import type { LibraryAgentConfigStore } from "../library-agent-config-store";
import type { listRemoteModels } from "../list-remote-models";
import type { LongAgentConfigStore } from "../long-agent-config-store";
import type { exportLongManuscript } from "../long-manuscript-export";
import type { ModelConfigStore } from "../model-config-store";
import type { ModelUsageStore } from "../model-usage-store";
import type { exportShortManuscript } from "../short-manuscript-export";
import type { UtilitySupervisor } from "../supervisor";
import type { UsageRunContext } from "../usage-observation";
import type { WorkspaceAgentConfigStore } from "../workspace-agent-config-store";
import type { WorkspaceDirectoryStore } from "../workspace-directory-store";
import type {
  chooseWorkspaceDirectory,
  workspaceGroupParent,
  workspaceResourceParent
} from "./workspace-paths";

export interface ActiveRun extends MainInternalCommandActiveRun {
  correlationId: string;
  runtime: AgentRuntimeRef;
  usageContext?: UsageRunContext;
}

export interface IpcCommandContext {
  getMainWindow: () => BrowserWindow;
  supervisor: UtilitySupervisor;
  broadcastEvent: (event: SystemEventEnvelope) => void;
  dialog: Pick<Electron.Dialog, "showOpenDialog" | "showSaveDialog">;
  continuationImportPreviews: ContinuationImportPreviewRegistry;
  legacySyncPreviews: LegacySyncPreviewRegistry;
  authorizeMainInternalCommand: typeof authorizeMainInternalCommand;
  activeRuns: Map<string, ActiveRun>;
  pendingUsageContexts: Map<string, UsageRunContext>;
  terminalRuns: Set<string>;
  recordUsageObservation: (
    event: Extract<SystemEventEnvelope, { type: "agent.usage_observed" }>
  ) => void;
  requireModelConfigStore: () => ModelConfigStore;
  requireModelUsageStore: () => ModelUsageStore;
  requireChatAssistantProjectConfigStore: () => ChatAssistantProjectConfigStore;
  requireWorkspaceAgentConfigStore: () => WorkspaceAgentConfigStore;
  requireAgentTeamConfigStore: () => AgentTeamConfigStore;
  requireLibraryAgentConfigStore: () => LibraryAgentConfigStore;
  requireLongAgentConfigStore: () => LongAgentConfigStore;
  requireLearningImitationConfigStore: () => LearningImitationConfigStore;
  requireLongBookAnalysisConfigStore: () => LongBookAnalysisConfigStore;
  requireWorkspaceDirectoryStore: () => WorkspaceDirectoryStore;
  requireAppearanceService: () => AppearanceService;
  requireGeneralSettingsStore: () => GeneralSettingsStore;
  exportShortManuscript: typeof exportShortManuscript;
  exportLongManuscript: typeof exportLongManuscript;
  listRemoteModels: typeof listRemoteModels;
  resolveDraftApiKey: ModelConfigStore["resolveDraftApiKey"];
  readExternalLibraryEntries: typeof readExternalLibraryEntries;
  importLegacyLibraryArchives: typeof importLegacyLibraryArchives;
  cachedAppearanceSettings: () => AppearanceSettings;
  syncNativeAppearanceChrome: (settings: AppearanceSettings) => void;
  syncGeneralSettings: (settings: GeneralSettings) => void;
  requireSelectedWorkspaceDirectory: () => Promise<string | null>;
  workspaceResourceParent: typeof workspaceResourceParent;
  workspaceGroupParent: typeof workspaceGroupParent;
  chooseWorkspaceDirectory: () => ReturnType<typeof chooseWorkspaceDirectory>;
  senderWebContentsId: number;
  getDocumentsPath: () => string;
  getAppVersion: () => string;
}
