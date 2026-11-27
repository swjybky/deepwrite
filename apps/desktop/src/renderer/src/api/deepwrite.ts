import type { DeepWriteApi } from "@deepwrite/contracts";

/**
 * The Preload bridge. This is the only module that reads it; it is undefined
 * outside Electron (unit tests, static previews).
 */
export function deepwriteApi(): DeepWriteApi | undefined {
  if (typeof window === "undefined" || !("deepwrite" in window))
    return undefined;
  return window.deepwrite as DeepWriteApi | undefined;
}
