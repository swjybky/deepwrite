import { join } from "node:path";
import type { BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  MysteryAgentSettingsSchema,
  MysteryApplyOperationsResultSchema,
  MysteryExportBundleResultSchema,
  MysteryListBooksResultSchema,
  MysteryOpenBookResultSchema,
  MysteryPreviewOperationsResultSchema,
  MysteryReadAgentsMdResultSchema,
  MysteryReadDocumentResultSchema,
  MysteryRemoveBookResultSchema,
  MysteryRestoreOperationsResultSchema,
  MysterySearchResultSchema,
  MysteryWorkspaceIndexResultSchema,
  MysteryWriteAgentsMdResultSchema,
  MysteryWriteDocumentResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  createBookImageExportLoader,
  type BookImageExportLoader
} from "../book-images/export-assets";
import { BookImageError } from "../book-images/pick";
import type { MysteryAgentConfigStore } from "../mystery-agent-config-store";
import { exportMysteryBundle } from "../mystery-bundle-export";
import {
  UtilityCommandTimeoutError,
  type UtilitySupervisor
} from "../supervisor";
import { safeErrorDetails } from "./errors";
import { rejectedResult } from "./errors";

export interface MysteryIpcCommandContext {
  getMainWindow: () => BrowserWindow | undefined;
  supervisor: Pick<UtilitySupervisor, "requestCommand">;
  dialog: Pick<Electron.Dialog, "showOpenDialog">;
  requireSelectedWorkspaceDirectory: () => Promise<string | null>;
  requireMysteryAgentConfigStore: () => MysteryAgentConfigStore;
  forgetBookTeamBinding?: (bookId: string) => Promise<void>;
  loadBookImageExportAssets?: () => BookImageExportLoader;
}

export async function handleMysteryCommands(
  ctx: MysteryIpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "mystery.createBook" ||
    command.type === "mystery.openExisting"
  ) {
    try {
      const workspaceDirectory = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspaceDirectory) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      const defaultPath = join(workspaceDirectory, "mystery-books");
      let selectedPath = defaultPath;
      if (command.type === "mystery.openExisting") {
        const selection = await ctx.dialog.showOpenDialog({
          title: "打开已有剧本杀作品",
          defaultPath,
          properties: ["openDirectory"]
        });
        if (selection.canceled || selection.filePaths.length === 0) {
          return {
            status: "accepted",
            requestId: command.id,
            payload: null
          };
        }
        selectedPath = selection.filePaths[0]!;
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        command.type === "mystery.createBook"
          ? createEnvelope(
              "mystery.createBookAtPath",
              {
                parentDirectory: selectedPath,
                input: command.payload
              },
              { id: command.id, context: command.context }
            )
          : createEnvelope(
              "mystery.openAtPath",
              { projectDirectory: selectedPath },
              { id: command.id, context: command.context }
            )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        60_000
      );
      if (result.status === "rejected") return result;
      return {
        status: "accepted",
        requestId: command.id,
        payload: MysteryOpenBookResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "mystery.forward_failed",
        error instanceof Error ? error.message : "剧本杀目录操作失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "mystery.exportBundle") {
    try {
      const loadImages =
        ctx.loadBookImageExportAssets?.() ??
        createBookImageExportLoader((coreCmd) =>
          ctx.supervisor.requestCommand("core", coreCmd, 0)
        );
      return {
        status: "accepted",
        requestId: command.id,
        payload: MysteryExportBundleResultSchema.parse(
          await exportMysteryBundle(
            ctx.getMainWindow(),
            command.payload,
            (coreCmd) => ctx.supervisor.requestCommand("core", coreCmd, 60_000),
            loadImages
          )
        )
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        error instanceof BookImageError ? error.code : "mystery.export_failed",
        error instanceof Error ? error.message : "导出剧本杀开本包失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "mysteryAgents.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: MysteryAgentSettingsSchema.parse(
          await ctx.requireMysteryAgentConfigStore().list()
        )
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "mystery_agents.list_failed",
        error instanceof Error ? error.message : "加载剧本杀智能体设置失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "mysteryAgents.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: MysteryAgentSettingsSchema.parse(
          await ctx.requireMysteryAgentConfigStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "mystery_agents.save_failed",
        error instanceof Error ? error.message : "保存剧本杀智能体设置失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (command.type === "mysteryAgents.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: MysteryAgentSettingsSchema.parse(
          await ctx
            .requireMysteryAgentConfigStore()
            .reset(command.payload.agentId)
        )
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "mystery_agents.reset_failed",
        error instanceof Error
          ? error.message
          : "恢复剧本杀智能体默认设置失败。",
        safeErrorDetails(error)
      );
    }
  }

  if (
    command.type === "mystery.list" ||
    command.type === "mystery.open" ||
    command.type === "mystery.duplicateBook" ||
    command.type === "mystery.rename" ||
    command.type === "mystery.updateBindings" ||
    command.type === "mystery.getWorkspaceIndex" ||
    command.type === "mystery.readDocument" ||
    command.type === "mystery.writeDocument" ||
    command.type === "mystery.readAgentsMd" ||
    command.type === "mystery.writeAgentsMd" ||
    command.type === "mystery.search" ||
    command.type === "mystery.previewOperations" ||
    command.type === "mystery.applyOperations" ||
    command.type === "mystery.restoreOperations" ||
    command.type === "mystery.unregister" ||
    command.type === "mystery.delete"
  ) {
    try {
      const result = await ctx.supervisor.requestCommand(
        "core",
        command,
        60_000
      );
      if (result.status === "rejected") return result;
      let payload: unknown;
      switch (command.type) {
        case "mystery.list":
          payload = MysteryListBooksResultSchema.parse(result.payload);
          break;
        case "mystery.open":
        case "mystery.duplicateBook":
        case "mystery.rename":
        case "mystery.updateBindings":
          payload = MysteryOpenBookResultSchema.parse(result.payload);
          break;
        case "mystery.getWorkspaceIndex":
          payload = MysteryWorkspaceIndexResultSchema.parse(result.payload);
          break;
        case "mystery.readDocument":
          payload = MysteryReadDocumentResultSchema.parse(result.payload);
          break;
        case "mystery.writeDocument":
          payload = MysteryWriteDocumentResultSchema.parse(result.payload);
          break;
        case "mystery.readAgentsMd":
          payload = MysteryReadAgentsMdResultSchema.parse(result.payload);
          break;
        case "mystery.writeAgentsMd":
          payload = MysteryWriteAgentsMdResultSchema.parse(result.payload);
          break;
        case "mystery.search":
          payload = MysterySearchResultSchema.parse(result.payload);
          break;
        case "mystery.previewOperations":
          payload = MysteryPreviewOperationsResultSchema.parse(result.payload);
          break;
        case "mystery.applyOperations":
          payload = MysteryApplyOperationsResultSchema.parse(result.payload);
          break;
        case "mystery.restoreOperations":
          payload = MysteryRestoreOperationsResultSchema.parse(result.payload);
          break;
        case "mystery.unregister":
          payload = MysteryRemoveBookResultSchema.parse(result.payload);
          break;
        case "mystery.delete":
          payload = MysteryRemoveBookResultSchema.parse(result.payload);
          await ctx.forgetBookTeamBinding?.(command.payload.bookId);
          break;
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        error instanceof UtilityCommandTimeoutError
          ? "mystery.command_timeout"
          : "mystery.forward_failed",
        error instanceof UtilityCommandTimeoutError
          ? "剧本杀操作等待超时，结果尚未确认；请刷新作品核对后再决定是否重试。"
          : error instanceof Error
            ? error.message
            : "剧本杀操作失败。",
        safeErrorDetails(error)
      );
    }
  }

  return undefined;
}
