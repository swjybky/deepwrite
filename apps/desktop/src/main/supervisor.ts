import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import {
  UtilityInternalCommandResultMessageSchema,
  UtilityOutboundMessageSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityHealthPayload,
  type UtilityInternalCommandRequestMessage,
  type UtilityInternalCommandTarget,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";

type WorkerStatus = UtilityHealthPayload["status"];

const MAX_PENDING_INTERNAL_COMMANDS = 32;

export class UtilityCommandTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UtilityCommandTimeoutError";
  }
}

interface PendingHealthCheck {
  resolve(payload: UtilityHealthPayload): void;
  timer: NodeJS.Timeout;
}

interface PendingCommand {
  commandId: string;
  resolve(result: CommandResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | undefined;
}

interface PendingShutdown {
  resolve(): void;
  timer: NodeJS.Timeout;
}

interface PendingInternalCommandBridge {
  source: "agent";
  target: UtilityInternalCommandTarget;
  requestId: string;
  parentRequestId: string;
  targetRequestId: string;
  commandId: string;
}

export interface UtilityInternalCommandAuthorizationContext {
  source: UtilityWorkerName;
  target: UtilityInternalCommandTarget;
  message: UtilityInternalCommandRequestMessage;
}

export type UtilityInternalCommandAuthorizationResult =
  | boolean
  | {
      authorized: boolean;
      /** Stable Main-owned reason code for diagnostics and tests. */
      code?: string;
      message?: string;
    };

export interface UtilitySupervisorOptions {
  onUtilityEvent(event: SystemEventEnvelope, worker: UtilityWorkerName): void;
  onUnexpectedExit(worker: UtilityWorkerName, reason: string): void;
  onWorkerRestarted(worker: UtilityWorkerName, reason: string): void;
  internalCommandAllowlist?: Readonly<
    Partial<
      Record<UtilityInternalCommandTarget, readonly CommandEnvelope["type"][]>
    >
  >;
  /**
   * Optional run-time authorization after the static allowlist and before
   * forwarding. A false/denied decision is always surfaced to Agent as
   * utility.internal_command_unauthorized.
   */
  internalCommandAuthorize?: (
    context: UtilityInternalCommandAuthorizationContext
  ) => UtilityInternalCommandAuthorizationResult;
}

class UtilityWorker {
  private child: UtilityProcess | undefined;
  private status: WorkerStatus = "stopped";
  private pid: number | undefined;
  private startedAt: string | undefined;
  private lastHeartbeatAt: string | undefined;
  private isStopping = false;
  private readonly pendingHealth = new Map<string, PendingHealthCheck>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private pendingShutdown: PendingShutdown | undefined;

  constructor(
    private readonly name: UtilityWorkerName,
    private readonly entryPath: string,
    private readonly onUnexpectedExit: (
      worker: UtilityWorkerName,
      reason: string
    ) => void,
    private readonly onReady: (worker: UtilityWorkerName) => void,
    private readonly onUtilityEvent: (
      event: SystemEventEnvelope,
      worker: UtilityWorkerName
    ) => void,
    private readonly onInternalCommandRequest: (
      source: UtilityWorkerName,
      message: UtilityInternalCommandRequestMessage
    ) => void,
    private readonly onExit: (worker: UtilityWorkerName, reason: string) => void
  ) {}

  start(): void {
    if (this.child || this.isStopping) {
      return;
    }

    this.status = "starting";
    const child = utilityProcess.fork(this.entryPath, [], {
      serviceName: `deepwrite-${this.name}`,
      env: { ...process.env }
    });
    this.child = child;
    this.pid = child.pid;

    child.on("message", (message: unknown) => this.handleMessage(message));
    child.once("exit", (code) => {
      const unexpected = !this.isStopping;
      const reason = `exit:${code ?? "unknown"}`;
      this.child = undefined;
      this.pid = undefined;
      this.status = "stopped";
      this.startedAt = undefined;
      this.lastHeartbeatAt = undefined;
      this.resolvePendingHealth("degraded");
      this.rejectPendingCommands(
        new Error(`${this.name} utility exited: ${reason}`)
      );
      this.resolvePendingShutdown();
      this.onExit(this.name, reason);

      if (unexpected) {
        this.onUnexpectedExit(this.name, reason);
      }
    });
  }

  async requestHealth(timeoutMs = 1600): Promise<UtilityHealthPayload> {
    const child = this.child;
    if (!child) {
      return this.snapshot("degraded");
    }

    const requestId = createId(`health_${this.name}`);
    return await new Promise<UtilityHealthPayload>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingHealth.delete(requestId);
        resolve(
          this.snapshot(this.status === "starting" ? "starting" : "degraded")
        );
      }, timeoutMs);
      this.pendingHealth.set(requestId, { resolve, timer });
      try {
        child.postMessage({ kind: "utility.health.request", requestId });
      } catch {
        clearTimeout(timer);
        this.pendingHealth.delete(requestId);
        resolve(this.snapshot("degraded"));
      }
    });
  }

  requestCommand(
    command: CommandEnvelope,
    timeoutMs = 60_000,
    requestId = command.id
  ): Promise<CommandResult> {
    const child = this.child;
    if (!child || this.isStopping) {
      return Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: {
          code: "utility.not_running",
          message: `${this.name} utility is not available.`
        }
      });
    }

    if (
      this.pendingCommands.has(requestId) ||
      [...this.pendingCommands.values()].some(
        (pending) => pending.commandId === command.id
      )
    ) {
      return Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: {
          code: "utility.duplicate_command",
          message: `A command with id ${command.id} is already pending.`
        }
      });
    }

    return new Promise<CommandResult>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pendingCommands.delete(requestId);
              reject(
                new UtilityCommandTimeoutError(
                  `${this.name} utility command timed out: ${command.type}`
                )
              );
            }, timeoutMs)
          : undefined;
      this.pendingCommands.set(requestId, {
        commandId: command.id,
        resolve,
        reject,
        timer
      });

      try {
        child.postMessage({
          kind: "utility.command.request",
          requestId,
          command
        });
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pendingCommands.delete(requestId);
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to post utility command.")
        );
      }
    });
  }

  cancelCommandRequest(requestId: string, error: Error): void {
    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingCommands.delete(requestId);
    pending.reject(error);
  }

  sendInternalCommandResult(
    target: UtilityInternalCommandTarget,
    requestId: string,
    parentRequestId: string,
    result: CommandResult
  ): boolean {
    const child = this.child;
    if (!child || this.isStopping || this.name !== "agent") {
      return false;
    }
    try {
      child.postMessage(
        UtilityInternalCommandResultMessageSchema.parse({
          kind: "utility.internal.command.result",
          worker: "agent",
          target,
          requestId,
          parentRequestId,
          result
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  shutdown(timeoutMs = 1800): Promise<void> {
    this.isStopping = true;
    const child = this.child;
    if (!child) {
      this.status = "stopped";
      return Promise.resolve();
    }
    if (this.pendingShutdown) {
      return new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (!this.pendingShutdown) {
            clearInterval(poll);
            resolve();
          }
        }, 10);
        poll.unref();
      });
    }

    const requestId = createId(`shutdown_${this.name}`);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        setTimeout(() => this.resolvePendingShutdown(), 250).unref();
      }, timeoutMs);
      this.pendingShutdown = { resolve, timer };
      try {
        child.postMessage({ kind: "utility.shutdown", requestId });
      } catch {
        child.kill();
      }
    });
  }

  async restart(): Promise<void> {
    if (this.child) {
      await this.shutdown();
    }
    this.isStopping = false;
    this.start();
  }

  private snapshot(status: WorkerStatus = this.status): UtilityHealthPayload {
    return {
      name: this.name,
      status,
      ...(this.pid ? { pid: this.pid } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.lastHeartbeatAt
        ? { lastHeartbeatAt: this.lastHeartbeatAt }
        : {}),
      details: { entry: this.entryPath }
    };
  }

  private handleMessage(rawMessage: unknown): void {
    const parsed = UtilityOutboundMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      const raw = rawMessage as Record<string, unknown> | null;
      const requestId =
        raw && typeof raw.requestId === "string" ? raw.requestId : undefined;
      const isCommandResponse =
        raw?.kind === "utility.command.result" ||
        raw?.kind === "utility.command.event";
      const pending =
        requestId && isCommandResponse
          ? this.pendingCommands.get(requestId)
          : undefined;
      if (requestId && pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(requestId);
        pending.reject(
          new Error(`${this.name} utility emitted an invalid command message.`)
        );
      }
      return;
    }

    const message = parsed.data;
    if (message.worker !== this.name) {
      return;
    }

    if (message.kind === "utility.ready") {
      this.status = "ok";
      this.pid = message.pid;
      this.startedAt = message.startedAt;
      this.lastHeartbeatAt = nowIso();
      this.onReady(this.name);
      return;
    }

    if (message.kind === "utility.heartbeat") {
      this.status = "ok";
      this.lastHeartbeatAt = message.timestamp;
      return;
    }

    if (message.kind === "utility.health") {
      const pending = this.pendingHealth.get(message.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingHealth.delete(message.requestId);
      if (message.payload.name !== this.name) {
        pending.resolve(this.snapshot("degraded"));
        return;
      }
      this.status = "ok";
      this.lastHeartbeatAt = nowIso();
      pending.resolve(message.payload);
      return;
    }

    if (message.kind === "utility.shutdown_ack") {
      this.status = "stopped";
      return;
    }

    if (message.kind === "utility.command.result") {
      const pending = this.pendingCommands.get(message.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingCommands.delete(message.requestId);
      if (message.result.requestId !== pending.commandId) {
        pending.reject(
          new Error("Utility result requestId does not match pending command.")
        );
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.kind === "utility.internal.command.request") {
      this.onInternalCommandRequest(this.name, message);
      return;
    }

    this.onUtilityEvent(message.event, this.name);
  }

  private resolvePendingHealth(status: WorkerStatus): void {
    for (const [requestId, pending] of this.pendingHealth) {
      clearTimeout(pending.timer);
      pending.resolve(this.snapshot(status));
      this.pendingHealth.delete(requestId);
    }
  }

  private rejectPendingCommands(error: Error): void {
    for (const requestId of this.pendingCommands.keys()) {
      this.cancelCommandRequest(requestId, error);
    }
  }

  private resolvePendingShutdown(): void {
    const pending = this.pendingShutdown;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingShutdown = undefined;
    pending.resolve();
  }
}

export class UtilitySupervisor {
  private readonly workers: Map<UtilityWorkerName, UtilityWorker>;
  private readonly restartTimers = new Map<UtilityWorkerName, NodeJS.Timeout>();
  private readonly restartReasons = new Map<UtilityWorkerName, string>();
  private readonly pendingInternalCommands = new Map<
    string,
    PendingInternalCommandBridge
  >();
  private shuttingDown = false;

  constructor(private readonly options: UtilitySupervisorOptions) {
    const makeWorker = (name: UtilityWorkerName): UtilityWorker =>
      new UtilityWorker(
        name,
        join(__dirname, "utilities", `${name}-entry.js`),
        (worker, reason) => this.handleUnexpectedExit(worker, reason),
        (worker) => this.handleWorkerReady(worker),
        options.onUtilityEvent,
        (source, message) => this.handleInternalCommandRequest(source, message),
        (worker, reason) => this.handleWorkerExit(worker, reason)
      );

    this.workers = new Map([
      ["core", makeWorker("core")],
      ["agent", makeWorker("agent")],
      ["tool", makeWorker("tool")]
    ]);
  }

  startAll(): void {
    if (this.shuttingDown) {
      return;
    }
    for (const worker of this.workers.values()) {
      worker.start();
    }
  }

  requestCommand(
    worker: UtilityWorkerName,
    command: CommandEnvelope,
    timeoutMs?: number
  ): Promise<CommandResult> {
    const target = this.workers.get(worker);
    if (!target) {
      return Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: {
          code: "utility.unknown_worker",
          message: `Unknown utility worker: ${worker}`
        }
      });
    }
    return target.requestCommand(command, timeoutMs);
  }

  async collectHealth(): Promise<{
    status: "starting" | "ok" | "degraded";
    checkedAt: string;
    workers: UtilityHealthPayload[];
  }> {
    const workers = await Promise.all(
      [...this.workers.values()].map((worker) => worker.requestHealth())
    );
    const status = workers.every((worker) => worker.status === "ok")
      ? "ok"
      : workers.some((worker) => worker.status === "starting")
        ? "starting"
        : "degraded";
    return { status, checkedAt: nowIso(), workers };
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    this.restartReasons.clear();
    this.cancelPendingInternalCommands(
      "utility.internal_command_cancelled",
      "Utility supervisor is shutting down."
    );
    await this.workers.get("agent")?.shutdown(1800);
    await Promise.all([
      this.workers.get("tool")?.shutdown(1800),
      this.workers.get("core")?.shutdown(30_000)
    ]);
  }

  async restartWorker(name: UtilityWorkerName, reason: string): Promise<void> {
    const worker = this.workers.get(name);
    if (!worker || this.shuttingDown) return;
    this.restartReasons.set(name, reason);
    await worker.restart();
  }

  private handleInternalCommandRequest(
    source: UtilityWorkerName,
    message: UtilityInternalCommandRequestMessage
  ): void {
    if (source !== "agent" || message.worker !== source) {
      return;
    }

    const sourceWorker = this.workers.get("agent");
    if (!sourceWorker) {
      return;
    }
    if (this.shuttingDown) {
      sourceWorker.sendInternalCommandResult(
        message.target,
        message.requestId,
        message.parentRequestId,
        this.createInternalCommandRejection(
          message.command.id,
          "utility.internal_command_cancelled",
          "Utility supervisor is shutting down."
        )
      );
      return;
    }
    const allowedCommandTypes =
      this.options.internalCommandAllowlist?.[message.target] ?? [];
    if (!allowedCommandTypes.includes(message.command.type)) {
      sourceWorker.sendInternalCommandResult(
        message.target,
        message.requestId,
        message.parentRequestId,
        this.createInternalCommandRejection(
          message.command.id,
          "utility.internal_command_not_allowed",
          `${message.command.type} is not allowed for the ${message.target} utility bridge.`
        )
      );
      return;
    }
    const authorization = this.authorizeInternalCommand({
      source,
      target: message.target,
      message
    });
    if (!authorization.authorized) {
      sourceWorker.sendInternalCommandResult(
        message.target,
        message.requestId,
        message.parentRequestId,
        this.createInternalCommandRejection(
          message.command.id,
          "utility.internal_command_unauthorized",
          authorization.message ??
            "The internal utility command is not authorized for the active run.",
          authorization.code
            ? { authorizationCode: authorization.code }
            : undefined
        )
      );
      return;
    }
    if (this.pendingInternalCommands.has(message.requestId)) {
      return;
    }
    if (this.pendingInternalCommands.size >= MAX_PENDING_INTERNAL_COMMANDS) {
      sourceWorker.sendInternalCommandResult(
        message.target,
        message.requestId,
        message.parentRequestId,
        this.createInternalCommandRejection(
          message.command.id,
          "utility.internal_command_limit",
          "Too many internal utility commands are pending."
        )
      );
      return;
    }

    const targetWorker = this.workers.get(message.target);
    if (!targetWorker) {
      sourceWorker.sendInternalCommandResult(
        message.target,
        message.requestId,
        message.parentRequestId,
        this.createInternalCommandRejection(
          message.command.id,
          "utility.internal_command_unknown_target",
          `Unknown internal utility target: ${message.target}`
        )
      );
      return;
    }

    const targetRequestId = createId(`internal_${message.target}`);
    this.pendingInternalCommands.set(message.requestId, {
      source: "agent",
      target: message.target,
      requestId: message.requestId,
      parentRequestId: message.parentRequestId,
      targetRequestId,
      commandId: message.command.id
    });

    void targetWorker
      .requestCommand(message.command, message.timeoutMs, targetRequestId)
      .then((result) => {
        this.completeInternalCommand(message.requestId, result);
      })
      .catch((error: unknown) => {
        const timedOut = error instanceof UtilityCommandTimeoutError;
        this.completeInternalCommand(
          message.requestId,
          this.createInternalCommandRejection(
            message.command.id,
            timedOut
              ? "utility.internal_command_timeout"
              : "utility.internal_command_failed",
            timedOut
              ? `${message.target} utility internal command timed out.`
              : error instanceof Error
                ? error.message
                : "Internal utility command failed."
          )
        );
      });
  }

  private completeInternalCommand(
    requestId: string,
    result: CommandResult
  ): void {
    const pending = this.pendingInternalCommands.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingInternalCommands.delete(requestId);
    const correlatedResult =
      result.requestId === pending.commandId
        ? result
        : this.createInternalCommandRejection(
            pending.commandId,
            "utility.internal_command_invalid_result",
            "Internal utility result did not match the requested command."
          );
    this.workers
      .get(pending.source)
      ?.sendInternalCommandResult(
        pending.target,
        pending.requestId,
        pending.parentRequestId,
        correlatedResult
      );
  }

  private handleWorkerExit(worker: UtilityWorkerName, reason: string): void {
    for (const pending of [...this.pendingInternalCommands.values()]) {
      if (pending.source === worker) {
        this.pendingInternalCommands.delete(pending.requestId);
        this.workers
          .get(pending.target)
          ?.cancelCommandRequest(
            pending.targetRequestId,
            new Error(`Internal command source exited: ${reason}`)
          );
        continue;
      }
      if (pending.target === worker) {
        this.pendingInternalCommands.delete(pending.requestId);
        this.workers
          .get(pending.source)
          ?.sendInternalCommandResult(
            pending.target,
            pending.requestId,
            pending.parentRequestId,
            this.createInternalCommandRejection(
              pending.commandId,
              "utility.internal_command_target_exited",
              `${worker} utility exited before completing the internal command.`
            )
          );
      }
    }
  }

  private cancelPendingInternalCommands(code: string, message: string): void {
    for (const pending of [...this.pendingInternalCommands.values()]) {
      this.pendingInternalCommands.delete(pending.requestId);
      this.workers
        .get(pending.target)
        ?.cancelCommandRequest(pending.targetRequestId, new Error(message));
      this.workers
        .get(pending.source)
        ?.sendInternalCommandResult(
          pending.target,
          pending.requestId,
          pending.parentRequestId,
          this.createInternalCommandRejection(pending.commandId, code, message)
        );
    }
  }

  private createInternalCommandRejection(
    commandId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): CommandResult {
    return {
      status: "rejected",
      requestId: commandId,
      error: {
        code,
        message,
        ...(details ? { details } : {})
      }
    };
  }

  private authorizeInternalCommand(
    context: UtilityInternalCommandAuthorizationContext
  ): {
    authorized: boolean;
    code?: string;
    message?: string;
  } {
    const authorize = this.options.internalCommandAuthorize;
    if (!authorize) {
      return { authorized: true };
    }
    try {
      const decision = authorize(context);
      if (typeof decision === "boolean") {
        return { authorized: decision };
      }
      return decision;
    } catch (error: unknown) {
      return {
        authorized: false,
        code: "authorizer_exception",
        message:
          error instanceof Error
            ? error.message
            : "The internal command authorizer failed."
      };
    }
  }

  private handleUnexpectedExit(
    worker: UtilityWorkerName,
    reason: string
  ): void {
    this.restartReasons.set(worker, reason);
    this.options.onUnexpectedExit(worker, reason);
    if (this.shuttingDown || this.restartTimers.has(worker)) {
      return;
    }
    const timer = setTimeout(() => {
      this.restartTimers.delete(worker);
      if (!this.shuttingDown) {
        this.workers.get(worker)?.start();
      }
    }, 250);
    timer.unref();
    this.restartTimers.set(worker, timer);
  }

  private handleWorkerReady(worker: UtilityWorkerName): void {
    const reason = this.restartReasons.get(worker);
    if (!reason) {
      return;
    }
    this.restartReasons.delete(worker);
    this.options.onWorkerRestarted(worker, reason);
  }
}
