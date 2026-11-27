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
  endpointAnswers,
  type ExternalControlServer
} from "./control-server";
import type { ExternalControlPaths } from "./control-paths";
import {
  ensurePrivateDirectory,
  readExternalControlState,
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
import { rejectedResult } from "../../main/ipc/errors";

export { EXTERNAL_CONTROL_LAUNCH_FLAG } from "@deepwrite/contracts/external-control";
export { ExternalControlError } from "./errors";
export { createClientConfirmDialog } from "./confirm-dialog";
export type { BridgeConnection } from "./client-configs";
export {
  DEVELOPMENT_CONTROL_DIRECTORY_ENV,
  resolveExternalControlPaths
} from "./control-paths";

const ACTIVITY_ENTRIES = 50;
const RECOVERY_DELAYS_MS = [500, 2_000, 5_000] as const;
const MAX_RECOVERY_ATTEMPTS = 5;

interface ExternalControlOptions {
  configurationDirectory?: () => string;
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
    accessFile: () =>
      join(
        options.configurationDirectory?.() ?? options.app.dataDirectory(),
        "config",
        "external-control.json"
      ),
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
  let updating = false;
  let restarting = false;
  let server: ExternalControlServer | undefined;
  let queue: Promise<void> = Promise.resolve();
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryAttempts = 0;

  function clearRecovery(): void {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }
  }

  function scheduleRecovery(): void {
    if (!enabled || stopped || !settingsKnown || recoveryTimer) return;
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return;
    const delayMs =
      RECOVERY_DELAYS_MS[
        Math.min(recoveryAttempts, RECOVERY_DELAYS_MS.length - 1)
      ] ?? 5_000;
    recoveryAttempts += 1;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!enabled || stopped) return;
      void enqueue().then(() => {
        if (!server && enabled && !stopped) scheduleRecovery();
      });
    }, delayMs);
    recoveryTimer.unref();
  }

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

  /**
   * Smoke and probe profiles bypass the single-instance lock but share this
   * home directory, so a running development app's endpoint is not ours.
   */
  async function servedByAnotherInstance(): Promise<boolean> {
    const state = await readExternalControlState(options.paths.stateFile);
    if (state?.status !== "ready" || state.pid === pid) return false;
    return endpointAnswers(options.paths.endpoint);
  }

  async function removeOwnState(): Promise<void> {
    if (await servedByAnotherInstance()) return;
    await removeExternalControlState(options.paths.stateFile);
  }

  async function startServer(): Promise<void> {
    if (await servedByAnotherInstance()) {
      warn("DeepWrite external control is served by another instance");
      return;
    }
    const token = createToken();
    const created = createExternalControlServer({
      endpoint: options.paths.endpoint,
      token,
      authorize: approval.authorize,
      handleCall,
      onUnexpectedError: (error) => {
        warn(`DeepWrite external control server error: ${error.name}`);
        if (server === created) server = undefined;
        scheduleRecovery();
      },
      onUnexpectedClose: () => {
        if (server === created) server = undefined;
        scheduleRecovery();
      }
    });
    // The socket lives here, so this must exist before listening.
    await ensurePrivateDirectory(options.paths.directory);
    await created.start();
    server = created;
    recoveryAttempts = 0;
    clearRecovery();
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
    if (await servedByAnotherInstance()) return;
    if (updating) {
      // Holds bridges back until the next app start replaces this file.
      await writeExternalControlState(options.paths.stateFile, {
        ...identity,
        status: "updating",
        startedAt: now()
      });
    } else if (restarting) {
      // Holds bridges back until the restarted instance replaces this file.
      await writeExternalControlState(options.paths.stateFile, {
        ...identity,
        status: "restarting",
        startedAt: now()
      });
    } else if (launchRequested && !stopped) {
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
      await removeOwnState().catch(() => undefined);
    });
    return queue;
  }

  return {
    sync(nextEnabled: boolean): Promise<void> {
      clearRecovery();
      recoveryAttempts = 0;
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
    failPendingWindowRequests: windowRequests.failAll,
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
        return rejectedResult(
          command.id,
          error instanceof ExternalControlError
            ? error.code
            : "external.not_ready",
          error instanceof ExternalControlError
            ? error.message
            : "DeepWrite 暂时无法完成这次操作。请稍后重试。"
        );
      }
    },
    /** Never rejects, so shutdown continues if cleanup fails. */
    stop(
      options: { updating?: boolean; restarting?: boolean } = {}
    ): Promise<void> {
      stopped = true;
      updating = options.updating === true;
      restarting = !updating && options.restarting === true;
      clearRecovery();
      return enqueue();
    }
  };
}

export type ExternalControl = ReturnType<typeof createExternalControl>;
