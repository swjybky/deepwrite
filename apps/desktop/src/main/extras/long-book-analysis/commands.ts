import {
  LongBookAnalysisSavedSourceCatalogSchema,
  LongBookAnalysisSettingsSchema,
  LongBookAnalysisSourceSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { BrowserWindow, Dialog } from "electron";
import type { LongBookAnalysisConfigStore } from "./config-store";
import type { LongBookAnalysisPlanStore } from "./plan-store";
import { readLongBookAnalysisSource } from "./source-reader";
import { LongBookAnalysisSourceStore } from "./source-store";

export interface LongBookAnalysisCommandContext {
  dialog: Pick<Dialog, "showOpenDialog">;
  getMainWindow(): BrowserWindow;
  configStore(): LongBookAnalysisConfigStore;
  /** Lazy, like `configStore`: the store needs `userData`, resolved at call time. */
  planStore(): LongBookAnalysisPlanStore;
  getWorkspaceDirectory(): Promise<string | null>;
}

async function sourceStore(
  context: LongBookAnalysisCommandContext
): Promise<LongBookAnalysisSourceStore> {
  const workspaceDirectory = await context.getWorkspaceDirectory();
  if (!workspaceDirectory) {
    throw new Error("请先在设置中选择 DeepWrite 工作目录。");
  }
  return new LongBookAnalysisSourceStore(workspaceDirectory);
}

function failure(
  command: CommandEnvelope,
  code: string,
  fallback: string,
  error: unknown
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: {
      code,
      message: error instanceof Error ? error.message : fallback
    }
  };
}

export async function handleLongBookAnalysisCommands(
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
      await (await sourceStore(context)).save(source);
      return {
        status: "accepted",
        requestId: command.id,
        payload: source
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis.source_failed",
        "读取长篇拆书来源失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysis.listSources") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongBookAnalysisSavedSourceCatalogSchema.parse(
          await (await sourceStore(context)).list()
        )
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis.sources_list_failed",
        "加载已导入长篇失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysis.loadSource") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongBookAnalysisSourceSchema.parse(
          await (await sourceStore(context)).load(command.payload.sourceId)
        )
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis.source_load_failed",
        "读取已导入长篇失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysisSettings.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongBookAnalysisSettingsSchema.parse(
          await context.configStore().list()
        )
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_settings.list_failed",
        "加载长篇拆书预设失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysisSettings.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongBookAnalysisSettingsSchema.parse(
          await context.configStore().save(command.payload)
        )
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_settings.save_failed",
        "保存长篇拆书预设失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysisSettings.reset") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongBookAnalysisSettingsSchema.parse(
          await context.configStore().reset(command.payload.presetId)
        )
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_settings.reset_failed",
        "恢复长篇拆书默认预设失败。",
        error
      );
    }
  }
  // --- batch plans -------------------------------------------------------------
  // Plan files are pure persistence for the renderer-side scheduler: the main
  // process never schedules anything, it only stores what the renderer hands it.

  if (command.type === "longBookAnalysisPlan.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: { plans: await context.planStore().list() }
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_plan.list_failed",
        "读取拆书计划失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysisPlan.save") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: { plan: await context.planStore().save(command.payload.plan) }
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_plan.save_failed",
        "保存拆书计划失败。",
        error
      );
    }
  }

  if (command.type === "longBookAnalysisPlan.remove") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          removed: await context.planStore().remove(command.payload.planId)
        }
      };
    } catch (error: unknown) {
      return failure(
        command,
        "long_book_analysis_plan.remove_failed",
        "删除拆书计划失败。",
        error
      );
    }
  }
  return undefined;
}
