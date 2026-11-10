import { installWindowFrame, usesCustomWindowFrame } from "./window-frame";
import { BrowserWindow, screen, shell } from "electron";
import { join } from "node:path";
import type { AppearanceSettings } from "@deepwrite/contracts";
import {
  applyNativeAppearanceChrome,
  resolveNativeBackgroundColor
} from "./native-appearance-chrome";
import { loadWindowRenderer } from "./window-renderer";
import { installTextContextMenu } from "./text-context-menu";
import { guardWindowStartup } from "./window-startup";
import { resolveStartupWindowSize } from "./startup-window-size";
import type { StartupLog } from "./startup-log";

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

const ZHUQUE_DETECTION_ORIGIN = "https://matrix.tencent.com";

function isAllowedZhuqueDetectionUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === ZHUQUE_DETECTION_ORIGIN;
  } catch {
    return false;
  }
}

export function createDesktopWindow(
  appearance: AppearanceSettings,
  startup: { log: StartupLog; fail: (error: unknown) => void }
): BrowserWindow {
  const isDarwin = process.platform === "darwin";
  const window = new BrowserWindow({
    ...resolveStartupWindowSize(
      appearance.startupWindowSize,
      screen.getPrimaryDisplay().workAreaSize
    ),
    center: true,
    show: false,
    ...(usesCustomWindowFrame() ? { frame: false } : {}),
    backgroundColor: resolveNativeBackgroundColor(appearance),
    title: "DeepWrite",
    icon: join(__dirname, "../renderer/app-icon.png"),
    ...(isDarwin
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 10 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Inactive smoke windows still need timers and transition frames.
      backgroundThrottling: process.env.DEEPWRITE_SMOKE !== "1",
      webviewTag: true
    }
  });
  installTextContextMenu(window);
  installWindowFrame(window);

  applyNativeAppearanceChrome(appearance, [window]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (
        typeof params.src !== "string" ||
        !isAllowedZhuqueDetectionUrl(params.src)
      ) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    }
  );

  window.webContents.on("did-attach-webview", (_event, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
    guestContents.on("will-navigate", (event, url) => {
      if (isAllowedZhuqueDetectionUrl(url)) return;
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    });
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  const loading = guardWindowStartup(window, {
    log: startup.log,
    onFailure: startup.fail,
    show: process.env.DEEPWRITE_SMOKE !== "1"
  });

  void loadWindowRenderer(
    window,
    join(__dirname, "../renderer/index.html"),
    process.env.ELECTRON_RENDERER_URL
  ).catch(loading.fail);

  return window;
}
