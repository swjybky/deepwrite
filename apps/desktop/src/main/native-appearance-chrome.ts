import { BrowserWindow, nativeTheme } from "electron";
import type { AppearanceSettings } from "@deepwrite/contracts";

export type NativeColorScheme = "light" | "dark";

export function resolveNativeColorScheme(
  settings: AppearanceSettings,
  systemPrefersDark = nativeTheme.shouldUseDarkColors
): NativeColorScheme {
  if (settings.mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return settings.mode;
}

export function resolveNativeBackgroundColor(
  settings: AppearanceSettings,
  systemPrefersDark = nativeTheme.shouldUseDarkColors
): string {
  return settings[resolveNativeColorScheme(settings, systemPrefersDark)].background;
}

export function applyNativeAppearanceChrome(
  settings: AppearanceSettings,
  windows: readonly BrowserWindow[] = BrowserWindow.getAllWindows()
): void {
  nativeTheme.themeSource = settings.mode === "system" ? "system" : settings.mode;
  const background = resolveNativeBackgroundColor(settings);
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(background);
    }
  }
}
