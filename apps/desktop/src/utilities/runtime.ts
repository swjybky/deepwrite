import {
  CommandResultSchema,
  SystemEventEnvelopeSchema,
  UtilityInboundMessageSchema,
  UtilityOutboundMessageSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityHealthPayload,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { nowIso } from "@deepwrite/shared";

export interface UtilityRuntimeOptions {
  mode?: string;
  commandHandler?: (
    command: CommandEnvelope,
    emitEvent: (event: SystemEventEnvelope) => void
  ) => Promise<CommandResult> | CommandResult;
  onShutdown?: () => Promise<void> | void;
}

function unwrapMessage(message: unknown): unknown {
  if (typeof message === "object" && message !== null && "data" in message) {
    return (message as { data: unknown }).data;
  }
  return message;
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  return {
    kind: error instanceof Error ? error.name : "unknown"
  };
}

export function bootUtility(
  worker: UtilityWorkerName,
  options: UtilityRuntimeOptions = {}
): void {
  const port = process.parentPort;
  if (!port) {
    throw new Error(`${worker} utility requires Electron utilityProcess parentPort.`);
  }

  const startedAt = nowIso();
  let lastHeartbeatAt = startedAt;
  let shuttingDown = false;
  const activeCommands = new Set<Promise<void>>();

  const post = (message: unknown): void => {
    port.postMessage(UtilityOutboundMessageSchema.parse(message));
  };

  const health = (): UtilityHealthPayload => ({
    name: worker,
    status: shuttingDown ? "stopped" : "ok",
    pid: process.pid,
    startedAt,
    lastHeartbeatAt,
    details: {
      mode: options.mode ?? "foundation",
      uptimeMs: Math.round(process.uptime() * 1000)
    }
  });

  const heartbeat = setInterval(() => {
    lastHeartbeatAt = nowIso();
    post({
      kind: "utility.heartbeat",
      worker,
      pid: process.pid,
      timestamp: lastHeartbeatAt
    });
  }, 5000);
  heartbeat.unref();

  const sendRejected = (
    requestId: string,
    commandId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): void => {
    post({
      kind: "utility.command.result",
      worker,
      requestId,
      result: {
        status: "rejected",
        requestId: commandId,
        error: {
          code,
          message,
          ...(details ? { details } : {})
        }
      }
    });
  };

  const handleCommand = async (requestId: string, command: CommandEnvelope): Promise<void> => {
    if (shuttingDown) {
      sendRejected(
        requestId,
        command.id,
        "utility.shutting_down",
        `${worker} utility is shutting down.`
      );
      return;
    }

    const emitEvent = (event: SystemEventEnvelope): void => {
      post({
        kind: "utility.command.event",
        worker,
        requestId,
        event: SystemEventEnvelopeSchema.parse(event)
      });
    };

    try {
      const result = CommandResultSchema.parse(
        options.commandHandler
          ? await options.commandHandler(command, emitEvent)
          : {
              status: "rejected",
              requestId: command.id,
              error: {
                code: "utility.unsupported_command",
                message: `${worker} utility does not handle ${command.type}.`
              }
            }
      );

      if (result.requestId !== command.id) {
        throw new Error("Utility command result requestId does not match command id.");
      }

      post({
        kind: "utility.command.result",
        worker,
        requestId,
        result
      });
    } catch (error: unknown) {
      sendRejected(
        requestId,
        command.id,
        "utility.command_failed",
        error instanceof Error ? error.message : "Utility command failed.",
        safeErrorDetails(error)
      );
    }
  };

  const shutdown = async (requestId: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(heartbeat);
    try {
      await Promise.allSettled([...activeCommands]);
      await options.onShutdown?.();
    } finally {
      post({
        kind: "utility.shutdown_ack",
        worker,
        requestId,
        timestamp: nowIso()
      });
      setTimeout(() => process.exit(0), 20).unref();
    }
  };

  port.on("message", (message: unknown) => {
    const raw = unwrapMessage(message);
    const parsed = UtilityInboundMessageSchema.safeParse(raw);

    if (!parsed.success) {
      const record =
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>)
          : undefined;
      const requestId = record?.requestId;
      if (
        record?.kind === "utility.command.request" &&
        typeof requestId === "string"
      ) {
        sendRejected(
          requestId,
          requestId,
          "utility.invalid_command_message",
          "Utility command request failed schema validation."
        );
      }
      return;
    }

    const inbound = parsed.data;
    if (inbound.kind === "utility.health.request") {
      lastHeartbeatAt = nowIso();
      post({
        kind: "utility.health",
        worker,
        requestId: inbound.requestId,
        payload: health()
      });
      return;
    }

    if (inbound.kind === "utility.command.request") {
      const active = handleCommand(inbound.requestId, inbound.command);
      activeCommands.add(active);
      void active.finally(() => activeCommands.delete(active));
      return;
    }

    void shutdown(inbound.requestId);
  });

  process.once("SIGTERM", () => void shutdown("signal_sigterm"));
  process.once("SIGINT", () => void shutdown("signal_sigint"));

  post({
    kind: "utility.ready",
    worker,
    pid: process.pid,
    startedAt
  });
}
