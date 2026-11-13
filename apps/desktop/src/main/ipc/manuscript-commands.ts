import { createBookImageExportLoader } from "../book-images/export-assets";
import { BookImageError } from "../book-images/pick";
import {
  ExportLongManuscriptResultSchema,
  ExportShortManuscriptResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleManuscriptCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "manuscript.exportShort") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ExportShortManuscriptResultSchema.parse(
          await ctx.exportShortManuscript(
            ctx.getMainWindow(),
            command.payload,
            createBookImageExportLoader((coreCommand) =>
              ctx.supervisor.requestCommand("core", coreCommand, 0)
            )
          )
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof BookImageError
              ? error.code
              : "manuscript.export_failed",
          message: error instanceof Error ? error.message : "导出正文失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "manuscript.exportLong") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ExportLongManuscriptResultSchema.parse(
          await ctx.exportLongManuscript(
            ctx.getMainWindow(),
            command.payload,
            createBookImageExportLoader((coreCommand) =>
              ctx.supervisor.requestCommand("core", coreCommand, 0)
            )
          )
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof BookImageError
              ? error.code
              : "manuscript.export_failed",
          message: error instanceof Error ? error.message : "导出长篇失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
