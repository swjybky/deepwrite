import { nativeMessages, nativeText, setNativeLanguage } from "./native-i18n";
import { handleSessionCommands } from "./ipc/session-commands";
import { handleBookTemplateCommands } from "./ipc/book-template-commands";
import { handleCatalogProjectCommands } from "./ipc/catalog-project-commands";
import type { ExtrasAgentService } from "../extras/agents";
import { isDecompositionFauxSmokeModel } from "./smoke-decomposition-model";
import { isBookIdentityFauxSmokeModel } from "./smoke-book-identity-model";
import {
  createDesktopServices,
  refreshDesktopServices
} from "./desktop-services";
import { createDesktopStartup } from "./desktop-startup";
import {
  acquireStorageInstanceLock,
  initializeStorageLocation
} from "./storage-bootstrap";
import { createStorageSettingsService } from "./storage-settings-runtime";
import type { StorageSettingsService } from "./storage-settings-service";
import { handleStorageSettingsCommands } from "./ipc/storage-settings-commands";
import { runStorageSmoke } from "./smoke-storage";
import {
  recordUsageObservation,
  type UsageRunContext
} from "./usage-observation";
import {
  handleConversationExportCommands,
  disposeConversationExports
} from "./ipc/conversation-export-commands";
import {
  acquireConversationOperation,
  releaseConversationRuns
} from "./ipc/conversation-operation-guard";
import { releaseDrainedAgentRun } from "./ipc/agent-run-drain";
import { createRendererStateFlushCoordinator } from "./renderer-state-flush";
import { createGracefulShutdown } from "./graceful-shutdown";
import { guardConversationWindowClose } from "./conversation-window-close";
import { createDesktopWindow } from "./create-desktop-window";
import {
  type createDesktopDeviceSync,
  registerDeviceSyncIpc
} from "../extras/device-sync";
import { handleRendererStateCommands } from "./ipc/renderer-state-commands";
import { handleAgentTeamCommands } from "./ipc/agent-team-commands";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BookSchema,
  SaveDocumentResultSchema,
  CatalogDraftSectionSchema,
  CreateDraftSectionsResultSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
  APP_ALERT_GET_CHANNEL,
  AppAlertDesktopRevisionSchema,
  AppAlertSnapshotSchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentResultSchema,
  ReadWritingContextResultSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionResultSchema,
  MoveDraftSectionResultSchema,
  DuplicateCatalogProjectResultSchema,
  ExportLongManuscriptResultSchema,
  ExportShortManuscriptResultSchema,
  ExternalLibrarySelectionResultSchema,
  ImportLibraryEntriesResultSchema,
  GeneralSettingsSnapshotSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  LibraryAgentSettingsSchema,
  LongApplyOperationsResultSchema,
  LongApplyLegacySyncResultSchema,
  LongAgentSettingsSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongImportPortableResultSchema,
  LongChooseContinuationImportSourceResultSchema,
  LongImportContinuationResultSchema,
  LongPreviewContinuationImportAtPathResultSchema,
  LongPreviewLegacySyncAtPathResultSchema,
  LongChooseLegacySyncSourceResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentResultSchema,
  LongReadAgentsMdResultSchema,
  LongRemoveBookResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  LongWriteAgentsMdResultSchema,
  RemoveLibraryEntryResultSchema,
  MoveLibraryEntryResultSchema,
  WorkspaceAgentSettingsSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SystemReadyEventEnvelopeSchema,
  UnregisterCatalogProjectResultSchema,
  WriteWritingContextResultSchema,
  WorkspaceDirectorySettingsSchema,
  createDefaultAppearanceSettings,
  createDefaultGeneralSettings,
  createEnvelope,
  type AgentRuntimeRef,
  type AppearanceSettings,
  type AppAlertSnapshot,
  type CommandResult,
  type GeneralSettings,
  type SystemEventEnvelope,
  type UpdateState,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";
import { AppearanceService } from "./appearance-service";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { GeneralSettingsStore } from "./general-settings-store";
import { VoiceService } from "./voice/voice-service";
import { ImageService } from "./image/image-service";
import { handleImageCommands } from "./image/image-commands";
import { CoverRenderService } from "../extras/book-identity/cover-render-service";
import { handleBookIdentityCommands } from "../extras/book-identity/commands";
import {
  installCoverProtocolHandler,
  registerCoverScheme
} from "../extras/book-identity/cover-protocol";
import { handleBookIdentitySubmission } from "../extras/book-identity/submit-bridge";
import { handleVoiceCommands } from "./ipc/voice-commands";
import {
  installVoicePermissions,
  requestVoiceMicrophoneAccess
} from "./voice-permissions";
import { resolveContextCompactionRun } from "./context-compaction-run";
import { ModelConfigStore } from "./model-config-store";
import { electronRemoteFetch } from "./electron-remote-fetch";
import { applyNetworkProxyPreference } from "./network-proxy-preference";
import { listRemoteModels } from "./list-remote-models";
import { ModelUsageStore } from "./model-usage-store";
import { SoftwareTokenUsageReporter } from "./software-token-usage-reporter";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import { LongAgentConfigStore } from "./long-agent-config-store";
import { applyNativeAppearanceChrome } from "./native-appearance-chrome";
import { exportShortManuscript } from "./short-manuscript-export";
import { exportLongManuscript } from "./long-manuscript-export";
import { UtilityCommandTimeoutError, UtilitySupervisor } from "./supervisor";
import { runApplicationSmoke } from "./smoke";
import {
  catalogCommandTimeoutMessage,
  catalogCommandTimeoutMs
} from "./catalog-command-timeout";
import {
  AGENT_CORE_QUERY_COMMANDS,
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";
import { UpdateService } from "./update-service";
import { AppAlertStore } from "./app-alert-store";
import { MarketplaceClient } from "./marketplace-client";
import {
  CloudBackupService,
  registerCloudBackupIpc
} from "../extras/cloud-backup";
import { ContinuationImportPreviewRegistry } from "./continuation-import-preview-registry";
import { ImportPreviewRegistry } from "./import-preview-registry";
import {
  handleLibraryPackageCommands,
  type LibraryPackagePreviewSource
} from "./ipc/library-package-commands";
import { LegacySyncPreviewRegistry } from "./legacy-sync-preview-registry";
import { readExternalLibraryEntries } from "./external-library-import";
import { createMainWindowStartupGate } from "./main-window-startup-gate";
import { configureBootstrapEnvironment } from "./bootstrap-environment";
import { handleModelCommands } from "./ipc/model-commands";
import { handleAppearanceCommands } from "./ipc/appearance-commands";
import {
  installAppearanceFontProtocolHandler,
  registerAppearanceFontScheme
} from "./appearance-font-protocol";
import { registerMarketplaceIpc } from "./ipc/marketplace-ipc";
import {
  registerAgentTeamMarketplaceIpc,
  type AgentTeamMarketplaceClient
} from "../extras/agent-team-marketplace";

registerAppearanceFontScheme();
registerCoverScheme();
const hasSingleInstanceLock = acquireStorageInstanceLock(app);
// A second instance must not write diagnostics into a profile being migrated.
if (!hasSingleInstanceLock) app.exit(0);
let storageBootstrap: ReturnType<typeof initializeStorageLocation> | undefined;
if (hasSingleInstanceLock) {
  try {
    storageBootstrap = initializeStorageLocation(app);
  } catch (error) {
    dialog.showErrorBox(
      nativeText("storageReadFailure"),
      error instanceof Error ? error.message : nativeText("checkUserData")
    );
    app.exit(1);
  }
}
const desktopStartup = createDesktopStartup();

interface ActiveRun extends MainInternalCommandActiveRun {
  correlationId: string;
  runtime: AgentRuntimeRef;
  usageContext?: UsageRunContext;
}

const activeRuns = new Map<string, ActiveRun>();
const terminalRuns = new Set<string>();
const pendingUsageContexts = new Map<string, UsageRunContext>();
let smokeEventTap: ((event: SystemEventEnvelope) => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let modelConfigStore: ModelConfigStore | undefined;
let modelUsageStore: ModelUsageStore | undefined;
let softwareTokenUsageReporter: SoftwareTokenUsageReporter | undefined;
let agentTeamConfigStore: AgentTeamConfigStore | undefined;
let appearanceService: AppearanceService | undefined;
let generalSettingsStore: GeneralSettingsStore | undefined;
let voiceService: VoiceService | undefined;
let imageService: ImageService | undefined;
let coverRenderService: CoverRenderService | undefined;
let extrasAgentService: ExtrasAgentService;
let libraryAgentConfigStore: LibraryAgentConfigStore | undefined;
let longAgentConfigStore: LongAgentConfigStore | undefined;
let cachedAppearanceSettings: AppearanceSettings =
  createDefaultAppearanceSettings();
let cachedGeneralSettings: GeneralSettings = createDefaultGeneralSettings();
let utilitiesStarted = false;
let nativeAppearanceListenerBound = false;
let workspaceAgentConfigStore: WorkspaceAgentConfigStore | undefined;
let workspaceDirectoryStore: WorkspaceDirectoryStore | undefined;
let storageSettingsService: StorageSettingsService | undefined;
let quitting = false;
let shutdownComplete = false;
let menuBarTray: Tray | undefined;
let updateService: UpdateService | undefined;
let appAlertStore: AppAlertStore | undefined;
let marketplaceClient: MarketplaceClient | undefined;
let agentTeamMarketplaceClient: AgentTeamMarketplaceClient | undefined;
let cloudBackupService: CloudBackupService | undefined;
let deviceSyncService: ReturnType<typeof createDesktopDeviceSync> | undefined;
const rendererStateFlush = createRendererStateFlushCoordinator();
const continuationImportPreviews = new ContinuationImportPreviewRegistry();
const libraryPackagePreviews =
  new ImportPreviewRegistry<LibraryPackagePreviewSource>({
    idPrefix: "library-package-preview",
    expiredMessage: "导入预览已失效，请重新选择。",
    ttlMs: 30 * 60 * 1_000,
    now: Date.now
  });
const legacySyncPreviews = new LegacySyncPreviewRegistry();
const mainWindowStartupGate = createMainWindowStartupGate(() =>
  showMainWindow()
);

function broadcastEvent(event: SystemEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENT_CHANNEL, event);
    }
  }
}

const gracefulShutdown = createGracefulShutdown({
  flushRenderer: async () => {
    // Storage migration already awaited this flush before accepting the IPC request.
    if (!storageSettingsService?.restartPending)
      await rendererStateFlush.request(mainWindow);
    mainWindow?.close();
  },
  shutdownUtilities: () => supervisor.shutdownAll(),
  flushUsage: () => modelUsageStore?.flush(),
  reportUsage: () => softwareTokenUsageReporter?.reportBeforeShutdown(),
  complete(installUpdate) {
    shutdownComplete = true;
    destroyMenuBarTray();
    if (installUpdate && updateService) updateService.quitAndInstall();
    else {
      if (storageSettingsService?.restartPending) app.relaunch();
      app.quit();
    }
  },
  cancel(error) {
    quitting = false;
    if (storageSettingsService?.restartPending) {
      storageSettingsService.cancelRestart();
      dialog.showErrorBox(
        nativeText("migrationCancelled"),
        nativeText("migrationCancelledDetail")
      );
    }
    console.warn(
      "DeepWrite shutdown was canceled before conversations were saved:",
      error
    );
  }
});

function beginGracefulShutdown(
  options: { installUpdate?: boolean } = {}
): void {
  if (shutdownComplete && options.installUpdate && updateService) {
    updateService.quitAndInstall();
    return;
  }
  quitting = true;
  gracefulShutdown.begin(options);
}

type AgentEventEnvelope = Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.context_compaction"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.usage_observed"
      | "agent.error"
      | "agent.user_input_requested"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "extras_agent.output_updated"
      | "subagent_authoring.draft_updated"
      | "library.editor_mutation"
      | "workspace.editor_mutation"
      | "workspace.stage_selection"
      | "long.mutation_proposal"
      | "long.chapter_write_proposal"
      | "long.ledger_commit_proposal"
      | "subagent.planned"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed"
      | "subagent.draw_updated";
  }
>;

function isAgentEvent(event: SystemEventEnvelope): event is AgentEventEnvelope {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.context_compaction" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.usage_observed" ||
    event.type === "agent.error" ||
    event.type === "agent.user_input_requested" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "extras_agent.output_updated" ||
    event.type === "subagent_authoring.draft_updated" ||
    event.type === "library.editor_mutation" ||
    event.type === "workspace.editor_mutation" ||
    event.type === "workspace.stage_selection" ||
    event.type === "long.mutation_proposal" ||
    event.type === "long.chapter_write_proposal" ||
    event.type === "long.ledger_commit_proposal" ||
    event.type === "subagent.planned" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed" ||
    event.type === "subagent.draw_updated"
  );
}

function rememberTerminalRun(runId: string): void {
  terminalRuns.add(runId);
  while (terminalRuns.size > 2_000) {
    const oldest = terminalRuns.values().next().value as string | undefined;
    if (!oldest) {
      return;
    }
    terminalRuns.delete(oldest);
  }
}

function handleUtilityEvent(
  event: SystemEventEnvelope,
  worker: UtilityWorkerName
): void {
  if (event.type === "agent.run_drained" && worker !== "agent") return;
  if (isAgentEvent(event) && worker !== "agent") {
    return;
  }

  const validated = SystemEventEnvelopeSchema.parse(
    event
  ) as SystemEventEnvelope;
  if (validated.type === "agent.run_drained") {
    releaseDrainedAgentRun(
      activeRuns,
      pendingUsageContexts,
      validated,
      rememberTerminalRun
    );
    return;
  }
  if (validated.type === "agent.usage_observed") {
    recordUsageObservation(
      validated,
      modelUsageStore,
      activeRuns,
      pendingUsageContexts
    );
    if (
      validated.payload.status === "completed" &&
      validated.payload.hadToolCall &&
      !validated.payload.parentToolCallId &&
      !validated.payload.subagentRunId
    ) {
      broadcastEvent(validated);
    }
    return;
  }
  if (isAgentEvent(validated)) {
    const runId = validated.payload.runId;
    if (
      validated.type === "agent.message_completed" ||
      validated.type === "agent.error"
    ) {
      const activeRun = activeRuns.get(runId);
      const previouslyTerminal = terminalRuns.has(runId);
      rememberTerminalRun(runId);
      // Revoke Core authority on UI termination, but keep ownership while
      // model/tool execution drains in Agent Utility.
      if (activeRun) activeRun.accepted = false;
      else if (!previouslyTerminal && validated.payload.runtime)
        activeRuns.set(runId, {
          sessionId: validated.payload.sessionId,
          correlationId: validated.context.correlationId,
          runtime: validated.payload.runtime,
          accepted: false
        });
      pendingUsageContexts.delete(
        activeRun?.correlationId ?? validated.context.correlationId
      );
    } else if (
      // A plan or draw update always follows its tool request, so it never
      // opens a run.
      validated.type !== "subagent.planned" &&
      validated.type !== "subagent.draw_updated" &&
      !terminalRuns.has(runId) &&
      !activeRuns.has(runId)
    ) {
      const usageContext = pendingUsageContexts.get(
        validated.context.correlationId
      );
      activeRuns.set(runId, {
        sessionId: validated.payload.sessionId,
        correlationId: validated.context.correlationId,
        runtime: validated.payload.runtime,
        accepted: false,
        ...(usageContext ? { usageContext } : {})
      });
    }
  }
  smokeEventTap?.(validated);
  broadcastEvent(validated);
}

function handleUnexpectedExit(worker: UtilityWorkerName, reason: string): void {
  if (worker === "agent") {
    for (const [runId, run] of activeRuns) {
      const event = SystemEventEnvelopeSchema.parse(
        createEnvelope(
          "agent.error",
          {
            sessionId: run.sessionId,
            runId,
            code: "agent.utility_exited",
            message: "Agent Utility 意外退出，本轮对话已终止。",
            details: { reason },
            runtime: run.runtime
          },
          {
            id: createId("evt"),
            context: {
              correlationId: run.correlationId,
              sessionId: run.sessionId,
              runId
            }
          }
        )
      ) as SystemEventEnvelope;
      rememberTerminalRun(runId);
      smokeEventTap?.(event);
      broadcastEvent(event);
    }
    activeRuns.clear();
    releaseConversationRuns(activeRuns);
    pendingUsageContexts.clear();
  }

  broadcastEvent(
    SystemEventEnvelopeSchema.parse(
      createEnvelope(
        "system.worker_restarting",
        { worker, reason, detectedAt: nowIso() },
        { id: createId("evt_restarting") }
      )
    ) as SystemEventEnvelope
  );
}

function handleWorkerRestarted(
  worker: UtilityWorkerName,
  reason: string
): void {
  broadcastEvent(
    SystemEventEnvelopeSchema.parse(
      createEnvelope(
        "system.worker_restarted",
        { worker, reason, restartedAt: nowIso() },
        { id: createId("evt_restarted") }
      )
    ) as SystemEventEnvelope
  );
}

const supervisor: UtilitySupervisor = new UtilitySupervisor({
  onUtilityEvent: handleUtilityEvent,
  onUnexpectedExit: handleUnexpectedExit,
  onWorkerRestarted: handleWorkerRestarted,
  internalCommandAllowlist: {
    core: AGENT_CORE_QUERY_COMMANDS
  },
  internalCommandAuthorize: (context) =>
    authorizeMainInternalCommand(context, activeRuns),
  internalCommandHandle: (context) =>
    handleBookIdentitySubmission(context, activeRuns, (command) =>
      supervisor.requestCommand("core", command, 60_000)
    )
});

function createMainWindow(): BrowserWindow {
  const window = createDesktopWindow(cachedAppearanceSettings, {
    log: desktopStartup.log,
    fail: (error) => desktopStartup.fail(error, "window")
  });
  const windowWebContentsId = window.webContents.id;
  installVoicePermissions(window);
  const cancelWindowMedia = () => {
    voiceService?.cancelOwner(windowWebContentsId);
    imageService?.cancelOwner(windowWebContentsId);
    coverRenderService?.cancelOwner(windowWebContentsId);
  };
  window.webContents.on("did-start-loading", cancelWindowMedia);
  window.webContents.on("render-process-gone", cancelWindowMedia);
  window.webContents.once("did-finish-load", () => {
    void announceReady(window).catch((error: unknown) => {
      desktopStartup.log.write("utilities.health.failed", { error });
    });
  });
  window.on("close", (event) => {
    if (cachedGeneralSettings.showInMenuBar && !quitting && !shutdownComplete) {
      event.preventDefault();
      window.hide();
    }
  });
  guardConversationWindowClose(window, {
    skip: () =>
      quitting || shutdownComplete || cachedGeneralSettings.showInMenuBar,
    flush: () => rendererStateFlush.request(window),
    onError: (error) =>
      console.warn("DeepWrite window close was canceled:", error)
  });
  window.webContents.on("did-start-loading", () =>
    rendererStateFlush.reset(windowWebContentsId)
  );
  window.on("closed", () => {
    cancelWindowMedia();
    rendererStateFlush.reset(windowWebContentsId);
    void disposeConversationExports({
      supervisor,
      dialog,
      getMainWindow: requireMainWindow,
      senderWebContentsId: windowWebContentsId
    });
    continuationImportPreviews.clearForWebContents(windowWebContentsId);
    libraryPackagePreviews.clearForWebContents(windowWebContentsId);
    legacySyncPreviews.clearForWebContents(windowWebContentsId);
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function destroyMenuBarTray(): void {
  menuBarTray?.destroy();
  menuBarTray = undefined;
}

function syncMenuBarTray(): void {
  if (!cachedGeneralSettings.showInMenuBar) {
    destroyMenuBarTray();
    return;
  }
  if (!menuBarTray || menuBarTray.isDestroyed()) {
    const rendererIconPath = join(__dirname, "../renderer/app-icon.png");
    const buildIconPath = join(__dirname, "../../build/icon.png");
    const sourceIcon = existsSync(rendererIconPath)
      ? rendererIconPath
      : buildIconPath;
    let trayIcon = nativeImage.createFromPath(sourceIcon);
    if (process.platform === "darwin" && !trayIcon.isEmpty()) {
      trayIcon = trayIcon.resize({ width: 18, height: 18 });
      trayIcon.setTemplateImage(true);
    }
    menuBarTray = new Tray(trayIcon);
    menuBarTray.setToolTip("DeepWrite");
    menuBarTray.on("click", showMainWindow);
  }
  menuBarTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: nativeText("showApp"),
        click: showMainWindow
      },
      { type: "separator" },
      {
        label: nativeText("quit"),
        click: () => app.quit()
      }
    ])
  );
}

function syncGeneralSettings(settings: GeneralSettings): void {
  const shouldRestartAgent =
    utilitiesStarted &&
    cachedGeneralSettings.useNetworkProxy !== settings.useNetworkProxy;
  cachedGeneralSettings = settings;
  setNativeLanguage(settings.language, app.getLocale());
  syncMenuBarTray();
  applyNetworkProxyPreference(settings.useNetworkProxy);
  if (shouldRestartAgent) {
    void supervisor.restartWorker("agent", "network-proxy-preference");
  }
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  return { kind: error instanceof Error ? error.name : "unknown" };
}

function extractCommandRequestId(rawCommand: unknown): string {
  if (
    rawCommand &&
    typeof rawCommand === "object" &&
    "id" in rawCommand &&
    typeof (rawCommand as { id: unknown }).id === "string"
  ) {
    const requestId = (rawCommand as { id: string }).id.trim();
    if (requestId) {
      return requestId;
    }
  }
  return "unknown";
}

function summarizeCommandValidationIssues(
  issues: readonly { path: PropertyKey[]; message: string }[]
): Record<string, unknown> {
  const preview = issues.slice(0, 3).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message
  }));
  return {
    issueCount: issues.length,
    issues: preview
  };
}

function requireModelConfigStore(): ModelConfigStore {
  if (!modelConfigStore) {
    throw new Error("模型配置存储尚未初始化。");
  }
  return modelConfigStore;
}

function requireModelUsageStore(): ModelUsageStore {
  if (!modelUsageStore) {
    throw new Error("模型用量存储尚未初始化。");
  }
  return modelUsageStore;
}

function requireWorkspaceAgentConfigStore(): WorkspaceAgentConfigStore {
  if (!workspaceAgentConfigStore) {
    throw new Error("创作空间智能体设置存储尚未初始化。");
  }
  return workspaceAgentConfigStore;
}

function requireMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("DeepWrite 主窗口尚未初始化。");
  }
  return mainWindow;
}

function requireAgentTeamConfigStore(): AgentTeamConfigStore {
  if (!agentTeamConfigStore) {
    throw new Error("智能体团队设置存储尚未初始化。");
  }
  return agentTeamConfigStore;
}

function requireLibraryAgentConfigStore(): LibraryAgentConfigStore {
  if (!libraryAgentConfigStore) {
    throw new Error("资料库智能体设置存储尚未初始化。");
  }
  return libraryAgentConfigStore;
}

function requireLongAgentConfigStore(): LongAgentConfigStore {
  if (!longAgentConfigStore) {
    throw new Error("长篇智能体设置存储尚未初始化。");
  }
  return longAgentConfigStore;
}

function requireWorkspaceDirectoryStore(): WorkspaceDirectoryStore {
  if (!workspaceDirectoryStore) {
    throw new Error("工作目录配置存储尚未初始化。");
  }
  return workspaceDirectoryStore;
}

function requireAppearanceService(): AppearanceService {
  if (!appearanceService) {
    throw new Error("外观设置服务尚未初始化。");
  }
  return appearanceService;
}

function requireGeneralSettingsStore(): GeneralSettingsStore {
  if (!generalSettingsStore) {
    throw new Error("常规设置存储尚未初始化。");
  }
  return generalSettingsStore;
}

function syncNativeAppearanceChrome(settings: AppearanceSettings): void {
  cachedAppearanceSettings = settings;
  applyNativeAppearanceChrome(settings);
  if (!nativeAppearanceListenerBound) {
    nativeAppearanceListenerBound = true;
    nativeTheme.on("updated", () => {
      if (cachedAppearanceSettings.mode === "system") {
        applyNativeAppearanceChrome(cachedAppearanceSettings);
      }
    });
  }
}

async function loadAndSyncNativeAppearanceChrome(): Promise<void> {
  try {
    const snapshot = await requireAppearanceService().list();
    syncNativeAppearanceChrome(snapshot.settings);
  } catch (error) {
    desktopStartup.log.write("appearance.fallback", { error });
    syncNativeAppearanceChrome(createDefaultAppearanceSettings());
  }
}

async function chooseWorkspaceDirectory(): Promise<ReturnType<
  typeof WorkspaceDirectorySettingsSchema.parse
> | null> {
  const current = await requireWorkspaceDirectoryStore().list();
  const selection = await dialog.showOpenDialog({
    title: nativeText("chooseWorkspace"),
    defaultPath: current.path ?? app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  const selectedDirectory = selection.filePaths[0];
  if (selection.canceled || !selectedDirectory) {
    return null;
  }
  return WorkspaceDirectorySettingsSchema.parse(
    await requireWorkspaceDirectoryStore().save(selectedDirectory)
  );
}

async function requireSelectedWorkspaceDirectory(): Promise<string | null> {
  const current = await requireWorkspaceDirectoryStore().list();
  if (current.path) {
    return current.path;
  }
  return (await chooseWorkspaceDirectory())?.path ?? null;
}

function workspaceResourceParent(
  workspaceDirectory: string,
  domain: "book" | "material" | "skill"
): string {
  return join(
    workspaceDirectory,
    domain === "book" ? "books" : domain === "material" ? "materials" : "skills"
  );
}

function workspaceGroupParent(
  workspaceDirectory: string,
  domain: "material" | "skill"
): string {
  return join(
    workspaceDirectory,
    domain === "material" ? "material-groups" : "skill-groups"
  );
}

function registerIpc(): void {
  const requireUpdateService = (
    event: Electron.IpcMainInvokeEvent
  ): UpdateService => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents
    ) {
      throw new Error(
        "IPC update request sender is not the active DeepWrite window."
      );
    }
    if (!updateService) throw new Error("更新服务尚未初始化。");
    return updateService;
  };
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, (event): UpdateState =>
    requireUpdateService(event).getState()
  );
  ipcMain.handle(UPDATE_CHECK_CHANNEL, (event): Promise<UpdateState> =>
    requireUpdateService(event).check()
  );
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, (event): Promise<UpdateState> =>
    requireUpdateService(event).download()
  );
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, (event): void => {
    requireUpdateService(event).install();
  });
  const requireAppAlertStore = (
    event: Electron.IpcMainInvokeEvent
  ): AppAlertStore => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents
    ) {
      throw new Error(
        "IPC app alert request sender is not the active DeepWrite window."
      );
    }
    if (!appAlertStore) throw new Error("提醒服务尚未初始化。");
    return appAlertStore;
  };
  ipcMain.handle(
    APP_ALERT_GET_CHANNEL,
    async (event): Promise<AppAlertSnapshot> =>
      AppAlertSnapshotSchema.parse(
        await requireAppAlertStore(event).getSnapshot()
      )
  );
  ipcMain.handle(
    APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
    async (event, rawRevision: unknown): Promise<void> => {
      const revision = AppAlertDesktopRevisionSchema.parse(rawRevision);
      await requireAppAlertStore(event).acknowledgeDesktop(revision);
    }
  );

  registerMarketplaceIpc({
    getMainWindow: () => mainWindow,
    getMarketplaceClient: () => marketplaceClient
  });
  registerAgentTeamMarketplaceIpc(
    () => agentTeamMarketplaceClient,
    () => mainWindow
  );

  registerDeviceSyncIpc(
    () => deviceSyncService,
    () => mainWindow,
    () => activeRuns.size > 0
  );
  registerCloudBackupIpc(
    () => cloudBackupService,
    () => mainWindow
  );

  ipcMain.handle(
    IPC_COMMAND_CHANNEL,
    async (event, rawCommand: unknown): Promise<CommandResult> => {
      const requestId = extractCommandRequestId(rawCommand);
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
      ) {
        return {
          status: "rejected",
          requestId,
          error: {
            code: "ipc.untrusted_sender",
            message: "IPC command sender is not the active DeepWrite window."
          }
        };
      }
      const parsed = CommandEnvelopeSchema.safeParse(rawCommand);
      if (!parsed.success) {
        const details = summarizeCommandValidationIssues(parsed.error.issues);
        const firstIssue = Array.isArray(details.issues)
          ? (details.issues[0] as
              { path?: string; message?: string } | undefined)
          : undefined;
        const issueHint =
          firstIssue?.path && firstIssue.message
            ? ` (${firstIssue.path}: ${firstIssue.message})`
            : "";
        console.error(
          `DeepWrite IPC rejected invalid command ${requestId}:`,
          details
        );
        return {
          status: "rejected",
          requestId,
          error: {
            code: "ipc.invalid_command",
            message: `Command envelope failed schema validation.${issueHint}`,
            details
          }
        };
      }

      const command = parsed.data;
      if (
        command.type.startsWith("imageModels.") ||
        command.type.startsWith("bookIdentity.")
      ) {
        if (event.senderFrame !== event.sender.mainFrame)
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "image.untrusted_frame",
              message: "图片与设计操作仅允许从应用主界面发起。"
            }
          };
        if (imageService && command.type.startsWith("imageModels.")) {
          const result = await handleImageCommands(
            command,
            imageService,
            event.sender.id
          );
          if (result) return result;
        }
        if (coverRenderService && command.type.startsWith("bookIdentity.")) {
          const result = await handleBookIdentityCommands(
            command,
            (coreCommand) => supervisor.requestCommand("core", coreCommand, 0),
            coverRenderService,
            event.sender.id
          );
          if (result) return result;
        }
      }
      if (
        command.type.startsWith("storageSettings.") &&
        storageSettingsService
      ) {
        if (event.senderFrame !== event.sender.mainFrame) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "storage_settings.untrusted_frame",
              message: "存储操作仅允许从应用主界面发起。"
            }
          };
        }
        const result = await handleStorageSettingsCommands(
          command,
          storageSettingsService
        );
        if (result) return result;
      }
      if (command.type.startsWith("voice.") && voiceService) {
        if (event.senderFrame !== event.sender.mainFrame) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "voice.untrusted_frame",
              message: "语音操作仅允许从应用主界面发起。"
            }
          };
        }
        const result = await handleVoiceCommands(
          command,
          voiceService,
          event.sender.id,
          process.env.DEEPWRITE_SMOKE === "1"
            ? async () => true
            : requestVoiceMicrophoneAccess
        );
        if (result) return result;
      }
      if (
        command.type === "deviceSync.workspace" ||
        command.type === "agent.prompt" ||
        command.type === "agent.extras_run" ||
        command.type === "agent.abort" ||
        command.type === "agent.user_input_response" ||
        command.type === "agent.model_test" ||
        command.type === "agent.model_capacity" ||
        command.type === "catalog.createShortBookAtPath" ||
        command.type === "catalog.createScriptBookAtPath" ||
        command.type === "long.createBookAtPath" ||
        command.type === "long.previewLegacySyncAtPath" ||
        command.type === "long.applyLegacySyncAtPath" ||
        command.type === "long.importPortableAtPath" ||
        command.type === "long.previewContinuationImportAtPath" ||
        command.type === "long.importContinuationAtPath" ||
        command.type === "long.openAtPath" ||
        command.type === "catalog.createLibraryAtPath" ||
        command.type === "catalog.createLibraryGroupAtPath" ||
        command.type === "catalog.openProjectAtPath" ||
        command.type === "catalog.readLibraryPackageSource" ||
        command.type === "catalog.previewLibraryPackageAtPath" ||
        command.type === "catalog.importLibraryPackageAtPath" ||
        command.type === "catalog.installMarketplaceSkillContent"
      ) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "ipc.forbidden_internal_command",
            message: "Renderer cannot invoke internal commands."
          }
        };
      }
      if (command.type === "system.health") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: SystemHealthPayloadSchema.parse(
            await supervisor.collectHealth()
          )
        };
      }

      if (command.type === "manuscript.exportShort") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ExportShortManuscriptResultSchema.parse(
              await exportShortManuscript(mainWindow, command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "manuscript.export_failed",
              message:
                error instanceof Error ? error.message : "导出正文失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "manuscript.exportLong") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ExportLongManuscriptResultSchema.parse(
              await exportLongManuscript(mainWindow, command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "manuscript.export_failed",
              message:
                error instanceof Error ? error.message : "导出长篇失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "workspaceDirectory.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: WorkspaceDirectorySettingsSchema.parse(
              await requireWorkspaceDirectoryStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_directory.list_failed",
              message:
                error instanceof Error ? error.message : "加载工作目录失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "workspaceDirectory.choose") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: await chooseWorkspaceDirectory()
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_directory.choose_failed",
              message:
                error instanceof Error ? error.message : "切换工作目录失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const appearanceCommandResult = await handleAppearanceCommands(
        {
          dialog,
          getMainWindow: requireMainWindow,
          requireAppearanceService,
          syncNativeAppearanceChrome
        },
        command
      );
      if (appearanceCommandResult) {
        return appearanceCommandResult;
      }

      const extrasAgentResult = await extrasAgentService.handle(
        {
          dialog,
          getMainWindow: requireMainWindow,
          getWorkspaceDirectory: async () =>
            (await requireWorkspaceDirectoryStore().list()).path,
          core: (command) => supervisor.requestCommand("core", command, 60_000),
          coreLong: (command) =>
            supervisor.requestCommand("core", command, 15 * 60_000),
          chatSources: {
            core: (command) =>
              supervisor.requestCommand("core", command, 60_000),
            listModels: () => requireModelConfigStore().list(),
            queryUsage: (query) => requireModelUsageStore().query(query),
            appVersion: () => app.getVersion()
          },
          evaluationMode: process.env.DEEPWRITE_APP_MODE === "evaluation",
          imageCapability: () =>
            imageService?.capability() ?? Promise.resolve(undefined),
          resolveModel: (modelId) =>
            isDecompositionFauxSmokeModel(modelId) ||
            isBookIdentityFauxSmokeModel(modelId)
              ? Promise.resolve(undefined)
              : requireModelConfigStore().resolve(modelId),
          resolveContextCompaction: (runModelId) =>
            resolveContextCompactionRun(
              async () => (await requireGeneralSettingsStore().list()).settings,
              (modelId) => requireModelConfigStore().resolve(modelId),
              runModelId
            ),
          requestAgent: (command) =>
            supervisor.requestCommand("agent", command, 10_000),
          acquireConversation: (sessionId, ownerId) =>
            acquireConversationOperation(
              activeRuns,
              sessionId,
              "prompt",
              ownerId
            ),
          activeRuns,
          terminalRuns,
          pendingUsageContexts
        },
        command
      );
      if (extrasAgentResult) return extrasAgentResult;

      if (command.type === "generalSettings.list") {
        try {
          const snapshot = GeneralSettingsSnapshotSchema.parse(
            await requireGeneralSettingsStore().list()
          );
          syncGeneralSettings(snapshot.settings);
          return {
            status: "accepted",
            requestId: command.id,
            payload: snapshot
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "general_settings.list_failed",
              message:
                error instanceof Error ? error.message : "加载常规设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "generalSettings.save") {
        // Match Renderer session language even if the following disk write fails.
        setNativeLanguage(command.payload.language, app.getLocale());
        syncMenuBarTray();
        try {
          const snapshot = GeneralSettingsSnapshotSchema.parse(
            await requireGeneralSettingsStore().save(command.payload)
          );
          syncGeneralSettings(snapshot.settings);
          return {
            status: "accepted",
            requestId: command.id,
            payload: snapshot
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "general_settings.save_failed",
              message:
                error instanceof Error ? error.message : "保存常规设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (
        command.type === "long.createBook" ||
        command.type === "long.openExisting"
      ) {
        try {
          const workspaceDirectory = await requireSelectedWorkspaceDirectory();
          if (!workspaceDirectory) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          const defaultPath = workspaceResourceParent(
            workspaceDirectory,
            "book"
          );
          let selectedPath = defaultPath;
          if (command.type === "long.openExisting") {
            const selection = await dialog.showOpenDialog({
              title: nativeText("openLongProject"),
              defaultPath,
              properties: ["openDirectory"]
            });
            if (selection.canceled || selection.filePaths.length === 0) {
              return {
                status: "accepted",
                requestId: command.id,
                payload: null
              };
            }
            selectedPath = selection.filePaths[0]!;
          }
          const internalCommand = CommandEnvelopeSchema.parse(
            command.type === "long.createBook"
              ? createEnvelope(
                  "long.createBookAtPath",
                  {
                    parentDirectory: selectedPath,
                    input: command.payload
                  },
                  { id: command.id, context: command.context }
                )
              : createEnvelope(
                  "long.openAtPath",
                  { projectDirectory: selectedPath },
                  { id: command.id, context: command.context }
                )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongOpenBookResultSchema.parse(result.payload)
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.forward_failed",
              message:
                error instanceof Error ? error.message : "长篇目录操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "long.chooseContinuationImportSource") {
        try {
          const selection = await dialog.showOpenDialog(mainWindow, {
            title: nativeText("chooseContinuation"),
            defaultPath: app.getPath("documents"),
            buttonLabel: nativeText("scanChapters"),
            properties: ["openDirectory"]
          });
          const sourcePath = selection.filePaths[0];
          if (selection.canceled || !sourcePath) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.previewContinuationImportAtPath",
              { sourcePath },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          const preview = LongPreviewContinuationImportAtPathResultSchema.parse(
            result.payload
          );
          const { previewId, expiresAt } = continuationImportPreviews.register({
            webContentsId: event.sender.id,
            sourcePath,
            sourceFingerprint: preview.sourceFingerprint
          });
          const { sourceFingerprint: _sourceFingerprint, ...publicPreview } =
            preview;
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongChooseContinuationImportSourceResultSchema.parse({
              ...publicPreview,
              previewId,
              expiresAt: new Date(expiresAt).toISOString()
            })
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.preview_continuation_import_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "扫描续写章节文件夹失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "long.chooseLegacySyncSource") {
        try {
          const selection = await dialog.showOpenDialog(mainWindow, {
            title: nativeText("chooseLegacyLong"),
            defaultPath: app.getPath("documents"),
            buttonLabel: nativeText("uploadPreview"),
            filters: [
              { name: nativeText("legacyLongArchive"), extensions: ["zip"] }
            ],
            properties: ["openFile"]
          });
          const sourcePath = selection.filePaths[0];
          if (selection.canceled || !sourcePath) {
            return { status: "accepted", requestId: command.id, payload: null };
          }
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.previewLegacySyncAtPath",
              { sourcePath },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          const preview = LongPreviewLegacySyncAtPathResultSchema.parse(
            result.payload
          );
          const { previewId, expiresAt } = legacySyncPreviews.register({
            webContentsId: event.sender.id,
            sourcePath,
            sourceFingerprint: preview.sourceFingerprint
          });
          const { sourceFingerprint: _fingerprint, ...publicPreview } = preview;
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongChooseLegacySyncSourceResultSchema.parse({
              ...publicPreview,
              previewId,
              expiresAt: new Date(expiresAt).toISOString()
            })
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.preview_legacy_sync_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "读取旧版本压缩包失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "long.applyLegacySync") {
        try {
          const registration = legacySyncPreviews.resolve(
            command.payload.previewId,
            event.sender.id
          );
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.applyLegacySyncAtPath",
              {
                bookId: command.payload.bookId,
                modules: command.payload.modules,
                sourcePath: registration.sourcePath,
                expectedFingerprint: registration.sourceFingerprint
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          legacySyncPreviews.consume(command.payload.previewId);
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongApplyLegacySyncResultSchema.parse(result.payload)
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.apply_legacy_sync_failed",
              message:
                error instanceof Error ? error.message : "同步旧版本失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "long.importContinuation") {
        try {
          const registration = continuationImportPreviews.resolve(
            command.payload.previewId,
            event.sender.id
          );
          const workspaceDirectory = await requireSelectedWorkspaceDirectory();
          if (!workspaceDirectory) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.importContinuationAtPath",
              {
                parentDirectory: workspaceResourceParent(
                  workspaceDirectory,
                  "book"
                ),
                sourcePath: registration.sourcePath,
                expectedFingerprint: registration.sourceFingerprint,
                title: command.payload.title,
                genre: command.payload.genre
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          continuationImportPreviews.consume(command.payload.previewId);
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongImportContinuationResultSchema.parse(result.payload)
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.import_continuation_failed",
              message:
                error instanceof Error ? error.message : "续写导入失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "long.importPortable") {
        try {
          const workspaceDirectory = await requireSelectedWorkspaceDirectory();
          if (!workspaceDirectory) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          const selection = await dialog.showOpenDialog(mainWindow, {
            title: nativeText("importPortableLong"),
            defaultPath: app.getPath("documents"),
            buttonLabel: nativeText("selectImport"),
            filters: [
              {
                name: nativeText("portableLongProject"),
                extensions: ["json"]
              }
            ],
            properties: ["openFile"]
          });
          const sourcePath = selection.filePaths[0];
          if (selection.canceled || !sourcePath) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.importPortableAtPath",
              {
                parentDirectory: workspaceResourceParent(
                  workspaceDirectory,
                  "book"
                ),
                sourcePath
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") return result;
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongImportPortableResultSchema.parse(result.payload)
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.import_portable_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "导入长篇可移植工程失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const libraryPackageResult = await handleLibraryPackageCommands(
        {
          supervisor,
          window: mainWindow,
          dialog,
          documentsPath: app.getPath("documents"),
          appVersion: app.getVersion(),
          webContentsId: event.sender.id,
          previews: libraryPackagePreviews,
          requireSelectedWorkspaceDirectory
        },
        command
      );
      if (libraryPackageResult) return libraryPackageResult;

      const catalogProjectContext = {
        requireSelectedWorkspaceDirectory,
        workspaceGroupParent,
        workspaceResourceParent,
        dialog,
        supervisor
      };
      const templateResult = await handleBookTemplateCommands(
        catalogProjectContext,
        command
      );
      if (templateResult) return templateResult;
      const catalogProjectResult = await handleCatalogProjectCommands(
        catalogProjectContext,
        command
      );
      if (catalogProjectResult) return catalogProjectResult;

      if (
        command.type === "long.list" ||
        command.type === "long.open" ||
        command.type === "long.duplicateBook" ||
        command.type === "long.rename" ||
        command.type === "long.updateBindings" ||
        command.type === "long.getWorkspaceIndex" ||
        command.type === "long.readDocument" ||
        command.type === "long.readAgentsMd" ||
        command.type === "long.search" ||
        command.type === "long.writeDocument" ||
        command.type === "long.writeAgentsMd" ||
        command.type === "long.previewOperations" ||
        command.type === "long.applyOperations" ||
        command.type === "long.writeChapter" ||
        command.type === "long.commitChapter" ||
        command.type === "long.deleteLedgerCommit" ||
        command.type === "long.unregister" ||
        command.type === "long.delete"
      ) {
        try {
          const result = await supervisor.requestCommand("core", command, 0);
          if (result.status === "rejected") return result;
          let payload: unknown;
          switch (command.type) {
            case "long.list":
              payload = LongListBooksResultSchema.parse(result.payload);
              break;
            case "long.open":
            case "long.duplicateBook":
            case "long.rename":
            case "long.updateBindings":
              payload = LongOpenBookResultSchema.parse(result.payload);
              break;
            case "long.getWorkspaceIndex":
              payload = LongWorkspaceIndexResultSchema.parse(result.payload);
              break;
            case "long.readDocument":
              payload = LongReadDocumentResultSchema.parse(result.payload);
              break;
            case "long.readAgentsMd":
              payload = LongReadAgentsMdResultSchema.parse(result.payload);
              break;
            case "long.search":
              payload = LongSearchResultSchema.parse(result.payload);
              break;
            case "long.writeDocument":
              payload = LongWriteDocumentResultSchema.parse(result.payload);
              break;
            case "long.writeAgentsMd":
              payload = LongWriteAgentsMdResultSchema.parse(result.payload);
              break;
            case "long.previewOperations":
              payload = LongPreviewOperationsResultSchema.parse(result.payload);
              break;
            case "long.applyOperations":
              payload = LongApplyOperationsResultSchema.parse(result.payload);
              break;
            case "long.writeChapter":
              payload = LongWriteChapterResultSchema.parse(result.payload);
              break;
            case "long.commitChapter":
              payload = LongCommitChapterResultSchema.parse(result.payload);
              break;
            case "long.deleteLedgerCommit":
              payload = LongDeleteLedgerCommitResultSchema.parse(
                result.payload
              );
              break;
            case "long.unregister":
            case "long.delete":
              payload = LongRemoveBookResultSchema.parse(result.payload);
              break;
          }
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long.forward_failed",
              message:
                error instanceof Error ? error.message : "长篇操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "catalog.chooseExternalLibraryEntries") {
        try {
          const selection =
            command.payload.sourceKind === "directory"
              ? mainWindow
                ? await dialog.showOpenDialog(mainWindow, {
                    title: nativeText("chooseLibraryFolder"),
                    properties: ["openDirectory"]
                  })
                : await dialog.showOpenDialog({
                    title: nativeText("chooseLibraryFolder"),
                    properties: ["openDirectory"]
                  })
              : mainWindow
                ? await dialog.showOpenDialog(mainWindow, {
                    title: nativeText("chooseLibraryFile"),
                    properties: ["openFile", "multiSelections"],
                    filters: [
                      {
                        name: nativeText("documents"),
                        extensions: [
                          "txt",
                          "md",
                          "markdown",
                          "doc",
                          "docx",
                          "pdf"
                        ]
                      }
                    ]
                  })
                : await dialog.showOpenDialog({
                    title: nativeText("chooseLibraryFile"),
                    properties: ["openFile", "multiSelections"],
                    filters: [
                      {
                        name: nativeText("documents"),
                        extensions: [
                          "txt",
                          "md",
                          "markdown",
                          "doc",
                          "docx",
                          "pdf"
                        ]
                      }
                    ]
                  });
          if (selection.canceled || selection.filePaths.length === 0) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: null
            };
          }
          return {
            status: "accepted",
            requestId: command.id,
            payload: ExternalLibrarySelectionResultSchema.parse(
              await readExternalLibraryEntries(
                command.payload.sourceKind,
                selection.filePaths
              )
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "catalog.choose_external_library_entries_failed",
              message:
                error instanceof Error ? error.message : "读取外部资料失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const rendererFlushResult = rendererStateFlush.handleCommand(
        event.sender.id,
        command
      );
      if (rendererFlushResult) return rendererFlushResult;

      const rendererStateResult = await handleRendererStateCommands(
        { supervisor, activeRuns },
        command
      );
      if (rendererStateResult) return rendererStateResult;
      const conversationExportResult = await handleConversationExportCommands(
        {
          supervisor,
          dialog,
          getMainWindow: requireMainWindow,
          senderWebContentsId: event.sender.id
        },
        command
      );
      if (conversationExportResult) return conversationExportResult;

      if (
        command.type === "catalog.index" ||
        command.type === "catalog.readDocument" ||
        command.type === "catalog.readWritingContext" ||
        command.type === "catalog.writeWritingContext" ||
        command.type === "catalog.snapshot" ||
        command.type === "catalog.loadDraftRecovery" ||
        command.type === "catalog.saveDraftRecovery" ||
        command.type === "catalog.updateBook" ||
        command.type === "catalog.mutateCharacterStructure" ||
        command.type === "catalog.mutatePlotStructure" ||
        command.type === "catalog.updateLibraryGroup" ||
        command.type === "catalog.updateLibrary" ||
        command.type === "catalog.deleteBook" ||
        command.type === "catalog.saveDocument" ||
        command.type === "catalog.createDraftSection" ||
        command.type === "catalog.createDraftSections" ||
        command.type === "catalog.deleteDraftSection" ||
        command.type === "catalog.moveDraftSection" ||
        command.type === "catalog.saveLibraryEntry" ||
        command.type === "catalog.createLibraryEntry" ||
        command.type === "catalog.importLibraryEntries" ||
        command.type === "catalog.removeLibraryEntry" ||
        command.type === "catalog.moveLibraryEntry" ||
        command.type === "catalog.unregisterProject" ||
        command.type === "catalog.deleteProject" ||
        command.type === "catalog.duplicateProject"
      ) {
        try {
          const result = await supervisor.requestCommand(
            "core",
            command,
            catalogCommandTimeoutMs(command.type)
          );
          if (result.status === "rejected") {
            return result;
          }
          let payload: unknown;
          switch (command.type) {
            case "catalog.index":
              payload = CatalogIndexSnapshotSchema.parse(result.payload);
              break;
            case "catalog.readDocument":
              payload = CatalogReadDocumentResultSchema.parse(result.payload);
              break;
            case "catalog.readWritingContext":
              payload = ReadWritingContextResultSchema.parse(result.payload);
              break;
            case "catalog.writeWritingContext":
              payload = WriteWritingContextResultSchema.parse(result.payload);
              break;
            case "catalog.snapshot":
              payload = CatalogSnapshotSchema.parse(result.payload);
              break;
            case "catalog.loadDraftRecovery":
              payload = CatalogDraftRecoverySchema.parse(result.payload);
              break;
            case "catalog.saveDraftRecovery":
              payload = CatalogDraftRecoverySaveResultSchema.parse(
                result.payload
              );
              break;
            case "catalog.deleteBook":
              payload = DeleteBookResultSchema.parse(result.payload);
              break;
            case "catalog.saveDocument":
              payload = SaveDocumentResultSchema.parse(result.payload);
              break;
            case "catalog.createDraftSection":
              payload = CatalogDraftSectionSchema.parse(result.payload);
              break;
            case "catalog.createDraftSections":
              payload = CreateDraftSectionsResultSchema.parse(result.payload);
              break;
            case "catalog.deleteDraftSection":
              payload = DeleteDraftSectionResultSchema.parse(result.payload);
              break;
            case "catalog.moveDraftSection":
              payload = MoveDraftSectionResultSchema.parse(result.payload);
              break;
            case "catalog.saveLibraryEntry":
            case "catalog.createLibraryEntry":
              payload = CatalogLibraryEntrySchema.parse(result.payload);
              break;
            case "catalog.importLibraryEntries":
              payload = ImportLibraryEntriesResultSchema.parse(result.payload);
              break;
            case "catalog.removeLibraryEntry":
              payload = RemoveLibraryEntryResultSchema.parse(result.payload);
              break;
            case "catalog.moveLibraryEntry":
              payload = MoveLibraryEntryResultSchema.parse(result.payload);
              break;
            case "catalog.updateLibrary":
              payload = CatalogLibrarySchema.parse(result.payload);
              break;
            case "catalog.unregisterProject":
              payload = UnregisterCatalogProjectResultSchema.parse(
                result.payload
              );
              break;
            case "catalog.deleteProject":
              payload = DeleteCatalogProjectResultSchema.parse(result.payload);
              break;
            case "catalog.duplicateProject":
              payload = DuplicateCatalogProjectResultSchema.parse(
                result.payload
              );
              break;
            case "catalog.updateBook":
            case "catalog.mutateCharacterStructure":
            case "catalog.mutatePlotStructure":
              payload = BookSchema.parse(result.payload);
              break;
            case "catalog.updateLibraryGroup":
              payload = CatalogLibraryGroupSchema.parse(result.payload);
              break;
          }
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          const timedOut = error instanceof UtilityCommandTimeoutError;
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: timedOut
                ? "catalog.command_timeout"
                : "catalog.forward_failed",
              message: timedOut
                ? catalogCommandTimeoutMessage(command.type)
                : error instanceof Error
                  ? error.message
                  : "目录操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const modelCommandResult = await handleModelCommands(
        {
          requireModelConfigStore,
          requireModelUsageStore,
          listRemoteModels: (input) =>
            listRemoteModels(
              input,
              cachedGeneralSettings.useNetworkProxy
                ? fetch
                : electronRemoteFetch
            ),
          remoteFetch: cachedGeneralSettings.useNetworkProxy
            ? fetch
            : electronRemoteFetch,
          supervisor
        },
        command
      );
      if (modelCommandResult) {
        return modelCommandResult;
      }

      if (command.type === "workspaceAgents.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: WorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().list(
                command.payload.workspaceType
              )
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.list_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "加载创作空间智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const teamResult = await handleAgentTeamCommands(
        {
          requireAgentTeamConfigStore,
          getMainWindow: () => mainWindow,
          dialog,
          getDocumentsPath: () => app.getPath("documents")
        },
        command
      );
      if (teamResult) return teamResult;
      if (command.type === "workspaceAgents.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: WorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.save_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "保存创作空间智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "workspaceAgents.reset") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: WorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().reset(
                command.payload.workspaceType,
                command.payload.agentId
              )
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.reset_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "恢复创作空间默认设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "longAgents.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongAgentSettingsSchema.parse(
              await requireLongAgentConfigStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long_agents.list_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "加载长篇智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "longAgents.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongAgentSettingsSchema.parse(
              await requireLongAgentConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long_agents.save_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "保存长篇智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "longAgents.reset") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LongAgentSettingsSchema.parse(
              await requireLongAgentConfigStore().reset(command.payload.agentId)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long_agents.reset_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "恢复长篇智能体默认设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "libraryAgents.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LibraryAgentSettingsSchema.parse(
              await requireLibraryAgentConfigStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "library_agents.list_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "加载资料库智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "libraryAgents.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LibraryAgentSettingsSchema.parse(
              await requireLibraryAgentConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "library_agents.save_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "保存资料库智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "libraryAgents.reset") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LibraryAgentSettingsSchema.parse(
              await requireLibraryAgentConfigStore().reset(
                command.payload.domain
              )
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "library_agents.reset_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "恢复资料库智能体默认设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      const sessionResult = await handleSessionCommands(
        {
          activeRuns,
          supervisor,
          pendingUsageContexts,
          terminalRuns,
          requireModelConfigStore,
          requireWorkspaceAgentConfigStore,
          requireLongAgentConfigStore,
          requireAgentTeamConfigStore,
          requireLibraryAgentConfigStore,
          requireGeneralSettingsStore
        },
        command
      );
      if (sessionResult) return sessionResult;

      throw new Error("Unreachable command variant after schema validation.");
    }
  );
}

async function announceReady(window: BrowserWindow): Promise<void> {
  const health = SystemHealthPayloadSchema.parse(
    await supervisor.collectHealth()
  );
  const event = SystemReadyEventEnvelopeSchema.parse(
    createEnvelope("system.ready", health, { id: createId("evt_ready") })
  ) as SystemEventEnvelope;
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_EVENT_CHANNEL, event);
  }

  if (process.env.DEEPWRITE_STORAGE_SMOKE) {
    try {
      console.log(
        `DEEPWRITE_STORAGE_SMOKE_OK ${JSON.stringify(await runStorageSmoke(window))}`
      );
    } catch (error) {
      console.error(
        `DEEPWRITE_STORAGE_SMOKE_FAIL ${error instanceof Error ? error.message : "unknown"}`
      );
    } finally {
      app.quit();
    }
    return;
  }
  if (process.env.DEEPWRITE_SMOKE === "1") {
    try {
      await runApplicationSmoke(health, supervisor, window, (tap) => {
        smokeEventTap = tap;
      });
    } catch (error: unknown) {
      console.error(
        `DEEPWRITE_SMOKE_FAIL ${error instanceof Error ? error.message : "unknown"}`
      );
    } finally {
      app.quit();
    }
  }
}

applyNetworkProxyPreference(false);

if (!hasSingleInstanceLock) {
  shutdownComplete = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindowStartupGate.requestShow();
  });

  void desktopStartup.run(async () => {
    await app.whenReady();
    setNativeLanguage("auto", app.getLocale());
    Menu.setApplicationMenu(null);
    const userDataPath = configureBootstrapEnvironment(
      app,
      import.meta.env.MAIN_VITE_DEEPWRITE_APP_MODE
    );
    const services = await desktopStartup.step("services", () =>
      createDesktopServices({
        userDataPath,
        appVersion: app.getVersion(),
        command: (command) => supervisor.requestCommand("core", command, 0),
        busy: () => activeRuns.size > 0,
        installUpdate: () => beginGracefulShutdown({ installUpdate: true })
      })
    );
    ({
      modelConfigStore,
      modelUsageStore,
      softwareTokenUsageReporter,
      workspaceAgentConfigStore,
      agentTeamConfigStore,
      libraryAgentConfigStore,
      longAgentConfigStore,
      extrasAgentService,
      workspaceDirectoryStore,
      appearanceService,
      generalSettingsStore,
      voiceService,
      imageService,
      coverRenderService,
      updateService,
      appAlertStore,
      cloudBackupService,
      deviceSyncService,
      marketplaceClient,
      agentTeamMarketplaceClient
    } = services);
    storageSettingsService = createStorageSettingsService({
      locations: storageBootstrap!.locations,
      workspace: requireWorkspaceDirectoryStore,
      getWindow: requireMainWindow,
      busy: () =>
        quitting || activeRuns.size > 0 || pendingUsageContexts.size > 0,
      flushRenderer: () => rendererStateFlush.request(mainWindow),
      restart: () => {
        quitting = true;
        setImmediate(() => beginGracefulShutdown());
      }
    });
    if (storageBootstrap?.migrationError) {
      void dialog.showMessageBox({
        type: "warning",
        title: nativeText("migrationIncomplete"),
        message: storageBootstrap.migrationError
      });
    }
    installAppearanceFontProtocolHandler(appearanceService);
    installCoverProtocolHandler((command) =>
      supervisor.requestCommand("core", command, 0)
    );
    await desktopStartup.step("workspace", async () => {
      const store = services.workspaceDirectoryStore;
      const rejected = await store.rejectedPath();
      const current = await store.initializeDefault(app.getPath("documents"));
      if (rejected && current.path) {
        void dialog.showMessageBox({
          type: "warning",
          title: nativeText("workspaceRejected"),
          message: nativeText("workspaceRejected"),
          detail: nativeMessages().workspaceRejectedDetails(
            rejected,
            current.path
          )
        });
      }
    });
    await desktopStartup.step("appearance", loadAndSyncNativeAppearanceChrome);
    await desktopStartup.step("settings", async () => {
      syncGeneralSettings(
        (await services.generalSettingsStore.list()).settings
      );
    });
    refreshDesktopServices(services, desktopStartup.log);
    updateService.subscribe((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(UPDATE_STATE_EVENT_CHANNEL, state);
      }
    });
    await desktopStartup.step("utilities", () => {
      registerIpc();
      supervisor.startAll();
      utilitiesStarted = true;
    });
    await desktopStartup.step("window", () => {
      mainWindow = createMainWindow();
    });
    mainWindowStartupGate.markReady();

    app.on("activate", () => {
      showMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownComplete) {
    return;
  }
  event.preventDefault();
  beginGracefulShutdown();
});
