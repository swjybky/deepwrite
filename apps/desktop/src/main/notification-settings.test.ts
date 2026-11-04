import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationSettingsUrl } from "./task-notification-policy";

const electron = vi.hoisted(() => ({
  isPackaged: true,
  openExternal: vi.fn(async (_url: string) => undefined)
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electron.isPackaged;
    }
  },
  shell: { openExternal: electron.openExternal }
}));

import {
  canOpenNotificationSettings,
  openNotificationSettings
} from "./notification-settings";

const realPlatform = process.platform;

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  electron.isPackaged = true;
  electron.openExternal.mockReset();
  electron.openExternal.mockResolvedValue(undefined);
});

describe("notification settings destination", () => {
  it("opens this app's entry on macOS, in both packaged and development runs", () => {
    expect(notificationSettingsUrl("darwin", true)).toBe(
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=cn.deepwrite.desktop"
    );
    expect(notificationSettingsUrl("darwin", false)).toContain(
      "?id=com.github.Electron"
    );
  });

  it("opens the notification list on Windows, which has no per-app page", () => {
    expect(notificationSettingsUrl("win32", true)).toBe(
      "ms-settings:notifications"
    );
  });

  it("has nothing to open on other systems", () => {
    expect(notificationSettingsUrl("linux", true)).toBeUndefined();
  });
});

describe("opening notification settings", () => {
  it("hands the system its own settings address", async () => {
    usePlatform("win32");
    await expect(openNotificationSettings("cmd-1")).resolves.toEqual({
      status: "accepted",
      requestId: "cmd-1",
      payload: { opened: true }
    });
    expect(electron.openExternal).toHaveBeenCalledWith(
      "ms-settings:notifications"
    );
  });

  it("rejects the command when the system cannot open the page", async () => {
    usePlatform("darwin");
    electron.openExternal.mockRejectedValueOnce(new Error("no handler"));
    await expect(openNotificationSettings("cmd-2")).resolves.toMatchObject({
      status: "rejected",
      requestId: "cmd-2",
      error: {
        code: "general_settings.open_notification_settings_failed",
        message: "no handler"
      }
    });
  });

  it("reports no settings page without calling the system", async () => {
    usePlatform("linux");
    expect(canOpenNotificationSettings()).toBe(false);
    await expect(openNotificationSettings("cmd-3")).resolves.toMatchObject({
      status: "rejected"
    });
    expect(electron.openExternal).not.toHaveBeenCalled();
  });
});
