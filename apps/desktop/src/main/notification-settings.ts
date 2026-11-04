import { app, shell } from "electron";
import type { CommandResult } from "@deepwrite/contracts";
import { safeErrorDetails } from "./ipc/errors";
import { notificationSettingsUrl } from "./task-notification-policy";

function settingsUrl(): string | undefined {
  return notificationSettingsUrl(process.platform, app.isPackaged);
}

export function canOpenNotificationSettings(): boolean {
  return settingsUrl() !== undefined;
}

export async function openNotificationSettings(
  requestId: string
): Promise<CommandResult> {
  try {
    const url = settingsUrl();
    if (!url) throw new Error("此系统没有可打开的通知设置页。");
    await shell.openExternal(url);
    return { status: "accepted", requestId, payload: { opened: true } };
  } catch (error: unknown) {
    return {
      status: "rejected",
      requestId,
      error: {
        code: "general_settings.open_notification_settings_failed",
        message:
          error instanceof Error ? error.message : "打开系统通知设置失败。",
        details: safeErrorDetails(error)
      }
    };
  }
}
