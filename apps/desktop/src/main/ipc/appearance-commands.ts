import { nativeText } from "../native-i18n";
import {
  AppearanceFontCatalogSnapshotSchema,
  AppearanceFontInstallResultSchema,
  AppearanceFontRemoveResultSchema,
  AppearanceSettingsSnapshotSchema,
  AppearanceSettingsSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export type AppearanceCommandContext = Pick<
  IpcCommandContext,
  | "dialog"
  | "getMainWindow"
  | "requireAppearanceService"
  | "syncNativeAppearanceChrome"
>;

function rejected(
  command: CommandEnvelope,
  code: string,
  fallbackMessage: string,
  error: unknown
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: {
      code,
      message: fallbackMessage,
      details: safeErrorDetails(error)
    }
  };
}

export async function handleAppearanceCommands(
  ctx: AppearanceCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "appearance.list") {
    try {
      const snapshot = AppearanceSettingsSnapshotSchema.parse(
        await ctx.requireAppearanceService().list()
      );
      ctx.syncNativeAppearanceChrome(snapshot.settings);
      return {
        status: "accepted",
        requestId: command.id,
        payload: snapshot
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "appearance.list_failed",
        "加载外观设置失败。",
        error
      );
    }
  }

  if (command.type === "appearance.save") {
    try {
      const settings = AppearanceSettingsSchema.parse(command.payload);
      if (command.payload.captureCurrentWindowSize) {
        const window = ctx.getMainWindow();
        const { width, height } = window.getBounds();
        settings.startupWindowSize = { width, height };
      }
      const snapshot = AppearanceSettingsSnapshotSchema.parse(
        await ctx.requireAppearanceService().save(settings)
      );
      ctx.syncNativeAppearanceChrome(snapshot.settings);
      return {
        status: "accepted",
        requestId: command.id,
        payload: snapshot
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "appearance.save_failed",
        "保存外观设置失败。",
        error
      );
    }
  }

  if (command.type === "appearance.fonts.list") {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: AppearanceFontCatalogSnapshotSchema.parse(
          await ctx.requireAppearanceService().listFonts()
        )
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "appearance.fonts.list_failed",
        "加载本地字体失败。",
        error
      );
    }
  }

  if (command.type === "appearance.fonts.install") {
    try {
      const selection = await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
        title: nativeText("uploadFont"),
        buttonLabel: "上传",
        filters: [
          { name: nativeText("fontFiles"), extensions: ["ttf", "otf"] }
        ],
        properties: ["openFile", "multiSelections"]
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: AppearanceFontInstallResultSchema.parse({
            status: "canceled"
          })
        };
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: AppearanceFontInstallResultSchema.parse(
          await ctx.requireAppearanceService().installFonts(selection.filePaths)
        )
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "appearance.fonts.install_failed",
        "上传本地字体失败。",
        error
      );
    }
  }

  if (command.type === "appearance.fonts.remove") {
    try {
      const result = AppearanceFontRemoveResultSchema.parse(
        await ctx.requireAppearanceService().removeFont(command.payload.id)
      );
      ctx.syncNativeAppearanceChrome(result.appearance.settings);
      return {
        status: "accepted",
        requestId: command.id,
        payload: result
      };
    } catch (error: unknown) {
      return rejected(
        command,
        "appearance.fonts.remove_failed",
        "删除本地字体失败。",
        error
      );
    }
  }

  return undefined;
}
