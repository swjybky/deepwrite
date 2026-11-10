import { app, systemPreferences, type BrowserWindow } from "electron";

/** Only the local application's top-level frame may request audio capture. */
export function isTrustedVoiceFrame(
  requestingUrl: string | undefined,
  currentUrl: string,
  isMainFrame: boolean
): boolean {
  if (!isMainFrame || !requestingUrl || !currentUrl) return false;
  try {
    const requested = new URL(requestingUrl);
    const current = new URL(currentUrl);
    requested.hash = "";
    current.hash = "";
    return requested.href === current.href;
  } catch {
    return false;
  }
}

export function installVoicePermissions(window: BrowserWindow): void {
  const contents = window.webContents;
  const trusted = (
    sender: Electron.WebContents | null,
    details: { requestingUrl?: string; isMainFrame: boolean }
  ) =>
    !window.isDestroyed() &&
    sender === contents &&
    isTrustedVoiceFrame(
      details.requestingUrl,
      contents.getURL(),
      details.isMainFrame
    );
  contents.session.setPermissionCheckHandler(
    (sender, permission, _origin, details) => {
      if (permission !== "media") return true;
      return trusted(sender, details) && details.mediaType === "audio";
    }
  );
  contents.session.setPermissionRequestHandler(
    (sender, permission, callback, details) => {
      if (permission !== "media") {
        // Preserve the application's existing behavior for non-capture permissions.
        callback(permission !== "display-capture");
        return;
      }
      const mediaTypes =
        "mediaTypes" in details ? details.mediaTypes : undefined;
      callback(
        trusted(sender, details) &&
          mediaTypes?.length === 1 &&
          mediaTypes[0] === "audio"
      );
    }
  );
}

export async function requestVoiceMicrophoneAccess(): Promise<boolean> {
  // Smoke capture uses Chromium's synthetic device and must not request host audio.
  if (
    process.env.DEEPWRITE_SMOKE === "1" &&
    app.commandLine.hasSwitch("use-fake-device-for-media-stream")
  )
    return true;
  if (process.platform !== "darwin") return true;
  const state = systemPreferences.getMediaAccessStatus("microphone");
  if (state === "granted") return true;
  if (state === "denied" || state === "restricted") return false;
  return systemPreferences.askForMediaAccess("microphone");
}
