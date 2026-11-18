import type { BrowserWindow } from "electron";
import type {
  AgentRuntimeRef,
  AppearanceSettings,
  GeneralSettings,
  SystemEventEnvelope,
  WebSearchRuntimeConfig
} from "@deepwrite/contracts";
import type { AgentTeamConfigStore } from "../agent-team-config-store";
import type { AppearanceService } from "../appearance-service";
import type { ContinuationImportPreviewRegistry } from "../continuation-import-preview-registry";
import type { readExternalLibraryEntries } from "../external-library-import";
import type { GeneralSettingsStore } from "../general-settings-store";
import type {
  authorizeMainInternalCommand,
  MainInternalCommandActiveRun
} from "../internal-command-authorizer";
import type { LegacySyncPreviewRegistry } from "../legacy-sync-preview-registry";
import type { LibraryAgentConfigStore } from "../library-agent-config-store";
import type { listRemoteModels } from "../list-remote-models";
import type { AcademicAgentConfigStore } from "../academic-agent-config-store";
import type { exportAcademicManuscript } from "../academic-manuscript-export";
import type { LongAgentConfigStore } from "../long-agent-config-store";
import type { MysteryAgentConfigStore } from "../mystery-agent-config-store";
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
  requireWorkspaceAgentConfigStore: () => WorkspaceAgentConfigStore;
  requireAgentTeamConfigStore: () => AgentTeamConfigStore;
  requireLibraryAgentConfigStore: () => LibraryAgentConfigStore;
  requireLongAgentConfigStore: () => LongAgentConfigStore;
  requireAcademicAgentConfigStore: () => AcademicAgentConfigStore;
  requireMysteryAgentConfigStore: () => MysteryAgentConfigStore;
  requireWorkspaceDirectoryStore: () => WorkspaceDirectoryStore;
  requireAppearanceService: () => AppearanceService;
  requireGeneralSettingsStore: () => GeneralSettingsStore;
  /** Search settings for one run; absent or undefined means no search tool. */
  resolveWebSearch?: () => Promise<WebSearchRuntimeConfig | undefined>;
  exportAcademicManuscript: typeof exportAcademicManuscript;
  exportShortManuscript: typeof exportShortManuscript;
  exportLongManuscript: typeof exportLongManuscript;
  listRemoteModels: typeof listRemoteModels;
  resolveDraftApiKey: ModelConfigStore["resolveDraftApiKey"];
  readExternalLibraryEntries: typeof readExternalLibraryEntries;
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
