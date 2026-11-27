import { lstat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import { createId } from "@deepwrite/shared";
import {
  createEnvelope,
  SHORT_BOOK_ANALYSIS_MAX_FILE_BYTES,
  ShortBookAnalysisSourceSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { decodeAnalysisText } from "./text-decoder";
import { rejectedResult } from "../../../main/ipc/errors";
export interface ShortBookSourceCommandContext {
  dialog: Pick<Dialog, "showOpenDialog">;
  getMainWindow(): BrowserWindow;
  getWorkspaceDirectory(): Promise<string | null>;
  core(command: CommandEnvelope): Promise<CommandResult>;
}
export async function handleShortBookSourceCommands(
  ctx: ShortBookSourceCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("shortBookAnalysis.")) return undefined;
  try {
    let payload: unknown;
    // Internal snapshot commands are never accepted directly from Renderer.
    if (
      command.type === "shortBookAnalysis.storeSources" ||
      command.type === "shortBookAnalysis.deleteStoredSource" ||
      command.type === "shortBookAnalysis.querySources"
    )
      throw new Error("不允许直接调用内部来源命令。");
    const workspaceDirectory = await ctx.getWorkspaceDirectory();
    if (!workspaceDirectory)
      throw new Error("请先在设置中选择 DeepWrite 工作目录。");
    const forward = async (inner: CommandEnvelope) => {
      const result = await ctx.core(inner);
      if (result.status !== "accepted")
        throw new Error(result.error?.message ?? "来源操作失败。");
      return result.payload;
    };
    if (
      command.type === "shortBookAnalysis.listSources" ||
      command.type === "shortBookAnalysis.loadSource"
    ) {
      payload = await forward(
        createEnvelope(
          "shortBookAnalysis.querySources",
          {
            workspaceDirectory,
            ...(command.type === "shortBookAnalysis.loadSource"
              ? { sourceId: command.payload.sourceId }
              : {})
          },
          { id: command.id, context: command.context }
        )
      );
    } else if (command.type === "shortBookAnalysis.deleteSource") {
      payload = await forward(
        createEnvelope(
          "shortBookAnalysis.deleteStoredSource",
          { workspaceDirectory, sourceId: command.payload.sourceId },
          { id: command.id, context: command.context }
        )
      );
    } else {
      const sources = [];
      if (command.type === "shortBookAnalysis.chooseSources") {
        const selection = await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
          title: "导入短篇正文",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "短篇文本", extensions: ["txt", "md", "markdown"] }]
        });
        if (selection.canceled)
          return { status: "accepted", requestId: command.id, payload: null };
        if (selection.filePaths.length > 10)
          throw new Error("每次最多导入 10 本短篇。");
        for (const path of selection.filePaths) {
          const stat = await lstat(path);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > SHORT_BOOK_ANALYSIS_MAX_FILE_BYTES
          )
            throw new Error("请选择不超过 25 MB 的普通文本文件。");
          if (
            ![".txt", ".md", ".markdown"].includes(extname(path).toLowerCase())
          )
            throw new Error("仅支持 TXT / Markdown 文件。");
          sources.push(
            ShortBookAnalysisSourceSchema.parse({
              id: createId("short_source"),
              title: basename(path, extname(path)),
              text: decodeAnalysisText(await readFile(path)),
              kind: "file",
              importedAt: new Date().toISOString()
            })
          );
        }
      } else if (command.type === "shortBookAnalysis.addText")
        sources.push(
          ShortBookAnalysisSourceSchema.parse({
            ...command.payload,
            id: createId("short_source"),
            kind: "paste",
            importedAt: new Date().toISOString()
          })
        );
      else throw new Error("未知短篇拆书命令。");
      await forward(
        createEnvelope(
          "shortBookAnalysis.storeSources",
          { workspaceDirectory, sources },
          { id: command.id, context: command.context }
        )
      );
      payload =
        command.type === "shortBookAnalysis.addText" ? sources[0] : sources;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      "short_book_analysis.command_failed",
      error instanceof Error ? error.message : "短篇拆书操作失败。"
    );
  }
}
