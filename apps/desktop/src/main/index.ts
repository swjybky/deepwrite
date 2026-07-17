import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { join } from "node:path";
import {
  CommandEnvelopeSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SessionPromptAcceptedPayloadSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SystemReadyEventEnvelopeSchema,
  createEnvelope,
  type AgentRuntimeRef,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";
import { UtilitySupervisor } from "./supervisor";

interface ActiveRun {
  sessionId: string;
  correlationId: string;
  runtime: AgentRuntimeRef;
}

const activeRuns = new Map<string, ActiveRun>();
const terminalRuns = new Set<string>();
let smokeEventTap: ((event: SystemEventEnvelope) => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let shutdownComplete = false;

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
      | "tool.call_requested"
      | "tool.execution_completed";
  }
>;

function isAgentEvent(event: SystemEventEnvelope): event is AgentEventEnvelope {
  return (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed"
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
  const window = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: "#ffffff",
    title: "DeepWrite",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

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

function registerIpc(): void {
  ipcMain.handle(
    IPC_COMMAND_CHANNEL,
    async (_event, rawCommand: unknown): Promise<CommandResult> => {
      const parsed = CommandEnvelopeSchema.safeParse(rawCommand);
      if (!parsed.success) {
        return {
          status: "rejected",
          requestId: "unknown",
          error: {
            code: "ipc.invalid_command",
            message: "Command envelope failed schema validation.",
            details: { issueCount: parsed.error.issues.length }
          }
        };
      }

      const command = parsed.data;
      if (command.type === "system.health") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: SystemHealthPayloadSchema.parse(await supervisor.collectHealth())
        };
      }

      if (command.type === "session.prompt") {
        try {
          const result = await supervisor.requestCommand("agent", command, 10_000);
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
        "session.prompt",
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  supervisor.startAll();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

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
  void supervisor.shutdownAll().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
