import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AgentTeamSettingsSchema,
  CatalogDocumentSchema,
  CatalogDraftSectionSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  CatalogOpenProjectResultSchema,
  AppearanceSettingsSnapshotSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionResultSchema,
  ExportShortManuscriptResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  LearningImitationSettingsSchema,
  LibraryAgentSettingsSchema,
  ModelConnectionTestResultSchema,
  ModelSettingsSchema,
  RemoveLibraryEntryResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  ShortBookSchema,
  ShortWorkspaceAgentSettingsSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SystemReadyEventEnvelopeSchema,
  UnregisterCatalogProjectResultSchema,
  WorkspaceDirectorySettingsSchema,
  createDefaultAppearanceSettings,
  createEnvelope,
  type AgentProviderRuntimeConfig,
  type AgentRuntimeRef,
  type AppearanceSettings,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";
import {
  LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES,
  importLegacyLibraryArchives
} from "./legacy-library-import-batch";
import { AppearanceConfigStore } from "./appearance-config-store";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { ModelConfigStore } from "./model-config-store";
import { LearningImitationConfigStore } from "./learning-imitation-config-store";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import {
  assertModelRunSettings,
  resolveModelRunSettings
} from "./model-run-settings";
import {
  applyNativeAppearanceChrome,
  resolveNativeBackgroundColor
} from "./native-appearance-chrome";
import { exportShortManuscript } from "./short-manuscript-export";
import { UtilitySupervisor } from "./supervisor";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";

interface ActiveRun {
  sessionId: string;
  correlationId: string;
  runtime: AgentRuntimeRef;
}

const activeRuns = new Map<string, ActiveRun>();
const terminalRuns = new Set<string>();
let smokeEventTap: ((event: SystemEventEnvelope) => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let modelConfigStore: ModelConfigStore | undefined;
let agentTeamConfigStore: AgentTeamConfigStore | undefined;
let appearanceConfigStore: AppearanceConfigStore | undefined;
let learningImitationConfigStore: LearningImitationConfigStore | undefined;
let libraryAgentConfigStore: LibraryAgentConfigStore | undefined;
let cachedAppearanceSettings: AppearanceSettings = createDefaultAppearanceSettings();
let nativeAppearanceListenerBound = false;
let workspaceAgentConfigStore: WorkspaceAgentConfigStore | undefined;
let workspaceDirectoryStore: WorkspaceDirectoryStore | undefined;
let quitting = false;
let shutdownComplete = false;
const RENDERER_DRAFT_FLUSH_GRACE_MS = 500;

function broadcastEvent(event: SystemEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENT_CHANNEL, event);
    }
  }
}

type AgentEventEnvelope = Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "learning_imitation.result_updated"
      | "library.editor_mutation"
      | "workspace.editor_mutation"
      | "workspace.stage_selection"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
>;

function isAgentEvent(event: SystemEventEnvelope): event is AgentEventEnvelope {
  return (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "learning_imitation.result_updated" ||
    event.type === "library.editor_mutation" ||
    event.type === "workspace.editor_mutation" ||
    event.type === "workspace.stage_selection" ||
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

function handleUtilityEvent(event: SystemEventEnvelope, worker: UtilityWorkerName): void {
  if (isAgentEvent(event) && worker !== "agent") {
    return;
  }

  const validated = SystemEventEnvelopeSchema.parse(event) as SystemEventEnvelope;
  if (isAgentEvent(validated)) {
    const runId = validated.payload.runId;
    if (validated.type === "agent.message_completed" || validated.type === "agent.error") {
      rememberTerminalRun(runId);
      activeRuns.delete(runId);
    } else if (!terminalRuns.has(runId) && !activeRuns.has(runId)) {
      activeRuns.set(runId, {
        sessionId: validated.payload.sessionId,
        correlationId: validated.context.correlationId,
        runtime: validated.payload.runtime
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

function handleWorkerRestarted(worker: UtilityWorkerName, reason: string): void {
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
  onWorkerRestarted: handleWorkerRestarted
});

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
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
      webSecurity: true
    }
  });

  applyNativeAppearanceChrome(cachedAppearanceSettings, [window]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.webContents.once("did-finish-load", () => void announceReady(window));
  return window;
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

function requireWorkspaceAgentConfigStore(): WorkspaceAgentConfigStore {
  if (!workspaceAgentConfigStore) {
    throw new Error("创作空间智能体设置存储尚未初始化。");
  }
  return workspaceAgentConfigStore;
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

function requireLearningImitationConfigStore(): LearningImitationConfigStore {
  if (!learningImitationConfigStore) {
    throw new Error("学习仿写设置存储尚未初始化。");
  }
  return learningImitationConfigStore;
}

function requireWorkspaceDirectoryStore(): WorkspaceDirectoryStore {
  if (!workspaceDirectoryStore) {
    throw new Error("工作目录配置存储尚未初始化。");
  }
  return workspaceDirectoryStore;
}

function requireAppearanceConfigStore(): AppearanceConfigStore {
  if (!appearanceConfigStore) {
    throw new Error("外观设置存储尚未初始化。");
  }
  return appearanceConfigStore;
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
    const snapshot = await requireAppearanceConfigStore().list();
    syncNativeAppearanceChrome(snapshot.settings);
  } catch {
    syncNativeAppearanceChrome(createDefaultAppearanceSettings());
  }
}

async function chooseWorkspaceDirectory(): Promise<
  ReturnType<typeof WorkspaceDirectorySettingsSchema.parse> | null
> {
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

function configureCatalogEnvironment(): string {
  const userDataPath = app.getPath("userData");
  process.env.DEEPWRITE_USER_DATA_PATH = userDataPath;

  const currentLegacyRoot = join(
    app.getPath("home"),
    "Library",
    "Application Support",
    "DeepWrite",
    ".data"
  );
  const configuredProjectRoot =
    process.env.DEEPWRITE_LEGACY_PROJECT_DATA_ROOT?.trim();
  const repositoryCandidates = [
    ...(configuredProjectRoot ? [resolve(configuredProjectRoot)] : []),
    join(app.getPath("home"), "project", "openwrite", "write-claw", ".data"),
    resolve(process.cwd(), "../openwrite/write-claw/.data"),
    resolve(app.getAppPath(), "../../../openwrite/write-claw/.data")
  ];
  const repositoryFallback =
    repositoryCandidates.find((candidate) => existsSync(candidate)) ??
    repositoryCandidates[0]!;
  const legacyDataRoots = [
    ...(existsSync(currentLegacyRoot) ? [currentLegacyRoot] : []),
    ...(existsSync(repositoryFallback) ? [repositoryFallback] : [])
  ].filter((root, index, roots) => roots.indexOf(root) === index);
  if (legacyDataRoots.length > 0) {
    process.env.DEEPWRITE_LEGACY_DATA_ROOT = legacyDataRoots[0];
    process.env.DEEPWRITE_LEGACY_DATA_ROOTS = JSON.stringify(legacyDataRoots);
  } else {
    delete process.env.DEEPWRITE_LEGACY_DATA_ROOT;
    delete process.env.DEEPWRITE_LEGACY_DATA_ROOTS;
  }
  return userDataPath;
}

function registerIpc(): void {
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
          ? (details.issues[0] as { path?: string; message?: string } | undefined)
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
        command.type === "agent.prompt" ||
        command.type === "agent.abort" ||
        command.type === "agent.model_test" ||
        command.type === "catalog.createShortBookAtPath" ||
        command.type === "catalog.createLibraryAtPath" ||
        command.type === "catalog.createLibraryGroupAtPath" ||
        command.type === "catalog.openProjectAtPath" ||
        command.type === "catalog.importLegacyBookAtPath" ||
        command.type === "catalog.importLegacyLibraryAtPath"
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
          payload: SystemHealthPayloadSchema.parse(await supervisor.collectHealth())
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
              message: error instanceof Error ? error.message : "导出正文失败。",
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
              message: error instanceof Error ? error.message : "加载工作目录失败。",
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
              message: error instanceof Error ? error.message : "切换工作目录失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "appearance.list") {
        try {
          const snapshot = AppearanceSettingsSnapshotSchema.parse(
            await requireAppearanceConfigStore().list()
          );
          syncNativeAppearanceChrome(snapshot.settings);
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
              code: "appearance.list_failed",
              message: error instanceof Error ? error.message : "加载外观设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "appearance.save") {
        try {
          const snapshot = AppearanceSettingsSnapshotSchema.parse(
            await requireAppearanceConfigStore().save(command.payload)
          );
          syncNativeAppearanceChrome(snapshot.settings);
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
              code: "appearance.save_failed",
              message: error instanceof Error ? error.message : "保存外观设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createLibrary" ||
        command.type === "catalog.createLibraryGroup" ||
        command.type === "catalog.openProject" ||
        command.type === "catalog.importLegacyBook" ||
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
            command.type === "catalog.importLegacyBook"
              ? "book"
              : command.payload.domain;
          const defaultPath =
            command.type === "catalog.createLibraryGroup"
              ? workspaceGroupParent(workspaceDirectory, command.payload.domain)
              : workspaceResourceParent(workspaceDirectory, domain);
          let selectedPaths: string[];
          if (
            command.type === "catalog.createShortBook" ||
            command.type === "catalog.createLibrary" ||
            command.type === "catalog.createLibraryGroup"
          ) {
            selectedPaths = [defaultPath];
          } else {
            const selection = await dialog.showOpenDialog({
              title:
                command.type === "catalog.importLegacyBook"
                  ? "导入旧版书籍压缩包"
                  : command.type === "catalog.importLegacyLibrary"
                    ? `导入旧版${domain === "material" ? "素材" : "技能"}库压缩包`
                  : domain === "book"
                    ? "打开已有书籍"
                    : domain === "material"
                      ? "打开已有素材库"
                      : "打开已有技能库",
              defaultPath,
              ...(
                command.type === "catalog.importLegacyBook" ||
                command.type === "catalog.importLegacyLibrary"
                ? {
                    properties:
                      command.type === "catalog.importLegacyLibrary"
                        ? LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES
                        : (["openFile"] as const),
                    filters: [
                      {
                        name:
                          command.type === "catalog.importLegacyBook"
                            ? "旧版书籍压缩包"
                            : `旧版${domain === "material" ? "素材" : "技能"}库压缩包`,
                        extensions: ["zip"]
                      }
                    ]
                  }
                : { properties: ["openDirectory"] as const }
              )
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
                  : command.type === "catalog.importLegacyBook"
                    ? createEnvelope(
                        "catalog.importLegacyBookAtPath",
                        {
                          archivePath: selectedPath,
                          parentDirectory: defaultPath
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
              : command.type === "catalog.createLibrary"
                ? CatalogLibrarySchema.parse(result.payload)
                : command.type === "catalog.createLibraryGroup"
                  ? CatalogLibraryGroupSchema.parse(result.payload)
                : command.type === "catalog.openProject"
                  ? CatalogOpenProjectResultSchema.parse(result.payload)
                  : command.type === "catalog.importLegacyBook"
                    ? ShortBookSchema.parse(result.payload)
                    : CatalogLibrarySchema.parse(result.payload);
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "catalog.forward_failed",
              message: error instanceof Error ? error.message : "目录操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (
        command.type === "catalog.snapshot" ||
        command.type === "catalog.loadDraftRecovery" ||
        command.type === "catalog.saveDraftRecovery" ||
        command.type === "catalog.updateBook" ||
        command.type === "catalog.updateLibraryGroup" ||
        command.type === "catalog.deleteBook" ||
        command.type === "catalog.saveDocument" ||
        command.type === "catalog.createDraftSection" ||
        command.type === "catalog.deleteDraftSection" ||
        command.type === "catalog.saveLibraryEntry" ||
        command.type === "catalog.createLibraryEntry" ||
        command.type === "catalog.removeLibraryEntry" ||
        command.type === "catalog.unregisterProject" ||
        command.type === "catalog.deleteProject"
      ) {
        try {
          const result = await supervisor.requestCommand("core", command, 0);
          if (result.status === "rejected") {
            return result;
          }
          let payload: unknown;
          switch (command.type) {
            case "catalog.snapshot":
              payload = CatalogSnapshotSchema.parse(result.payload);
              break;
            case "catalog.loadDraftRecovery":
              payload = CatalogDraftRecoverySchema.parse(result.payload);
              break;
            case "catalog.saveDraftRecovery":
              payload = CatalogDraftRecoverySaveResultSchema.parse(result.payload);
              break;
            case "catalog.deleteBook":
              payload = DeleteBookResultSchema.parse(result.payload);
              break;
            case "catalog.saveDocument":
              payload = CatalogDocumentSchema.parse(result.payload);
              break;
            case "catalog.createDraftSection":
              payload = CatalogDraftSectionSchema.parse(result.payload);
              break;
            case "catalog.deleteDraftSection":
              payload = DeleteDraftSectionResultSchema.parse(result.payload);
              break;
            case "catalog.saveLibraryEntry":
            case "catalog.createLibraryEntry":
              payload = CatalogLibraryEntrySchema.parse(result.payload);
              break;
            case "catalog.removeLibraryEntry":
              payload = RemoveLibraryEntryResultSchema.parse(result.payload);
              break;
            case "catalog.unregisterProject":
              payload = UnregisterCatalogProjectResultSchema.parse(result.payload);
              break;
            case "catalog.deleteProject":
              payload = DeleteCatalogProjectResultSchema.parse(result.payload);
              break;
            case "catalog.updateBook":
              payload = ShortBookSchema.parse(result.payload);
              break;
            case "catalog.updateLibraryGroup":
              payload = CatalogLibraryGroupSchema.parse(result.payload);
              break;
          }
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "catalog.forward_failed",
              message: error instanceof Error ? error.message : "目录操作失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "models.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ModelSettingsSchema.parse(await requireModelConfigStore().list())
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.list_failed",
              message: error instanceof Error ? error.message : "加载模型配置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "models.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ModelSettingsSchema.parse(
              await requireModelConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.save_failed",
              message: error instanceof Error ? error.message : "保存模型配置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "models.test") {
        try {
          const runtimeConfig = await requireModelConfigStore().resolveDraft(
            command.payload.model
          );
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.model_test",
              { runtimeConfig },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand("agent", internalCommand, 20_000);
          if (result.status === "accepted") {
            return {
              status: "accepted",
              requestId: command.id,
              payload: ModelConnectionTestResultSchema.parse(result.payload)
            };
          }
          return result;
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.test_failed",
              message: error instanceof Error ? error.message : "模型连接测试失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "workspaceAgents.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ShortWorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.list_failed",
              message: error instanceof Error ? error.message : "加载创作空间智能体设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "agentTeams.list") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: AgentTeamSettingsSchema.parse(
              await requireAgentTeamConfigStore().list()
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "agent_teams.list_failed",
              message: error instanceof Error ? error.message : "加载智能体团队设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "agentTeams.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: AgentTeamSettingsSchema.parse(
              await requireAgentTeamConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "agent_teams.save_failed",
              message: error instanceof Error ? error.message : "保存智能体团队设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "workspaceAgents.save") {
        try {
          return {
            status: "accepted",
            requestId: command.id,
            payload: ShortWorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().save(command.payload)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.save_failed",
              message: error instanceof Error ? error.message : "保存创作空间智能体设置失败。",
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
            payload: ShortWorkspaceAgentSettingsSchema.parse(
              await requireWorkspaceAgentConfigStore().reset(command.payload.agentId)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "workspace_agents.reset_failed",
              message: error instanceof Error ? error.message : "恢复创作空间默认设置失败。",
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
              await requireLibraryAgentConfigStore().reset(command.payload.domain)
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
              message: error instanceof Error ? error.message : "加载学习仿写设置失败。",
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
              message: error instanceof Error ? error.message : "保存学习仿写设置失败。",
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
              await requireLearningImitationConfigStore().reset(command.payload.stageId)
            )
          };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "learning_imitation_settings.reset_failed",
              message: error instanceof Error ? error.message : "恢复学习仿写默认设置失败。",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.abort") {
        try {
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.abort",
              command.payload,
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand("agent", internalCommand, 10_000);
          if (result.status === "accepted") {
            const accepted = SessionAbortAcceptedPayloadSchema.parse(result.payload);
            if (
              accepted.sessionId !== command.payload.sessionId ||
              accepted.runId !== command.payload.runId
            ) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_abort_result",
                  message: "Agent abort result does not match the requested run."
                }
              };
            }
            return { status: "accepted", requestId: command.id, payload: accepted };
          }
          return result;
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_abort_failed",
              message: error instanceof Error ? error.message : "Agent abort failed.",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      if (command.type === "session.prompt") {
        try {
          const runtimeConfig = await requireModelConfigStore().resolve(command.payload.modelId);
          const shortWorkspace = command.payload.workspaceContext?.shortWorkspace;
          const libraryWorkspace = command.payload.workspaceContext?.libraryWorkspace;
          const learningImitation = command.payload.workspaceContext?.learningImitation;
          const agentProfile = shortWorkspace
            ? await requireWorkspaceAgentConfigStore().resolveForWorkspace(
                shortWorkspace
              )
            : undefined;
          const subagentDefinitions = agentProfile
            ? await requireAgentTeamConfigStore().resolve(agentProfile.id)
            : undefined;
          const subagentRuntimeConfigs: Record<string, AgentProviderRuntimeConfig> =
            {};
          if (subagentDefinitions?.length) {
            for (const definition of subagentDefinitions) {
              if (definition.modelMode !== "custom" || !definition.modelId) {
                continue;
              }
              const resolved =
                subagentRuntimeConfigs[definition.modelId] ??
                (await requireModelConfigStore().resolve(definition.modelId));
              if (!resolved) {
                throw new Error(
                  `子智能体「${definition.name}」配置的模型不存在，请刷新模型配置后重试。`
                );
              }
              assertModelRunSettings(resolved, {
                thinkingLevel: definition.thinkingLevel,
                temperature: definition.temperature
              });
              subagentRuntimeConfigs[definition.modelId] = resolved;
            }
          }
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
          const { thinkingLevel, temperature } = resolveModelRunSettings(runtimeConfig, {
            thinkingLevel: command.payload.thinkingLevel,
            temperature: command.payload.temperature
          });
          const {
            thinkingLevel: _requestedThinkingLevel,
            temperature: _requestedTemperature,
            ...promptPayload
          } = command.payload;
          const internalCommand = CommandEnvelopeSchema.parse(
            createEnvelope(
              "agent.prompt",
              {
                ...promptPayload,
                ...(thinkingLevel ? { thinkingLevel } : {}),
                ...(temperature !== undefined ? { temperature } : {}),
                ...(runtimeConfig ? { runtimeConfig } : {}),
                ...(agentProfile ? { agentProfile } : {}),
                ...(subagentDefinitions ? { subagentDefinitions } : {}),
                ...(Object.keys(subagentRuntimeConfigs).length > 0
                  ? { subagentRuntimeConfigs }
                  : {}),
                ...(libraryAgentProfile ? { libraryAgentProfile } : {}),
                ...(learningImitationProfile ? { learningImitationProfile } : {})
              },
              { id: command.id, context: command.context }
            )
          );
          const result = await supervisor.requestCommand("agent", internalCommand, 10_000);
          if (result.status === "accepted") {
            const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
            if (accepted.sessionId !== command.payload.sessionId) {
              return {
                status: "rejected",
                requestId: command.id,
                error: {
                  code: "ipc.invalid_agent_acceptance",
                  message: "Agent acceptance sessionId does not match the prompt command."
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
                  message: "Agent acceptance runId does not match the provisional event stream."
                }
              };
            }
            if (!terminalRuns.has(accepted.runId)) {
              activeRuns.set(accepted.runId, {
                sessionId: accepted.sessionId,
                correlationId: command.context.correlationId,
                runtime: accepted.runtime
              });
            }
            return { status: "accepted", requestId: command.id, payload: accepted };
          }
          return result;
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.agent_command_failed",
              message: error instanceof Error ? error.message : "Agent command failed.",
              details: safeErrorDetails(error)
            }
          };
        }
      }

      throw new Error("Unreachable command variant after schema validation.");
    }
  );
}

async function runAgentSmoke(health: ReturnType<typeof SystemHealthPayloadSchema.parse>): Promise<void> {
  const sessionId = "session_electron_smoke";
  const commandId = createId("cmd_smoke");
  const events: SystemEventEnvelope[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });

  smokeEventTap = (event) => {
    if (isAgentEvent(event) && "sessionId" in event.payload && event.payload.sessionId === sessionId) {
      events.push(event);
      if (event.type === "agent.message_completed" || event.type === "agent.error") {
        resolveTerminal?.();
      }
    }
  };

  try {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId,
          message: "验证 DeepWrite Electron Faux 流式链路",
          thinkingLevel: "medium" as const,
          workspaceContext: {
            activeResource: {
              id: "chapter_smoke",
              domain: "creation" as const,
              title: "冒烟测试章节",
              path: ["测试作品", "冒烟测试章节"],
              format: "正文",
              source: "live-editor" as const,
              content: "这是发送瞬间的实时文稿。"
            }
          }
        },
        {
          id: commandId,
          context: { correlationId: commandId, sessionId, resourceId: "chapter_smoke" }
        }
      )
    );

    const result = await supervisor.requestCommand("agent", command);
    if (result.status === "rejected") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent smoke timed out.")), 8_000)
      )
    ]);

    const completed = events.find((event) => event.type === "agent.message_completed");
    const errors = events.filter((event) => event.type === "agent.error");
    const deltas = events.filter((event) => event.type === "agent.message_delta");
    const thinking = events.filter((event) => event.type === "agent.thinking_delta");
    const deltaText = deltas
      .map((event) => event.type === "agent.message_delta" ? event.payload.delta : "")
      .join("");

    if (
      accepted.runtime.mode !== "local-faux" ||
      !completed ||
      errors.length > 0 ||
      deltas.length < 2 ||
      thinking.length < 1 ||
      (completed.type === "agent.message_completed" && completed.payload.content !== deltaText)
    ) {
      throw new Error("Agent smoke event assertions failed.");
    }

    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({
        health,
        agent: {
          status: "ok",
          runtime: accepted.runtime,
          deltaCount: deltas.length,
          thinkingDeltaCount: thinking.length,
          completed: true
        }
      })}`
    );
  } finally {
    smokeEventTap = undefined;
  }
}

async function announceReady(window: BrowserWindow): Promise<void> {
  const health = SystemHealthPayloadSchema.parse(await supervisor.collectHealth());
  const event = SystemReadyEventEnvelopeSchema.parse(
    createEnvelope("system.ready", health, { id: createId("evt_ready") })
  ) as SystemEventEnvelope;
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_EVENT_CHANNEL, event);
  }

  if (process.env.DEEPWRITE_SMOKE === "1") {
    try {
      await runAgentSmoke(health);
    } catch (error: unknown) {
      console.error(`DEEPWRITE_SMOKE_FAIL ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      app.quit();
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  shutdownComplete = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const userDataPath = configureCatalogEnvironment();
    modelConfigStore = new ModelConfigStore(userDataPath, {
      appVersion: app.getVersion()
    });
    void modelConfigStore.initialize();
    workspaceAgentConfigStore = new WorkspaceAgentConfigStore(userDataPath);
    agentTeamConfigStore = new AgentTeamConfigStore(userDataPath);
    libraryAgentConfigStore = new LibraryAgentConfigStore(userDataPath);
    learningImitationConfigStore = new LearningImitationConfigStore(userDataPath);
    workspaceDirectoryStore = new WorkspaceDirectoryStore(userDataPath);
    appearanceConfigStore = new AppearanceConfigStore(userDataPath);
    await workspaceDirectoryStore.initializeDefault(app.getPath("documents"));
    await loadAndSyncNativeAppearanceChrome();
    registerIpc();
    supervisor.startAll();
    mainWindow = createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
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
  if (quitting) {
    return;
  }
  quitting = true;
  setTimeout(() => {
    void supervisor.shutdownAll().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  }, RENDERER_DRAFT_FLUSH_GRACE_MS);
});
