import {
  CommandResultSchema,
  SystemEventEnvelopeSchema,
  UtilityInboundMessageSchema,
  UtilityOutboundMessageSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityInternalCommandTarget,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { createUtilityLifecycle } from "./utility-lifecycle";

const DEFAULT_INTERNAL_COMMAND_TIMEOUT_MS = 60_000;
const INTERNAL_COMMAND_RESPONSE_GRACE_MS = 250;
const MAX_PENDING_INTERNAL_COMMANDS = 32;

export interface UtilityInternalCommandOptions {
  timeoutMs?: number;
}

export interface UtilityCommandHandlerContext {
  worker: UtilityWorkerName;
  requestId: string;
  requestInternalCommand(
    target: UtilityInternalCommandTarget,
    command: CommandEnvelope,
    options?: UtilityInternalCommandOptions
  ): Promise<CommandResult>;
}

export interface UtilityRuntimeOptions {
  mode?: string;
  commandHandler?: (
    command: CommandEnvelope,
    emitEvent: (event: SystemEventEnvelope) => void,
    context?: UtilityCommandHandlerContext
  ) => Promise<CommandResult> | CommandResult;
  onShutdown?: () => Promise<void> | void;
}

interface PendingInternalCommand {
  commandId: string;
  parentRequestId: string;
  target: UtilityInternalCommandTarget;
  resolve(result: CommandResult): void;
  timer: NodeJS.Timeout;
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

function rejectedCommandResult(
  commandId: string,
  code: string,
  message: string
): CommandResult {
  return {
    status: "rejected",
    requestId: commandId,
    error: {
      code,
      message
    }
  };
}

export function bootUtility(
  worker: UtilityWorkerName,
  options: UtilityRuntimeOptions = {}
): void {
  const port = process.parentPort;
  if (!port) {
    throw new Error(
      `${worker} utility requires Electron utilityProcess parentPort.`
    );
  }

  const activeCommands = new Set<Promise<void>>();
  const pendingInternalCommands = new Map<string, PendingInternalCommand>();

  const post = (message: unknown): void => {
    port.postMessage(UtilityOutboundMessageSchema.parse(message));
  };

  const lifecycle = createUtilityLifecycle(worker, {
    mode: options.mode,
    post,
    onStopping: () =>
      rejectPendingInternalCommands(
        "utility.internal_command_cancelled",
        `${worker} utility is shutting down.`
      ),
    async drain() {
      await Promise.allSettled([...activeCommands]);
      await options.onShutdown?.();
    }
  });

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

  const settleInternalCommand = (
    requestId: string,
    result: CommandResult
  ): void => {
    const pending = pendingInternalCommands.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingInternalCommands.delete(requestId);
    pending.resolve(result);
  };

  const rejectPendingInternalCommands = (
    code: string,
    message: string
  ): void => {
    for (const [requestId, pending] of pendingInternalCommands) {
      settleInternalCommand(
        requestId,
        rejectedCommandResult(pending.commandId, code, message)
      );
    }
  };

  const requestInternalCommand = (
    parentRequestId: string,
    target: UtilityInternalCommandTarget,
    command: CommandEnvelope,
    requestOptions?: UtilityInternalCommandOptions
  ): Promise<CommandResult> => {
    if (worker !== "agent") {
      return Promise.resolve(
        rejectedCommandResult(
          command.id,
          "utility.internal_command_forbidden",
          `${worker} utility cannot request internal utility commands.`
        )
      );
    }
    if (lifecycle.isShuttingDown()) {
      return Promise.resolve(
        rejectedCommandResult(
          command.id,
          "utility.shutting_down",
          `${worker} utility is shutting down.`
        )
      );
    }
    if (pendingInternalCommands.size >= MAX_PENDING_INTERNAL_COMMANDS) {
      return Promise.resolve(
        rejectedCommandResult(
          command.id,
          "utility.internal_command_limit",
          "Too many internal utility commands are pending."
        )
      );
    }

    const timeoutMs =
      requestOptions?.timeoutMs ?? DEFAULT_INTERNAL_COMMAND_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      return Promise.resolve(
        rejectedCommandResult(
          command.id,
          "utility.internal_command_invalid_timeout",
          "Internal utility command timeout must be between 1 and 120000 milliseconds."
        )
      );
    }

    const requestId = createId("internal_command");
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        settleInternalCommand(
          requestId,
          rejectedCommandResult(
            command.id,
            "utility.internal_command_timeout",
            `${target} utility did not return an internal command result in time.`
          )
        );
      }, timeoutMs + INTERNAL_COMMAND_RESPONSE_GRACE_MS);
      timer.unref();
      pendingInternalCommands.set(requestId, {
        commandId: command.id,
        parentRequestId,
        target,
        resolve,
        timer
      });

      try {
        post({
          kind: "utility.internal.command.request",
          worker,
          target,
          requestId,
          parentRequestId,
          timeoutMs,
          command
        });
      } catch {
        settleInternalCommand(
          requestId,
          rejectedCommandResult(
            command.id,
            "utility.internal_command_unavailable",
            "Failed to request an internal utility command."
          )
        );
      }
    });
  };

  const handleCommand = async (
    requestId: string,
    command: CommandEnvelope
  ): Promise<void> => {
    if (lifecycle.isShuttingDown()) {
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
          ? await options.commandHandler(command, emitEvent, {
              worker,
              requestId,
              requestInternalCommand: (
                target,
                internalCommand,
                requestOptions
              ) =>
                requestInternalCommand(
                  requestId,
                  target,
                  internalCommand,
                  requestOptions
                )
            })
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
        throw new Error(
          "Utility command result requestId does not match command id."
        );
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
    if (inbound.kind === "utility.internal.command.result") {
      if (worker !== inbound.worker) {
        return;
      }
      const pending = pendingInternalCommands.get(inbound.requestId);
      if (!pending) {
        return;
      }
      if (
        inbound.parentRequestId !== pending.parentRequestId ||
        inbound.target !== pending.target ||
        inbound.result.requestId !== pending.commandId
      ) {
        settleInternalCommand(
          inbound.requestId,
          rejectedCommandResult(
            pending.commandId,
            "utility.internal_command_invalid_result",
            "Internal utility command result did not match the pending request."
          )
        );
        return;
      }
      settleInternalCommand(inbound.requestId, inbound.result);
      return;
    }

    if (inbound.kind === "utility.health.request") {
      post({
        kind: "utility.health",
        worker,
        requestId: inbound.requestId,
        payload: lifecycle.health()
      });
      return;
    }

    if (inbound.kind === "utility.command.request") {
      const active = handleCommand(inbound.requestId, inbound.command);
      activeCommands.add(active);
      void active.finally(() => activeCommands.delete(active));
      return;
    }

    void lifecycle.shutdown(inbound.requestId);
  });

  lifecycle.start();
}
