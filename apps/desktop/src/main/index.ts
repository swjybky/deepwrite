import {
  handleConversationExportCommands,
  disposeConversationExports
} from "./ipc/conversation-export-commands";
import { acquireConversationOperation } from "./ipc/conversation-operation-guard";
import { createRendererStateFlushCoordinator } from "./renderer-state-flush";
import { createGracefulShutdown } from "./graceful-shutdown";
import { guardConversationWindowClose } from "./conversation-window-close";
import { createCloudBackupFeature } from "../extras/cloud-backup/create-service";
import { loadWindowRenderer } from "./window-renderer";
import {
  createDesktopDeviceSync,
  registerDeviceSyncIpc
} from "../extras/device-sync";
import { handleRendererStateCommands } from "./ipc/renderer-state-commands";
import { handleAgentTeamCommands } from "./ipc/agent-team-commands";
import { prepareLibraryManagementRunContext } from "./library-management-run-context";
import { prepareMaterialRunContext } from "./material-run-context";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell
} from "electron";
import { createHash } from "node:crypto";
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
  CatalogOpenProjectResultSchema,
  APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
  APP_ALERT_GET_CHANNEL,
  AppAlertDesktopRevisionSchema,
  AppAlertSnapshotSchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentResultSchema,
  ReadWritingContextResultSchema,
  CatalogSnapshotSchema,
  ChatAssistantProjectConfigSchema,
  ChatAssistantProjectConfigListSchema,
  ChatAssistantRuntimeContextSchema,
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
  LearningImitationSettingsSchema,
  MARKETPLACE_IPC_CHANNEL,
  MarketplaceIpcRequestSchema,
  CatalogInstallMarketplaceSkillContentResultSchema,
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
  ModelSettingsSchema,
  ModelUsageDashboardSchema,
  RemoveLibraryEntryResultSchema,
  MoveLibraryEntryResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  ScriptBookSchema,
  ShortBookSchema,
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
  type AgentProviderRuntimeConfig,
  type AgentRuntimeRef,
  type AppearanceSettings,
  type AppAlertSnapshot,
  type CommandResult,
  type GeneralSettings,
  type ChatAssistantRuntimeContext,
  type ModelUsageModelSnapshot,
  type ModelUsageModule,
  type SessionPromptCommandPayload,
  type SystemEventEnvelope,
  type UpdateState,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";
import {
  LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES,
  importLegacyLibraryArchives
} from "./legacy-library-import-batch";
import { AppearanceService } from "./appearance-service";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { resolveAgentTeamRuntime } from "./agent-team-run-mode";

import { GeneralSettingsStore } from "./general-settings-store";
import { ChatAssistantProjectConfigStore } from "./chat-assistant-project-config-store";
import { ModelConfigStore } from "./model-config-store";
import { electronRemoteFetch } from "./electron-remote-fetch";
import { applyNetworkProxyPreference } from "./network-proxy-preference";
import { listRemoteModels } from "./list-remote-models";
import {
  createModelUsageRevisionId,
  ModelUsageStore
} from "./model-usage-store";
import { SoftwareTokenUsageReporter } from "./software-token-usage-reporter";
import { LearningImitationConfigStore } from "./learning-imitation-config-store";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import { LongAgentConfigStore } from "./long-agent-config-store";
import { resolveModelRunSettings } from "./model-run-settings";
import {
  applyNativeAppearanceChrome,
  resolveNativeBackgroundColor
} from "./native-appearance-chrome";
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
import { LegacySyncPreviewRegistry } from "./legacy-sync-preview-registry";
import { readExternalLibraryEntries } from "./external-library-import";
import { createMainWindowStartupGate } from "./main-window-startup-gate";
import { configureBootstrapEnvironment } from "./bootstrap-environment";
import { handleModelCommands } from "./ipc/model-commands";
import { handleAppearanceCommands } from "./ipc/appearance-commands";
import { LongBookAnalysisConfigStore } from "./extras/long-book-analysis/config-store";
import { handleLongBookAnalysisCommands } from "./extras/long-book-analysis/commands";
import {
  installAppearanceFontProtocolHandler,
  registerAppearanceFontScheme
} from "./appearance-font-protocol";

registerAppearanceFontScheme();

interface ActiveRun extends MainInternalCommandActiveRun {
  correlationId: string;
  runtime: AgentRuntimeRef;
  usageContext?: UsageRunContext;
}

interface UsageRunContext {
  module: ModelUsageModule;
  snapshotsByConfigId: ReadonlyMap<string, ModelUsageModelSnapshot>;
  snapshotsByRuntime: ReadonlyMap<string, ModelUsageModelSnapshot>;
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
let chatAssistantProjectConfigStore:
  ChatAssistantProjectConfigStore | undefined;
let learningImitationConfigStore: LearningImitationConfigStore | undefined;
let longBookAnalysisConfigStore: LongBookAnalysisConfigStore | undefined;
let libraryAgentConfigStore: LibraryAgentConfigStore | undefined;
let longAgentConfigStore: LongAgentConfigStore | undefined;
let cachedAppearanceSettings: AppearanceSettings =
  createDefaultAppearanceSettings();
let cachedGeneralSettings: GeneralSettings = createDefaultGeneralSettings();
let utilitiesStarted = false;
let nativeAppearanceListenerBound = false;
let workspaceAgentConfigStore: WorkspaceAgentConfigStore | undefined;
let workspaceDirectoryStore: WorkspaceDirectoryStore | undefined;
let quitting = false;
let shutdownComplete = false;
let menuBarTray: Tray | undefined;
let updateService: UpdateService | undefined;
let appAlertStore: AppAlertStore | undefined;
let marketplaceClient: MarketplaceClient | undefined;
let cloudBackupService: CloudBackupService | undefined;
let deviceSyncService: ReturnType<typeof createDesktopDeviceSync> | undefined;
const rendererStateFlush = createRendererStateFlushCoordinator();
const continuationImportPreviews = new ContinuationImportPreviewRegistry();
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
    else app.quit();
  },
  cancel(error) {
    quitting = false;
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
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.usage_observed"
      | "agent.error"
      | "agent.user_input_requested"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "learning_imitation.result_updated"
      | "long_book_analysis.note_updated"
      | "long_book_analysis.result_updated"
      | "subagent_authoring.draft_updated"
      | "library.editor_mutation"
      | "workspace.editor_mutation"
      | "workspace.stage_selection"
      | "long.mutation_proposal"
      | "long.chapter_write_proposal"
      | "long.ledger_commit_proposal"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
>;

function isAgentEvent(event: SystemEventEnvelope): event is AgentEventEnvelope {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.usage_observed" ||
    event.type === "agent.error" ||
    event.type === "agent.user_input_requested" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "learning_imitation.result_updated" ||
    event.type === "long_book_analysis.note_updated" ||
    event.type === "long_book_analysis.result_updated" ||
    event.type === "subagent_authoring.draft_updated" ||
    event.type === "library.editor_mutation" ||
    event.type === "workspace.editor_mutation" ||
    event.type === "workspace.stage_selection" ||
    event.type === "long.mutation_proposal" ||
    event.type === "long.chapter_write_proposal" ||
    event.type === "long.ledger_commit_proposal" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
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

function recordUsageObservation(
  event: Extract<SystemEventEnvelope, { type: "agent.usage_observed" }>
): void {
  if (!modelUsageStore || event.payload.runtime.mode === "local-faux") return;
  const activeRun = activeRuns.get(event.payload.runId);
  const usageContext =
    activeRun?.usageContext ??
    pendingUsageContexts.get(event.context.correlationId);
  const snapshot = usageSnapshotForRuntime(usageContext, event.payload.runtime);
  void modelUsageStore
    .record({
      id: `v2:${event.payload.observationId}`,
      occurredAt: event.payload.observedAt,
      model: snapshot,
      module: usageContext?.module ?? "unknown",
      actor: event.payload.subagentRunId ? "subagent" : "main-agent",
      status: event.payload.status,
      usage: event.payload.usage
    })
    .catch((error: unknown) => {
      console.warn(
        "DeepWrite model usage record was not persisted:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
}

function handleUtilityEvent(
  event: SystemEventEnvelope,
  worker: UtilityWorkerName
): void {
  if (isAgentEvent(event) && worker !== "agent") {
    return;
  }

  const validated = SystemEventEnvelopeSchema.parse(
    event
  ) as SystemEventEnvelope;
  if (validated.type === "agent.usage_observed") {
    recordUsageObservation(validated);
    return;
  }
  if (isAgentEvent(validated)) {
    const runId = validated.payload.runId;
    if (
      validated.type === "agent.message_completed" ||
      validated.type === "agent.error"
    ) {
      const activeRun = activeRuns.get(runId);
      rememberTerminalRun(runId);
      activeRuns.delete(runId);
      pendingUsageContexts.delete(
        activeRun?.correlationId ?? validated.context.correlationId
      );
    } else if (!terminalRuns.has(runId) && !activeRuns.has(runId)) {
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

const supervisor = new UtilitySupervisor({
  onUtilityEvent: handleUtilityEvent,
  onUnexpectedExit: handleUnexpectedExit,
  onWorkerRestarted: handleWorkerRestarted,
  internalCommandAllowlist: {
    core: AGENT_CORE_QUERY_COMMANDS
  },
  internalCommandAuthorize: (context) =>
    authorizeMainInternalCommand(context, activeRuns)
});

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

const ZHUQUE_DETECTION_ORIGIN = "https://matrix.tencent.com";

function isAllowedZhuqueDetectionUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === ZHUQUE_DETECTION_ORIGIN;
  } catch {
    return false;
  }
}

function createMainWindow(): BrowserWindow {
  const isDarwin = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: resolveNativeBackgroundColor(cachedAppearanceSettings),
    title: "DeepWrite",
    icon: join(__dirname, "../../build/icon.png"),
    ...(isDarwin
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 10 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true
    }
  });
  const windowWebContentsId = window.webContents.id;

  applyNativeAppearanceChrome(cachedAppearanceSettings, [window]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (
        typeof params.src !== "string" ||
        !isAllowedZhuqueDetectionUrl(params.src)
      ) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    }
  );

  window.webContents.on("did-attach-webview", (_event, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
    guestContents.on("will-navigate", (event, url) => {
      if (isAllowedZhuqueDetectionUrl(url)) return;
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    });
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  if (process.env.DEEPWRITE_SMOKE !== "1") {
    window.once("ready-to-show", () => window.show());
  }

  void loadWindowRenderer(
    window,
    join(__dirname, "../renderer/index.html"),
    process.env.ELECTRON_RENDERER_URL
  ).catch((error: unknown) => console.error("加载工作台失败", error));

  window.webContents.once("did-finish-load", () => void announceReady(window));
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
    rendererStateFlush.reset(windowWebContentsId);
    void disposeConversationExports({
      supervisor,
      dialog,
      getMainWindow: requireMainWindow,
      senderWebContentsId: windowWebContentsId
    });
    continuationImportPreviews.clearForWebContents(windowWebContentsId);
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
  if (menuBarTray && !menuBarTray.isDestroyed()) {
    return;
  }

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
  menuBarTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 DeepWrite",
        click: showMainWindow
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
  menuBarTray.on("click", showMainWindow);
}

function syncGeneralSettings(settings: GeneralSettings): void {
  const shouldRestartAgent =
    utilitiesStarted &&
    cachedGeneralSettings.useNetworkProxy !== settings.useNetworkProxy;
  cachedGeneralSettings = settings;
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

function requireChatAssistantProjectConfigStore(): ChatAssistantProjectConfigStore {
  if (!chatAssistantProjectConfigStore) {
    throw new Error("聊天助手项目配置存储尚未初始化。");
  }
  return chatAssistantProjectConfigStore;
}

async function requireCorePayload(
  supervisor: UtilitySupervisor,
  type: "catalog.index" | "catalog.snapshot" | "long.list",
  schema: { parse(value: unknown): unknown }
): Promise<unknown> {
  const id = createId(`cmd_chat_assistant_${type.replaceAll(".", "_")}`);
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(type, {}, { id, correlationId: id })
  );
  const result = await supervisor.requestCommand("core", command, 60_000);
  if (result.status === "rejected") {
    throw new Error(result.error.message);
  }
  return schema.parse(result.payload);
}

function chatAssistantUsageStart(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (days > 1) date.setDate(date.getDate() - (days - 1));
  return date.toISOString();
}

async function resolveChatAssistantRuntimeContext(
  supervisor: UtilitySupervisor,
  payload: SessionPromptCommandPayload
): Promise<ChatAssistantRuntimeContext> {
  const request = payload.chatAssistant ?? { mode: "normal" as const };
  const [catalog, longList, settings, today, sevenDays, thirtyDays, all] =
    await Promise.all([
      requireCorePayload(
        supervisor,
        "catalog.index",
        CatalogIndexSnapshotSchema
      ),
      requireCorePayload(supervisor, "long.list", LongListBooksResultSchema),
      requireModelConfigStore().list(),
      requireModelUsageStore().query({ startAt: chatAssistantUsageStart(1) }),
      requireModelUsageStore().query({ startAt: chatAssistantUsageStart(7) }),
      requireModelUsageStore().query({ startAt: chatAssistantUsageStart(30) }),
      requireModelUsageStore().query()
    ]);
  const modelSettings = ModelSettingsSchema.parse(settings);
  const base = {
    software: {
      name: "DeepWrite" as const,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      currentTime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    },
    catalog: CatalogIndexSnapshotSchema.parse(catalog),
    longBooks: LongListBooksResultSchema.parse(longList).books,
    models: modelSettings.models.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      modelId: model.modelId,
      api: model.api,
      reasoning: model.reasoning,
      defaultThinkingLevel: model.defaultThinkingLevel,
      thinkingLevelOptions: model.thinkingLevelOptions,
      temperatureOptions: model.temperatureOptions,
      credentialConfigured: model.hasApiKey,
      ...(model.managedBy ? { managedBy: model.managedBy } : {}),
      ...(model.status !== undefined ? { status: model.status } : {}),
      ...(model.discount !== undefined ? { discount: model.discount } : {}),
      ...(model.input !== undefined ? { input: model.input } : {}),
      ...(model.output !== undefined ? { output: model.output } : {}),
      ...(model.cache !== undefined ? { cache: model.cache } : {})
    })),
    defaultModelId: modelSettings.defaultModelId,
    usage: {
      today: ModelUsageDashboardSchema.parse(today),
      "7d": ModelUsageDashboardSchema.parse(sevenDays),
      "30d": ModelUsageDashboardSchema.parse(thirtyDays),
      all: ModelUsageDashboardSchema.parse(all)
    }
  };
  if (request.mode === "normal") {
    return ChatAssistantRuntimeContextSchema.parse({ ...base, mode: "normal" });
  }
  const config = await requireChatAssistantProjectConfigStore().get(
    request.project
  );
  if (request.project.projectType === "long") {
    const projectBook = base.longBooks.find(
      (book) => book.id === request.project.projectId
    );
    if (!projectBook)
      throw new Error("所选长篇项目不存在或暂时不可用，请刷新后重试。");
    return ChatAssistantRuntimeContextSchema.parse({
      ...base,
      mode: "project",
      project: request.project,
      projectPrompt: config.systemPrompt,
      projectBook
    });
  }
  const snapshot = CatalogSnapshotSchema.parse(
    await requireCorePayload(
      supervisor,
      "catalog.snapshot",
      CatalogSnapshotSchema
    )
  );
  const projectBook = snapshot.books.find(
    (book) =>
      book.id === request.project.projectId &&
      book.bookType === request.project.projectType
  );
  if (!projectBook)
    throw new Error("所选创作项目不存在或暂时不可用，请刷新后重试。");
  return ChatAssistantRuntimeContextSchema.parse({
    ...base,
    mode: "project",
    project: request.project,
    projectPrompt: config.systemPrompt,
    projectBook
  });
}

function usageRuntimeKey(
  runtime: Pick<AgentRuntimeRef, "provider" | "model">
): string {
  return `${runtime.provider}\u0000${runtime.model}`;
}

function usageEndpointOrigin(baseUrl: string): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "";
  }
}

function createUsageModelSnapshot(
  runtime: AgentRuntimeRef,
  config?: AgentProviderRuntimeConfig
): ModelUsageModelSnapshot {
  const provider = config?.provider ?? runtime.provider;
  const modelId = config?.modelId ?? runtime.model;
  const api = config?.api;
  const endpointOrigin = config ? usageEndpointOrigin(config.baseUrl) : "";
  const revisionId = config
    ? createModelUsageRevisionId(config)
    : createHash("sha256")
        .update(
          JSON.stringify({ provider, modelId, api: api ?? "", endpointOrigin })
        )
        .digest("hex");
  const configId =
    config?.id ?? runtime.configId ?? `runtime:${provider}:${modelId}`;
  return {
    configId,
    revisionId,
    label: config?.label ?? modelId,
    provider,
    modelId,
    ...(api ? { api } : {}),
    ...(config?.managedBy ? { managedBy: config.managedBy } : {})
  };
}

function usageModuleForPrompt(
  payload: SessionPromptCommandPayload
): ModelUsageModule {
  if (payload.mode === "chat-assistant") return "assistant-chat";
  const context = payload.workspaceContext;
  if (!context) return "unknown";
  if (context.shortWorkspace) return "short-writing";
  if (context.scriptWorkspace) return "script-writing";
  if (context.longWorkspace) return "long-writing";
  if (context.libraryWorkspace) {
    return context.libraryWorkspace.domain === "skill"
      ? "skill-library"
      : "material-library";
  }
  if (context.learningImitation) return "learning-imitation";
  if (context.longBookAnalysis) return "long-book-analysis";
  if (context.subagentAuthoring) return "subagent-authoring";
  return "unknown";
}

function createUsageRunContext(
  payload: SessionPromptCommandPayload,
  runtimeConfig: AgentProviderRuntimeConfig | undefined,
  subagentRuntimeConfigs: Readonly<Record<string, AgentProviderRuntimeConfig>>
): UsageRunContext {
  const snapshotsByConfigId = new Map<string, ModelUsageModelSnapshot>();
  const snapshotsByRuntime = new Map<string, ModelUsageModelSnapshot>();
  const add = (config: AgentProviderRuntimeConfig | undefined): void => {
    if (!config) return;
    const runtime: AgentRuntimeRef = {
      provider: config.provider,
      model: config.modelId,
      mode: "provider",
      configId: config.id
    };
    const snapshot = createUsageModelSnapshot(runtime, config);
    snapshotsByConfigId.set(config.id, snapshot);
    snapshotsByRuntime.set(usageRuntimeKey(runtime), snapshot);
  };
  add(runtimeConfig);
  for (const config of Object.values(subagentRuntimeConfigs)) {
    add(config);
  }
  return {
    module: usageModuleForPrompt(payload),
    snapshotsByConfigId,
    snapshotsByRuntime
  };
}

function usageSnapshotForRuntime(
  context: UsageRunContext | undefined,
  runtime: AgentRuntimeRef
): ModelUsageModelSnapshot {
  const byConfigId = runtime.configId
    ? context?.snapshotsByConfigId.get(runtime.configId)
    : undefined;
  return (
    byConfigId ??
    context?.snapshotsByRuntime.get(usageRuntimeKey(runtime)) ??
    createUsageModelSnapshot(runtime)
  );
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

function requireLearningImitationConfigStore(): LearningImitationConfigStore {
  if (!learningImitationConfigStore) {
    throw new Error("学习仿写设置存储尚未初始化。");
  }
  return learningImitationConfigStore;
}

function requireLongBookAnalysisConfigStore(): LongBookAnalysisConfigStore {
  if (!longBookAnalysisConfigStore) {
    throw new Error("长篇拆书分析设置存储尚未初始化。");
  }
  return longBookAnalysisConfigStore;
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
  } catch {
    syncNativeAppearanceChrome(createDefaultAppearanceSettings());
  }
}

async function chooseWorkspaceDirectory(): Promise<ReturnType<
  typeof WorkspaceDirectorySettingsSchema.parse
> | null> {
  const current = await requireWorkspaceDirectoryStore().list();
  const selection = await dialog.showOpenDialog({
    title: "选择 DeepWrite 工作目录",
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

  ipcMain.handle(
    MARKETPLACE_IPC_CHANNEL,
    async (event, rawRequest: unknown): Promise<unknown> => {
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
      ) {
        throw new Error("技能广场 IPC 请求来源无效。");
      }
      if (!marketplaceClient) {
        throw new Error("技能广场服务尚未初始化。");
      }
      const request = MarketplaceIpcRequestSchema.parse(rawRequest);
      switch (request.operation) {
        case "session":
          return marketplaceClient.session();
        case "register":
          return marketplaceClient.register(request.input);
        case "login":
          return marketplaceClient.login(request.input);
        case "logout":
          return marketplaceClient.logout();
        case "list":
          return marketplaceClient.list(request.filter);
        case "detail":
          return marketplaceClient.detail(request.ref);
        case "listMine":
          return marketplaceClient.listMine(request.filter);
        case "myDetail":
          return marketplaceClient.myDetail(request.ref);
        case "publish":
          return marketplaceClient.publish(request.input);
        case "update":
          return marketplaceClient.update(request.input);
        case "setEnabled":
          return marketplaceClient.setEnabled(request.input);
        case "delete":
          return marketplaceClient.delete(request.ref);
        case "like":
          return marketplaceClient.like(request.input);
        case "previewInstall":
          return marketplaceClient.previewInstall(request.ref);
        case "install":
          return marketplaceClient.install(request.input);
      }
    }
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
        command.type === "deviceSync.workspace" ||
        command.type === "agent.prompt" ||
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
        command.type === "catalog.importLegacyLibraryAtPath" ||
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

      const longBookAnalysisCommandResult =
        await handleLongBookAnalysisCommands(
          {
            dialog,
            getMainWindow: requireMainWindow,
            configStore: requireLongBookAnalysisConfigStore,
            getWorkspaceDirectory: async () =>
              (await requireWorkspaceDirectoryStore().list()).path
          },
          command
        );
      if (longBookAnalysisCommandResult) {
        return longBookAnalysisCommandResult;
      }

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
              title: "打开已有长篇项目",
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
            title: "选择续写章节文件夹",
            defaultPath: app.getPath("documents"),
            buttonLabel: "扫描章节",
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
            title: "选择旧版本长篇压缩包",
            defaultPath: app.getPath("documents"),
            buttonLabel: "上传并预览",
            filters: [{ name: "旧版本长篇压缩包", extensions: ["zip"] }],
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
            title: "导入 DeepWrite 长篇可移植工程",
            defaultPath: app.getPath("documents"),
            buttonLabel: "选择并导入",
            filters: [
              {
                name: "DeepWrite 长篇可移植工程",
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

      if (
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createScriptBook" ||
        command.type === "catalog.createLibrary" ||
        command.type === "catalog.createLibraryGroup" ||
        command.type === "catalog.openProject" ||
        command.type === "catalog.importLegacyLibrary"
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

          const domain =
            command.type === "catalog.createShortBook" ||
            command.type === "catalog.createScriptBook"
              ? "book"
              : command.payload.domain;
          const defaultPath =
            command.type === "catalog.createLibraryGroup"
              ? workspaceGroupParent(workspaceDirectory, command.payload.domain)
              : workspaceResourceParent(workspaceDirectory, domain);
          let selectedPaths: string[];
          if (
            command.type === "catalog.createShortBook" ||
            command.type === "catalog.createScriptBook" ||
            command.type === "catalog.createLibrary" ||
            command.type === "catalog.createLibraryGroup"
          ) {
            selectedPaths = [defaultPath];
          } else {
            const selection = await dialog.showOpenDialog({
              title:
                command.type === "catalog.importLegacyLibrary"
                  ? `导入旧版${domain === "material" ? "素材" : "技能"}库压缩包`
                  : domain === "book"
                    ? "打开已有书籍"
                    : domain === "material"
                      ? "打开已有素材库"
                      : "打开已有技能库",
              defaultPath,
              ...(command.type === "catalog.importLegacyLibrary"
                ? {
                    properties:
                      command.type === "catalog.importLegacyLibrary"
                        ? LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES
                        : (["openFile"] as const),
                    filters: [
                      {
                        name: `旧版${domain === "material" ? "素材" : "技能"}库压缩包`,
                        extensions: ["zip"]
                      }
                    ]
                  }
                : { properties: ["openDirectory"] as const })
            });
            if (selection.canceled || selection.filePaths.length === 0) {
              return {
                status: "accepted",
                requestId: command.id,
                payload: null
              };
            }
            selectedPaths = selection.filePaths;
          }

          const selectedPath = selectedPaths[0]!;

          const internalCommand = CommandEnvelopeSchema.parse(
            command.type === "catalog.createShortBook"
              ? createEnvelope(
                  "catalog.createShortBookAtPath",
                  {
                    parentDirectory: selectedPath,
                    input: command.payload
                  },
                  { id: command.id, context: command.context }
                )
              : command.type === "catalog.createScriptBook"
                ? createEnvelope(
                    "catalog.createScriptBookAtPath",
                    {
                      parentDirectory: selectedPath,
                      input: command.payload
                    },
                    { id: command.id, context: command.context }
                  )
                : command.type === "catalog.createLibrary"
                  ? createEnvelope(
                      "catalog.createLibraryAtPath",
                      {
                        ...command.payload,
                        parentDirectory: selectedPath
                      },
                      { id: command.id, context: command.context }
                    )
                  : command.type === "catalog.createLibraryGroup"
                    ? createEnvelope(
                        "catalog.createLibraryGroupAtPath",
                        {
                          parentDirectory: selectedPath,
                          input: command.payload
                        },
                        { id: command.id, context: command.context }
                      )
                    : command.type === "catalog.openProject"
                      ? createEnvelope(
                          "catalog.openProjectAtPath",
                          {
                            projectDirectory: selectedPath,
                            domain: command.payload.domain
                          },
                          { id: command.id, context: command.context }
                        )
                      : createEnvelope(
                          "catalog.importLegacyLibraryAtPath",
                          {
                            domain: command.payload.domain,
                            archivePath: selectedPath,
                            parentDirectory: defaultPath
                          },
                          { id: command.id, context: command.context }
                        )
          );

          if (command.type === "catalog.importLegacyLibrary") {
            const payload = await importLegacyLibraryArchives(
              selectedPaths,
              async (archivePath, index) => {
                const result = await supervisor.requestCommand(
                  "core",
                  createEnvelope(
                    "catalog.importLegacyLibraryAtPath",
                    {
                      domain: command.payload.domain,
                      archivePath,
                      parentDirectory: defaultPath
                    },
                    {
                      id: `${command.id}_${index + 1}`,
                      context: command.context
                    }
                  ),
                  0
                );
                if (result.status === "rejected") {
                  throw new Error(result.error.message);
                }
                return result.payload;
              }
            );
            return {
              status: "accepted",
              requestId: command.id,
              payload
            };
          }

          const result = await supervisor.requestCommand(
            "core",
            internalCommand,
            0
          );
          if (result.status === "rejected") {
            return result;
          }
          const payload =
            command.type === "catalog.createShortBook"
              ? ShortBookSchema.parse(result.payload)
              : command.type === "catalog.createScriptBook"
                ? ScriptBookSchema.parse(result.payload)
                : command.type === "catalog.createLibrary"
                  ? CatalogLibrarySchema.parse(result.payload)
                  : command.type === "catalog.createLibraryGroup"
                    ? CatalogLibraryGroupSchema.parse(result.payload)
                    : command.type === "catalog.openProject"
                      ? CatalogOpenProjectResultSchema.parse(result.payload)
                      : CatalogLibrarySchema.parse(result.payload);
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "catalog.forward_failed",
              message:
                error instanceof Error ? error.message : "目录操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

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
                    title: "选择包含技能或素材的文件夹",
                    properties: ["openDirectory"]
                  })
                : await dialog.showOpenDialog({
                    title: "选择包含技能或素材的文件夹",
                    properties: ["openDirectory"]
                  })
              : mainWindow
                ? await dialog.showOpenDialog(mainWindow, {
                    title: "选择技能或素材文件",
                    properties: ["openFile", "multiSelections"],
                    filters: [
                      {
                        name: "文本与文档",
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
                    title: "选择技能或素材文件",
                    properties: ["openFile", "multiSelections"],
                    filters: [
                      {
                        name: "文本与文档",
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

      if (command.type === "learningImitationSettings.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LearningImitationSettingsSchema.parse(
              await requireLearningImitationConfigStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "learning_imitation_settings.list_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "加载学习仿写设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "learningImitationSettings.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LearningImitationSettingsSchema.parse(
              await requireLearningImitationConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "learning_imitation_settings.save_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "保存学习仿写设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "learningImitationSettings.reset") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: LearningImitationSettingsSchema.parse(
              await requireLearningImitationConfigStore().reset(
                command.payload.stageId
              )
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "learning_imitation_settings.reset_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "恢复学习仿写默认设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (
        command.type === "chatAssistantProjectConfig.list" ||
        command.type === "chatAssistantProjectConfig.get" ||
        command.type === "chatAssistantProjectConfig.save" ||
        command.type === "chatAssistantProjectConfig.reset"
      ) {
        try {
          const store = requireChatAssistantProjectConfigStore();
          const payload =
            command.type === "chatAssistantProjectConfig.list"
              ? await store.list()
              : command.type === "chatAssistantProjectConfig.get"
                ? await store.get(command.payload)
                : command.type === "chatAssistantProjectConfig.save"
                  ? await store.save(
                      command.payload.project,
                      command.payload.systemPrompt
                    )
                  : await store.reset(command.payload);
          return {
            status: "accepted",
            requestId: command.id,
            payload:
              command.type === "chatAssistantProjectConfig.list"
                ? ChatAssistantProjectConfigListSchema.parse(payload)
                : ChatAssistantProjectConfigSchema.parse(payload)
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "chat_assistant_project_config.failed",
              message:
                error instanceof Error
                  ? error.message
                  : "处理聊天助手项目配置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.user_input_response") {
        try {
          // activeRuns is a Main-side event-stream mirror and can briefly lag
          // the Agent utility that owns the pending question. The Agent is the
          // authoritative validator for this response.
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope("agent.user_input_response", command.payload, {
              id: command.id,
              context: command.context
            })
          );
          const result = await supervisor.requestCommand(
            "agent",
            internalCommand,
            10_000
          );
          if (result.status !== "accepted") return result;
          const accepted = SessionUserInputResponseAcceptedPayloadSchema.parse(
            result.payload
          );
          if (
            accepted.sessionId !== command.payload.sessionId ||
            accepted.runId !== command.payload.runId ||
            accepted.requestId !== command.payload.requestId
          ) {
            return {
              status: "rejected",
              requestId: command.id,
              error: {
                code: "ipc.invalid_agent_user_input_result",
                message: "Agent user-input result does not match the request."
              }
            };
          }
          return {
            status: "accepted",
            requestId: command.id,
            payload: accepted
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_user_input_failed",
              message:
                error instanceof Error ? error.message : "提交用户回答失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.abort") {
        try {
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope("agent.abort", command.payload, {
              id: command.id,
              context: command.context
            })
          );
          const result = await supervisor.requestCommand(
            "agent",
            internalCommand,
            10_000
          );
          if (result.status === "accepted") {
            const accepted = SessionAbortAcceptedPayloadSchema.parse(
              result.payload
            );
            if (
              accepted.sessionId !== command.payload.sessionId ||
              accepted.runId !== command.payload.runId
            ) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_abort_result",
                  message:
                    "Agent abort result does not match the requested run."
                }
              };
            }
            return {
              status: "accepted",
              requestId: command.id,
              payload: accepted
            };
          }
          return result;
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_abort_failed",
              message:
                error instanceof Error ? error.message : "Agent abort failed.",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.prompt") {
        const release = acquireConversationOperation(
          activeRuns,
          command.payload.sessionId,
          "prompt"
        );
        if (!release)
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "conversation_history.busy",
              message: "此对话正在管理历史，请稍后重试。"
            }
          };
        try {
          const runtimeConfig = await requireModelConfigStore().resolve(
            command.payload.modelId
          );
          const chatAssistantRuntimeContext =
            command.payload.mode === "chat-assistant"
              ? await resolveChatAssistantRuntimeContext(
                  supervisor,
                  command.payload
                )
              : undefined;
          const shortWorkspace =
            command.payload.workspaceContext?.shortWorkspace;
          const scriptWorkspace =
            command.payload.workspaceContext?.scriptWorkspace;
          const longWorkspace = command.payload.workspaceContext?.longWorkspace;
          const libraryWorkspace =
            command.payload.workspaceContext?.libraryWorkspace;
          const learningImitation =
            command.payload.workspaceContext?.learningImitation;
          const longBookAnalysis =
            command.payload.workspaceContext?.longBookAnalysis;
          const creativeWorkspace = shortWorkspace ?? scriptWorkspace;
          const creativeWorkspaceType = scriptWorkspace ? "script" : "short";
          const agentProfile = creativeWorkspace
            ? await requireWorkspaceAgentConfigStore().resolveForWorkspace(
                creativeWorkspace,
                creativeWorkspaceType
              )
            : undefined;
          const longAgentProfile = longWorkspace
            ? await requireLongAgentConfigStore().resolve(
                longWorkspace.activeAgentId
              )
            : undefined;
          const { subagentDefinitions, subagentRuntimeConfigs } =
            await resolveAgentTeamRuntime(
              command.payload.agentTeamMode,
              agentProfile
                ? {
                    workspaceType: creativeWorkspaceType,
                    parentAgentId: agentProfile.id
                  }
                : longAgentProfile
                  ? {
                      workspaceType: "long",
                      parentAgentId: longAgentProfile.id
                    }
                  : undefined,
              {
                resolveDefinitions: (workspaceType, parentAgentId) =>
                  requireAgentTeamConfigStore().resolve(
                    workspaceType,
                    parentAgentId
                  ),
                resolveModel: (modelId) =>
                  requireModelConfigStore().resolve(modelId)
              }
            );
          const libraryAgentProfile = libraryWorkspace
            ? await requireLibraryAgentConfigStore().resolve(
                libraryWorkspace.domain
              )
            : undefined;
          const learningImitationProfile = learningImitation
            ? await requireLearningImitationConfigStore().resolve(
                learningImitation.stageId
              )
            : undefined;
          const longBookAnalysisProfile = longBookAnalysis
            ? await requireLongBookAnalysisConfigStore().resolve(
                longBookAnalysis.presetId
              )
            : undefined;
          const { thinkingLevel, temperature } = resolveModelRunSettings(
            runtimeConfig,
            {
              thinkingLevel: command.payload.thinkingLevel,
              temperature: command.payload.temperature
            }
          );
          const {
            agentTeamMode: _requestedAgentTeamMode,
            thinkingLevel: _requestedThinkingLevel,
            temperature: _requestedTemperature,
            ...promptPayload
          } = command.payload;
          const usageContext = createUsageRunContext(
            command.payload,
            runtimeConfig,
            subagentRuntimeConfigs
          );
          pendingUsageContexts.set(command.context.correlationId, usageContext);
          const libraryManagement = await prepareLibraryManagementRunContext(
            command.payload.workspaceContext,
            requireAgentTeamConfigStore(),
            requireLibraryAgentConfigStore(),
            (query) => supervisor.requestCommand("core", query, 60_000)
          );
          const materialWorkspaceContext = await prepareMaterialRunContext(
            {
              workspaceContext: command.payload.workspaceContext,
              ...(agentProfile ? { agentProfile } : {}),
              ...(longAgentProfile ? { longAgentProfile } : {}),
              snapshotMode: process.env.DEEPWRITE_MATERIAL_SNAPSHOT_MODE === "1"
            },
            (query) => supervisor.requestCommand("core", query, 60_000)
          );
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.prompt",
              {
                ...promptPayload,
                ...(libraryManagement ? { libraryManagement } : {}),
                ...(materialWorkspaceContext
                  ? { workspaceContext: materialWorkspaceContext }
                  : {}),
                ...(thinkingLevel ? { thinkingLevel } : {}),
                ...(temperature !== undefined ? { temperature } : {}),
                ...(runtimeConfig ? { runtimeConfig } : {}),
                ...(chatAssistantRuntimeContext
                  ? { chatAssistantRuntimeContext }
                  : {}),
                ...(agentProfile
                  ? scriptWorkspace
                    ? { scriptAgentProfile: agentProfile }
                    : { agentProfile }
                  : {}),
                ...(longAgentProfile ? { longAgentProfile } : {}),
                ...(subagentDefinitions ? { subagentDefinitions } : {}),
                ...(Object.keys(subagentRuntimeConfigs).length > 0
                  ? { subagentRuntimeConfigs }
                  : {}),
                ...(libraryAgentProfile ? { libraryAgentProfile } : {}),
                ...(learningImitationProfile
                  ? { learningImitationProfile }
                  : {}),
                ...(longBookAnalysisProfile ? { longBookAnalysisProfile } : {})
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand(
            "agent",
            internalCommand,
            10_000
          );
          if (result.status === "accepted") {
            const accepted = SessionPromptAcceptedPayloadSchema.parse(
              result.payload
            );
            if (accepted.sessionId !== command.payload.sessionId) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_acceptance",
                  message:
                    "Agent acceptance sessionId does not match the prompt command."
                }
              };
            }
            const provisional = [...activeRuns.entries()].find(
              ([, run]) => run.correlationId === command.context.correlationId
            );
            if (provisional && provisional[0] !== accepted.runId) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_acceptance",
                  message:
                    "Agent acceptance runId does not match the provisional event stream."
                }
              };
            }
            if (!terminalRuns.has(accepted.runId)) {
              activeRuns.set(accepted.runId, {
                sessionId: accepted.sessionId,
                correlationId: command.context.correlationId,
                runtime: accepted.runtime,
                accepted: true,
                promptRequestId: internalCommand.id,
                ...(libraryManagement
                  ? { libraryManagementScope: libraryManagement.scope }
                  : {}),
                ...(materialWorkspaceContext?.materialCatalog
                  ? {
                      materialScope:
                        materialWorkspaceContext.materialCatalog.scope
                    }
                  : {}),
                usageContext,
                ...(longWorkspace
                  ? { resourceId: longWorkspace.bookId }
                  : chatAssistantRuntimeContext?.mode === "project" &&
                      chatAssistantRuntimeContext.project.projectType === "long"
                    ? {
                        resourceId:
                          chatAssistantRuntimeContext.project.projectId
                      }
                    : {})
              });
            }
            pendingUsageContexts.delete(command.context.correlationId);
            return {
              status: "accepted",
              requestId: command.id,
              payload: accepted
            };
          }
          pendingUsageContexts.delete(command.context.correlationId);
          return result;
        } catch (error: unknown) {
          pendingUsageContexts.delete(command.context.correlationId);
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_command_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Agent command failed.",
              details: safeErrorDetails(error)
            }
          };
        } finally {
          release();
        }
      }

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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  shutdownComplete = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindowStartupGate.requestShow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const userDataPath = configureBootstrapEnvironment(
      app,
      import.meta.env.MAIN_VITE_DEEPWRITE_APP_MODE
    );
    modelConfigStore = new ModelConfigStore(userDataPath, {
      appVersion: app.getVersion()
    });
    modelUsageStore = new ModelUsageStore(userDataPath);
    softwareTokenUsageReporter = new SoftwareTokenUsageReporter(
      userDataPath,
      modelUsageStore
    );
    void softwareTokenUsageReporter.reportAtStartup().catch(() => {
      console.warn(
        "DeepWrite software token usage was not reported at startup."
      );
    });
    void modelConfigStore.initialize();
    void modelConfigStore
      .list()
      .then((settings) =>
        modelUsageStore?.syncConfiguredModels(settings.models)
      )
      .catch((error: unknown) => {
        console.warn(
          "DeepWrite model usage registry could not initialize:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
    workspaceAgentConfigStore = new WorkspaceAgentConfigStore(userDataPath);
    agentTeamConfigStore = new AgentTeamConfigStore(userDataPath);
    libraryAgentConfigStore = new LibraryAgentConfigStore(userDataPath);
    longAgentConfigStore = new LongAgentConfigStore(userDataPath);
    learningImitationConfigStore = new LearningImitationConfigStore(
      userDataPath
    );
    longBookAnalysisConfigStore = new LongBookAnalysisConfigStore(userDataPath);
    workspaceDirectoryStore = new WorkspaceDirectoryStore(userDataPath);
    appearanceService = new AppearanceService(userDataPath);
    installAppearanceFontProtocolHandler(appearanceService);
    generalSettingsStore = new GeneralSettingsStore(userDataPath);
    chatAssistantProjectConfigStore = new ChatAssistantProjectConfigStore(
      userDataPath
    );
    await workspaceDirectoryStore.initializeDefault(app.getPath("documents"));
    await loadAndSyncNativeAppearanceChrome();
    syncGeneralSettings((await generalSettingsStore.list()).settings);
    updateService = new UpdateService(() => {
      beginGracefulShutdown({ installUpdate: true });
    });
    appAlertStore = new AppAlertStore(userDataPath);
    cloudBackupService = createCloudBackupFeature(
      userDataPath,
      async () => (await requireWorkspaceDirectoryStore().list()).path,
      (command) => supervisor.requestCommand("core", command, 0)
    );
    deviceSyncService = createDesktopDeviceSync(userDataPath, {
      workspaceDirectory: async () =>
        (await requireWorkspaceDirectoryStore().list()).path,
      command: (command) => supervisor.requestCommand("core", command, 0),
      busy: () => activeRuns.size > 0
    });
    marketplaceClient = new MarketplaceClient(userDataPath, {
      loadCatalogSnapshot: async () => {
        const id = createId("cmd_marketplace_snapshot");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
        return CatalogSnapshotSchema.parse(result.payload);
      },
      installPackage: async (input) => {
        const id = createId("cmd_marketplace_install");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope("catalog.installMarketplaceSkillContent", input, {
            id,
            correlationId: id
          })
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
        return CatalogInstallMarketplaceSkillContentResultSchema.parse(
          result.payload
        );
      }
    });
    updateService.subscribe((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(UPDATE_STATE_EVENT_CHANNEL, state);
      }
    });
    registerIpc();
    supervisor.startAll();
    utilitiesStarted = true;
    mainWindow = createMainWindow();
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
