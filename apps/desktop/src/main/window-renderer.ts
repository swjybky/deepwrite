import type { BrowserWindow } from "electron";

/** Load the local build when the development server is unavailable at startup. */
export async function loadWindowRenderer(
  window: Pick<BrowserWindow, "loadURL" | "loadFile" | "isDestroyed">,
  indexPath: string,
  developmentUrl?: string
): Promise<void> {
  if (developmentUrl) {
    try {
      await window.loadURL(developmentUrl);
      return;
    } catch {
      if (window.isDestroyed()) return;
      // The built renderer uses the same validated preload bridge.
    }
  }
  if (!window.isDestroyed()) await window.loadFile(indexPath);
}
