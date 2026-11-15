import { afterEach, expect, it, vi } from "vitest";
import { feedbackSmokeInRenderer } from "./smoke-feedback";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("checks and dismisses the shared login dialog for signed-out feedback", async () => {
  vi.useFakeTimers();
  let loginOpen = false;
  const close = vi.fn(() => {
    loginOpen = false;
  });
  vi.stubGlobal("deepwrite", {
    feedback: {
      captureWindow: async () => ({
        contentType: "image/png",
        data: btoa("\x89PNG\r\n\x1a\n")
      })
    }
  });
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      if (selector === ".account-identity-button")
        return { getAttribute: () => "true" };
      if (selector === ".account-feedback-button")
        return { click: () => (loginOpen = true) };
      if (selector === ".marketplace-login-dialog .auth-form")
        return loginOpen ? {} : null;
      if (selector === ".marketplace-login-dialog .dialog-close")
        return loginOpen ? { click: close } : null;
      return null;
    }
  });
  const result = feedbackSmokeInRenderer();
  const assertion = expect(result).resolves.toMatchObject({
    status: "ok",
    signInRequired: true
  });
  await Promise.all([assertion, vi.runAllTimersAsync()]);
  expect(close).toHaveBeenCalledOnce();
});
