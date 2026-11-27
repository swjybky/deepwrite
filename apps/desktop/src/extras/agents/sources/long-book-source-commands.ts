import {
  LongBookAnalysisSourceSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { BrowserWindow, Dialog } from "electron";
import { readLongBookAnalysisSource } from "./long-book-source-reader";
import { rejectedResult } from "../../../main/ipc/errors";

export interface LongBookAnalysisCommandContext {
  dialog: Pick<Dialog, "showOpenDialog">;
  getMainWindow(): BrowserWindow;
  getWorkspaceDirectory(): Promise<string | null>;
  core(command: CommandEnvelope): Promise<CommandResult>;
}

async function sourceCommand(
  context: LongBookAnalysisCommandContext,
  command: CommandEnvelope,
  payload: Record<string, unknown>
): Promise<CommandResult> {
  const workspaceDirectory = await context.getWorkspaceDirectory();
  if (!workspaceDirectory) throw new Error("请先选择工作目录。");
  const result = await context.core(
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "longBookAnalysis.coreSource",
        { workspaceDirectory, ...payload },
        { id: command.id + "-core", context: command.context }
      )
    )
  );
  return { ...result, requestId: command.id };
}

function failure(
  command: CommandEnvelope,
  code: string,
  fallback: string,
  error: unknown
): CommandResult {
  return rejectedResult(
    command.id,
    code,
    error instanceof Error ? error.message : fallback
  );
}

export async function handleLongBookSourceCommands(
  context: LongBookAnalysisCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "longBookAnalysis.chooseSource") {
    try {
      const kind = command.payload.kind;
      const selection = await context.dialog.showOpenDialog(
        context.getMainWindow(),
        kind === "txt"
          ? {
              title: "选择长篇 TXT",
              properties: ["openFile"],
              filters: [{ name: "TXT 正文", extensions: ["txt"] }]
            }
          : {
              title: "选择按章节整理的文件夹",
              properties: ["openDirectory"]
            }
      );
      if (selection.canceled || !selection.filePaths[0]) {
        return { status: "accepted", requestId: command.id, payload: null };
      }
      const source = LongBookAnalysisSourceSchema.parse(
        await readLongBookAnalysisSource(kind, selection.filePaths[0])
      );
      return sourceCommand(context, command, { operation: "import", source });
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis.source_failed",
        "读取长篇拆书来源失败。",
        error
      );
    }
  }

  const operation =
    command.type === "longBookAnalysis.listSources"
      ? "list"
      : command.type === "longBookAnalysis.loadSource"
        ? "load"
        : command.type === "longBookAnalysis.deleteSource"
          ? "delete"
          : command.type === "longBookAnalysis.saveSource"
            ? "save"
            : command.type === "longBookAnalysis.confirmSource"
              ? "confirm"
              : undefined;
  if (operation) {
    try {
      return await sourceCommand(context, command, {
        operation,
        ...(command.type === "longBookAnalysis.loadSource" ||
        command.type === "longBookAnalysis.deleteSource"
          ? { sourceId: command.payload.sourceId }
          : {}),
        ...(command.type === "longBookAnalysis.saveSource"
          ? { save: command.payload }
          : {}),
        ...(command.type === "longBookAnalysis.confirmSource"
          ? { confirm: command.payload }
          : {})
      });
    } catch (error) {
      return failure(
        command,
        "long_book_analysis.source_failed",
        "来源操作失败。",
        error
      );
    }
  }

  return undefined;
}
