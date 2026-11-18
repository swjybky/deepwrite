import {
  ListDocumentVersionsResultSchema,
  ReadDocumentVersionResultSchema,
  RestoreDocumentVersionResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  activeRunResourceIds,
  hasActiveResourceRun
} from "../active-resource-runs";
import {
  catalogCommandTimeoutMessage,
  catalogCommandTimeoutMs
} from "../catalog-command-timeout";
import type { MainInternalCommandActiveRun } from "../internal-command-authorizer";
import {
  UtilityCommandTimeoutError,
  type UtilitySupervisor
} from "../supervisor";
import { safeErrorDetails } from "./errors";

export function filterVersionOrigin(
  command: CommandEnvelope,
  enabled: boolean
): CommandEnvelope {
  if (
    !enabled &&
    (command.type === "catalog.saveDocument" ||
      command.type === "catalog.createDraftSections" ||
      command.type === "long.applyOperations" ||
      command.type === "mystery.writeDocument" ||
      command.type === "mystery.applyOperations") &&
    command.payload.versionOrigin
  ) {
    const { versionOrigin: _, ...payload } = command.payload;
    return { ...command, payload } as CommandEnvelope;
  }
  return command;
}

interface DocumentVersionCommandContext {
  versionHistoryEnabled: boolean;
  activeRuns: ReadonlyMap<
    string,
    Pick<MainInternalCommandActiveRun, "externalResourceIds" | "resourceId">
  >;
  supervisor: Pick<UtilitySupervisor, "requestCommand">;
}

export async function handleDocumentVersionCommands(
  context: DocumentVersionCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type !== "versions.list" &&
    command.type !== "versions.read" &&
    command.type !== "versions.restore"
  )
    return undefined;
  if (!context.versionHistoryEnabled) {
    return {
      status: "rejected",
      requestId: command.id,
      error: { code: "version.disabled", message: "版本控制已关闭。" }
    };
  }
  if (
    command.type === "versions.restore" &&
    hasActiveResourceRun(
      context.activeRuns.size,
      activeRunResourceIds(context.activeRuns.values()),
      [command.payload.target.bookId]
    )
  ) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "version.busy",
        message: "智能体正在修改这部作品，请等运行结束后再回退。"
      }
    };
  }
  try {
    const result = await context.supervisor.requestCommand(
      "core",
      command,
      catalogCommandTimeoutMs(command.type)
    );
    if (result.status === "rejected") return result;
    const payload =
      command.type === "versions.list"
        ? ListDocumentVersionsResultSchema.parse(result.payload)
        : command.type === "versions.read"
          ? ReadDocumentVersionResultSchema.parse(result.payload)
          : RestoreDocumentVersionResultSchema.parse(result.payload);
    return { status: "accepted", requestId: command.id, payload };
  } catch (error: unknown) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code:
          error instanceof UtilityCommandTimeoutError
            ? "version.command_timeout"
            : "version.forward_failed",
        message:
          error instanceof UtilityCommandTimeoutError
            ? catalogCommandTimeoutMessage(command.type)
            : error instanceof Error
              ? error.message
              : "版本操作失败。",
        details: safeErrorDetails(error)
      }
    };
  }
}
