import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlOverviewSchema,
  findExternalControlTool,
  isExternalControlSettingsCommand,
  type ExternalControlClient,
  type ExternalControlOverview,
  type ExternalWindowRequest
} from "@deepwrite/contracts/external-control";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import { auditTarget, createAuditLog } from "./audit-log";
import { bridgeClientConfigs, type BridgeConnection } from "./client-configs";
import { installSkill, listSkillTargets } from "./skill-install";
import { createClientApproval } from "./client-approval";
import {
  createExternalControlServer,
  type ExternalControlServer
} from "./control-server";
import type { ExternalControlPaths } from "./control-paths";
import {
  ensurePrivateDirectory,
  removeExternalControlState,
  writeExternalControlState
} from "./control-state-file";
import { ExternalControlError } from "./errors";
import {
  callExternalControlTool,
  type ExternalControlAppState
} from "./tool-routes";
import { createTrashStore, trashExpiry } from "./trash-store";
import { createWindowRequests } from "./window-requests";

export { EXTERNAL_CONTROL_LAUNCH_FLAG } from "@deepwrite/contracts/external-control";
export { createClientConfirmDialog } from "./confirm-dialog";
export type { BridgeConnection } from "./client-configs";
export { resolveExternalControlPaths } from "./control-paths";

const ACTIVITY_ENTRIES = 50;

interface ExternalControlOptions {
  paths: ExternalControlPaths;
  app: Omit<ExternalControlAppState, "windowRequest">;
  sendWindowRequest(id: string, request: ExternalWindowRequest): void;
  confirmClient(client: ExternalControlClient): Promise<boolean>;
  homeDirectory: string;
  connection(): BridgeConnection;
  pid?: number;
  createToken?: () => string;
  now?: () => string;
  warn?: (message: string) => void;
}

/** Owns the endpoint's lifetime. Every transition runs in one queue. */
export function createExternalControl(options: ExternalControlOptions) {
  const pid = options.pid ?? process.pid;
  const createToken =
    options.createToken ?? (() => randomBytes(32).toString("hex"));
  const now = options.now ?? (() => new Date().toISOString());
  const warn = options.warn ?? console.warn;
  const inData = (...path: string[]) =>
    join(options.app.dataDirectory(), ...path);
  const approval = createClientApproval({
    accessFile: () => inData("config", "external-control.json"),
    confirm: options.confirmClient
  });
  const trash = createTrashStore({ directory: () => inData("external-trash") });
  const windowRequests = createWindowRequests({
    send: options.sendWindowRequest
  });
  const appState: ExternalControlAppState = {
    ...options.app,
    windowRequest: windowRequests.request
  };
  const audit = createAuditLog(
    () => inData("logs", "external-control.jsonl"),
    warn
  );
  const identity = {
    protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
    appVersion: options.app.appVersion,
    pid
  };

  let enabled = false;
  // A launch flag arrives before settings load; answering it then would
  // report "disabled" for an app whose switch is actually on.
  let settingsKnown = false;
  let launchRequested = false;
  let stopped = false;
  let server: ExternalControlServer | undefined;
  let queue: Promise<void> = Promise.resolve();

  async function stopServer(): Promise<void> {
    const running = server;
    server = undefined;
    await running?.stop();
  }

  async function handleCall(
    tool: string,
    args: Record<string, unknown>,
    client: ExternalControlClient
  ): Promise<unknown> {
    const audited = !findExternalControlTool(tool)?.annotations.readOnlyHint;
    const record = (result: string) =>
      audited
        ? audit.append({
            time: now(),
            client: client.name,
            tool: tool.slice(0, 120),
            target: auditTarget(args),
            result
          })
        : Promise.resolve();
    try {
      const value = await callExternalControlTool(appState, tool, args, {
        trash,
        client
      });
      await record("ok");
      return value;
    } catch (error: unknown) {
      await record(
        error instanceof ExternalControlError ? error.code : "failed"
      );
      throw error;
    }
  }

  async function overview(): Promise<ExternalControlOverview> {
    const [clients, records, activity, skillTargets] = await Promise.all([
      approval.list(),
      trash.list(),
      audit.recent(ACTIVITY_ENTRIES),
      listSkillTargets(options.homeDirectory)
    ]);
    return ExternalControlOverviewSchema.parse({
      enabled,
      clients,
      trash: records.map((record) => ({
        trashId: record.id,
        kind: record.kind,
        title: record.title,
        deletedAt: record.deletedAt,
        expiresAt: trashExpiry(record)
      })),
      activity: activity.map(({ time, client, tool, result }) => ({
        time,
        client,
        tool,
        result
      })),
      configs: bridgeClientConfigs(options.connection()),
      skillTargets
    });
  }

  async function startServer(): Promise<void> {
    const token = createToken();
    const created = createExternalControlServer({
      endpoint: options.paths.endpoint,
      token,
      authorize: approval.authorize,
      handleCall
    });
    // The socket lives here, so this must exist before listening.
    await ensurePrivateDirectory(options.paths.directory);
    await created.start();
    server = created;
    await Promise.all([trash.purgeExpired(), audit.trim()]);
    await writeExternalControlState(options.paths.stateFile, {
      ...identity,
      status: "ready",
      endpoint: options.paths.endpoint,
      token,
      startedAt: now()
    });
  }

  async function publishStopped(): Promise<void> {
    if (launchRequested && !stopped) {
      // Answers a bridge waiting on launch; carries no way to connect.
      await writeExternalControlState(options.paths.stateFile, {
        ...identity,
        status: "disabled"
      });
    } else {
      await removeExternalControlState(options.paths.stateFile);
    }
  }

  async function reconcile(): Promise<void> {
    if (!settingsKnown && !stopped) return;
    const shouldRun = enabled && !stopped;
    if (shouldRun && server) return;
    if (shouldRun) {
      await startServer();
      return;
    }
    await stopServer();
    await publishStopped();
  }

  function enqueue(): Promise<void> {
    queue = queue.then(reconcile).catch(async (error: unknown) => {
      warn(
        `DeepWrite external control could not change state: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
      await stopServer().catch(() => undefined);
      await removeExternalControlState(options.paths.stateFile).catch(
        () => undefined
      );
    });
    return queue;
  }

  return {
    sync(nextEnabled: boolean): Promise<void> {
      if (!nextEnabled) approval.reset();
      enabled = nextEnabled;
      settingsKnown = true;
      return enqueue();
    },
    /** The bridge started or re-activated the app and is polling the state. */
    noteLaunchRequest(): Promise<void> {
      launchRequested = true;
      return enqueue();
    },
    call: handleCall,
    resolveWindowResponse: windowRequests.resolve,
    /** Undefined when the command is not one of the settings page's own. */
    async handleSettingsCommand(
      command: CommandEnvelope
    ): Promise<CommandResult | undefined> {
      if (!isExternalControlSettingsCommand(command.type)) return undefined;
      try {
        if (command.type === "externalControl.revokeClient") {
          await approval.revoke(command.payload.name);
          server?.disconnectClient(command.payload.name);
        } else if (command.type === "externalControl.emptyTrash") {
          await trash.clear();
        } else if (command.type === "externalControl.installSkill") {
          await installSkill(options.homeDirectory, command.payload.targetId);
        } else if (command.type === "externalControl.restoreTrash") {
          await callExternalControlTool(
            appState,
            "restore_trash_item",
            { trashId: command.payload.trashId },
            { trash, client: { name: "DeepWrite" } }
          );
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: await overview()
        };
      } catch (error: unknown) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code:
              error instanceof ExternalControlError
                ? error.code
                : "external.not_ready",
            message:
              error instanceof ExternalControlError
                ? error.message
                : "DeepWrite 暂时无法完成这次操作。请稍后重试。"
          }
        };
      }
    },
    /** Never rejects, so shutdown continues if cleanup fails. */
    stop(): Promise<void> {
      stopped = true;
      return enqueue();
    }
  };
}

export type ExternalControl = ReturnType<typeof createExternalControl>;
