import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import {
  UtilityOutboundMessageSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityHealthPayload,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";

type WorkerStatus = UtilityHealthPayload["status"];

interface PendingHealthCheck {
  resolve(payload: UtilityHealthPayload): void;
  timer: NodeJS.Timeout;
}

interface PendingCommand {
  commandId: string;
  resolve(result: CommandResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingShutdown {
  resolve(): void;
  timer: NodeJS.Timeout;
}

interface UtilitySupervisorOptions {
  onUtilityEvent(event: SystemEventEnvelope, worker: UtilityWorkerName): void;
  onUnexpectedExit(worker: UtilityWorkerName, reason: string): void;
  onWorkerRestarted(worker: UtilityWorkerName, reason: string): void;
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
    private readonly onUnexpectedExit: (worker: UtilityWorkerName, reason: string) => void,
    private readonly onReady: (worker: UtilityWorkerName) => void,
    private readonly onUtilityEvent: (
      event: SystemEventEnvelope,
      worker: UtilityWorkerName
    ) => void
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
      this.rejectPendingCommands(new Error(`${this.name} utility exited: ${reason}`));
      this.resolvePendingShutdown();

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
        resolve(this.snapshot(this.status === "starting" ? "starting" : "degraded"));
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

  requestCommand(command: CommandEnvelope, timeoutMs = 60_000): Promise<CommandResult> {
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

    if (this.pendingCommands.has(command.id)) {
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
      const timer = setTimeout(() => {
        this.pendingCommands.delete(command.id);
        reject(new Error(`${this.name} utility command timed out: ${command.type}`));
      }, timeoutMs);
      this.pendingCommands.set(command.id, {
        commandId: command.id,
        resolve,
        reject,
        timer
      });

      try {
        child.postMessage({
          kind: "utility.command.request",
          requestId: command.id,
          command
        });
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pendingCommands.delete(command.id);
        reject(error instanceof Error ? error : new Error("Failed to post utility command."));
      }
    });
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

  private snapshot(status: WorkerStatus = this.status): UtilityHealthPayload {
    return {
      name: this.name,
      status,
      ...(this.pid ? { pid: this.pid } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.lastHeartbeatAt ? { lastHeartbeatAt: this.lastHeartbeatAt } : {}),
      details: { entry: this.entryPath }
    };
  }

  private handleMessage(rawMessage: unknown): void {
    const parsed = UtilityOutboundMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      const raw = rawMessage as Record<string, unknown> | null;
      const requestId = raw && typeof raw.requestId === "string" ? raw.requestId : undefined;
      const pending = requestId ? this.pendingCommands.get(requestId) : undefined;
      if (requestId && pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(requestId);
        pending.reject(new Error(`${this.name} utility emitted an invalid command message.`));
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
        pending.reject(new Error("Utility result requestId does not match pending command."));
        return;
      }
      pending.resolve(message.result);
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
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingCommands.delete(requestId);
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
  private shuttingDown = false;

  constructor(private readonly options: UtilitySupervisorOptions) {
    const makeWorker = (name: UtilityWorkerName): UtilityWorker =>
      new UtilityWorker(
        name,
        join(__dirname, "utilities", `${name}-entry.js`),
        (worker, reason) => this.handleUnexpectedExit(worker, reason),
        (worker) => this.handleWorkerReady(worker),
        options.onUtilityEvent
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
    await Promise.all([...this.workers.values()].map((worker) => worker.shutdown()));
  }

  private handleUnexpectedExit(worker: UtilityWorkerName, reason: string): void {
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
