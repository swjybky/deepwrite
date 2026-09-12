import { handleConversationExportCommands } from "./conversation-export-commands";
import {
  SystemHealthPayloadSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { handleCatalogCommands } from "./catalog-commands";
import type { IpcCommandContext } from "./command-types";
import { isForbiddenRendererCommand } from "./forbidden-commands";
import { handleLongCommands } from "./long-commands";
import { handleManuscriptCommands } from "./manuscript-commands";
import { handleModelCommands } from "./model-commands";
import { handleRendererStateCommands } from "./renderer-state-commands";
import { handleSessionCommands } from "./session-commands";
import { handleSettingsCommands } from "./settings-commands";

export async function dispatchCommand(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult> {
  if (isForbiddenRendererCommand(command.type)) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "ipc.forbidden_internal_command",
        message: "Renderer cannot invoke internal commands."
      }
    };
  }
  if (command.type === "system.health") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: SystemHealthPayloadSchema.parse(
        await ctx.supervisor.collectHealth()
      )
    };
  }

  const result =
    (await handleManuscriptCommands(ctx, command)) ??
    (await handleSettingsCommands(ctx, command)) ??
    (await handleLongCommands(ctx, command)) ??
    (await handleCatalogCommands(ctx, command)) ??
    (await handleRendererStateCommands(ctx, command)) ??
    (await handleConversationExportCommands(ctx, command)) ??
    (await handleModelCommands(ctx, command)) ??
    (await handleSessionCommands(ctx, command));
  if (result) {
    return result;
  }
  throw new Error("Unreachable command variant after schema validation.");
}
