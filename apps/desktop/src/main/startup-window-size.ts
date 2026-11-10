import type { AppearanceSettings } from "@deepwrite/contracts";

export function resolveStartupWindowSize(
  saved: AppearanceSettings["startupWindowSize"],
  workArea: { width: number; height: number }
): { width: number; height: number; minWidth: number; minHeight: number } {
  const minWidth = Math.min(1120, workArea.width);
  const minHeight = Math.min(700, workArea.height);
  return {
    width: Math.min(workArea.width, Math.max(minWidth, saved?.width ?? 1200)),
    height: Math.min(
      workArea.height,
      Math.max(minHeight, saved?.height ?? 800)
    ),
    minWidth,
    minHeight
  };
}
