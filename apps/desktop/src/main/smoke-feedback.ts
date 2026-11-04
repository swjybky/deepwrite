import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";

/** Captures the real window through Preload and Main, then opens the lazy dialog. */
async function feedbackSmokeInRenderer() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Feedback smoke: ${reason}`);
  };

  const capture = await api.feedback.captureWindow();
  ensure(capture.contentType === "image/png", "capture is not a PNG");
  ensure(
    atob(capture.data.slice(0, 8)).startsWith("\x89PNG"),
    "capture does not hold PNG bytes"
  );

  const account = document.querySelector<HTMLElement>(
    ".account-identity-button"
  );
  ensure(account, "account menu button missing");
  if (account!.getAttribute("aria-expanded") !== "true") account!.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const entry = document.querySelector<HTMLElement>(".account-feedback-button");
  ensure(entry, "account menu feedback entry missing");
  entry!.click();
  let signInRequired = false;
  for (let attempt = 0; attempt < 100 && !signInRequired; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    signInRequired = Boolean(
      document.querySelector(".feedback-dialog .auth-form")
    );
  }
  ensure(signInRequired, "a signed-out user was not asked to sign in");
  document
    .querySelector<HTMLElement>(".feedback-dialog .dialog-close")
    ?.click();
  return { status: "ok", captureBytes: capture.data.length, signInRequired };
}

export function runFeedbackSmoke(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `(${feedbackSmokeInRenderer.toString()})()`
  );
}
