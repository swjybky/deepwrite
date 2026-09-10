import {
  AgentTeamCatalogSnapshotSchema,
  AgentTeamPackageExportResultSchema,
  AgentTeamPackageInstallResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  downloadAgentTeamPackage,
  installAgentTeamPackage
} from "../agent-team-package-service";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
export async function handleAgentTeamCommands(
  ctx: Pick<
    IpcCommandContext,
    "requireAgentTeamConfigStore" | "dialog" | "getDocumentsPath"
  > & { getMainWindow: () => Electron.BrowserWindow | undefined },
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "agentTeams.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: AgentTeamCatalogSnapshotSchema.parse(
          await ctx.requireAgentTeamConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent_teams.list_failed",
          message:
            error instanceof Error ? error.message : "加载智能体团队设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "agentTeams.exportPackage") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: AgentTeamPackageExportResultSchema.parse(
          await downloadAgentTeamPackage(
            requireMainWindow(ctx.getMainWindow()),
            ctx.dialog,
            ctx.requireAgentTeamConfigStore(),
            command.payload,
            ctx.getDocumentsPath()
          )
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent_teams.export_failed",
          message:
            error instanceof Error ? error.message : "下载智能体团队失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "agentTeams.installPackage") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: AgentTeamPackageInstallResultSchema.parse(
          await installAgentTeamPackage(
            requireMainWindow(ctx.getMainWindow()),
            ctx.dialog,
            ctx.requireAgentTeamConfigStore(),
            ctx.getDocumentsPath()
          )
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent_teams.install_failed",
          message:
            error instanceof Error ? error.message : "安装智能体团队失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (
    command.type === "agentTeams.create" ||
    command.type === "agentTeams.rename" ||
    command.type === "agentTeams.delete" ||
    command.type === "agentTeams.setEnabled" ||
    command.type === "agentTeams.save" ||
    command.type === "agentTeams.saveBuiltins"
  ) {
    try {
      const store = ctx.requireAgentTeamConfigStore();
      const snapshot =
        command.type === "agentTeams.create"
          ? await store.create(command.payload)
          : command.type === "agentTeams.rename"
            ? await store.rename(command.payload)
            : command.type === "agentTeams.delete"
              ? await store.delete(command.payload)
              : command.type === "agentTeams.setEnabled"
                ? await store.setEnabled(command.payload)
                : command.type === "agentTeams.saveBuiltins"
                  ? await store.saveBuiltins(command.payload)
                  : await store.save(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: AgentTeamCatalogSnapshotSchema.parse(snapshot)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent_teams.save_failed",
          message:
            error instanceof Error ? error.message : "保存智能体团队设置失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  return undefined;
}

function requireMainWindow(
  window: Electron.BrowserWindow | undefined
): Electron.BrowserWindow {
  if (!window || window.isDestroyed()) throw new Error("主窗口当前不可用。");
  return window;
}
