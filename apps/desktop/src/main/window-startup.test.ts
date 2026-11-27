import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardWindowStartup } from "./window-startup";

function setup(show = true, activate?: boolean) {
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    show: vi.fn(),
    showInactive: vi.fn(),
    isDestroyed: vi.fn(() => false)
  });
  const onFailure = vi.fn();
  const log = { path: "/test/startup.log", write: vi.fn() };
  const guard = guardWindowStartup(window as unknown as BrowserWindow, {
    log,
    onFailure,
    show,
    ...(activate === undefined ? {} : { activate }),
    timeoutMs: 1000
  });
  return { window, onFailure, log, guard };
}

describe("window startup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a loaded window even when ready-to-show never arrives", () => {
    const { window, onFailure, log } = setup();
    window.webContents.emit("did-finish-load");
    vi.advanceTimersByTime(2000);
    expect(window.show).toHaveBeenCalledOnce();
    expect(log.write).toHaveBeenCalledWith("window.loaded");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("shows only once and removes startup listeners after loading", () => {
    const { window, onFailure } = setup();
    window.emit("ready-to-show");
    window.webContents.emit("did-finish-load");
    window.webContents.emit("render-process-gone", {}, { exitCode: 1 });
    expect(window.show).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    expect(window.webContents.listenerCount("preload-error")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a test instance without taking focus", () => {
    const { window } = setup(true, false);
    window.webContents.emit("did-finish-load");
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.show).not.toHaveBeenCalled();
  });

  it("keeps smoke windows hidden while still observing successful loading", () => {
    const { window, log } = setup(false);
    window.emit("ready-to-show");
    window.webContents.emit("did-finish-load");
    expect(window.show).not.toHaveBeenCalled();
    expect(log.write).toHaveBeenCalledWith("window.loaded");
  });

  it("fails a preload error once and never shows the failed window", () => {
    const { window, onFailure, guard } = setup();
    const error = new Error("test preload failure");
    window.webContents.emit("preload-error", {}, "/test/preload.js", error);
    guard.fail(error);
    window.webContents.emit("did-finish-load");
    vi.advanceTimersByTime(2000);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
    expect(window.show).not.toHaveBeenCalled();
  });

  it("reports a renderer exit before the page finishes loading", () => {
    const { window, onFailure } = setup();
    window.webContents.emit(
      "render-process-gone",
      {},
      { exitCode: -1073741819 }
    );
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: -1073741819 })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "bounds a stalled page load, even after first paint: %s",
    (firstPaint) => {
      const { window, onFailure } = setup();
      if (firstPaint) window.emit("ready-to-show");
      vi.advanceTimersByTime(999);
      expect(onFailure).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ code: "WINDOW_STARTUP_TIMEOUT" })
      );
    }
  );

  it("cancels the timer and ignores a load rejection after the window closes", () => {
    const { window, onFailure, guard } = setup();
    window.isDestroyed.mockReturnValue(true);
    window.emit("closed");
    guard.fail(new Error("ERR_ABORTED"));
    vi.advanceTimersByTime(2000);
    expect(onFailure).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
  });

  it("surfaces a rejected load instead of leaving a hidden window", () => {
    const { guard, window, onFailure } = setup();
    const error = Object.assign(new Error("test load failure"), {
      code: "ERR_FILE_NOT_FOUND"
    });
    guard.fail(error);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
    expect(window.show).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
