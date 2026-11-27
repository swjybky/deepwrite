import type { BrowserWindow } from "electron";
import type { StartupLog } from "./startup-log";

interface WindowStartupOptions {
  log: StartupLog;
  onFailure: (error: unknown) => void;
  show: boolean;
  /** False shows the window behind the current app without taking focus. */
  activate?: boolean;
  timeoutMs?: number;
}

/** A hidden window must either finish loading or report a bounded startup failure. */
export function guardWindowStartup(
  window: BrowserWindow,
  options: WindowStartupOptions
) {
  let settled = false;
  let shown = false;
  const show = (): void => {
    if (!shown && !settled && !window.isDestroyed() && options.show) {
      shown = true;
      if (options.activate === false) window.showInactive();
      else window.show();
    }
  };
  const cleanup = (): void => {
    settled = true;
    clearTimeout(timer);
    window.removeListener("ready-to-show", show);
    window.removeListener("closed", cleanup);
    window.webContents.removeListener("did-finish-load", loaded);
    window.webContents.removeListener("preload-error", preloadFailed);
    window.webContents.removeListener("render-process-gone", rendererGone);
  };
  const fail = (error: unknown): void => {
    if (settled) return;
    cleanup();
    options.onFailure(error);
  };
  const loaded = (): void => {
    // Some machines never emit ready-to-show. A completed load is also sufficient.
    show();
    cleanup();
    options.log.write("window.loaded");
  };
  const preloadFailed = (_event: unknown, _path: string, error: Error): void =>
    fail(error);
  const rendererGone = (
    _event: unknown,
    details: Electron.RenderProcessGoneDetails
  ): void => {
    fail(
      Object.assign(new Error("Renderer exited during startup"), {
        code: details.exitCode
      })
    );
  };
  const timer = setTimeout(() => {
    fail(
      Object.assign(new Error("Window startup timed out"), {
        code: "WINDOW_STARTUP_TIMEOUT"
      })
    );
  }, options.timeoutMs ?? 30_000);
  timer.unref();
  window.once("ready-to-show", show);
  window.once("closed", cleanup);
  window.webContents.once("did-finish-load", loaded);
  window.webContents.once("preload-error", preloadFailed);
  window.webContents.once("render-process-gone", rendererGone);
  return { fail };
}
