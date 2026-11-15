import { readFileSync, rmSync, writeFileSync } from "node:fs";

/** Written just before the installer starts; the next app start reads it. */
export function writeUpdateInstallMarker(path: string, version: string): void {
  writeFileSync(path, `${JSON.stringify({ version })}\n`, "utf8");
}

/** Reads and removes the marker; a missing or damaged one reads as absent. */
export function takeUpdateInstallMarker(path: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  rmSync(path, { force: true });
  try {
    const { version } = JSON.parse(text) as { version?: unknown };
    return typeof version === "string" && version ? version : undefined;
  } catch {
    return undefined;
  }
}
