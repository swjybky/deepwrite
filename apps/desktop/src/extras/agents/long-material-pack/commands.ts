import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type LongMaterialCoreOperation
} from "@deepwrite/contracts";
import {
  workspaceGroupParent,
  workspaceResourceParent
} from "../../../main/ipc/workspace-paths";
import type { ExtrasAgentCommandContext } from "../index";

const WRITES = new Set(["convert", "resolve", "applyGuide"]);

/** Main → Core with the paths only Main may resolve from the workspace. */
export async function longMaterialCore(
  context: Pick<
    ExtrasAgentCommandContext,
    "core" | "coreLong" | "getWorkspaceDirectory"
  >,
  command: CommandEnvelope,
  request: LongMaterialCoreOperation
): Promise<CommandResult> {
  const workspaceDirectory = await context.getWorkspaceDirectory();
  if (!workspaceDirectory) throw new Error("请先在设置中选择工作目录。");
  const core =
    WRITES.has(request.operation) && context.coreLong
      ? context.coreLong
      : context.core;
  const result = await core(
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "longMaterialPack.core",
        {
          workspaceDirectory,
          paths: {
            materials: workspaceResourceParent(workspaceDirectory, "material"),
            groups: workspaceGroupParent(workspaceDirectory, "material")
          },
          request
        },
        { id: `${command.id}-core`, context: command.context }
      )
    )
  );
  return { ...result, requestId: command.id };
}

export async function handleLongMaterialPackCommands(
  context: ExtrasAgentCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    !command.type.startsWith("longMaterialPack.") ||
    command.type === "longMaterialPack.core"
  )
    return undefined;
  try {
    return await longMaterialCore(context, command, {
      operation: command.type.slice("longMaterialPack.".length),
      ...(command.payload as object)
    } as LongMaterialCoreOperation);
  } catch (error) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "long_material_pack.failed",
        message:
          error instanceof Error ? error.message : "长篇转素材库操作失败。"
      }
    };
  }
}
