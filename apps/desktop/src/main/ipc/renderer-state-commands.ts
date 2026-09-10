import {
  RendererStateHistoryKeysResultSchema,
  RendererStateLoadResultSchema,
  RendererStateMutationResultSchema,
  RendererStateMigrationResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleRendererStateCommands(
  ctx: Pick<IpcCommandContext, "supervisor">,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "rendererState.listHistoryKeys" ||
    command.type === "rendererState.migrateHistory" ||
    command.type === "rendererState.load" ||
    command.type === "rendererState.save" ||
    command.type === "rendererState.remove"
  ) {
    try {
      const result = await ctx.supervisor.requestCommand(
        "core",
        command,
        60_000
      );
      if (result.status === "rejected") return result;
      return {
        status: "accepted",
        requestId: command.id,
        payload:
          command.type === "rendererState.listHistoryKeys"
            ? RendererStateHistoryKeysResultSchema.parse(result.payload)
            : command.type === "rendererState.migrateHistory"
              ? RendererStateMigrationResultSchema.parse(result.payload)
              : command.type === "rendererState.load"
                ? RendererStateLoadResultSchema.parse(result.payload)
                : RendererStateMutationResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      const timedOut = error instanceof UtilityCommandTimeoutError;
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: timedOut
            ? "renderer_state.command_timeout"
            : "renderer_state.forward_failed",
          message: timedOut
            ? "会话历史持久化操作超时。"
            : error instanceof Error
              ? error.message
              : "会话历史持久化操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
